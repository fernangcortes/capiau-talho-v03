"""Testes do lançador comum de navegador, diagnóstico, cancelamento e órfãos."""
from __future__ import annotations

import asyncio
import importlib.util
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from src.navegador import (
    CapturaCancelada,
    Navegador,
    PedidoQuadro,
    calcular_assinatura,
    diagnosticar,
    diagnostico_barato,
    navegador_utilizavel,
    orfaos,
)


def test_diagnostico_barato_rapido_e_cobre_cenarios(monkeypatch):
    t0 = time.perf_counter()
    res = diagnostico_barato()
    dur_ms = (time.perf_counter() - t0) * 1000.0
    assert dur_ms < 100.0
    assert {"ok", "playwright_instalado", "executavel_encontrado", "canal_provavel", "caminho", "motivo"} <= set(res)

    # Sem playwright
    monkeypatch.setattr(importlib.util, "find_spec", lambda nome: None if nome == "playwright" else object())
    sem_pw = diagnostico_barato()
    assert sem_pw["ok"] is False
    assert sem_pw["playwright_instalado"] is False
    assert "playwright" in sem_pw["motivo"].lower()

    # Playwright presente, sem executável
    monkeypatch.setattr(importlib.util, "find_spec", lambda nome: object())
    from src.navegador import diagnostico as mod_diag

    monkeypatch.setattr(mod_diag, "localizar_executavel_instalado", lambda **_kw: (None, None))
    sem_exe = diagnostico_barato()
    assert sem_exe["ok"] is False
    assert sem_exe["playwright_instalado"] is True
    assert sem_exe["executavel_encontrado"] is False
    assert "edge" in sem_exe["motivo"].lower() or "chrome" in sem_exe["motivo"].lower()


def test_assinatura_estavel_e_sensivel():
    a1 = calcular_assinatura("msedge", "131.0.2903.51", "screenshot", ())
    a2 = calcular_assinatura("msedge", "131.0.2903.99", "screenshot", ())
    b1 = calcular_assinatura("chrome", "131.0.2903.51", "screenshot", ())
    c1 = calcular_assinatura("msedge", "132.0.0.1", "screenshot", ())
    d1 = calcular_assinatura("msedge", "131.0.2903.51", "beginframe", ())

    assert a1 == a2  # mesma versão maior e mesmo canal/modo
    assert len({a1, b1, c1, d1}) == 4


def test_guarda_de_thread_e_loop_asyncio(tmp_path):
    nav = Navegador(tmp_path, rotulo="guarda")
    erro_thread = []

    def _outra():
        try:
            _ = nav.info
        except RuntimeError as exc:
            erro_thread.append(str(exc))

    t = threading.Thread(target=_outra)
    t.start()
    t.join(timeout=3.0)
    assert erro_thread and "thread" in erro_thread[0].lower()

    async def _no_loop():
        nav2 = Navegador(tmp_path, rotulo="loop")
        with pytest.raises(RuntimeError, match="asyncio"):
            _ = nav2.info

    asyncio.run(_no_loop())
    nav.fechar()


def test_varredura_orfaos_dono_morto_vivo_e_imagem_divergente(tmp_path):
    dir_pids = tmp_path / "pids"

    # 1. Processo dormindo com imagem correspondente + dono morto -> deve matar
    p_alvo = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    # 2. Processo dormindo com dono VIVO (nosso PID) -> não deve matar
    p_vivo = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    # 3. Processo dormindo com dono morto mas imagem divergente -> não deve matar
    p_div = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])

    try:
        exe_real = orfaos.caminho_executavel_pid(p_alvo.pid) or sys.executable
        arq_morto = orfaos.registrar_pids(
            "morto", [p_alvo.pid], executavel=exe_real, pid_dono=999_999_991, pasta=dir_pids
        )
        arq_vivo = orfaos.registrar_pids(
            "vivo", [p_vivo.pid], executavel=exe_real, pid_dono=sys.argv and __import__("os").getpid(), pasta=dir_pids
        )
        arq_div = orfaos.registrar_pids(
            "div", [p_div.pid], executavel="C:/fake/nao_existe_navegador.exe", pid_dono=999_999_992, pasta=dir_pids
        )

        mortos = orfaos.varrer_orfaos(dir_pids)
        assert p_alvo.pid in mortos
        assert p_vivo.pid not in mortos
        assert p_div.pid not in mortos

        p_alvo.wait(timeout=3.0)
        assert p_vivo.poll() is None
        assert p_div.poll() is None
        assert not arq_morto.exists()
        assert arq_vivo.exists()
        assert not arq_div.exists()
    finally:
        for proc in (p_alvo, p_vivo, p_div):
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=3.0)


