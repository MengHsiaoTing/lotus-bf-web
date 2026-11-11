"""LoTUS API for the schema created by ns-nano/create_db.py.

Text search uses metadata.fts (English stemming), as the teacher's /query API does.
Coordinates use strict 3D distance < r in MNI millimetres, default r=6.
Maps include all reported coordinates in matching studies; they are not statistical maps.
All user values are SQL bind parameters. This module never creates/modifies data tables.
"""
import gzip
import io
import json
import math
import re
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_file
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

ROOT = Path(__file__).resolve().parent
TOKEN = re.compile(r'\s*(\[[^\]]*\]|"[^"\n]*"|\(|\)|[^\s()\[\]"]+)')


class QueryError(ValueError):
    pass


def parse_query(query):
    if not query.strip() or len(query) > 1200:
        raise QueryError('Enter a query of 1–1200 characters.')
    tokens, pos = [], 0
    while pos < len(query):
        if not query[pos:].strip():
            break
        match = TOKEN.match(query, pos)
        if not match:
            raise QueryError('Unmatched quotation marks or coordinate brackets.')
        tokens.append(match.group(1))
        pos = match.end()
    if len(tokens) > 100:
        raise QueryError('Query too long. Use fewer terms or parentheses.')
    index = 0

    def peek():
        return tokens[index].upper() if index < len(tokens) else None

    def primary():
        nonlocal index
        token = peek()
        if token is None:
            raise QueryError('Missing term or coordinate after an operator.')
        if token == '(':
            index += 1
            node = disjunction()
            if peek() != ')':
                raise QueryError('Missing closing parenthesis ).')
            index += 1
            return node
        if token in ('AND', 'OR', 'NOT', ')'):
            raise QueryError('Check AND, OR, NOT and parentheses.')
        raw = tokens[index]
        index += 1
        if raw.startswith('['):
            try:
                coords = tuple(float(v.strip()) for v in raw[1:-1].split(','))
            except ValueError:
                raise QueryError('Coordinates must contain three numbers, e.g. [-22,0,-20].') from None
            if len(coords) != 3 or not all(math.isfinite(v) and abs(v) <= 1000 for v in coords):
                raise QueryError('Coordinates must be three finite numbers between -1000 and 1000 mm.')
            return ('point', coords)
        phrase = raw.startswith('"')
        word = raw[1:-1] if phrase else raw
        if not word.strip():
            raise QueryError('A term cannot be empty.')
        return ('phrase' if phrase else 'term', word.strip())

    def unary():
        nonlocal index
        if peek() == 'NOT':
            index += 1
            return ('not', unary())
        return primary()

    def conjunction():
        nonlocal index
        node = unary()
        while peek() not in (None, ')', 'OR'):
            if peek() == 'AND':
                index += 1
            node = ('and', node, unary())
        return node

    def disjunction():
        nonlocal index
        node = conjunction()
        while peek() == 'OR':
            index += 1
            node = ('or', node, conjunction())
        return node

    result = disjunction()
    if index != len(tokens):
        raise QueryError('Unexpected closing parenthesis ).')
    return result


def compile_query(query, radius=6):
    """Compile each atom to a study-id set, preserving boolean grouping."""
    ast = parse_query(query)
    ctes, params = [], {'radius': radius}

    def visit(node):
        op = node[0]
        if op in ('and', 'or'):
            left, right = visit(node[1]), visit(node[2])
            sql = f'SELECT study_id FROM {left} {"INTERSECT" if op == "and" else "UNION"} SELECT study_id FROM {right}'
        elif op == 'not':
            child = visit(node[1])
            sql = f'SELECT study_id FROM ns.metadata EXCEPT SELECT study_id FROM {child}'
        elif op == 'point':
            atom = len(ctes)
            for axis, value in zip('xyz', node[1]):
                params[f'{axis}{atom}'] = value
            point = f'ST_MakePoint(:x{atom}, :y{atom}, :z{atom})'
            sql = f'''SELECT DISTINCT c.study_id FROM ns.coordinates c
                WHERE ST_3DDistance(ST_SetSRID(c.geom, 0), {point}) < :radius'''
        else:
            key = f'term{len(ctes)}'
            params[key] = node[1]
            fn = 'phraseto_tsquery' if op == 'phrase' else 'plainto_tsquery'
            ts = f"{fn}('english', :{key})"
            sql = f'''SELECT m.study_id FROM ns.metadata m
                WHERE m.fts @@ {ts}
                   OR to_tsvector('english', COALESCE(m.title, '')) @@ {ts}'''
        name = f'q{len(ctes)}'
        ctes.append(f'{name} AS ({sql})')
        return name

    last = visit(ast)
    return 'WITH ' + ',\n'.join(ctes) + f', matched AS (SELECT study_id FROM {last}) ', params


def number_arg(name, default, minimum, maximum, integer=False):
    try:
        value = (int if integer else float)(request.args.get(name, default))
    except (ValueError, TypeError):
        raise QueryError(f'{name} must be a valid number.') from None
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise QueryError(f'{name} must be between {minimum} and {maximum}.')
    return value


