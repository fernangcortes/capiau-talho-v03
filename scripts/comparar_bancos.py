"""Compara dois bancos do CapIAu-Talho lado a lado, para decidir qual análise é a boa.

Criado em 18/08/2026. Contexto: o banco desta máquina se mostrou mais ANTIGO que a
análise feita em casa por volta de 20/07 — ao abrir hoje, a migração precisou CRIAR as
colunas `title`, `category`, `category_confidence`, `burst_group_id`, `palette_temp`,
`palette_hex`, `realm`, `role` e `status`, o que só acontece quando elas não existiam.
Ou seja: as descrições daqui foram geradas antes das melhorias de prompt de 17–22/07.

Uso:
    python scripts/comparar_bancos.py <banco_a.db> <banco_b.db>
    python scripts/comparar_bancos.py data/capiau.db D:/backup/capiau_casa.db

Só lê: nunca escreve em nenhum dos dois bancos.
"""
import sqlite3
import sys
from pathlib import Path


def _existe_coluna(con: sqlite3.Connection, tabela: str, coluna: str) -> bool:
    try:
        cols = [r[1] for r in con.execute(f"PRAGMA table_info({tabela})")]
    except sqlite3.Error:
        return False
    return coluna in cols


def _conta(con: sqlite3.Connection, sql: str) -> int:
    try:
        return con.execute(sql).fetchone()[0]
    except sqlite3.Error:
        return -1  # coluna ou tabela ausente neste banco


def perfil(caminho: str) -> dict:
    """Impressão digital de um banco: o que ele tem e quanto está preenchido."""
    p = Path(caminho)
    con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    d = {
        "arquivo": str(p),
        "tamanho_mb": round(p.stat().st_size / 1024 / 1024, 1),
        "tabelas": sorted(r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")),
    }

    for tabela in ("video", "photo"):
        d[f"{tabela}_total"] = _conta(con, f"SELECT COUNT(*) FROM {tabela}")
        for campo in ("title", "description", "summary", "category"):
            if _existe_coluna(con, tabela, campo):
                d[f"{tabela}_com_{campo}"] = _conta(
                    con, f"SELECT COUNT(*) FROM {tabela} WHERE {campo} IS NOT NULL AND TRIM({campo}) <> ''")
            else:
                d[f"{tabela}_com_{campo}"] = None  # coluna nem existe

    # Sinais de que a análise nova rodou neste banco
    d["segmentos"] = _conta(con, "SELECT COUNT(*) FROM media_segment")
    d["segmentos_com_shot_scale"] = _conta(
        con, "SELECT COUNT(*) FROM media_segment WHERE shot_scale IS NOT NULL")
    d["fotos_em_rajada"] = _conta(
        con, "SELECT COUNT(*) FROM photo WHERE burst_group_id IS NOT NULL")
    d["correcoes_de_triagem"] = _conta(con, "SELECT COUNT(*) FROM triage_feedback")
    d["entidades"] = _conta(con, "SELECT COUNT(*) FROM entity")

    # Tamanho médio da descrição: prompts melhores costumam render textos mais densos
    for tabela in ("video", "photo"):
        try:
            r = con.execute(
                f"SELECT AVG(LENGTH(description)) FROM {tabela} "
                f"WHERE description IS NOT NULL AND TRIM(description) <> ''").fetchone()[0]
            d[f"{tabela}_descricao_media_chars"] = round(r) if r else 0
        except sqlite3.Error:
            d[f"{tabela}_descricao_media_chars"] = -1

    con.close()
    return d


def amostra_descricoes(caminho: str, n: int = 3) -> list:
    """Algumas descrições reais, para comparar a QUALIDADE a olho — não só a contagem."""
    con = sqlite3.connect(f"file:{caminho}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    saida = []
    try:
        campos = "id, filename, description"
        if _existe_coluna(con, "video", "title"):
            campos = "id, filename, title, description"
        for r in con.execute(
                f"SELECT {campos} FROM video "
                f"WHERE description IS NOT NULL AND TRIM(description) <> '' ORDER BY id LIMIT {n}"):
            saida.append(dict(r))
    except sqlite3.Error:
        pass
    con.close()
    return saida


def _fmt(v) -> str:
    if v is None:
        return "coluna ausente"
    if v == -1:
        return "tabela ausente"
    return str(v)


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    a, b = sys.argv[1], sys.argv[2]
    for caminho in (a, b):
        if not Path(caminho).exists():
            print(f"ERRO: banco não encontrado: {caminho}")
            sys.exit(1)

    pa, pb = perfil(a), perfil(b)

    rotulo_a = Path(a).name
    rotulo_b = Path(b).name
    largura = max(len(rotulo_a), len(rotulo_b), 14)

    print()
    print(f"{'MÉTRICA':<34} {rotulo_a:>{largura}}  {rotulo_b:>{largura}}   DIFERENÇA")
    print("-" * (34 + largura * 2 + 16))

    chaves = [k for k in pa if k not in ("arquivo", "tabelas")]
    for k in chaves:
        va, vb = pa.get(k), pb.get(k)
        dif = ""
        if isinstance(va, (int, float)) and isinstance(vb, (int, float)) and va >= 0 and vb >= 0:
            delta = vb - va
            if delta:
                dif = f"{delta:+}"
        marca = "  <<<" if dif and dif.startswith("+") else ""
        print(f"{k:<34} {_fmt(va):>{largura}}  {_fmt(vb):>{largura}}   {dif}{marca}")

    so_em_b = sorted(set(pb["tabelas"]) - set(pa["tabelas"]))
    so_em_a = sorted(set(pa["tabelas"]) - set(pb["tabelas"]))
    if so_em_b:
        print(f"\nTabelas só em {rotulo_b}: {', '.join(so_em_b)}")
    if so_em_a:
        print(f"Tabelas só em {rotulo_a}: {', '.join(so_em_a)}")

    for rotulo, caminho in ((rotulo_a, a), (rotulo_b, b)):
        print(f"\n--- amostra de descrições: {rotulo} ---")
        for item in amostra_descricoes(caminho):
            titulo = item.get("title") or "(sem título)"
            desc = (item.get("description") or "").replace("\n", " ")
            print(f"  [{item['id']}] {titulo}")
            print(f"      {desc[:200]}{'…' if len(desc) > 200 else ''}")

    print("\nLeitura: '<<<' marca onde o segundo banco tem MAIS. Colunas ausentes num dos")
    print("lados indicam que aquele banco é anterior à feature correspondente.")


if __name__ == "__main__":
    main()