def test_abortar_idempotente(tmp_path):
    nav = Navegador(tmp_path, rotulo="idemp")
    nav.abortar()
    nav.abortar()
    with pytest.raises(CapturaCancelada):
        _ = nav.info
    nav.fechar()
    nav.fechar()


def test_rotas_diagnostico_api(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from src.api.routes import modelos
    from tests.auth_helpers import auth_headers

    app = FastAPI()
    app.include_router(modelos.router)
    cli = TestClient(app)

    r_get = cli.get("/api/navegador/diagnostico")
    assert r_get.status_code == 200
    assert "playwright_instalado" in r_get.json()

    r_sem_auth = cli.post("/api/navegador/testar")
    assert r_sem_auth.status_code in (401, 403)
    assert cli.get("/api/modelos").status_code == 200

    monkeypatch.setattr(modelos, "_diagnosticar_navegador", lambda: {"ok": True, "lancamento_ok": True})
    r_com_auth = cli.post("/api/navegador/testar", headers=auth_headers())
    assert r_com_auth.status_code == 200
    assert r_com_auth.json()["lancamento_ok"] is True
    assert any(getattr(rt, "path", "") == "/api/navegador/testar" for rt in modelos.router.routes)


@pytest.mark.skipif(not navegador_utilizavel(), reason="playwright/Edge/Chrome indisponível")
def test_navegador_real_contexto_seguro_audioworklet_e_cancelamento(tmp_path):
    diag = diagnosticar()
    assert diag["lancamento_ok"] is True
    assert diag["contexto_seguro"] is True
    assert diag["audio_worklet_disponivel"] is True

    # Teste cooperativo com cancelado() e captura de quadros
    html = tmp_path / "pagina.html"
    html.write_text(
        "<!DOCTYPE html><html><body style='margin:0;background:#112233'>"
        "<div id='n' style='color:#fff;font:24px sans-serif'>0</div>"
        "<script>window.PRONTO=true; window.setN = v => { document.getElementById('n').textContent = String(v); };</script>"
        "</body></html>",
        encoding="utf-8",
    )

    contador = {"n": 0}
    with Navegador(tmp_path / "trab1", cancelado=lambda: contador["n"] >= 2) as nav:
        base = nav.servidor.publicar_pasta("t", tmp_path)
        pg = nav.pagina(160, 90)
        pg.abrir(f"{base}/pagina.html", pronto="window.PRONTO === true")
        pg.esperar("() => document.getElementById('n').textContent === '0'", intervalo_ms=20)
        assert pg.avaliar("() => window.isSecureContext") is True

        pedidos = [
            PedidoQuadro(i, js_antes="v => window.setN(v)", arg=i, chave=f"k{i}")
            for i in range(6)
        ]
        gravados = []
        with pytest.raises(CapturaCancelada):
            for q in pg.capturar_quadros(pedidos, tmp_path / "q1", fps=24.0):
                gravados.append(q)
                contador["n"] += 1
        assert len(gravados) == 2

    # Teste rígido com abortar() de outra thread
    nav2 = Navegador(tmp_path / "trab2", rotulo="aborto")
    pids_registrados = []
    try:
        base2 = nav2.servidor.publicar_pasta("t", tmp_path)
        pg2 = nav2.pagina(160, 90)
        pg2.abrir(f"{base2}/pagina.html", pronto="window.PRONTO === true")
        pids_registrados = list(nav2._pids)

        def _abortar_depois():
            time.sleep(0.25)
            nav2.abortar()

        t_abort = threading.Thread(target=_abortar_depois)
        t_abort.start()
        with pytest.raises(CapturaCancelada):
            for i in range(60):
                pg2.avaliar("v => window.setN(v)", i)
                pg2.capturar()
        t_abort.join(timeout=5.0)
    finally:
        nav2.fechar()

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if not any(orfaos.processo_vivo(p) for p in pids_registrados):
            break
        time.sleep(0.1)
    assert not any(orfaos.processo_vivo(p) for p in pids_registrados)
