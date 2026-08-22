# -*- coding: utf-8 -*-
"""
APOSENTADO (Entrega A4 de docs/PLANO_HISTORICO_METADADOS_E_WORKER_ASR.md).

O remendo virou funcionalidade: MediaRepository.update_video_metadata arquiva
sozinho a versao anterior em `video_metadata_history` a cada sobrescrita, e a
interface tem "ver versoes anteriores" com botao de restaurar. Ninguem precisa
mais lembrar de rodar `salvar` antes do lote.

Mantido so para ler snapshots antigos em data/backups/. Nao use em lote novo.

---

Protege a decupagem editorial dos videos antes de re-transcrever.

Por que isso existe: ao final de cada transcricao o pipeline chama
`generate_video_summary`, que grava

    SET description = ?, summary = ?, tags = ?,
        title = COALESCE(NULLIF(?, ''), title)

ou seja, sobrescreve `description`, `summary` e `tags` incondicionalmente, e o
`title` sempre que a IA devolver algo. Quem corrigiu titulo ou descricao a mao
perde o trabalho ao reprocessar.

Uso:
    python -m scripts.proteger_metadados salvar     # antes de transcrever
    python -m scripts.proteger_metadados restaurar  # depois
    python -m scripts.proteger_metadados conferir   # mostra o que mudou

O snapshot fica em data/backups/metadados_<timestamp>.json e o mais recente e
usado por padrao. Passe --arquivo para escolher outro.
"""
from __future__ import annotations

import argparse
import io
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DB = RAIZ / "data" / "capiau.db"
BACKUPS = RAIZ / "data" / "backups"

CAMPOS = ("title", "description", "summary", "tags", "category")

# Videos do acervo de entrevistas — os que tem decupagem feita a mao.
FILTRO = "filepath like '%entrevistas-completas%'"


def conectar() -> sqlite3.Connection:
    conn = sqlite3.connect(DB, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def ultimo_snapshot() -> Path | None:
    if not BACKUPS.is_dir():
        return None
    arquivos = sorted(BACKUPS.glob("metadados_*.json"))
    return arquivos[-1] if arquivos else None


def salvar() -> int:
    BACKUPS.mkdir(parents=True, exist_ok=True)
    conn = conectar()
    linhas = conn.execute(
        f"select id, filename, {', '.join(CAMPOS)} from video where {FILTRO} order by id"
    ).fetchall()
    conn.close()

    dados = [dict(r) for r in linhas]
    destino = BACKUPS / f"metadados_{datetime.now():%Y%m%d_%H%M%S}.json"
    with io.open(destino, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)

    print(f"{len(dados)} videos salvos em {destino.name}")
    for d in dados:
        print(f"  id={d['id']:<4} {d['title'] or '(sem titulo)'}")
    return 0


def carregar(caminho: Path | None) -> list[dict]:
    alvo = caminho or ultimo_snapshot()
    if alvo is None or not alvo.exists():
        sys.exit("Nenhum snapshot encontrado. Rode 'salvar' antes.")
    print(f"Usando snapshot: {alvo.name}")
    return json.load(io.open(alvo, encoding="utf-8"))


def conferir(caminho: Path | None) -> int:
    dados = carregar(caminho)
    conn = conectar()
    mudou = 0
    for d in dados:
        atual = conn.execute(
            f"select {', '.join(CAMPOS)} from video where id = ?", (d["id"],)
        ).fetchone()
        if atual is None:
            print(f"  id={d['id']} sumiu do banco")
            continue
        difs = [c for c in CAMPOS if (atual[c] or "") != (d[c] or "")]
        if difs:
            mudou += 1
            print(f"  id={d['id']:<4} mudou: {', '.join(difs)}")
            if "title" in difs:
                print(f"        snapshot: {d['title']}")
                print(f"        agora   : {atual['title']}")
    conn.close()
    print()
    print(f"{mudou} de {len(dados)} videos com diferenca.")
    return 0


def restaurar(caminho: Path | None) -> int:
    dados = carregar(caminho)
    conn = conectar()
    cur = conn.cursor()
    restaurados = 0
    for d in dados:
        atual = conn.execute(
            f"select {', '.join(CAMPOS)} from video where id = ?", (d["id"],)
        ).fetchone()
        if atual is None:
            continue
        if all((atual[c] or "") == (d[c] or "") for c in CAMPOS):
            continue
        cur.execute(
            "update video set title=?, description=?, summary=?, tags=?, category=? where id=?",
            (d["title"], d["description"], d["summary"], d["tags"], d["category"], d["id"]),
        )
        restaurados += 1
        print(f"  id={d['id']:<4} restaurado -> {d['title']}")
    conn.commit()
    conn.close()
    print()
    print(f"{restaurados} videos restaurados.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("acao", choices=["salvar", "restaurar", "conferir"])
    ap.add_argument("--arquivo", type=Path, default=None,
                    help="snapshot especifico (default: o mais recente)")
    args = ap.parse_args()

    if args.acao == "salvar":
        return salvar()
    if args.acao == "conferir":
        return conferir(args.arquivo)
    return restaurar(args.arquivo)


if __name__ == "__main__":
    sys.exit(main())
