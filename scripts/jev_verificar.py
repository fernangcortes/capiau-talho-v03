"""Jev sobre uma rodada de triagem: três perguntas por clipe, para calibrar.

1. direto: a escolha de categoria de sempre (nome, pasta, duração, fala);
2. com visão: a mesma escolha, lendo também o que a triagem por visão viu nos quadros
   (justificativa e título, de video.triagem_detalhe);
3. verificação: a categoria que a triagem deu é sustentada pelas evidências?
   (confirma / contradiz / insuficiente; receita "cascata verificada" do Jev).

Só ACRESCENTA linhas em system1_decisao (modo 'avaliacao'; tarefas 'triagem',
'triagem_com_visao' e 'verificacao_triagem'); não muda a categoria de nada. Sem
--executar é só o plano.

Por onde: as Configurações (triage.jev_via, padrão TypeSafe). --via força nesta
execução; --chave-do-env usa a chave do .env (TYPESAFE_API_KEY ou OPENROUTER_API_KEY)
em vez da salva nas Configurações, sem gravar nada.

Uso:
    .venv\\Scripts\\python.exe scripts\\jev_verificar.py --rodada data\\cache\\triagem_rodada\\2026-10-07_1450.json --executar
Saída: data/cache/jev_verificacao/<data>_<hora>.json
"""
import argparse
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import CONFIG  # noqa: E402

SAIDA = CONFIG.CACHE_DIR / "jev_verificacao"


def _estado(conn, v: Dict[str, Any], objetivo: str) -> Dict[str, Any]:
    from src.db.repositories.narrative import NarrativeRepository
    from src.media.ffmpeg import has_audio_stream
    caminho = Path(v["filepath"])
    falas = NarrativeRepository.get_transcript_dialogues(conn, v["id"]) or []
    # o mesmo estado de PipelineService.triage_system1
    return {"objetivo": objetivo, "filename": caminho.name, "folder": caminho.parent.name,
            "duration_s": v["duration"], "has_audio": has_audio_stream(caminho) if caminho.exists() else False,
            "speech": " ".join(d["text"] for d in falas[:12])}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rodada", required=True, type=Path, help="JSON de uma rodada executada (triagem_rodada.py)")
    ap.add_argument("--via", choices=["typesafe", "openrouter"], help="força o caminho nesta execução")
    ap.add_argument("--chave-do-env", action="store_true", help="usa a chave do .env nesta execução")
    ap.add_argument("--executar", action="store_true", help="chama o Jev (gasta crédito); sem isto só planeja")
    args = ap.parse_args(argv)

    rodada = json.loads(args.rodada.read_text(encoding="utf-8"))
    ids = [r["video_id"] for r in rodada.get("resultados", []) if r.get("categoria")]
    projeto = rodada["projeto"]
    print(f"{len(ids)} clipes da rodada {args.rodada.stem}; 3 perguntas ao Jev por clipe.")
    if not args.executar:
        print("Plano apenas (sem --executar).")
        return 0

    from src.db.connection import get_db
    from src.nlp.prompt_templates import objetivo_do_projeto
    from src.services.system1_service import (
        PERGUNTAS_VERIFICACAO, System1Indisponivel, System1JevClient, TriageDecision,
        estado_com_visao, estado_triagem, estado_verificacao, perguntas_triagem, registrar_decisao,
    )
    chave = None
    if args.chave_do_env:
        from dotenv import dotenv_values
        env = dotenv_values(CONFIG.DB_PATH.parents[1] / ".env")
        via_env = args.via or "typesafe"
        chave = env.get("TYPESAFE_API_KEY" if via_env == "typesafe" else "OPENROUTER_API_KEY")
    jev = System1JevClient(api_key=chave, via=args.via)
    print(f"Jev por {jev.via(projeto)} ({jev.motor}).")
    objetivo = objetivo_do_projeto(projeto)

    linhas: List[Dict[str, Any]] = []
    custo = 0.0
    for vid in ids:
        with get_db() as conn:
            v = dict(conn.execute("SELECT id, filepath, duration, category, title, triagem_detalhe FROM video WHERE id = ?",
                                  (vid,)).fetchone())
            estado = _estado(conn, v, objetivo)
        try:
            detalhe = json.loads(v["triagem_detalhe"] or "{}")
        except ValueError:
            detalhe = {}
        evidencia = {"justificativa": detalhe.get("justificativa"), "titulo": v["title"]}
        categoria = v["category"]
        saida: Dict[str, Any] = {"video_id": vid, "triagem": categoria, "tem_justificativa": bool(evidencia["justificativa"])}
        registros = []
        for nome, chamar, tarefa, est, perg in (
            ("direto", lambda: jev.evaluate_media_triage(estado, projeto), "triagem",
             estado_triagem(estado), perguntas_triagem()),
            ("com_visao", lambda: jev.triagem_com_visao(estado, evidencia, projeto), "triagem_com_visao",
             estado_com_visao(estado, evidencia), perguntas_triagem()),
            ("verificacao", lambda: jev.verificar_triagem(estado, evidencia, categoria, projeto), "verificacao_triagem",
             estado_verificacao(estado, evidencia, categoria), PERGUNTAS_VERIFICACAO),
        ):
            try:
                r = chamar()
                erro = None
            except System1Indisponivel as e:
                r, erro = None, str(e)
            custo += float((jev.ultimo_uso or {}).get("cost") or 0.0) if r is not None else 0.0
            if isinstance(r, dict):  # verificação: o veredito vai no lugar da categoria
                dec = TriageDecision(category=r["veredito"], confidence=r["confianca"], escalate_to_system2=False,
                                     inference_time_ms=r["latencia_ms"], model=jev.motor,
                                     probabilities=r["probabilidades"], versao=r["modelo"])
            else:
                dec = r
            saida[nome] = ({"categoria": dec.category, "confianca": round(dec.confidence, 3)} if dec else {"erro": erro})
            registros.append((tarefa, est, perg, dec, erro))
        with get_db() as conn:
            for tarefa, est, perg, dec, erro in registros:
                registrar_decisao(conn, project_id=projeto, media_kind="video", media_id=vid, motor=jev.motor,
                                  modo="avaliacao", estado=est, perguntas=perg, decisao=dec, erro=erro,
                                  modelo_resposta=dec.versao if dec else None, tarefa=tarefa)
            conn.commit()
        linhas.append(saida)
        f = lambda d: f"{d.get('categoria') or 'ERRO'}:{d.get('confianca', '')}"
        print(f"#{vid:<4} triagem={categoria:<10} direto={f(saida['direto']):<16} "
              f"com_visao={f(saida['com_visao']):<16} verificação={f(saida['verificacao'])}")

    def bate(k):
        return sum(1 for l in linhas if l[k].get("categoria") == l["triagem"])
    print(f"\nJev direto concorda com a triagem: {bate('direto')}/{len(linhas)}")
    print(f"Jev com o que a visão viu concorda: {bate('com_visao')}/{len(linhas)}")
    print("Verificação:", dict(Counter(l["verificacao"].get("categoria") or "erro" for l in linhas)))
    if custo:
        print(f"Custo informado: US$ {custo:.5f}")
    SAIDA.mkdir(parents=True, exist_ok=True)
    destino = SAIDA / (datetime.now().strftime("%Y-%m-%d_%H%M") + ".json")
    destino.write_text(json.dumps({"rodada": args.rodada.stem, "via": jev.via(projeto), "motor": jev.motor,
                                   "custo_usd": custo, "clipes": linhas}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Saída: {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
