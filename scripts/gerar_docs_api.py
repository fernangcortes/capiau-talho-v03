#!/usr/bin/env python3
"""Gera a tabela de rotas da API REST por análise estática (AST).

Não importa o servidor, então roda sem FastAPI, Qdrant ou outras dependências.
Lê src/api/server.py (include_router e rotas diretas) e src/api/routes/*.py
(decoradores @router.get/post/put/patch/delete/api_route, prefixos e tags do APIRouter).

Uso:
    python scripts/gerar_docs_api.py           grava os arquivos
    python scripts/gerar_docs_api.py --check   sai com código 1 se estiver desatualizado

Escreve somente ENTRE os marcadores <!-- GERADO:API:INICIO --> e <!-- GERADO:API:FIM -->
em docs/api_endpoints.md e wiki/15.-Arquitetura-Tecnica-e-API-REST.md.
"""
from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
INICIO = "<!-- GERADO:API:INICIO -->"
FIM = "<!-- GERADO:API:FIM -->"
ALVOS = [
    ("docs/api_endpoints.md", True),
    ("wiki/15.-Arquitetura-Tecnica-e-API-REST.md", False),  # reescrita por outro fluxo: marcadores opcionais
]
METODOS_HTTP = {"get", "post", "put", "patch", "delete"}
ORDEM_METODOS = {"GET": 0, "POST": 1, "PUT": 2, "PATCH": 3, "DELETE": 4}


def _const_str(no: ast.AST | None) -> str | None:
    if isinstance(no, ast.Constant) and isinstance(no.value, str):
        return no.value
    return None


def _kw(call: ast.Call, nome: str) -> ast.AST | None:
    for k in call.keywords:
        if k.arg == nome:
            return k.value
    return None


def _lista_str(no: ast.AST | None) -> list[str]:
    if isinstance(no, (ast.List, ast.Tuple)):
        return [s for s in (_const_str(e) for e in no.elts) if s]
    return []


def _primeira_linha(doc: str | None) -> str:
    if not doc:
        return ""
    for linha in doc.strip().splitlines():
        linha = linha.strip()
        if linha:
            return linha
    return ""


def _routers_do_modulo(arvore: ast.Module) -> dict[str, dict]:
    """Mapeia nome da variável -> {prefix, tags} para cada APIRouter(...)."""
    out: dict[str, dict] = {}
    for no in arvore.body:
        if isinstance(no, ast.Assign) and isinstance(no.value, ast.Call):
            f = no.value.func
            nome_f = f.id if isinstance(f, ast.Name) else getattr(f, "attr", "")
            if nome_f == "APIRouter":
                for alvo in no.targets:
                    if isinstance(alvo, ast.Name):
                        out[alvo.id] = {
                            "prefix": _const_str(_kw(no.value, "prefix")) or "",
                            "tags": _lista_str(_kw(no.value, "tags")),
                        }
    return out


def _rotas_de_decoradores(arvore: ast.Module, dono: dict[str, dict], padrao_tag: str):
    """Gera tuplas (metodo, caminho, tag, descricao) a partir dos decoradores das funções."""
    for no in ast.walk(arvore):
        if not isinstance(no, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in no.decorator_list:
            if not (isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute)
                    and isinstance(dec.func.value, ast.Name)):
                continue
            var, attr = dec.func.value.id, dec.func.attr
            if var not in dono:
                continue
            if attr not in METODOS_HTTP and attr != "api_route":
                continue
            caminho = _const_str(dec.args[0]) if dec.args else _const_str(_kw(dec, "path"))
            if caminho is None:
                continue
            if attr == "api_route":
                metodos = [m.upper() for m in _lista_str(_kw(dec, "methods"))] or ["GET"]
            else:
                metodos = [attr.upper()]
            info = dono[var]
            tags = _lista_str(_kw(dec, "tags")) or info["tags"]
            tag = tags[0] if tags else padrao_tag
            desc = _const_str(_kw(dec, "summary")) or _primeira_linha(ast.get_docstring(no))
            for m in metodos:
                yield m, caminho, tag, desc, info


