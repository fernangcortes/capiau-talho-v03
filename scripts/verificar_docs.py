#!/usr/bin/env python3
"""Lints da documentação. Roda só com a biblioteca padrão do Python (e Node, para os atalhos).

Verificações:
  links      links relativos entre .md e âncoras (README, USER_MANUAL, wiki/*.md, docs/**/*.md)
  env        variáveis de blocos ```env existem em .env.example ou são lidas no código
  modelos    slugs "provedor/modelo" citados em docs de usuário existem em src/config.py
  caminhos   caminhos `src/...` citados em docs de usuário existem
  geradores  scripts/gerar_atalhos.mjs --check e scripts/gerar_docs_api.py --check

Uso:
    python scripts/verificar_docs.py                    roda tudo; código 1 se houver falha
    python scripts/verificar_docs.py --so-avisos        roda tudo; sempre código 0
    python scripts/verificar_docs.py --apenas links env roda só as verificações citadas
    python scripts/verificar_docs.py --excluir docs/x   ignora também esse caminho (prefixo)
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote

RAIZ = Path(__file__).resolve().parent.parent

# Exclusões padrão (prefixos relativos à raiz): material histórico e de pesquisa, ruidoso para links.
EXCLUIR_PADRAO = ["docs/Pesquisas", "docs/agentes/proximos_chats"]

# Docs voltadas ao usuário: sujeitas às checagens de modelos e de caminhos src/...
DOCS_USUARIO_FIXAS = [
    "README.md",
    "USER_MANUAL.md",
    "docs/usuario/ai_settings_pro_guide.md",
    "docs/usuario/costs_and_security.md",
    "docs/usuario/shortcuts.md",
    "docs/dev/api_endpoints.md",
    "docs/usuario/kdenlive_workflow.md",
    "docs/dev/AUPHONIC_AUDIO_RESTORATION_GUIDE.md",
]
# Para modelos, só as docs de configuração/uso (o resto pode citar modelos de pesquisa)
DOCS_MODELOS_FIXAS = [
    "README.md",
    "USER_MANUAL.md",
    "docs/usuario/ai_settings_pro_guide.md",
    "docs/usuario/costs_and_security.md",
]

# Slugs aceitos mesmo sem estar em config.py (exemplos genéricos, etc.)
ALLOWLIST_MODELOS: set[str] = set()
# Caminhos src/ aceitos mesmo sem existir (exemplos)
ALLOWLIST_CAMINHOS: set[str] = set()
# Variáveis de ambiente aceitas mesmo sem leitura detectada
ALLOWLIST_ENV: set[str] = set()

# Prefixos de provedor reconhecidos (lista fixa: evita confundir pastas como data/models com modelos)
PROVEDORES = {
    "openai", "anthropic", "google", "deepseek", "nvidia", "meta-llama", "mistralai", "qwen",
    "x-ai", "perceptron", "moonshotai", "z-ai", "cohere", "microsoft", "openrouter", "perplexity",
    "amazon", "minimax", "nousresearch", "stabilityai", "black-forest-labs",
}


# ── Utilidades de Markdown ──────────────────────────────────────────────────
class Problema:
    def __init__(self, categoria: str, arquivo: Path, linha: int, msg: str):
        self.categoria, self.arquivo, self.linha, self.msg = categoria, arquivo, linha, msg

    def __str__(self) -> str:
        return f"{self.arquivo.relative_to(RAIZ).as_posix()}:{self.linha}: {self.msg}"


def ler(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def mascarar_codigo(texto: str) -> str:
    """Troca por espaços o conteúdo de blocos ``` e de `código inline`, mantendo as linhas."""
    saida, dentro = [], False
    for linha in texto.split("\n"):
        if re.match(r"^\s{0,3}(```|~~~)", linha):
            dentro = not dentro
            saida.append("")
            continue
        if dentro:
            saida.append("")
            continue
        saida.append(re.sub(r"`[^`\n]*`", lambda m: " " * len(m.group(0)), linha))
    return "\n".join(saida)


