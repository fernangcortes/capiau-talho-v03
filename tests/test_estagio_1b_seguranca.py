"""Testes de segurança HTTP, uploads, ZIPs e backup consistente do Estágio 1B (SEC-01, SEC-02)."""
from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from src.api.security import get_local_token, validate_upload_filename
from src.api.server import app
from src.config import CONFIG
from src.db.operations import add_photo, add_project, add_video
from src.db.schema import init_db
from src.search.semantic import SemanticSearch
from tests.auth_helpers import auth_headers

_INITIAL_CACHE_DIR = Path(CONFIG.CACHE_DIR).resolve()


@pytest.fixture()
def sec_env(tmp_path, monkeypatch):
    """Isola banco SQLite, pastas de mídia e Qdrant em diretório temporário."""
    work = tmp_path / "capiau_1b_sec"
    work.mkdir(parents=True, exist_ok=True)

    originals_dir = work / "originals"
    proxies_dir = work / "proxies"
    photos_proxy_dir = proxies_dir / "photos"
    thumbs_dir = proxies_dir / "thumbnails"
    cache_dir = work / "cache"
    waveforms_dir = cache_dir / "waveforms"
    exports_dir = work / "exports"

    for d in (
        originals_dir,
        proxies_dir,
        photos_proxy_dir,
        thumbs_dir,
        cache_dir,
        waveforms_dir,
        exports_dir,
    ):
        d.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(CONFIG, "DB_PATH", work / "capiau.db")
    monkeypatch.setattr(CONFIG, "ORIGINALS_DIR", originals_dir)
    monkeypatch.setattr(CONFIG, "PROXIES_DIR", proxies_dir)
    monkeypatch.setattr(CONFIG, "THUMBNAILS_DIR", thumbs_dir)
    monkeypatch.setattr(CONFIG, "CACHE_DIR", cache_dir)
    monkeypatch.setattr(CONFIG, "WAVEFORMS_DIR", waveforms_dir)
    monkeypatch.setattr(CONFIG, "EXPORTS_DIR", exports_dir)
    monkeypatch.setattr(CONFIG, "QDRANT_DB_PATH", work / "qdrant.db")

    init_db(CONFIG.DB_PATH)
    SemanticSearch._instance = None

    project_id = add_project("Projeto Segurança 1B", "Teste automatizado", "")
    client = TestClient(app)
    yield client, project_id, work
    SemanticSearch._instance = None


