"""Testes do servidor HTTP local do módulo comum de navegador (`src/navegador/servidor.py`)."""
from __future__ import annotations

import http.client
import os
import socket
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

import pytest

from src.navegador.servidor import ServidorLocal

_OPENER_SEM_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _urlopen(url_or_req, timeout: float = 3.0):
    return _OPENER_SEM_PROXY.open(url_or_req, timeout=timeout)


def _http_raw(porta: int, req_bytes: bytes) -> tuple[int, dict[str, str], bytes]:
    with socket.create_connection(("127.0.0.1", porta), timeout=5.0) as sock:
        sock.sendall(req_bytes)
        sock.shutdown(socket.SHUT_WR)
        chunks = []
        while True:
            data = sock.recv(4096)
            if not data:
                break
            chunks.append(data)
    bruto = b"".join(chunks)
    cab, _, corpo = bruto.partition(b"\r\n\r\n")
    linhas = cab.decode("latin1").split("\r\n")
    status = int(linhas[0].split()[1])
    headers = {}
    for ln in linhas[1:]:
        if ":" in ln:
            k, v = ln.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    return status, headers, corpo


def test_bind_apenas_loopback_e_token_obrigatorio(tmp_path):
    (tmp_path / "ola.txt").write_text("oi", encoding="utf-8")
    with ServidorLocal(pasta_saidas=tmp_path / "out") as srv:
        parsed = urlparse(srv.url_base)
        assert parsed.hostname == "127.0.0.1"
        base = srv.publicar_pasta("ui", tmp_path)

        # Caminho certo funciona
        with _urlopen(f"{base}/ola.txt", timeout=3) as resp:
            assert resp.status == 200
            assert resp.read() == b"oi"

        # Token errado -> 404
        errado = f"http://127.0.0.1:{srv.porta}/token-errado/ui/ola.txt"
        with pytest.raises(urllib.error.HTTPError) as exc:
            _urlopen(errado, timeout=3)
        assert exc.value.code == 404

        # Host estranho -> 403
        token = parsed.path.strip("/")
        status, _, _ = _http_raw(
            srv.porta,
            f"GET /{token}/ui/ola.txt HTTP/1.1\r\nHost: evil.example:8000\r\nConnection: close\r\n\r\n".encode(),
        )
        assert status == 403


def test_travessia_bloqueada(tmp_path):
    raiz = tmp_path / "pub"
    raiz.mkdir()
    (raiz / "ok.txt").write_text("seguro", encoding="utf-8")
    fora = tmp_path / "segredo.txt"
    fora.write_text("segredo", encoding="utf-8")

    with ServidorLocal(pasta_saidas=tmp_path / "out") as srv:
        base = srv.publicar_pasta("ui", raiz)
        parsed = urlparse(base)
        prefixo = parsed.path  # /<token>/ui

        for ataque in (
            f"{prefixo}/../segredo.txt",
            f"{prefixo}/%2e%2e/segredo.txt",
            f"{prefixo}/C:\\Windows\\win.ini",
            f"{prefixo}/ok.txt::$DATA",
            f"{prefixo}/NUL",
            f"{prefixo}/nul.txt",
        ):
            status, _, _ = _http_raw(
                srv.porta,
                f"GET {ataque} HTTP/1.1\r\nHost: 127.0.0.1:{srv.porta}\r\nConnection: close\r\n\r\n".encode(),
            )
            assert status == 404, f"Ataque não bloqueado: {ataque} -> {status}"

        # Symlink para fora da pasta publicada (quando suportado pelo SO)
        link = raiz / "link_fora.txt"
        try:
            os.symlink(fora, link)
        except OSError:
            pass
        else:
            status, _, _ = _http_raw(
                srv.porta,
                f"GET {prefixo}/link_fora.txt HTTP/1.1\r\nHost: 127.0.0.1:{srv.porta}\r\nConnection: close\r\n\r\n".encode(),
            )
            assert status == 404