def slug_github(titulo: str) -> str:
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", titulo)  # links -> texto
    t = re.sub(r"<[^>]+>", "", t)  # tags HTML
    t = re.sub(r"[`*~]", "", t)
    t = t.strip().lower()
    manter = []
    for ch in t:
        cat = unicodedata.category(ch)
        if ch in " -_" or cat[0] in ("L", "N", "M"):
            manter.append(ch)
    return "".join(manter).replace(" ", "-")


def ancoras_de(texto: str) -> set[str]:
    ancoras: set[str] = set()
    usados: dict[str, int] = {}
    dentro = False
    for linha in texto.split("\n"):
        if re.match(r"^\s{0,3}(```|~~~)", linha):
            dentro = not dentro
            continue
        if dentro:
            continue
        for m in re.finditer(r'<a\s+[^>]*?(?:id|name)\s*=\s*["\']([^"\']+)["\']', linha, re.I):
            ancoras.add(m.group(1).lower())
        m = re.match(r"^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$", linha)
        if m:
            base = slug_github(m.group(1))
            n = usados.get(base, 0)
            usados[base] = n + 1
            ancoras.add(base if n == 0 else f"{base}-{n}")
    return ancoras


def arquivos_md(excluir: list[str]) -> list[Path]:
    achados: list[Path] = []
    for p in ["README.md", "USER_MANUAL.md"]:
        if (RAIZ / p).exists():
            achados.append(RAIZ / p)
    achados += sorted((RAIZ / "wiki").glob("*.md"))
    achados += sorted((RAIZ / "docs").rglob("*.md"))
    out = []
    for p in achados:
        rel = p.relative_to(RAIZ).as_posix()
        if any(rel == e or rel.startswith(e.rstrip("/") + "/") for e in excluir):
            continue
        out.append(p)
    return out


