"""Rodada só de triagem nos vídeos sem categoria (docs/REVISAO_CATEGORIAS.md, seção 8, passo 3).

Para cada vídeo: natureza (áudio vai ao tipo de som, local) -> ASR se faltar fala ->
planos -> Laya (sombra) -> triagem por visão (PipelineService.triar_video). Não roda a
análise de quadros. O status do vídeo volta ao que era.

Sem --executar é só o plano (dry-run): quais vídeos e a estimativa de custo. Com
--executar chama a API de verdade, grava a categoria no banco e mede o gasto REAL de
cada chamada (o 'usage' da OpenRouter, com o custo em US$). Para antes do próximo
vídeo quando o gasto passa do --teto-usd.

Piloto: --limite N escolhe N vídeos espalhados pela duração (do mais curto ao mais
longo), para o custo medido valer para o resto. Depois do piloto, rodar sem --limite
pega os que continuam sem categoria.

Uso:
    .venv\\Scripts\\python.exe scripts\\triagem_rodada.py --project 2 --limite 20
    .venv\\Scripts\\python.exe scripts\\triagem_rodada.py --project 2 --limite 20 --executar
Saída: data/cache/triagem_rodada/<data>_<hora>.json (+ .md ao lado).
"""
import argparse
import json
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import CONFIG  # noqa: E402

SAIDA = CONFIG.CACHE_DIR / "triagem_rodada"
# Estimativa de 07/10/2026 (Gemini 2.5 Flash: US$ 0,30/M entrada, 2,50/M saída; 6 quadros
# 1080p ~1.550 tokens cada + prompt ~1.200; saída 300 a 800). Só para o dry-run.
ESTIMATIVA_VISAO_USD = (0.004, 0.005)


