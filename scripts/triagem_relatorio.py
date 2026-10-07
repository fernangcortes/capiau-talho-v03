"""Relatório HTML de uma rodada de triagem (scripts/triagem_rodada.py), para revisar à mão.

Lê o JSON da rodada e o banco (só leitura) e gera um HTML ao lado do JSON, que toca os
proxies direto do disco (abra no navegador desta máquina). Cada clipe traz o vídeo, a
categoria da triagem, o voto da Laya (distribuição pelas 8 categorias), o título antes e
depois, o trecho da fala que a triagem viu e o custo. A revisão (certo / errado + a
categoria certa) fica no navegador e sai num JSON pelo botão "Baixar revisões".

Uso:
    .venv\\Scripts\\python.exe scripts\\triagem_relatorio.py data\\cache\\triagem_rodada\\2026-10-07_1317.json
    (sem argumento: a rodada executada mais recente)
"""
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import CONFIG  # noqa: E402
from src.db.repositories.narrative import NarrativeRepository  # noqa: E402
from src.nlp.prompt_registry import AUDIO_CATEGORIES, TRIAGE_CATEGORIES  # noqa: E402

PASTA = CONFIG.CACHE_DIR / "triagem_rodada"
MOTOR_LAYA = "laya-multilingual"
MOTORES_JEV = ("jev-latest", "jev-1.13")  # TypeSafe direto e OpenRouter