def coletar_rotas() -> list[dict]:
    server = ast.parse((RAIZ / "src/api/server.py").read_text(encoding="utf-8"))

    # módulo -> prefixo/tags extras vindos de include_router(modulo.router, prefix=..., tags=...)
    inclusoes: dict[str, dict] = {}
    for no in ast.walk(server):
        if (isinstance(no, ast.Call) and isinstance(no.func, ast.Attribute) and no.func.attr == "include_router"
                and no.args and isinstance(no.args[0], ast.Attribute) and isinstance(no.args[0].value, ast.Name)):
            inclusoes[no.args[0].value.id] = {
                "prefix": _const_str(_kw(no, "prefix")) or "",
                "tags": _lista_str(_kw(no, "tags")),
            }

    rotas: list[dict] = []
    for mod, extra in sorted(inclusoes.items()):
        arq = RAIZ / "src/api/routes" / f"{mod}.py"
        if not arq.exists():
            continue
        arvore = ast.parse(arq.read_text(encoding="utf-8"))
        routers = _routers_do_modulo(arvore)
        if "router" not in routers:
            continue
        for m, cam, tag, desc, info in _rotas_de_decoradores(arvore, {"router": routers["router"]}, mod):
            completo = extra["prefix"] + info["prefix"] + cam
            rotas.append({"metodo": m, "rota": completo, "grupo": tag, "descricao": desc})

    # rotas declaradas direto no app (ex.: /api/health)
    for m, cam, tag, desc, _ in _rotas_de_decoradores(server, {"app": {"prefix": "", "tags": []}}, "Sistema"):
        rotas.append({"metodo": m, "rota": cam, "grupo": tag, "descricao": desc})
    return rotas


def _esc(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ")


def gerar_bloco(rotas: list[dict]) -> str:
    grupos: dict[str, list[dict]] = {}
    for r in rotas:
        grupos.setdefault(r["grupo"], []).append(r)
    linhas = [f"Total: {len(rotas)} rotas em {len(grupos)} grupos. "
              "A documentação interativa completa (parâmetros e esquemas) fica em `/docs` com o servidor em execução.", ""]
    for grupo in sorted(grupos, key=str.lower):
        itens = sorted(grupos[grupo], key=lambda r: (r["rota"], ORDEM_METODOS.get(r["metodo"], 9)))
        linhas += [f"### {grupo}", "", "| Método | Rota | Descrição |", "| :--- | :--- | :--- |"]
        for r in itens:
            linhas.append(f"| {r['metodo']} | `{_esc(r['rota'])}` | {_esc(r['descricao'])} |")
        linhas.append("")
    return "\n".join(linhas).rstrip() + "\n"


def aplicar(bloco: str, check: bool) -> list[str]:
    problemas: list[str] = []
    for rel, obrigatorio in ALVOS:
        arq = RAIZ / rel
        if not arq.exists():
            if obrigatorio:
                problemas.append(f"{rel}: arquivo ausente")
            continue
        texto = arq.read_text(encoding="utf-8")
        i, f = texto.find(INICIO), texto.find(FIM)
        if i < 0 or f < i:
            if obrigatorio:
                problemas.append(f"{rel}: marcadores ausentes")
            else:
                print(f"  - {rel}: marcadores ausentes, ignorado")
            continue
        novo = texto[: i + len(INICIO)] + "\n\n" + bloco.strip() + "\n\n" + texto[f:]
        if novo == texto:
            print(f"  = {rel}: em dia")
        elif check:
            problemas.append(f"{rel}: desatualizado (rode: python scripts/gerar_docs_api.py)")
        else:
            arq.write_text(novo, encoding="utf-8", newline="\n")
            print(f"  + {rel}: atualizado")
    return problemas


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="não grava; código 1 se algum arquivo estiver desatualizado")
    args = ap.parse_args()
    rotas = coletar_rotas()
    problemas = aplicar(gerar_bloco(rotas), args.check)
    for p in problemas:
        print(f"ERRO: {p}", file=sys.stderr)
    if not problemas:
        print(f"OK: {len(rotas)} rotas.")
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