def _banco_leitura() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{CONFIG.DB_PATH.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def selecionar(project_id: int, limite: int = 0, ids: Optional[List[int]] = None) -> List[Dict[str, Any]]:
    conn = _banco_leitura()
    try:
        # Com ids explícitos vale também vídeo já triado (refazer o piloto); sem ids, só os sem categoria
        sql = ("SELECT v.id, v.filename, v.duration, v.video_type, v.natureza, "
               "EXISTS(SELECT 1 FROM transcript t WHERE t.video_id = v.id) AS tem_fala "
               "FROM video v WHERE v.project_id = ?"
               + ("" if ids else " AND (v.category IS NULL OR v.category = '')"))
        linhas = [dict(r) for r in conn.execute(sql + " ORDER BY v.duration, v.id", (project_id,))]
    finally:
        conn.close()
    if ids:
        quero = set(ids)
        return [l for l in linhas if l["id"] in quero]
    if limite and limite < len(linhas):
        # espalhados pela duração: o piloto vê do clipe de 5 s ao de 20 min
        passo = (len(linhas) - 1) / (limite - 1) if limite > 1 else 0
        return [linhas[round(i * passo)] for i in range(limite)]
    return linhas


def _preco_asr_hora(project_id: int) -> float:
    from src.services.settings_service import SettingsService
    from src.transcription.motores import OpcoesASR, preco_hora_usd, resolver_motores
    S = SettingsService.get_settings(project_id)
    plano = resolver_motores(S.get("transcription.engine"), S.get("diarization.engine"),
                             S.get("asr.language"), S.get("asr.whisper_model"))
    return preco_hora_usd(plano, OpcoesASR(idioma=S.get("asr.language"), diarizar=S.get("asr.speaker_labels"),
                                           detectar_entidades=S.get("asr.entity_detection")))


def plano(videos: List[Dict[str, Any]], preco_asr: float) -> Dict[str, Any]:
    sem_fala = [v for v in videos if not v["tem_fala"]]
    horas_sem_fala = sum(v["duration"] or 0 for v in sem_fala) / 3600
    return {
        "videos": len(videos),
        "horas": round(sum(v["duration"] or 0 for v in videos) / 3600, 2),
        "sem_transcricao": len(sem_fala),
        "visao_usd": [round(len(videos) * e, 2) for e in ESTIMATIVA_VISAO_USD],
        "asr_teto_usd": round(horas_sem_fala * preco_asr, 2),
    }


def executar(videos: List[Dict[str, Any]], teto: float, preco_asr: float) -> Dict[str, Any]:
    # As mesmas migrações que o servidor roda ao subir (colunas novas da triagem)
    from src.db.schema import init_db
    init_db()
    from src.services import pipeline as P
    chamadas: List[Dict[str, Any]] = []
    P.OBSERVADORES_DE_USO.append(chamadas.append)
    resultados, gasto = [], 0.0
    try:
        for n, v in enumerate(videos, start=1):
            if gasto >= teto:
                print(f"\nTeto de US$ {teto:.2f} atingido (gasto US$ {gasto:.4f}): parando antes do vídeo {v['id']}.")
                break
            antes = len(chamadas)
            inicio = time.perf_counter()
            try:
                r = P.PipelineService.triar_video(v["id"])
            except Exception as e:
                r = {"video_id": v["id"], "resultado": "erro", "erro": str(e)[:300]}
            usos = chamadas[antes:]
            visao = sum(float((u["uso"] or {}).get("cost") or 0.0) for u in usos)
            asr = (v["duration"] or 0) / 3600 * preco_asr if r.get("transcreveu") else 0.0
            gasto += visao + asr
            r.update(segundos=round(time.perf_counter() - inicio, 1), custo_visao_usd=round(visao, 6),
                     custo_asr_usd=round(asr, 4), chamadas=usos, filename=v["filename"])
            resultados.append(r)
            tokens = sum(int((u["uso"] or {}).get("prompt_tokens") or 0) for u in usos)
            saidas = sum(int((u["uso"] or {}).get("completion_tokens") or 0) for u in usos)
            print(f"[{n:>3}/{len(videos)}] #{v['id']:<4} {v['duration'] or 0:7.1f}s  {r.get('resultado', ''):8} "
                  f"{str(r.get('categoria') or '-'):11} conf {r.get('confianca', '-')!s:5} "
                  f"Laya {str(r.get('laya') or '-'):11} visão US$ {visao:.5f} ({len(usos)} cham., "
                  f"{tokens} entrada, {saidas} saída)  ASR US$ {asr:.4f}  {r['segundos']} s  US$ {gasto:.4f}")
    finally:
        P.OBSERVADORES_DE_USO.remove(chamadas.append)
    return {"gasto_usd": round(gasto, 4), "resultados": resultados}


def _resumo(execucao: Dict[str, Any], restantes: List[Dict[str, Any]], preco_asr: float) -> Dict[str, Any]:
    rs = execucao["resultados"]
    triados = [r for r in rs if r.get("chamadas")]
    visao = [r["custo_visao_usd"] for r in triados]
    media = sum(visao) / len(visao) if visao else 0.0
    tokens_in = [sum(int((u["uso"] or {}).get("prompt_tokens") or 0) for u in r["chamadas"]) for r in triados]
    tokens_out = [sum(int((u["uso"] or {}).get("completion_tokens") or 0) for u in r["chamadas"]) for r in triados]
    resto = plano(restantes, preco_asr)
    contagem: Dict[str, int] = {}
    for r in rs:
        contagem[r.get("resultado", "?")] = contagem.get(r.get("resultado", "?"), 0) + 1
    return {
        "gasto_usd": execucao["gasto_usd"],
        "resultados": contagem,
        "visao_media_por_video_usd": round(media, 5),
        "tokens_entrada_medio": round(sum(tokens_in) / len(tokens_in)) if tokens_in else 0,
        "tokens_saida_medio": round(sum(tokens_out) / len(tokens_out)) if tokens_out else 0,
        "retentativas": sum(max(0, len(r["chamadas"]) - 1) for r in triados),
        "asr_usd": round(sum(r["custo_asr_usd"] for r in rs), 4),
        "restantes": resto["videos"],
        "projecao_restantes_usd": round(resto["videos"] * media + resto["asr_teto_usd"], 2),
    }


def _markdown(dados: Dict[str, Any]) -> str:
    linhas = [f"# Rodada de triagem ({dados['gerado_em']})", ""]
    if "resumo" in dados:
        s = dados["resumo"]
        linhas += [f"- Gasto real: **US$ {s['gasto_usd']:.4f}** ({s['resultados']})",
                   f"- Visão por vídeo: US$ {s['visao_media_por_video_usd']:.5f}; tokens médios "
                   f"{s['tokens_entrada_medio']} entrada, {s['tokens_saida_medio']} saída; {s['retentativas']} retentativas",
                   f"- ASR: US$ {s['asr_usd']:.4f}",
                   f"- Restam {s['restantes']} vídeos: projeção **US$ {s['projecao_restantes_usd']:.2f}**", "",
                   "| id | dur (s) | resultado | categoria | conf | Laya | US$ visão | US$ ASR |",
                   "|---|---|---|---|---|---|---|---|"]
        for r in dados["resultados"]:
            linhas.append(f"| {r['video_id']} | {r.get('duracao', 0):.0f} | {r.get('resultado')} | "
                          f"{r.get('categoria') or '-'} | {r.get('confianca', '-')} | {r.get('laya') or '-'} | "
                          f"{r['custo_visao_usd']:.5f} | {r['custo_asr_usd']:.4f} |")
    else:
        p = dados["plano"]
        linhas += [f"- {p['videos']} vídeos, {p['horas']} h, {p['sem_transcricao']} sem transcrição",
                   f"- Visão estimada: US$ {p['visao_usd'][0]:.2f} a {p['visao_usd'][1]:.2f}; "
                   f"ASR até US$ {p['asr_teto_usd']:.2f}"]
    return "\n".join(linhas) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", type=int, required=True)
    ap.add_argument("--limite", type=int, default=0, help="piloto: N vídeos espalhados pela duração (0 = todos)")
    ap.add_argument("--videos", default="", help="ids separados por vírgula (no lugar da seleção; refaz mesmo os já triados)")
    ap.add_argument("--teto-usd", type=float, default=4.0, help="para antes do próximo vídeo ao passar disto")
    ap.add_argument("--executar", action="store_true", help="chama a API de verdade (custa); sem isto só planeja")
    args = ap.parse_args(argv)

    ids = [int(x) for x in args.videos.split(",") if x.strip()] or None
    videos = selecionar(args.project, args.limite, ids)
    preco_asr = _preco_asr_hora(args.project)
    p = plano(videos, preco_asr)
    print(f"{p['videos']} vídeos ({p['horas']} h; {p['sem_transcricao']} sem transcrição). "
          f"Estimativa: visão US$ {p['visao_usd'][0]:.2f} a {p['visao_usd'][1]:.2f}, ASR até US$ {p['asr_teto_usd']:.2f} "
          f"(US$ {preco_asr:.2f}/h). Teto: US$ {args.teto_usd:.2f}.")
    dados: Dict[str, Any] = {"gerado_em": datetime.now().isoformat(timespec="seconds"), "projeto": args.project,
                             "executado": args.executar, "plano": p, "videos": [v["id"] for v in videos]}
    if args.executar:
        execucao = executar(videos, args.teto_usd, preco_asr)
        feitos = {r["video_id"] for r in execucao["resultados"]}
        restantes = [v for v in selecionar(args.project) if v["id"] not in feitos]
        dados["resultados"] = execucao["resultados"]
        dados["resumo"] = _resumo(execucao, restantes, preco_asr)
        s = dados["resumo"]
        print(f"\nGasto real: US$ {s['gasto_usd']:.4f} | visão por vídeo US$ {s['visao_media_por_video_usd']:.5f} "
              f"| tokens médios {s['tokens_entrada_medio']} entrada / {s['tokens_saida_medio']} saída "
              f"| {s['resultados']}\nRestam {s['restantes']} vídeos sem categoria: projeção US$ {s['projecao_restantes_usd']:.2f}")
    else:
        for v in videos:
            print(f"  #{v['id']:<4} {v['duration'] or 0:7.1f}s  {v['video_type']:9} "
                  f"{'com fala' if v['tem_fala'] else 'sem transcrição':16} {v['filename']}")
    SAIDA.mkdir(parents=True, exist_ok=True)
    nome = datetime.now().strftime("%Y-%m-%d_%H%M") + ("" if args.executar else "_plano")
    (SAIDA / f"{nome}.json").write_text(json.dumps(dados, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    (SAIDA / f"{nome}.md").write_text(_markdown(dados), encoding="utf-8")
    print(f"\nRelatório: {SAIDA / nome}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
