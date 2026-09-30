"""Avalia o Sistema 1 (Laya, e Jev com --jev) em vídeos que já têm categoria.

Referência: a correção humana (triage_feedback) quando existe; senão a
categoria atual do vídeo (em geral dada pela triagem por visão). Cada decisão
vai para system1_decisao com modo='avaliacao', para comparar e treinar depois.

Uso:
    set PYTHONPATH=. && .venv\\Scripts\\python.exe scripts\\system1_avaliar.py --project 2 --limit 40
    (acrescente --jev para comparar com o Jev; gasta crédito do TypeSafe)
"""
import argparse
import statistics
from collections import Counter
from pathlib import Path

from src.db.connection import get_db
from src.db.repositories.narrative import NarrativeRepository
from src.media.ffmpeg import has_audio_stream
from src.nlp.prompt_registry import TRIAGE_CATEGORIES
from src.services.system1_service import (
    MOTOR_JEV, MOTOR_LAYA, System1Indisponivel, System1Service,
    estado_triagem, perguntas_triagem, registrar_decisao,
)


def selecionar(project_id: int, limite: int):
    with get_db() as conn:
        linhas = conn.execute(
            "SELECT v.id, v.filepath, v.duration, v.category, "
            "(SELECT right_category FROM triage_feedback f WHERE f.media_kind='video' AND f.media_id=v.id "
            " ORDER BY f.created_at DESC LIMIT 1) AS humano "
            "FROM video v WHERE v.project_id = ? AND v.category IS NOT NULL AND v.category != '' "
            "ORDER BY v.id LIMIT ?", (project_id, limite)).fetchall()
        itens = []
        for r in linhas:
            try:
                falas = NarrativeRepository.get_transcript_dialogues(conn, r["id"]) or []
            except Exception:
                falas = []
            itens.append((dict(r), " ".join(d["text"] for d in falas[:12])))
    return itens


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", type=int, required=True)
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--jev", action="store_true", help="compara com o Jev (gasta crédito TypeSafe)")
    args = ap.parse_args()

    itens = selecionar(args.project, args.limit)
    if not itens:
        print("Nenhum vídeo com categoria neste projeto.")
        return

    svc = System1Service()
    acertos = {MOTOR_LAYA: 0, MOTOR_JEV: 0}
    total = {MOTOR_LAYA: 0, MOTOR_JEV: 0}
    latencias = {MOTOR_LAYA: [], MOTOR_JEV: []}
    confiancas = {MOTOR_LAYA: [], MOTOR_JEV: []}
    concordam = 0
    confusao = Counter()

    for v, fala in itens:
        caminho = Path(v["filepath"])
        estado = {"filename": caminho.name, "folder": caminho.parent.name, "duration_s": v["duration"],
                  "has_audio": has_audio_stream(caminho) if caminho.exists() else False, "speech": fala}
        referencia = v["humano"] or v["category"]
        origem = "humano" if v["humano"] else "visão"
        if referencia not in TRIAGE_CATEGORIES:
            print(f"#{v['id']:<5} pulado: categoria '{referencia}' fora da lista atual")
            continue

        laya = svc.evaluate_triage(estado, project_id=args.project, media_id=v["id"],
                                   modo="avaliacao", comparar_jev=False)
        jev = None
        if args.jev:
            try:
                jev = svc.jev.evaluate_media_triage(estado, args.project)
            except System1Indisponivel as e:
                print(f"  Jev indisponível: {e}")
            with get_db() as conn:
                registrar_decisao(conn, project_id=args.project, media_kind="video", media_id=v["id"],
                                  motor=MOTOR_JEV, modo="avaliacao", estado=estado_triagem(estado),
                                  perguntas=perguntas_triagem(), decisao=jev,
                                  erro=None if jev else "indisponível")
                conn.commit()

        linha = f"#{v['id']:<5} ref={referencia:<10}({origem:<6})"
        for motor, dec in ((MOTOR_LAYA, laya), (MOTOR_JEV, jev)):
            if dec is None or dec.category is None:
                continue
            total[motor] += 1
            acertos[motor] += dec.category == referencia
            latencias[motor].append(dec.inference_time_ms)
            confiancas[motor].append(dec.confidence)
            linha += f"  {motor.split('-')[0]}={dec.category:<10}{dec.confidence:.2f}"
        if laya and laya.category:
            confusao[(referencia, laya.category)] += 1
        if laya and jev and laya.category and jev.category:
            concordam += laya.category == jev.category
        print(linha)

    print("\nResumo")
    for motor in (MOTOR_LAYA, MOTOR_JEV):
        if not total[motor]:
            continue
        print(f"  {motor}: {acertos[motor]}/{total[motor]} batem com a referência "
              f"({100 * acertos[motor] / total[motor]:.0f}%), confiança mediana "
              f"{statistics.median(confiancas[motor]):.2f}, latência mediana {statistics.median(latencias[motor]):.0f} ms")
    if total[MOTOR_JEV]:
        print(f"  Laya e Jev concordam em {concordam}/{min(total.values())}")
    erros = [(k, n) for k, n in confusao.most_common() if k[0] != k[1]][:8]
    if erros:
        print("  Erros mais comuns da Laya (referência -> Laya):")
        for (ref, dada), n in erros:
            print(f"    {ref} -> {dada}: {n}")


if __name__ == "__main__":
    main()
