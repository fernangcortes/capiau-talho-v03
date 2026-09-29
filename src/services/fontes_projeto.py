"""Fontes enviadas pelo usuario (upload), guardadas por projeto.

Arquivos em data/fontes/<project_id>/<familia><ext>. O nome da familia vem do nome
do arquivo, com a mesma limpeza que o editor usava (fontManager.loadUserFontFile):
reenviar um arquivo com o mesmo nome substitui a fonte.

Quem usa:
- rotas /api/project/{id}/fonts (upload, lista, arquivo, remocao);
- o render de titulos (titulos.GeradorTitulos), que abre outro navegador e precisa
  registrar as mesmas fontes do editor.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional

EXTENSOES = {".ttf", ".otf", ".woff", ".woff2"}
TAMANHO_MAXIMO = 20 * 1024 * 1024

# Assinaturas dos formatos aceitos (primeiros 4 bytes)
_ASSINATURAS = (b"\x00\x01\x00\x00", b"true", b"OTTO", b"wOFF", b"wOF2", b"ttcf")


class FonteInvalida(ValueError):
    """Arquivo recusado (extensao, tamanho ou conteudo)."""


def pasta_raiz() -> Path:
    from src.config import CONFIG
    return Path(CONFIG.DB_PATH).parent / "fontes"


def pasta_projeto(project_id: int, raiz: Optional[Path] = None) -> Path:
    return Path(raiz or pasta_raiz()) / str(int(project_id))


def familia_do_arquivo(nome: str) -> str:
    """"Minha Fonte-Bold.ttf" -> "Minha Fonte-Bold" (mesma regra do editor)."""
    base = re.sub(r"\.[^/.]+$", "", Path(str(nome)).name)
    return re.sub(r"[^a-zA-Z0-9_\s-]", "", base).strip()


def salvar(project_id: int, nome: str, dados: bytes, raiz: Optional[Path] = None) -> Dict:
    ext = Path(str(nome)).suffix.lower()
    if ext not in EXTENSOES:
        raise FonteInvalida(f"Formato '{ext or nome}' nao aceito. Use .ttf, .otf, .woff ou .woff2.")
    if not dados:
        raise FonteInvalida("Arquivo de fonte vazio.")
    if len(dados) > TAMANHO_MAXIMO:
        raise FonteInvalida("Arquivo de fonte maior que 20 MB.")
    if dados[:4] not in _ASSINATURAS:
        raise FonteInvalida("O arquivo nao parece uma fonte (.ttf/.otf/.woff/.woff2).")
    familia = familia_do_arquivo(nome)
    if not familia:
        raise FonteInvalida("Nome de arquivo sem letras ou numeros: renomeie a fonte.")
    pasta = pasta_projeto(project_id, raiz)
    pasta.mkdir(parents=True, exist_ok=True)
    # Mesma familia com outra extensao: a nova substitui a antiga
    for antigo in listar(project_id, raiz):
        if antigo["familia"] == familia:
            (pasta / antigo["arquivo"]).unlink(missing_ok=True)
    destino = pasta / f"{familia}{ext}"
    destino.write_bytes(dados)
    return _descrever(destino)


def listar(project_id: int, raiz: Optional[Path] = None) -> List[Dict]:
    pasta = pasta_projeto(project_id, raiz)
    if not pasta.is_dir():
        return []
    return [_descrever(p) for p in sorted(pasta.iterdir())
            if p.is_file() and p.suffix.lower() in EXTENSOES]


def caminho(project_id: int, arquivo: str, raiz: Optional[Path] = None) -> Optional[Path]:
    """Caminho do arquivo da fonte, ou None (inexistente ou fora da pasta do projeto)."""
    pasta = pasta_projeto(project_id, raiz).resolve()
    alvo = (pasta / str(arquivo)).resolve()
    if alvo.parent != pasta or not alvo.is_file() or alvo.suffix.lower() not in EXTENSOES:
        return None
    return alvo


def remover(project_id: int, arquivo: str, raiz: Optional[Path] = None) -> bool:
    alvo = caminho(project_id, arquivo, raiz)
    if alvo is None:
        return False
    alvo.unlink()
    return True


def _descrever(p: Path) -> Dict:
    st = p.stat()
    return {"familia": familia_do_arquivo(p.name), "arquivo": p.name,
            "caminho": str(p), "tamanho": st.st_size, "mtime": st.st_mtime}