def _build_zip_bytes(entries: list[tuple[str, bytes, int | None]]) -> bytes:
    """Constroi um ZIP em memória com suporte a permissões Unix customizadas (ex.: symlink)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data, unix_mode in entries:
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            if unix_mode is not None:
                info.external_attr = (unix_mode & 0xFFFF) << 16
            zf.writestr(info, data)
    return buf.getvalue()


def _count_projects(db_path: Path) -> int:
    conn = sqlite3.connect(db_path)
    try:
        return int(conn.execute("SELECT COUNT(*) FROM project").fetchone()[0])
    finally:
        conn.close()


def test_rotas_protegidas_bloqueiam_sem_token_ou_origem_externa_e_liberam_com_bearer(
    sec_env, monkeypatch
):
    client, project_id, work = sec_env

    ext_dir = work / "ingest_src"
    ext_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(
        "src.services.ingest.IngestService.ingest_external_path",
        staticmethod(lambda *a, **kw: None),
    )

    monkeypatch.setattr("subprocess.check_call", lambda *a, **kw: 0)
    fake_pipeline = MagicMock()
    monkeypatch.setattr("src.api.routes.faces.get_pipeline", lambda: fake_pipeline)

    fake_s3 = MagicMock()
    fake_s3.enabled = True
    fake_s3.upload_file.return_value = True
    monkeypatch.setattr("src.services.s3_service.S3Service.get_instance", staticmethod(lambda: fake_s3))

    monkeypatch.setattr(
        "src.services.rag.RAGService.chat",
        staticmethod(lambda *a, **kw: {"answer": "ok", "sources": []}),
    )
    monkeypatch.setattr(
        "src.services.modelos_locais.baixar",
        lambda model_id: {"status": "started", "id": model_id},
    )

    cases = [
        ("POST", "/api/ingest/external", {"path": str(ext_dir), "project_id": project_id, "virtual_folder": "root"}),
        ("POST", "/api/faces/pipeline/install-insightface", None),
        ("PUT", "/api/settings/global", {"values": {"timeline.max_suggestions": 4}}),
        ("POST", "/api/onboarding/api-key", {"provider": "openrouter", "api_key": "sk-local-test"}),
        ("POST", "/api/project/backup-db", None),
        ("POST", f"/api/project/{project_id}/chat", {"message": "oi", "history": []}),
        ("POST", "/api/modelos/whisper_tiny/baixar", None),
    ]

    for method, url, payload in cases:
        kwargs = {"json": payload} if payload is not None else {}

        # 1. Sem token -> 401
        r_no_auth = client.request(method, url, **kwargs)
        assert r_no_auth.status_code == 401, f"{method} {url} sem token retornou {r_no_auth.status_code}"

        # 2. Token incorreto -> 401
        r_bad_auth = client.request(
            method, url, headers={"Authorization": "Bearer token-invalido"}, **kwargs
        )
        assert r_bad_auth.status_code == 401, f"{method} {url} token ruim retornou {r_bad_auth.status_code}"

        # 3. Origin externo mesmo com token válido -> 403
        r_ext_origin = client.request(
            method,
            url,
            headers=auth_headers({"Origin": "https://atacante.exemplo"}),
            **kwargs,
        )
        assert r_ext_origin.status_code == 403, f"{method} {url} Origin externo retornou {r_ext_origin.status_code}"

        # 4. Host não local mesmo com token válido -> 403
        r_bad_host = client.request(
            method,
            url,
            headers=auth_headers({"Host": "atacante.exemplo:8000"}),
            **kwargs,
        )
        assert r_bad_host.status_code == 403, f"{method} {url} Host externo retornou {r_bad_host.status_code}"

        # 5. Token válido + Origin local -> 200
        r_ok = client.request(
            method,
            url,
            headers=auth_headers({"Origin": "http://127.0.0.1:8000"}),
            **kwargs,
        )
        assert r_ok.status_code == 200, f"{method} {url} com Bearer retornou {r_ok.status_code}: {r_ok.text}"


def test_rotas_auxiliares_novas_protegidas_por_local_auth(sec_env):
    client, project_id, _ = sec_env

    endpoints = [
        ("POST", "/api/onboarding/chat", {"message": "oi", "history": []}),
        ("POST", "/api/onboarding/chat/stream", {"message": "oi", "history": []}),
        ("POST", "/api/timeline/ai-suggest", {"project_id": project_id, "clips": [], "tracks": []}),
        ("POST", "/api/render/revelar", {"caminho": "inexistente.mp4"}),
        ("POST", "/api/ingest/select-folder", None),
        ("POST", "/api/ingest/select-files", None),
        ("POST", "/api/ingest/external-files", {"paths": [], "project_id": project_id}),
        ("POST", "/api/project/open-folder-in-explorer", {"path": ""}),
        ("POST", "/api/project/open-proxies-folder", None),
        ("POST", f"/api/project/{project_id}/relink", {"project_id": project_id, "search_folder": "x"}),
        ("POST", f"/api/projects/{project_id}/relink", {"search_dir": "x"}),
        ("POST", "/api/video/1/relink", {"new_filepath": "x"}),
        ("POST", f"/api/project/{project_id}/analyze-all-vision", None),
        ("POST", "/api/video/1/analyze-all", None),
        ("POST", "/api/photo/1/analyze-all", None),
    ]

    for method, url, payload in endpoints:
        kwargs = {"json": payload} if payload is not None else {}
        r_no_auth = client.request(method, url, **kwargs)
        assert r_no_auth.status_code == 401, f"{method} {url} deveria exigir auth (retornou {r_no_auth.status_code})"

        r_ext_origin = client.request(
            method,
            url,
            headers=auth_headers({"Origin": "https://evil.example"}),
            **kwargs,
        )
        assert r_ext_origin.status_code == 403, f"{method} {url} deveria bloquear Origin externo"


def test_get_local_token_bloqueia_origin_externo_e_cross_site(sec_env):
    client, _, _ = sec_env

    r_ok = client.get(
        "/api/auth/local-token",
        headers={"Origin": "http://127.0.0.1:8000", "Sec-Fetch-Site": "same-origin"},
    )
    assert r_ok.status_code == 200
    assert r_ok.json()["token"] == get_local_token()
    assert r_ok.headers.get("cache-control") == "no-store"

    r_ext_origin = client.get(
        "/api/auth/local-token",
        headers={"Origin": "https://evil.example"},
    )
    assert r_ext_origin.status_code == 403

    r_cross_site = client.get(
        "/api/auth/local-token",
        headers={"Origin": "http://127.0.0.1:8000", "Sec-Fetch-Site": "cross-site"},
    )
    assert r_cross_site.status_code == 403

    r_bad_host = client.get(
        "/api/auth/local-token",
        headers={"Host": "evil.example:8000"},
    )
    assert r_bad_host.status_code == 403

    remote_client = TestClient(app, client=("203.0.113.10", 51234))
    r_remote = remote_client.get("/api/auth/local-token")
    assert r_remote.status_code == 403


def test_cache_montado_exatamente_em_config_cache_dir():
    cache_route = next(
        (r for r in app.routes if getattr(r, "path", None) == "/cache"),
        None,
    )
    assert cache_route is not None, "Rota /cache não montada no app."
    assert Path(cache_route.app.directory).resolve() == _INITIAL_CACHE_DIR


def test_cache_e_dotfiles_nunca_expoem_local_token(sec_env, monkeypatch):
    client, _, _ = sec_env
    token = get_local_token()

    # Token deve ser persistido junto ao banco (fora de CONFIG.CACHE_DIR)
    assert (Path(CONFIG.DB_PATH).parent / ".local_token").is_file()
    assert not (Path(CONFIG.CACHE_DIR) / ".local_token").exists()

    # Simula presença de .local_token na pasta montada em /cache e garante bloqueio HTTP (403/404)
    cache_route = next(r for r in app.routes if getattr(r, "path", None) == "/cache")
    monkeypatch.setattr(cache_route.app, "directory", str(CONFIG.CACHE_DIR))
    (CONFIG.CACHE_DIR / ".local_token").write_text(token, encoding="utf-8")

    for req_path, req_headers in [
        ("/cache/.local_token", None),
        ("/cache/.local_token", {"Host": "evil.example:8000"}),
        ("/cache/%2elocal_token", {"Host": "evil.example:8000"}),
        ("/cache/sub/.local_token", None),
        ("/proxies/.hidden", None),
        ("/originals/.env", None),
        ("/exports/.git", None),
    ]:
        resp = client.get(req_path, headers=req_headers or {})
        assert resp.status_code in (403, 404), f"GET {req_path} retornou {resp.status_code}"
        assert token not in resp.text, f"Token vazou na resposta de {req_path}"


def test_export_project_nao_cria_zip_em_exports_dir_e_usa_proxy_photo(sec_env, monkeypatch):
    client, project_id, _ = sec_env

    # Atualiza nome do projeto com caracteres perigosos para testar sanitização do zip_filename
    conn = sqlite3.connect(CONFIG.DB_PATH)
    conn.execute("UPDATE project SET name = ? WHERE id = ?", ("../../Evil: Projeto 2026!", project_id))
    conn.commit()
    conn.close()

    vid_id = add_video(
        project_id=project_id,
        filename="entrevista.mp4",
        filepath="/originais/entrevista.mp4",
        file_hash="hash_vid_export_1",
        video_type="interview",
        duration=12.0,
    )
    photo_id = add_photo(
        project_id=project_id,
        filename="foto_set.jpg",
        filepath="/originais/foto_set.jpg",
        file_hash="hash_photo_export_1",
        description="Claquete no set",
        tags=["claquete"],
    )

    vid_proxy = CONFIG.PROXIES_DIR / f"proxy_vid_{vid_id}.mp4"
    vid_proxy.write_bytes(b"FAKE_MP4_PROXY")
    photo_proxy = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
    photo_proxy.parent.mkdir(parents=True, exist_ok=True)
    photo_proxy.write_bytes(b"FAKE_WEBP_PROXY")

    fake_search = MagicMock()
    monkeypatch.setattr("src.search.semantic.SemanticSearch.get_instance", staticmethod(lambda: fake_search))

    resp = client.post(
        f"/api/project/{project_id}/export",
        json={
            "include_metadata": True,
            "include_proxies": True,
            "include_photos": True,
            "include_docs": False,
        },
    )
    assert resp.status_code == 200
    assert list(CONFIG.EXPORTS_DIR.iterdir()) == [], "export_project nunca deve gravar ZIP em CONFIG.EXPORTS_DIR"

    disp = resp.headers.get("content-disposition", "")
    assert ".." not in disp and "/" not in disp and "\\" not in disp

    with zipfile.ZipFile(io.BytesIO(resp.content), "r") as zf:
        names = set(zf.namelist())
        assert "metadata.json" in names
        assert f"proxies/proxy_vid_{vid_id}.mp4" in names
        assert f"proxies/photos/proxy_photo_{photo_id}.webp" in names
        assert f"proxies/photos/photo_{photo_id}.webp" not in names


def test_path_traversal_falha_400_sem_escrita_em_disco(sec_env, monkeypatch):
    client, project_id, _ = sec_env
    before_projects = _count_projects(CONFIG.DB_PATH)

    fake_search = MagicMock()
    monkeypatch.setattr("src.search.semantic.SemanticSearch.get_instance", staticmethod(lambda: fake_search))

    # Validação unitária explícita para todos os vetores (incluindo C:\evil.txt e byte nulo,
    # já que python-multipart sanitiza prefixo IE6 C:\ antes de construir UploadFile).
    for bad_name in ["../evil.mp4", "/etc/passwd", "C:\\evil.txt", "C:evil.txt", "sub\\evil.mp4", "evil\x00.mp4"]:
        with pytest.raises(Exception) as exc_info:
            validate_upload_filename(bad_name)
        assert getattr(exc_info.value, "status_code", None) == 400

    # Vetores que chegam intactos via multipart HTTP ao UploadFile.filename
    http_bad_names = ["../evil.mp4", "/etc/passwd", "C:evil.txt", "sub\\evil.mp4"]

    for bad_name in http_bad_names:
        # 1. upload-files (também em lote com arquivo válido antes para provar zero escrita)
        r_up = client.post(
            "/api/ingest/upload-files",
            data={"project_id": str(project_id), "virtual_folder": "root"},
            files=[
                ("files", ("valido.mp4", b"VALID_BYTES", "video/mp4")),
                ("files", (bad_name, b"EVIL_BYTES", "video/mp4")),
            ],
        )
        assert r_up.status_code == 400, f"upload-files aceitou {bad_name!r}: {r_up.status_code}"
        assert list(CONFIG.ORIGINALS_DIR.iterdir()) == []

        # 2. docs
        doc_name = bad_name if bad_name.endswith(".txt") else f"{bad_name}.txt"
        r_doc = client.post(
            f"/api/project/{project_id}/docs",
            files={"file": (doc_name, b"Roteiro traversal", "text/plain")},
        )
        assert r_doc.status_code == 400, f"docs aceitou {doc_name!r}: {r_doc.status_code}"

        # 3. timeline/import
        tl_name = "../x.otio" if bad_name == "../evil.mp4" else f"{bad_name}.otio"
        r_tl = client.post(
            "/api/timeline/import",
            data={"project_id": str(project_id)},
            files={"file": (tl_name, b"{}", "application/json")},
        )
        assert r_tl.status_code == 400, f"timeline/import aceitou {tl_name!r}: {r_tl.status_code}"

        # 4. project/import
        zip_name = bad_name if bad_name.endswith(".zip") else f"{bad_name}.zip"
        r_zip = client.post(
            "/api/project/import",
            files={"file": (zip_name, b"PK\x03\x04fake", "application/zip")},
        )
        assert r_zip.status_code == 400, f"project/import aceitou {zip_name!r}: {r_zip.status_code}"

    # Verifica que nenhum doc ou timeline foi inserido
    conn = sqlite3.connect(CONFIG.DB_PATH)
    try:
        assert conn.execute("SELECT COUNT(*) FROM production_doc").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM timeline").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM project").fetchone()[0] == before_projects
    finally:
        conn.close()


def test_limites_streaming_413_sem_arquivos_orfaos(sec_env, monkeypatch):
    client, project_id, _ = sec_env
    before_projects = _count_projects(CONFIG.DB_PATH)

    monkeypatch.setenv("CAPIAU_MAX_UPLOAD_FILES", "2")
    monkeypatch.setenv("CAPIAU_MAX_MEDIA_UPLOAD_BYTES", "100")
    monkeypatch.setenv("CAPIAU_MAX_TOTAL_UPLOAD_BYTES", "150")
    monkeypatch.setenv("CAPIAU_MAX_DOC_UPLOAD_BYTES", "60")
    monkeypatch.setenv("CAPIAU_MAX_TIMELINE_UPLOAD_BYTES", "60")
    monkeypatch.setenv("CAPIAU_MAX_IMPORT_ZIP_BYTES", "100")

    # 1a. upload-files: arquivo único acima do limite -> 413 sem sobras
    r_single = client.post(
        "/api/ingest/upload-files",
        data={"project_id": str(project_id)},
        files=[("files", ("grande.mp4", b"A" * 101, "video/mp4"))],
    )
    assert r_single.status_code == 413
    assert list(CONFIG.ORIGINALS_DIR.iterdir()) == []

    # 1b. upload-files: lote estoura teto total no segundo arquivo -> 413 e apaga o primeiro (sem órfãos!)
    r_batch = client.post(
        "/api/ingest/upload-files",
        data={"project_id": str(project_id)},
        files=[
            ("files", ("primeiro.mp4", b"A" * 90, "video/mp4")),
            ("files", ("segundo.mp4", b"B" * 90, "video/mp4")),
        ],
    )
    assert r_batch.status_code == 413
    assert list(CONFIG.ORIGINALS_DIR.iterdir()) == []

    # 1c. upload-files: excesso de quantidade de arquivos -> 413
    r_many = client.post(
        "/api/ingest/upload-files",
        data={"project_id": str(project_id)},
        files=[
            ("files", ("a.mp4", b"1", "video/mp4")),
            ("files", ("b.mp4", b"2", "video/mp4")),
            ("files", ("c.mp4", b"3", "video/mp4")),
        ],
    )
    assert r_many.status_code == 413
    assert list(CONFIG.ORIGINALS_DIR.iterdir()) == []

    # 2. docs acima do limite -> 413
    r_doc = client.post(
        f"/api/project/{project_id}/docs",
        files={"file": ("roteiro.txt", b"X" * 61, "text/plain")},
    )
    assert r_doc.status_code == 413

    # 3. timeline/import acima do limite -> 413
    r_tl = client.post(
        "/api/timeline/import",
        data={"project_id": str(project_id)},
        files={"file": ("corte.otio", b"Y" * 61, "application/json")},
    )
    assert r_tl.status_code == 413

    # 4. project/import acima do limite -> 413
    r_zip = client.post(
        "/api/project/import",
        files={"file": ("pacote.zip", b"Z" * 101, "application/zip")},
    )
    assert r_zip.status_code == 413

    assert _count_projects(CONFIG.DB_PATH) == before_projects


def test_import_project_recusa_zip_bomb_traversal_symlink_e_excesso_de_membros(
    sec_env, tmp_path, monkeypatch
):
    client, _, _ = sec_env
    before_projects = _count_projects(CONFIG.DB_PATH)
    meta_bytes = json.dumps({"project": {"name": "Invasor"}}).encode("utf-8")

    # 1. Traversal dentro do ZIP
    escape_target = tmp_path / "escape_pwned.txt"
    zip_traversal = _build_zip_bytes([
        ("metadata.json", meta_bytes, None),
        ("../../escape_pwned.txt", b"evil", None),
    ])
    r_trav = client.post(
        "/api/project/import",
        files={"file": ("trav.zip", zip_traversal, "application/zip")},
    )
    assert r_trav.status_code == 400
    assert not escape_target.exists()
    assert _count_projects(CONFIG.DB_PATH) == before_projects

    # 2. Symlink dentro do ZIP
    zip_symlink = _build_zip_bytes([
        ("metadata.json", meta_bytes, None),
        ("link_secreto", b"/etc/passwd", 0o120777),
    ])
    r_sym = client.post(
        "/api/project/import",
        files={"file": ("sym.zip", zip_symlink, "application/zip")},
    )
    assert r_sym.status_code == 400
    assert _count_projects(CONFIG.DB_PATH) == before_projects

    # 3. Excesso de membros
    monkeypatch.setenv("CAPIAU_MAX_ZIP_MEMBERS", "3")
    zip_many = _build_zip_bytes([
        ("metadata.json", meta_bytes, None),
        ("a.txt", b"1", None),
        ("b.txt", b"2", None),
        ("c.txt", b"3", None),
    ])
    r_many = client.post(
        "/api/project/import",
        files={"file": ("many.zip", zip_many, "application/zip")},
    )
    assert r_many.status_code == 413
    assert _count_projects(CONFIG.DB_PATH) == before_projects

    # 4. Zip-bomb (2 MB de zeros altamente comprimidos -> razão >> 50x)
    monkeypatch.setenv("CAPIAU_MAX_ZIP_MEMBERS", "100")
    zip_bomb = _build_zip_bytes([
        ("metadata.json", meta_bytes, None),
        ("bomba.bin", b"\x00" * (2 * 1024 * 1024), None),
    ])
    r_bomb = client.post(
        "/api/project/import",
        files={"file": ("bomb.zip", zip_bomb, "application/zip")},
    )
    assert r_bomb.status_code == 413
    assert _count_projects(CONFIG.DB_PATH) == before_projects


def test_backup_db_usa_create_consistent_sqlite_backup_wal_safe_com_chave_versionada(
    sec_env, monkeypatch
):
    client, project_id, _ = sec_env

    # Abre conexão em WAL mantendo dados recentes no WAL
    wal_conn = sqlite3.connect(CONFIG.DB_PATH, timeout=30.0)
    wal_conn.execute("PRAGMA journal_mode = WAL")
    wal_conn.execute(
        "INSERT INTO video (project_id, filename, filepath, hash, video_type, status) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (project_id, "wal_clip.mp4", "/originais/wal_clip.mp4", "hash_wal_1", "interview", "ingested"),
    )
    wal_conn.commit()

    captured = {}
    import src.db.backup as backup_mod
    real_backup_fn = backup_mod.create_consistent_sqlite_backup

    def spy_backup(source_db, dest_db):
        captured["called"] = True
        captured["dest_db"] = Path(dest_db)
        return real_backup_fn(source_db, dest_db)

    monkeypatch.setattr(backup_mod, "create_consistent_sqlite_backup", spy_backup)

    class FakeS3:
        enabled = True

        def upload_file(self, local_path: Path, s3_key: str) -> bool:
            p = Path(local_path)
            captured["uploaded_path"] = p
            captured["s3_key"] = s3_key
            captured["uploaded_sha256"] = hashlib.sha256(p.read_bytes()).hexdigest()

            # Verifica que o arquivo enviado é uma cópia consistente com os dados do WAL
            check_conn = sqlite3.connect(p)
            try:
                integrity = check_conn.execute("PRAGMA integrity_check").fetchone()[0]
                assert integrity == "ok"
                row = check_conn.execute(
                    "SELECT filename FROM video WHERE hash = ?", ("hash_wal_1",)
                ).fetchone()
                assert row is not None and row[0] == "wal_clip.mp4"
            finally:
                check_conn.close()
            return True

    monkeypatch.setattr("src.services.s3_service.S3Service.get_instance", staticmethod(lambda: FakeS3()))

    try:
        resp = client.post("/api/project/backup-db", headers=auth_headers())
    finally:
        wal_conn.close()

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert captured.get("called") is True
    assert captured["uploaded_path"] != CONFIG.DB_PATH
    assert re.match(r"^backups/capiau_backup_\d{8}_\d{6}\.db$", body["key"])
    assert body["sha256"] == captured["uploaded_sha256"]
    assert body["size_bytes"] > 0
    # Diretório temporário limpo após retorno
    assert not captured["uploaded_path"].parent.exists()


def test_import_project_roundtrip_proxies_e_propagacao_400(sec_env, monkeypatch):
    client, project_id, _ = sec_env

    fake_search = MagicMock()
    fake_search.check_health.return_value = (True, None)
    monkeypatch.setattr("src.search.semantic.SemanticSearch.get_instance", staticmethod(lambda: fake_search))

    # 1. ZIP sem metadata.json -> 400 (nunca 500)
    zip_sem_meta = _build_zip_bytes([("outro.txt", b"oi", None)])
    r_no_meta = client.post(
        "/api/project/import",
        files={"file": ("sem_meta.zip", zip_sem_meta, "application/zip")},
    )
    assert r_no_meta.status_code == 400

    # 2. metadata.json sem chave 'project' válida -> 400
    zip_bad_meta = _build_zip_bytes([("metadata.json", json.dumps({"foo": 1}).encode("utf-8"), None)])
    r_bad_meta = client.post(
        "/api/project/import",
        files={"file": ("bad_meta.zip", zip_bad_meta, "application/zip")},
    )
    assert r_bad_meta.status_code == 400

    # 3. Round-trip export -> import copiando proxy_photo_<new_id>.webp
    photo_id = add_photo(
        project_id=project_id,
        filename="still.jpg",
        filepath="/originais/still.jpg",
        file_hash="hash_roundtrip_photo",
        description="Still teste",
        tags=["still"],
    )
    src_proxy = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
    src_proxy.parent.mkdir(parents=True, exist_ok=True)
    src_proxy.write_bytes(b"WEBP_ROUNDTRIP_PAYLOAD")

    r_exp = client.post(
        f"/api/project/{project_id}/export",
        json={
            "include_metadata": True,
            "include_proxies": False,
            "include_photos": True,
            "include_docs": False,
        },
    )
    assert r_exp.status_code == 200

    r_imp = client.post(
        "/api/project/import",
        files={"file": ("pacote.zip", r_exp.content, "application/zip")},
    )
    assert r_imp.status_code == 200, r_imp.text
    body = r_imp.json()
    for key in ("status", "project_id", "qdrant_status", "qdrant_errors", "warnings", "copied_files", "message"):
        assert key in body, f"Campo ausente na resposta de import_project: {key}"
    assert body["status"] == "success"
    new_pid = body["project_id"]
    assert new_pid != project_id

    conn = sqlite3.connect(CONFIG.DB_PATH)
    try:
        new_photo_row = conn.execute(
            "SELECT id, hash FROM photo WHERE project_id = ?", (new_pid,)
        ).fetchone()
    finally:
        conn.close()

    assert new_photo_row is not None
    new_photo_id, new_hash = new_photo_row
    assert new_photo_id != photo_id
    assert new_hash == "hash_roundtrip_photo"
    new_proxy = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{new_photo_id}.webp"
    assert new_proxy.exists()
    assert new_proxy.read_bytes() == b"WEBP_ROUNDTRIP_PAYLOAD"

