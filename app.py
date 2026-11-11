# app.py
from flask import Flask, jsonify, abort, send_file, send_from_directory, redirect
from pathlib import Path
import os
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import OperationalError

_engine = None

def get_engine():
    global _engine
    if _engine is not None:
        return _engine
    db_url = os.getenv("DB_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("Missing DB_URL (or DATABASE_URL) environment variable.")
    # Normalize old 'postgres://' scheme to 'postgresql://'
    if db_url.startswith("postgres://"):
        db_url = "postgresql://" + db_url[len("postgres://"):]
    _engine = create_engine(
        db_url,
        pool_pre_ping=True,
        pool_size=2, max_overflow=1, pool_timeout=10,
        connect_args={"connect_timeout": 10, "options": "-c statement_timeout=25000"},
    )
    return _engine

def create_app():
    app = Flask(__name__)

    @app.get("/assignment", endpoint="health")
    def health():
        return """
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport"
                  content="width=device-width, initial-scale=1">
            <title>Neurosynth API Server</title>
        </head>
        <body>
            <h1>Neurosynth API Server</h1>
            <p>
                Query Neurosynth data with Flask and PostgreSQL.
                Find studies that match A but not B.
            </p>

            <h2>Term search</h2>
            <p>
                A：posterior cingulate<br>
                B：ventromedial prefrontal
            </p>
            <ul>
                <li>
                    <a href="/dissociate/terms/posterior_cingulate/ventromedial_prefrontal">
                        A − B：includes term A, excludes term B
                    </a>
                </li>
                <li>
                    <a href="/dissociate/terms/ventromedial_prefrontal/posterior_cingulate">
                        B − A：includes term B, excludes term A
                    </a>
                </li>
            </ul>

            <h2>MNI coordinate search</h2>
            <p>
                A：[0, -52, 26]<br>
                B：[-2, 50, -6]
            </p>
            <ul>
                <li>
                    <a href="/dissociate/locations/0_-52_26/-2_50_-6">
                        A − B：has coordinates A, excludes coordinates B
                    </a>
                </li>
                <li>
                    <a href="/dissociate/locations/-2_50_-6/0_-52_26">
                        B − A：has coordinates B, excludes coordinates A
                    </a>
                </li>
            </ul>

            <h2>Image and database checks</h2>
            <ul>
                <li><a href="/img">View amygdala image</a></li>
                <li><a href="/test_db">Check database connection and record counts</a></li>
            </ul>

            <h2>Query notes</h2>
            <ul>
                <li>Term queries use annotations with weights greater than zero.</li>
                <li>Legacy coordinate queries require exact matches.</li>
                <li>Results are JSON with up to 100 studies.</li>
                <li>total_studies is the total number of matching studies.</li>
            </ul>
        </body>
        </html>
        """

    @app.get("/img", endpoint="show_img")
    def show_img():
        image = Path(__file__).resolve().parent / 'legacy-assets' / 'amygdala.gif'
        if not image.is_file():
            return jsonify(error='Place amygdala.gif in legacy-assets to enable the legacy demonstration.'), 404
        return send_file(image, mimetype="image/gif")

    @app.get("/terms/<term>/studies", endpoint="terms_studies")
    def get_studies_by_term(term):
        return term

    @app.get("/locations/<coords>/studies", endpoint="locations_studies")
    def get_studies_by_coordinates(coords):
        x, y, z = map(int, coords.split("_"))
        return jsonify([x, y, z])

    @app.get("/test_db", endpoint="test_db")
    
    def test_db():
        eng = get_engine()
        payload = {"ok": False, "dialect": eng.dialect.name}

        try:
            with eng.begin() as conn:
                # Ensure we are in the correct schema
                conn.execute(text("SET search_path TO ns, public;"))
                payload["version"] = conn.exec_driver_sql("SELECT version()").scalar()

                # Counts
                payload["coordinates_count"] = conn.execute(text("SELECT COUNT(*) FROM ns.coordinates")).scalar()
                payload["metadata_count"] = conn.execute(text("SELECT COUNT(*) FROM ns.metadata")).scalar()
                payload["annotations_terms_count"] = conn.execute(text("SELECT COUNT(*) FROM ns.annotations_terms")).scalar()

                # Samples
                try:
                    rows = conn.execute(text(
                        "SELECT study_id, ST_X(geom) AS x, ST_Y(geom) AS y, ST_Z(geom) AS z FROM ns.coordinates LIMIT 3"
                    )).mappings().all()
                    payload["coordinates_sample"] = [dict(r) for r in rows]
                except Exception:
                    payload["coordinates_sample"] = []

                try:
                    # Select a few columns if they exist; otherwise select a generic subset
                    rows = conn.execute(text("SELECT * FROM ns.metadata LIMIT 3")).mappings().all()
                    payload["metadata_sample"] = [dict(r) for r in rows]
                except Exception:
                    payload["metadata_sample"] = []

                try:
                    rows = conn.execute(text(
                        "SELECT study_id, contrast_id, term, weight FROM ns.annotations_terms LIMIT 3"
                    )).mappings().all()
                    payload["annotations_terms_sample"] = [dict(r) for r in rows]
                except Exception:
                    payload["annotations_terms_sample"] = []

            payload["ok"] = True
            return jsonify(payload), 200

        except Exception as e:
            app.logger.warning("Database check failed (%s)", type(e).__name__)
            payload["error"] = "Cannot read the database. Check DB_URL, tables and database status."
            return jsonify(payload), 500
        # 將查到的研究 ID 配上研究標題、作者、年份等資料。
    def study_results(conn, query, params):
        rows = conn.execute(
            text(f"""
                WITH matched AS (
                    {query}
                )
                SELECT DISTINCT
                    m.study_id,
                    m.title,
                    m.authors,
                    m.year,
                    m.journal
                FROM ns.metadata AS m
                JOIN matched AS s ON m.study_id = s.study_id
                ORDER BY m.study_id
                LIMIT 100
            """),
            params,
        ).mappings().all()

        count = conn.execute(
            text(f"""
                SELECT COUNT(*)
                FROM ({query}) AS matched
            """),
            params,
        ).scalar_one()

        return {
            "total_studies": count,
            "returned_records": len(rows),
            "limit": 100,
            "studies": [dict(row) for row in rows],
        }

    # 找出包含 term_a、但不包含 term_b 的研究。
    @app.get("/dissociate/terms/<term_a>/<term_b>")
    def dissociate_terms(term_a, term_b):
        term_a = term_a.replace("_", " ").strip().lower()
        term_b = term_b.replace("_", " ").strip().lower()

        # 老師的匯入資料可能保留 terms_abstract_tfidf__ 前綴。
        # 查詢時只取雙底線後面的詞彙，不需要重新匯入。
        query = """
            SELECT DISTINCT study_id
            FROM ns.annotations_terms
            WHERE LOWER(
                REPLACE(
                    CASE
                        WHEN POSITION('__' IN term) > 0
                        THEN SPLIT_PART(term, '__', 2)
                        ELSE term
                    END,
                    '_', ' '
                )
            ) = :term_a
            AND weight > 0

            EXCEPT

            SELECT DISTINCT study_id
            FROM ns.annotations_terms
            WHERE LOWER(
                REPLACE(
                    CASE
                        WHEN POSITION('__' IN term) > 0
                        THEN SPLIT_PART(term, '__', 2)
                        ELSE term
                    END,
                    '_', ' '
                )
            ) = :term_b
            AND weight > 0
        """

        with get_engine().connect() as conn:
            result = study_results(
                conn,
                query,
                {"term_a": term_a, "term_b": term_b},
            )

        result["term_a"] = term_a
        result["term_b"] = term_b
        result["direction"] = "A minus B"
        return jsonify(result)

    # 找出包含第一組座標、但不包含第二組座標的研究。
    @app.get("/dissociate/locations/<coords_a>/<coords_b>")
    def dissociate_locations(coords_a, coords_b):
        try:
            x1, y1, z1 = map(int, coords_a.split("_"))
            x2, y2, z2 = map(int, coords_b.split("_"))
        except ValueError:
            return jsonify({
                "error": "Coordinates must be three underscore-separated integers, e.g. 0_-52_26"
            }), 400

        # 此版本採用座標完全相符，不額外加入搜尋半徑。
        query = """
            SELECT DISTINCT study_id
            FROM ns.coordinates
            WHERE ST_X(geom) = :x1
              AND ST_Y(geom) = :y1
              AND ST_Z(geom) = :z1

            EXCEPT

            SELECT DISTINCT study_id
            FROM ns.coordinates
            WHERE ST_X(geom) = :x2
              AND ST_Y(geom) = :y2
              AND ST_Z(geom) = :z2
        """

        with get_engine().connect() as conn:
            result = study_results(
                conn,
                query,
                {
                    "x1": x1, "y1": y1, "z1": z1,
                    "x2": x2, "y2": y2, "z2": z2,
                },
            )

        result["coordinates_a"] = [x1, y1, z1]
        result["coordinates_b"] = [x2, y2, z2]
        result["match_mode"] = "exact"
        result["direction"] = "A minus B"
        return jsonify(result)

    # Both the built frontend and API are served from the same HTTPS origin.
    from lotus_api import create_api
    app.register_blueprint(create_api(get_engine))
    site = Path(__file__).resolve().parent / 'dist'

    @app.get('/')
    def home():
        return redirect('/lotus-bf/')

    @app.get('/lotus-bf/')
    def frontend():
        if not (site / 'index.html').is_file():
            return 'Frontend is not built. Run npm ci && npm run build.', 503
        return send_from_directory(site, 'index.html')

    @app.get('/lotus-bf/<path:filename>')
    def frontend_asset(filename):
        # Missing assets return 404, never HTML pretending to be a JSON/NIfTI file.
        response = send_from_directory(site, filename)
        if filename.startswith('assets/'):
            response.cache_control.public = True
            response.cache_control.max_age = 31536000
        return response

    @app.errorhandler(OperationalError)
    def database_unavailable(error):
        app.logger.warning('Database operation failed (%s)', type(error).__name__)
        return jsonify(error='The database is temporarily unavailable. Please try again later.'), 503

    return app

# WSGI entry point (no __main__)
app = create_app()