# ── a) links e âncoras ──────────────────────────────────────────────────────
RE_LINK = re.compile(r"\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
RE_WIKI = re.compile(r"\[\[([^\]\n]+)\]\]")


def checar_links(arquivos: list[Path]) -> list[Problema]:
    probs: list[Problema] = []
    cache_anc: dict[Path, set[str]] = {}
    paginas_wiki = {p.stem.lower(): p for p in (RAIZ / "wiki").glob("*.md")}

    def ancoras_do(p: Path) -> set[str]:
        if p not in cache_anc:
            cache_anc[p] = ancoras_de(ler(p))
        return cache_anc[p]

    def checar_ancora(origem: Path, linha: int, alvo: Path, frag: str, rotulo: str):
        if not frag or alvo.suffix.lower() != ".md" or not alvo.is_file():
            return
        if unquote(frag).lower() not in ancoras_do(alvo):
            probs.append(Problema("links", origem, linha, f"âncora inexistente: {rotulo}"))

    for arq in arquivos:
        em_wiki = arq.parent == RAIZ / "wiki"
        texto = ler(arq)
        limpo = mascarar_codigo(texto)
        for n, linha in enumerate(limpo.split("\n"), 1):
            for m in RE_LINK.finditer(linha):
                alvo_bruto = m.group(1)
                if re.match(r"^(https?:|mailto:|tel:|data:|javascript:|//)", alvo_bruto, re.I):
                    continue
                caminho, _, frag = alvo_bruto.partition("#")
                caminho = unquote(caminho.split("?")[0])
                if not caminho:  # âncora na própria página
                    checar_ancora(arq, n, arq, frag, alvo_bruto)
                    continue
                base = RAIZ if caminho.startswith("/") else arq.parent
                alvo = (base / caminho.lstrip("/")).resolve()
                if not alvo.exists() and em_wiki:
                    cand = paginas_wiki.get(Path(caminho).name.lower())
                    if cand:
                        alvo = cand
                    elif (arq.parent / (caminho + ".md")).exists():
                        alvo = (arq.parent / (caminho + ".md")).resolve()
                if not alvo.exists():
                    probs.append(Problema("links", arq, n, f"link quebrado: {alvo_bruto}"))
                    continue
                checar_ancora(arq, n, alvo, frag, alvo_bruto)
            if em_wiki:
                for m in RE_WIKI.finditer(linha):
                    conteudo = m.group(1)
                    alvo_txt = conteudo.split("|")[-1].strip()
                    pagina, _, frag = alvo_txt.partition("#")
                    chave = pagina.strip().replace(" ", "-").lower()
                    cand = paginas_wiki.get(chave)
                    if cand is None:
                        probs.append(Problema("links", arq, n, f"link wiki sem página: [[{conteudo}]]"))
                    else:
                        checar_ancora(arq, n, cand, frag, f"[[{conteudo}]]")
    return probs


# ── b) blocos ```env ────────────────────────────────────────────────────────
def variaveis_conhecidas() -> set[str]:
    conhecidas: set[str] = set(ALLOWLIST_ENV)
    exemplo = RAIZ / ".env.example"
    if exemplo.exists():
        for linha in ler(exemplo).split("\n"):
            m = re.match(r"^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=", linha)
            if m:
                conhecidas.add(m.group(1))
    alvos = list((RAIZ / "src").rglob("*.py")) + list((RAIZ / "scripts").glob("*.py"))
    alvos += [RAIZ / "docker-compose.yml", RAIZ / "Dockerfile"]
    padrao_lit = re.compile(r"[\"']([A-Z][A-Z0-9_]{2,})[\"']")
    padrao_atrib = re.compile(r"^\s*[A-Z_]*ENV[A-Z_]*\s*=\s*[\"']([A-Z][A-Z0-9_]{2,})[\"']")
    for p in alvos:
        if not p.is_file():
            continue
        for linha in ler(p).split("\n"):
            if re.search(r"getenv|environ|env_|_env|ENV", linha):
                conhecidas.update(padrao_lit.findall(linha))
            m = padrao_atrib.match(linha)
            if m:
                conhecidas.add(m.group(1))
            if p.suffix != ".py":
                for v in re.findall(r"\b([A-Z][A-Z0-9_]{2,})\s*[=:]", linha):
                    conhecidas.add(v)
    return conhecidas


def checar_env(arquivos: list[Path]) -> list[Problema]:
    probs: list[Problema] = []
    conhecidas = variaveis_conhecidas()
    for arq in arquivos:
        dentro = False
        for n, linha in enumerate(ler(arq).split("\n"), 1):
            m_f = re.match(r"^\s{0,3}```\s*(\w*)", linha)
            if m_f:
                if not dentro:
                    dentro = m_f.group(1).lower() in ("env", "dotenv")
                else:
                    dentro = False
                continue
            if dentro:
                m = re.match(r"^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=", linha)
                if m and not linha.lstrip().startswith("# ──") and m.group(1) not in conhecidas:
                    probs.append(Problema("env", arq, n, f"variável {m.group(1)} não existe em .env.example nem é lida no código"))
    return probs


# ── c) slugs de modelo ──────────────────────────────────────────────────────
def slugs_do_config() -> tuple[set[str], set[str]]:
    texto = ler(RAIZ / "src" / "config.py")
    token = re.compile(r"(?<![\w/.:-])([a-z0-9][a-z0-9-]*)/([A-Za-z0-9][A-Za-z0-9._-]*(?::[a-z]+)?)")
    slugs = {f"{a}/{b}" for a, b in token.findall(texto)}
    provedores = set(PROVEDORES)
    return slugs, provedores


def checar_modelos(arquivos: list[Path]) -> list[Problema]:
    probs: list[Problema] = []
    slugs, provedores = slugs_do_config()
    prov = "|".join(sorted(map(re.escape, provedores), key=len, reverse=True))
    padrao = re.compile(rf"(?<![\w/.:@-])((?:{prov}))/([A-Za-z0-9][A-Za-z0-9._-]*(?::[a-z]+)?)")
    for arq in arquivos:
        for n, linha in enumerate(ler(arq).split("\n"), 1):
            if re.search(r"https?://\S*" , linha):
                linha = re.sub(r"https?://\S+", " ", linha)
            for m in padrao.finditer(linha):
                slug = m.group(0).rstrip(".,;:")
                if slug in slugs or slug in ALLOWLIST_MODELOS:
                    continue
                # caminhos como google/... seguidos de extensão de arquivo não são modelos
                if re.search(r"\.(py|js|md|json|html|css|png|svg|ya?ml|txt)$", slug):
                    continue
                probs.append(Problema("modelos", arq, n, f"modelo '{slug}' não consta em src/config.py"))
    return probs


# ── d) caminhos src/... ─────────────────────────────────────────────────────
def checar_caminhos(arquivos: list[Path]) -> list[Problema]:
    probs: list[Problema] = []
    padrao = re.compile(r"(?<![\w/.-])(src/[A-Za-z0-9_./\-*{}]+)")
    for arq in arquivos:
        for n, linha in enumerate(ler(arq).split("\n"), 1):
            for m in padrao.finditer(linha):
                cam = m.group(1).rstrip(".,;)/")
                if any(c in cam for c in "*{}") or "..." in cam or cam in ALLOWLIST_CAMINHOS:
                    continue
                if not (RAIZ / cam).exists():
                    probs.append(Problema("caminhos", arq, n, f"caminho inexistente: {cam}"))
    return probs


# ── e) geradores ────────────────────────────────────────────────────────────
def checar_geradores() -> tuple[list[Problema], list[str]]:
    probs: list[Problema] = []
    avisos: list[str] = []
    ref = RAIZ / "scripts" / "verificar_docs.py"

    def rodar(cmd: list[str], nome: str):
        r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            detalhe = (r.stderr.strip() or r.stdout.strip()).replace("\n", " | ")
            probs.append(Problema("geradores", ref, 1, f"{nome} --check falhou: {detalhe}"))

    rodar([sys.executable, str(RAIZ / "scripts" / "gerar_docs_api.py"), "--check"], "gerar_docs_api.py")
    node = shutil.which("node")
    if node:
        rodar([node, str(RAIZ / "scripts" / "gerar_atalhos.mjs"), "--check"], "gerar_atalhos.mjs")
    else:
        avisos.append("node não encontrado: verificação de atalhos gerados ignorada")
    return probs, avisos


# ── principal ───────────────────────────────────────────────────────────────
CATEGORIAS = ["links", "env", "modelos", "caminhos", "geradores"]


def main() -> int:
    ap = argparse.ArgumentParser(description="Lints da documentação do CapIAu-Talho")
    ap.add_argument("--so-avisos", action="store_true", help="relata problemas mas sempre sai com código 0")
    ap.add_argument("--apenas", nargs="+", choices=CATEGORIAS, help="roda só estas verificações")
    ap.add_argument("--excluir", action="append", default=[], help="prefixo de caminho a ignorar (pode repetir)")
    args = ap.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    excluir = EXCLUIR_PADRAO + args.excluir
    todos = arquivos_md(excluir)
    por_rel = {p.relative_to(RAIZ).as_posix(): p for p in todos}
    docs_usuario = [p for r, p in por_rel.items() if r in DOCS_USUARIO_FIXAS or r.startswith("wiki/")]
    docs_modelos = [p for r, p in por_rel.items() if r in DOCS_MODELOS_FIXAS or r.startswith("wiki/")]
    ativas = args.apenas or CATEGORIAS

    problemas: list[Problema] = []
    avisos: list[str] = []
    if "links" in ativas:
        problemas += checar_links(todos)
    if "env" in ativas:
        problemas += checar_env(todos)
    if "modelos" in ativas:
        problemas += checar_modelos(docs_modelos)
    if "caminhos" in ativas:
        problemas += checar_caminhos(docs_usuario)
    if "geradores" in ativas:
        p, a = checar_geradores()
        problemas += p
        avisos += a

    print(f"Arquivos Markdown verificados: {len(todos)} (excluídos: {', '.join(excluir)})")
    for cat in CATEGORIAS:
        if cat not in ativas:
            continue
        itens = [p for p in problemas if p.categoria == cat]
        print(f"\n[{cat}] {'OK' if not itens else str(len(itens)) + ' problema(s)'}")
        for p in itens:
            print(f"  - {p}")
    for a in avisos:
        print(f"\nAVISO: {a}")

    total = len(problemas)
    print(f"\nResultado: {total} problema(s).")
    if total and not args.so_avisos:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
