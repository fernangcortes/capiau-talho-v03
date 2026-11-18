"""Fixtures, opções e markers da suíte de regressão do render (`tests/render_regressao/`)."""
from __future__ import annotations

import os
import shutil

import pytest

from src.navegador import navegador_utilizavel

from .fontes import garantir_midias_sinteticas


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--paridade",
        action="store_true",
        default=False,
        help="Executa testes de paridade Nível 2 (player x export).",
    )


def _ffmpeg_ok() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    rodar_paridade = bool(
        config.getoption("--paridade") or os.environ.get("CAPIAU_PARIDADE") == "1"
    )
    tem_ffmpeg = _ffmpeg_ok()
    tem_navegador: bool | None = None

    skip_paridade = pytest.mark.skip(
        reason="Nível 2 desligado por padrão (use --paridade ou CAPIAU_PARIDADE=1)"
    )
    skip_ffmpeg = pytest.mark.skip(reason="ffmpeg/ffprobe ausentes no PATH")
    skip_browser = pytest.mark.skip(reason="playwright/navegador headless indisponível")

    for item in items:
        if "paridade" in item.keywords and not rodar_paridade:
            item.add_marker(skip_paridade)
        if "needs_ffmpeg" in item.keywords and not tem_ffmpeg:
            item.add_marker(skip_ffmpeg)
        if "needs_browser" in item.keywords:
            if tem_navegador is None:
                tem_navegador = navegador_utilizavel()
            if not tem_navegador:
                item.add_marker(skip_browser)


@pytest.fixture(autouse=True)
def forcar_cpu(monkeypatch: pytest.MonkeyPatch) -> None:
    """Evita sondas QSV/NVENC/AMF e garante saída determinística em CPU."""
    monkeypatch.setattr(
        "src.media.ffmpeg.get_hardware_settings",
        lambda *_args, **_kwargs: ("cpu", "none"),
    )


@pytest.fixture(scope="session")
def ffmpeg_ok() -> bool:
    return _ffmpeg_ok()


@pytest.fixture(scope="session")
def fontes_sinteticas() -> dict:
    return garantir_midias_sinteticas()