def _ro(caminho: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{caminho.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _backup_anterior(gerado_em: str) -> Optional[Path]:
    """O backup feito antes da rodada (títulos antigos): o mais novo com data <= a da rodada."""
    dia = gerado_em[:10].replace("-", "")
    candidatos = sorted(p for p in CONFIG.DB_PATH.parent.glob("capiau.db.antes-triagem*")
                        if not p.name.endswith(("-wal", "-shm")) and dia in p.name)
    return candidatos[-1] if candidatos else None


def _relativo(arquivo: Path, base: Path) -> str:
    """Caminho do proxy relativo ao HTML: abre do disco e também servido por HTTP."""
    import os
    from urllib.parse import quote
    try:
        return quote(os.path.relpath(arquivo, base).replace(os.sep, "/"))
    except ValueError:  # outro disco: não há caminho relativo
        return arquivo.as_uri()


def _ultima_decisao(conn, video_id: int, motores, tarefa: str = "triagem") -> Optional[Dict[str, Any]]:
    # a última que respondeu; sem nenhuma, a última tentativa (para mostrar o erro)
    motores = (motores,) if isinstance(motores, str) else tuple(motores)
    r = conn.execute("SELECT categoria, confianca, resposta_json, erro, modo, created_at, motor, modelo_resposta "
                     "FROM system1_decisao WHERE media_kind = 'video' AND media_id = ? AND tarefa = ? "
                     f"AND motor IN ({','.join('?' * len(motores))}) "
                     "ORDER BY categoria IS NOT NULL DESC, id DESC LIMIT 1",
                     (video_id, tarefa, *motores)).fetchone()
    if not r:
        return None
    try:
        dist = json.loads(r["resposta_json"] or "{}")
    except ValueError:
        dist = {}
    dist = {k: float(v) for k, v in dist.items() if isinstance(v, (int, float))} if isinstance(dist, dict) else {}
    return {"categoria": r["categoria"], "confianca": r["confianca"], "distribuicao": dist,
            "erro": r["erro"], "modo": r["modo"], "quando": r["created_at"],
            "motor": r["motor"], "versao": r["modelo_resposta"]}


def _rodadas_anteriores(atual: Path) -> Dict[int, Dict[str, Any]]:
    """Resultado de cada vídeo na rodada executada mais recente ANTES desta (estabilidade)."""
    anteriores: Dict[int, Dict[str, Any]] = {}
    for p in sorted(PASTA.glob("*.json")):
        if p.stem.endswith("_plano") or p.stem >= atual.stem:
            continue
        try:
            dados = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        for r in dados.get("resultados", []):
            if r.get("categoria"):
                anteriores[r["video_id"]] = {"rodada": p.stem, "categoria": r.get("categoria"),
                                             "confianca": r.get("confianca"), "titulo": r.get("titulo")}
    return anteriores


def coletar(rodada: Dict[str, Any], base: Path, anteriores: Optional[Dict[int, Dict[str, Any]]] = None) -> Dict[str, Any]:
    conn = _ro(CONFIG.DB_PATH)
    backup = _backup_anterior(rodada["gerado_em"])
    antigo = _ro(backup) if backup else None
    clipes: List[Dict[str, Any]] = []
    try:
        for r in rodada["resultados"]:
            vid = r["video_id"]
            v = conn.execute("SELECT * FROM video WHERE id = ?", (vid,)).fetchone()
            if not v:
                continue
            v = dict(v)
            dialogos = NarrativeRepository.get_transcript_dialogues(conn, vid)
            titulo_antes = None
            if antigo:
                a = antigo.execute("SELECT title FROM video WHERE id = ?", (vid,)).fetchone()
                titulo_antes = a["title"] if a else None
            proxy = CONFIG.PROXIES_DIR / f"proxy_vid_{vid}.mp4"
            capa = CONFIG.THUMBNAILS_DIR / f"thumb_{vid}.jpg"
            try:
                secundarias = json.loads(v.get("categorias_secundarias") or "[]")
            except ValueError:
                secundarias = []
            usos = [c.get("uso") or {} for c in r.get("chamadas", [])]
            try:
                detalhe = json.loads(v.get("triagem_detalhe") or "{}")
            except ValueError:
                detalhe = {}
            clipes.append({
                "id": vid, "arquivo": v["filename"], "caminho": v["filepath"],
                "duracao": v.get("duration") or 0, "tipo": v.get("video_type"), "natureza": v.get("natureza"),
                "video": _relativo(proxy, base) if proxy.exists() else None,
                "capa": _relativo(capa, base) if capa.exists() else None,
                "resultado": r.get("resultado"), "categoria": r.get("categoria") or v.get("category"),
                "confianca": r.get("confianca", v.get("category_confidence")), "secundarias": secundarias,
                "distribuicao": r.get("distribuicao") or detalhe.get("distribuicao"),
                "margem": r.get("margem", detalhe.get("margem")),
                "justificativa": detalhe.get("justificativa"),
                "anterior": (anteriores or {}).get(vid),
                "fora_do_projeto": bool(v.get("fora_do_projeto")),
                "titulo": r.get("titulo") or v.get("title"), "titulo_antes": titulo_antes,
                "descricao_anterior": v.get("description"),
                # o que a triagem leu: os 6 primeiros blocos de fala, com o instante para pular
                "fala_vista": [{"t": d["start_time"], "falante": d["speaker_id"], "texto": d["text"]}
                               for d in dialogos[:6]],
                "falantes": len({d["speaker_id"] for d in dialogos}),
                "transcreveu_agora": bool(r.get("transcreveu")),
                "laya": _ultima_decisao(conn, vid, MOTOR_LAYA),
                "jev": _ultima_decisao(conn, vid, MOTORES_JEV),
                "jev_visao": _ultima_decisao(conn, vid, MOTORES_JEV, "triagem_com_visao"),
                "jev_verificacao": _ultima_decisao(conn, vid, MOTORES_JEV, "verificacao_triagem"),
                "custo_visao": r.get("custo_visao_usd", 0), "custo_asr": r.get("custo_asr_usd", 0),
                "tokens_entrada": sum(int(u.get("prompt_tokens") or 0) for u in usos),
                "tokens_saida": sum(int(u.get("completion_tokens") or 0) for u in usos),
                "chamadas": len(usos), "segundos": r.get("segundos"),
            })
    finally:
        conn.close()
        if antigo:
            antigo.close()
    return {"rodada": {k: rodada.get(k) for k in ("gerado_em", "projeto", "plano", "resumo")},
            "categorias": TRIAGE_CATEGORIES, "categorias_audio": AUDIO_CATEGORIES,
            "backup": backup.name if backup else None, "clipes": clipes}


def gerar(caminho_json: Path, destino: Optional[Path] = None) -> Path:
    rodada = json.loads(caminho_json.read_text(encoding="utf-8"))
    if not rodada.get("executado"):
        raise SystemExit(f"{caminho_json.name} é um plano (dry-run): não há resultados para relatar.")
    dados = coletar(rodada, caminho_json.parent, _rodadas_anteriores(caminho_json))
    modelo = (Path(__file__).with_name("triagem_relatorio.html")).read_text(encoding="utf-8")
    bruto = json.dumps(dados, ensure_ascii=False).replace("</", "<\\/")
    destino = destino or caminho_json.with_suffix(".html")
    destino.write_text(modelo.replace("/*__DADOS__*/null", bruto), encoding="utf-8")
    return destino


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    saida = None
    if "--saida" in argv:  # gera noutro arquivo, sem sobrescrever o relatório que já existe
        i = argv.index("--saida")
        saida = Path(argv[i + 1])
        del argv[i:i + 2]
    if argv:
        alvo = Path(argv[0])
    else:
        executadas = [p for p in sorted(PASTA.glob("*.json")) if not p.stem.endswith("_plano")]
        if not executadas:
            raise SystemExit("Nenhuma rodada executada em " + str(PASTA))
        alvo = executadas[-1]
    destino = gerar(alvo, saida)
    print(f"Relatório: {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