def test_range_head_e_mimes(tmp_path):
    dados = bytes(range(256))
    (tmp_path / "blob.bin").write_bytes(dados)
    (tmp_path / "app.js").write_text("export const x = 1;", encoding="utf-8")
    (tmp_path / "mod.mjs").write_text("export default 2;", encoding="utf-8")
    (tmp_path / "fonte.woff2").write_bytes(b"wOF2xxxx")
    (tmp_path / "som.wav").write_bytes(b"RIFFxxxxWAVE")

    with ServidorLocal(pasta_saidas=tmp_path / "out") as srv:
        base = srv.publicar_pasta("p", tmp_path)

        # HEAD
        req_head = urllib.request.Request(f"{base}/blob.bin", method="HEAD")
        with _urlopen(req_head, timeout=3) as r:
            assert r.status == 200
            assert r.headers.get("Accept-Ranges") == "bytes"
            assert int(r.headers.get("Content-Length")) == 256
            assert r.read() == b""

        # Range a-b
        req_ab = urllib.request.Request(f"{base}/blob.bin", headers={"Range": "bytes=10-19"})
        with _urlopen(req_ab, timeout=3) as r:
            assert r.status == 206
            assert r.headers.get("Content-Range") == "bytes 10-19/256"
            assert r.read() == dados[10:20]

        # Range a-
        req_a = urllib.request.Request(f"{base}/blob.bin", headers={"Range": "bytes=240-"})
        with _urlopen(req_a, timeout=3) as r:
            assert r.status == 206
            assert r.headers.get("Content-Range") == "bytes 240-255/256"
            assert r.read() == dados[240:]

        # Range -n
        req_n = urllib.request.Request(f"{base}/blob.bin", headers={"Range": "bytes=-16"})
        with _urlopen(req_n, timeout=3) as r:
            assert r.status == 206
            assert r.headers.get("Content-Range") == "bytes 240-255/256"
            assert r.read() == dados[-16:]

        # Range inválido -> 416
        for invalido in ("bytes=300-400", "bytes=50-10", "bytes=abc-def", "items=0-5"):
            req_inv = urllib.request.Request(f"{base}/blob.bin", headers={"Range": invalido})
            with pytest.raises(urllib.error.HTTPError) as exc:
                _urlopen(req_inv, timeout=3)
            assert exc.value.code == 416

        # MIMEs
        for nome, esperado in (
            ("app.js", "text/javascript"),
            ("mod.mjs", "text/javascript"),
            ("fonte.woff2", "font/woff2"),
            ("som.wav", "audio/wav"),
        ):
            with _urlopen(f"{base}/{nome}", timeout=3) as r:
                assert esperado in (r.headers.get("Content-Type") or "").lower()


def test_put_post_limite_e_streaming_sem_sobra(tmp_path):
    with ServidorLocal(pasta_saidas=tmp_path / "saidas") as srv:
        # PUT válido
        saida_put = srv.reservar_saida("clip.wav", limite_bytes=4096)
        assert not saida_put.recebida()
        req = urllib.request.Request(saida_put.url, data=b"ABC" * 100, method="PUT")
        with _urlopen(req, timeout=3) as r:
            assert r.status == 201
        assert saida_put.recebida()
        assert saida_put.tamanho() == 300
        assert saida_put.caminho.read_bytes() == b"ABC" * 100

        # POST acima do limite -> 413 e nenhum .parcial deixado no disco
        saida_lim = srv.reservar_saida("grande.bin", limite_bytes=128)
        req_over = urllib.request.Request(saida_lim.url, data=b"X" * 512, method="POST")
        with pytest.raises(urllib.error.HTTPError) as exc:
            _urlopen(req_over, timeout=3)
        assert exc.value.code == 413
        assert not saida_lim.recebida()
        parciais = list(saida_lim.caminho.parent.glob("*.parcial"))
        assert parciais == []

        # Streaming de arquivo maior (16 MiB) em blocos sem manter cópia inteira extra
        saida_stream = srv.reservar_saida("stream16m.bin", limite_bytes=32 * 1024 * 1024)
        parsed = urlparse(saida_stream.url)
        conn = http.client.HTTPConnection("127.0.0.1", srv.porta, timeout=10)
        total = 16 * 1024 * 1024
        bloco = b"0123456789abcdef" * 4096  # 64 KiB
        conn.putrequest("PUT", parsed.path)
        conn.putheader("Content-Length", str(total))
        conn.endheaders()
        for _ in range(total // len(bloco)):
            conn.send(bloco)
        resp = conn.getresponse()
        assert resp.status == 201
        conn.close()
        assert saida_stream.tamanho() == total

        # Nome inseguro na reserva falha antes de criar
        with pytest.raises(ValueError):
            srv.reservar_saida("../fora.wav")
        with pytest.raises(ValueError):
            srv.reservar_saida("NUL")


def test_oito_clientes_simultaneos_e_parar_limpo(tmp_path):
    (tmp_path / "item.txt").write_bytes(b"Z" * 8192)
    srv = ServidorLocal(pasta_saidas=tmp_path / "out")
    base = srv.publicar_pasta("ui", tmp_path)
    json_url = srv.responder_json("api_ok", {"status": "ok", "n": 42})

    def _baixar(i: int) -> int:
        url = json_url if i % 2 else f"{base}/item.txt"
        with _urlopen(url, timeout=5) as r:
            return len(r.read())

    with ThreadPoolExecutor(max_workers=8) as pool:
        resultados = list(pool.map(_baixar, range(24)))
    assert all(x > 0 for x in resultados)

    srv.parar()
    srv.parar()  # idempotente
    assert not srv._thread.is_alive()
