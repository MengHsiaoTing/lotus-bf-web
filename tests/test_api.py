import gzip
import json
from pathlib import Path
from unittest.mock import MagicMock

import nibabel as nib
import numpy as np
import pytest
from flask import Flask
from sqlalchemy.exc import OperationalError

from lotus_api import QueryError, compile_query, create_api, make_map, parse_query

ROOT = Path(__file__).resolve().parents[1]


def evaluate(node, terms, point=False):
    op = node[0]
    if op == 'and': return evaluate(node[1], terms, point) and evaluate(node[2], terms, point)
    if op == 'or': return evaluate(node[1], terms, point) or evaluate(node[2], terms, point)
    if op == 'not': return not evaluate(node[1], terms, point)
    if op == 'point': return point
    return node[1] in terms


@pytest.mark.parametrize('query,terms,expected', [
    ('memory AND attention', {'memory', 'attention'}, True),
    ('memory AND attention', {'memory'}, False),
    ('memory OR attention', {'attention'}, True),
    ('memory NOT attention', {'memory'}, True),
    ('memory NOT attention', {'memory', 'attention'}, False),
    ('memory attention', {'memory', 'attention'}, True),
    ('memory OR attention AND emotion', {'memory'}, True),
    ('(memory OR attention) AND emotion', {'memory'}, False),
    ('NOT (memory OR attention)', {'emotion'}, True),
    ('"working memory" AND emotion', {'working memory', 'emotion'}, True),
    ('memory and NOT emotion', {'memory'}, True),
])
def test_boolean_meaning(query, terms, expected):
    assert evaluate(parse_query(query), terms) is expected


def test_mixed_or_is_preserved():
    ast = parse_query('memory OR [-22,0,-20]')
    assert evaluate(ast, set(), point=True)
    assert evaluate(ast, {'memory'}, point=False)
    assert not evaluate(ast, set(), point=False)
    sql, values = compile_query('memory AND [-22,0,-20]')
    assert 'INTERSECT' in sql
    assert 'ST_3DDistance' in sql
    assert '< :radius' in sql
    assert -22 in values.values()


@pytest.mark.parametrize('query', ['', '(', 'memory AND', 'memory OR OR emotion', 'memory)', '[1,2]', '[nan,0,0]', '[inf,0,0]', '[1001,0,0]', '"unfinished', '[]', '""'])
def test_malformed_rejected(query):
    with pytest.raises(QueryError): parse_query(query)


def test_bind_parameters():
    query = '"memory; DROP TABLE ns.metadata; --"'
    sql, params = compile_query(query)
    assert 'DROP TABLE' not in sql
    assert query[1:-1] in params.values()
    assert 'phraseto_tsquery' in sql


def make_client(engine):
    app = Flask(__name__)
    app.register_blueprint(create_api(lambda: engine))
    return app.test_client()


def test_pagination_contract():
    engine = MagicMock()
    conn = engine.begin.return_value.__enter__.return_value
    counted, records = MagicMock(), MagicMock()
    counted.scalar_one.return_value = 45
    records.mappings.return_value.all.return_value = [dict(study_id='123', title='Example', year=2020, fts='internal')]
    conn.execute.side_effect = [counted, records]
    result = make_client(engine).get('/query/memory/studies?limit=20&offset=20&sort=asc')
    assert result.status_code == 200
    assert result.json['total'] == 45
    assert result.json['offset'] == 20
    assert result.json['results'][0]['study_id'] == '123'
    assert 'fts' not in result.json['results'][0]
    sql, params = conn.execute.call_args.args
    assert 'm.year ASC' in str(sql)
    assert params['offset'] == 20 and params['limit'] == 20


@pytest.mark.parametrize('suffix', ['?r=nan', '?r=-1', '?r=inf', '?limit=100000', '?limit=x', '?offset=-1', '?sort=drop'])
def test_invalid_parameters_before_db(suffix):
    engine = MagicMock()
    response = make_client(engine).get('/query/memory/studies' + suffix)
    assert response.status_code == 400
    engine.begin.assert_not_called()


def test_database_failure_no_secret():
    engine = MagicMock()
    engine.begin.side_effect = OperationalError('SQL', {}, Exception('postgres://secret-password'))
    response = make_client(engine).get('/query/memory/studies')
    assert response.status_code == 503
    assert 'secret-password' not in response.get_data(as_text=True)


def test_missing_database_configuration(monkeypatch):
    import app
    monkeypatch.delenv('DB_URL', raising=False)
    monkeypatch.delenv('DATABASE_URL', raising=False)
    monkeypatch.setattr(app, '_engine', None)
    client = app.create_app().test_client()
    assert client.get('/health').status_code == 200
    assert client.get('/query/memory/studies').status_code == 503
    assert client.get('/health/db').status_code == 503


def test_nifti_world_coordinate_and_duplicate_counts():
    template_path = ROOT / 'public/static/mni_2mm.nii.gz'
    template = nib.load(template_path)
    index = np.array([30, 40, 35])
    world = nib.affines.apply_affine(template.affine, index)
    row = dict(zip(('x', 'y', 'z'), world))
    blob, count = make_map([row, row, dict(x=9999,y=0,z=0)], template_path, fwhm=0)
    image = nib.Nifti1Image.from_bytes(gzip.decompress(blob))
    assert count == 2
    np.testing.assert_allclose(image.affine, template.affine)
    assert image.shape == template.shape[:3]
    assert image.get_fdata()[tuple(index)] == 2
    assert image.get_fdata().sum() == 2
    assert image.header.get_xyzt_units()[0] == 'mm'


def test_smoothed_and_empty_map():
    path = ROOT / 'public/static/mni_2mm.nii.gz'
    data, count = make_map([dict(x=0,y=0,z=0)], path)
    image = nib.Nifti1Image.from_bytes(gzip.decompress(data))
    assert count == 1 and np.count_nonzero(image.get_fdata()) > 1
    data, count = make_map([], path)
    assert count == 0
    assert not nib.Nifti1Image.from_bytes(gzip.decompress(data)).get_fdata().any()


def test_static_files_and_legacy_routes():
    import app
    client = app.create_app().test_client()
    assert client.get('/').location == '/lotus-bf/'
    assert client.get('/lotus-bf/').status_code == 200
    assert len(client.get('/lotus-bf/terms.json').json['terms']) == 3168
    assert client.get('/lotus-bf/missing.json').status_code == 404
    assert client.get('/lotus-bf/../../app.py').status_code == 404
    assert client.get('/assignment').status_code == 200
    assert client.get('/terms/memory/studies').get_data(as_text=True) == 'memory'
    assert client.get('/locations/0_1_2/studies').json == [0,1,2]
    rules = {r.rule for r in app.app.url_map.iter_rules()}
    assert '/dissociate/terms/<term_a>/<term_b>' in rules
    assert '/dissociate/locations/<coords_a>/<coords_b>' in rules


def test_terms_file():
    terms = json.loads((ROOT/'public/terms.json').read_text())['terms']
    assert len(terms) == len(set(terms)) == 3168
    assert terms == sorted(terms)
    assert all(not term[0].isdigit() for term in terms)