def make_map(rows, template_path, fwhm=10, kernel='gauss'):
    import numpy as np
    import nibabel as nib
    from scipy.ndimage import gaussian_filter

    template = nib.load(str(template_path))
    shape = template.shape[:3]
    affine = template.affine
    inverse = np.linalg.inv(affine)
    volume = np.zeros(shape, dtype=np.float32)
    included = 0
    for row in rows:
        point = np.array([row['x'], row['y'], row['z'], 1], dtype=float)
        if not np.isfinite(point).all():
            continue
        voxel = np.rint((inverse @ point)[:3]).astype(int)
        if np.all(voxel >= 0) and np.all(voxel < shape):
            volume[tuple(voxel)] += 1
            included += 1
    if kernel == 'gauss' and fwhm > 0:
        sigma = fwhm / (2 * np.sqrt(2 * np.log(2))) / np.asarray(template.header.get_zooms()[:3])
        gaussian_filter(volume, sigma, output=volume, mode='constant', truncate=3)
    img = nib.Nifti1Image(volume, affine)
    img.set_qform(affine, code=4)
    img.set_sform(affine, code=4)
    img.header.set_xyzt_units('mm')
    img.header['cal_min'] = 0
    img.header['cal_max'] = float(volume.max())
    return gzip.compress(img.to_bytes(), mtime=0), included


def create_api(get_engine):
    bp = Blueprint('lotus', __name__)

    @bp.errorhandler(QueryError)
    def invalid_query(error):
        return jsonify(error=str(error)), 400

    @bp.errorhandler(SQLAlchemyError)
    def db_error(error):
        current_app.logger.warning('Query database error (%s)', type(error).__name__)
        return jsonify(error='Database query failed or timed out. Check the connection and /health/db.'), 503

    @bp.errorhandler(RuntimeError)
    def configuration_error(error):
        current_app.logger.warning('Backend configuration error (%s)', type(error).__name__)
        return jsonify(error='Backend setup is incomplete. Check DB_URL.'), 503

    @bp.get('/health')
    def health():
        return jsonify(ok=True, service='lotus-bf', database_checked=False)

    @bp.get('/health/db')
    def health_db():
        with get_engine().connect() as conn:
            names = ('metadata', 'coordinates', 'annotations_terms')
            tables = {name: bool(conn.execute(text('SELECT to_regclass(:name)'), {'name': f'ns.{name}'}).scalar()) for name in names}
            fts = bool(conn.execute(text("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ns' AND table_name='metadata' AND column_name='fts')")).scalar())
            postgis = bool(conn.execute(text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='postgis')")).scalar())
            populated = {name: bool(conn.execute(text(f'SELECT EXISTS (SELECT 1 FROM ns.{name})')).scalar()) if tables[name] else False for name in names}
        ok = all(tables.values()) and all(populated.values()) and fts and postgis
        return jsonify(ok=ok, tables=tables, populated=populated, fts=fts, postgis=postgis), 200 if ok else 503

    @bp.get('/terms')
    def terms():
        return send_file(ROOT / 'public' / 'terms.json', mimetype='application/json')

    @bp.get('/query/<path:query>/studies')
    def studies(query):
        radius = number_arg('r', 6, 0.1, 50)
        limit = number_arg('limit', 20, 1, 100, integer=True)
        offset = number_arg('offset', 0, 0, 1000000, integer=True)
        sort = request.args.get('sort', 'desc')
        if sort not in ('asc', 'desc'):
            raise QueryError('sort must be asc or desc.')
        cte, params = compile_query(query, radius)
        params.update(limit=limit, offset=offset)
        with get_engine().begin() as conn:
            total = conn.execute(text(cte + 'SELECT COUNT(*) FROM matched'), params).scalar_one()
            rows = conn.execute(text(cte + f'''SELECT m.* FROM ns.metadata m JOIN matched USING (study_id)
                ORDER BY m.year {sort.upper()} NULLS LAST, m.study_id
                LIMIT :limit OFFSET :offset'''), params).mappings().all()
        results = [{k: v for k, v in dict(row).items() if k != 'fts'} for row in rows]
        return jsonify(results=results, count=len(results), total=int(total), limit=limit, offset=offset)

    def coordinate_sql(query):
        cte, params = compile_query(query, number_arg('r', 6, 0.1, 50))
        return cte + '''SELECT c.study_id, ST_X(c.geom)::float AS x,
          ST_Y(c.geom)::float AS y, ST_Z(c.geom)::float AS z
          FROM ns.coordinates c JOIN matched USING (study_id)''', params

    @bp.get('/query/<path:query>/locations')
    def locations(query):
        sql, params = coordinate_sql(query)
        params['limit'] = number_arg('limit', 1000, 1, 5000, integer=True)
        params['offset'] = number_arg('offset', 0, 0, 10000000, integer=True)
        with get_engine().connect() as conn:
            rows = conn.execute(text(sql + ' ORDER BY c.study_id, x, y, z LIMIT :limit OFFSET :offset'), params).mappings().all()
        results = [dict(row) for row in rows]
        return jsonify(results=results, location_counts=len(results), limit=params['limit'], offset=params['offset'])

    @bp.get('/query/<path:query>/nii')
    def nii(query):
        sql, params = coordinate_sql(query)
        fwhm = number_arg('fwhm', 10, 0, 30)
        kernel = request.args.get('kernel', 'gauss').lower()
        if kernel not in ('gauss', 'none'):
            raise QueryError('kernel must be gauss or none.')
        if 'voxel' in request.args and number_arg('voxel', 2, 2, 2) != 2:
            raise QueryError('Maps currently use a fixed 2 mm grid.')
        template = ROOT / 'public' / 'static' / 'mni_2mm.nii.gz'
        with get_engine().connect() as conn:
            rows = conn.execution_options(stream_results=True).execute(text(sql), params)
            try:
                data, count = make_map(rows.mappings(), template, fwhm, kernel)
            finally:
                rows.close()
        response = send_file(io.BytesIO(data), mimetype='application/octet-stream', download_name='query.nii.gz')
        response.headers['X-Coordinate-Count'] = str(count)
        response.headers['Cache-Control'] = 'private, max-age=300'
        return response

    return bp
