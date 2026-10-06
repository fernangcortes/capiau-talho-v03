"""Bancada de calibração da visão: quanto a densidade de quadros muda o resultado.

Para cada vídeo da amostra, segmenta UMA vez (local, sem custo) e planeja os quadros
de cada densidade com o mesmo planejador do app (PipelineService._plan_keyframes):
  - "plano": 1 quadro por segmento (coverage_floor=False);
  - número N: intervalo de N s (coverage_floor=True).
Sem --executar é só o plano (dry-run): vídeos, quadros por densidade e quantas chamadas
de visão custaria. Com --executar extrai os quadros, chama a visão SEM categoria no
prompt (de propósito: a descrição fica independente da triagem) e mede, contra a
densidade mais densa, que fração das descrições "novas" a menos densa perdeu.

Nunca grava no banco real nem no Qdrant: o banco abre só em modo leitura
(file:...?mode=ro) e nada aqui instancia SemanticSearch ou ImageSearch.

Uso:
    set PYTHONPATH=. && .venv\\Scripts\\python.exe scripts\\visao_calibrar.py --project 2 --videos 517,99 --densidades plano,8,4
    set PYTHONPATH=. && .venv\\Scripts\\python.exe scripts\\visao_calibrar.py --project 2 --videos 517,99 --densidades plano,8,4 --executar
Saída: data/cache/visao_calibracao/<data>.json (+ .md para ler no celular);
o dry-run grava <data>_plano.json/.md.
"""
import argparse
import base64
import difflib
import json
import random
import re
import sqlite3
import sys
import tempfile
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.config import CONFIG
from src.db.repositories.settings import SettingsRepository
from src.media.ffmpeg import extract_frame
from src.nlp.prompt_templates import get_vision_prompt
from src.services.pipeline import PipelineService
from src.services.settings_registry import get_registry_map
from src.services.settings_service import ResolvedSettings
from src.vision.segmentation import segment_video

SAIDA = CONFIG.CACHE_DIR / "visao_calibracao"
SEMENTE = 20261006
JANELA_S = 5.0        # descrição da menos densa "cobre" a da mais densa se estiver a até isto
SIMILARIDADE = 0.20   # Jaccard mínimo para "conteúdo parecido" (descrições de uma mesma cena variam de palavra)
LIMITE_PERDA = 0.10   # a sugestão é a menor densidade que perde menos que isto

STOPWORDS = {
    "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "em", "no", "na",
    "nos", "nas", "e", "ou", "com", "sem", "por", "para", "pra", "ao", "aos", "que", "se", "ha", "ser",
    "esta", "estao", "esta", "seu", "sua", "seus", "suas", "ele", "ela", "ao", "mais", "entre", "sobre",
    "ao", "ate", "como", "ha", "um", "ja", "ainda", "ali", "ai", "la", "aqui",
}


# ---------------------------------------------------------------------------
# Banco: só leitura
# ---------------------------------------------------------------------------

def abrir_banco_leitura(caminho: Path) -> sqlite3.Connection:
    """Abre o banco em modo somente leitura; qualquer escrita levanta OperationalError."""
    conn = sqlite3.connect(Path(caminho).resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def configuracoes(conn: sqlite3.Connection, project_id: int) -> ResolvedSettings:
    """Configurações resolvidas (padrão -> global -> projeto) lidas pela conexão somente leitura."""
    registro = get_registry_map()
    try:
        globais = SettingsRepository.get_all_global(conn)
        projeto = SettingsRepository.get_all_project(conn, project_id)
    except sqlite3.Error:
        globais, projeto = {}, {}
    valores = {}
    for chave, entrada in registro.items():
        if chave in projeto and entrada.get("scope") != "global":
            valores[chave] = projeto[chave]
        elif chave in globais:
            valores[chave] = globais[chave]
        else:
            valores[chave] = entrada["default"]
    return ResolvedSettings(valores)


def ler_videos(conn: sqlite3.Connection, project_id: int, ids: List[int]) -> List[Dict[str, Any]]:
    achados = []
    for vid in ids:
        r = conn.execute("SELECT id, filepath, duration, category FROM video WHERE id = ? AND project_id = ?",
                         (vid, project_id)).fetchone()
        if r:
            achados.append(dict(r))
        else:
            print(f"#{vid}: não existe no projeto {project_id}")
    return achados


# ---------------------------------------------------------------------------
# Densidades e planejamento
# ---------------------------------------------------------------------------

def parse_densidades(texto: str) -> List[Dict[str, Any]]:
    """"plano,8,4" -> [{'rotulo': 'plano', 'intervalo': None}, {'rotulo': '8s', 'intervalo': 8.0}, ...]."""
    saida = []
    for item in [x.strip().lower() for x in texto.split(",") if x.strip()]:
        if item == "plano":
            saida.append({"rotulo": "plano", "intervalo": None})
            continue
        try:
            n = float(item.replace("s", ""))
        except ValueError:
            raise ValueError(f"Densidade inválida: '{item}' (use 'plano' ou um intervalo em segundos)")
        if n <= 0:
            raise ValueError(f"Intervalo precisa ser positivo: '{item}'")
        saida.append({"rotulo": f"{n:g}s", "intervalo": n})
    if not saida:
        raise ValueError("Nenhuma densidade informada")
    return saida


def planejar_densidade(segmentos: List[Dict[str, Any]], duracao: float, densidade: Dict[str, Any],
                       min_gap: float, max_quadros: int = 0) -> List[Dict[str, Any]]:
    """Quadros de uma densidade, pelo planejador do app. max_quadros=0 = sem teto (mede a densidade pura)."""
    if densidade["intervalo"] is None:
        # 1 quadro por segmento; o intervalo é ignorado sem o piso de cobertura
        return PipelineService._plan_keyframes(segmentos, duracao, 10.0, min_gap, max_quadros, coverage_floor=False)
    return PipelineService._plan_keyframes(segmentos, duracao, densidade["intervalo"], min_gap, max_quadros,
                                           coverage_floor=True)


def fonte_dos_quadros(video: Dict[str, Any]) -> Path:
    return Path(video["filepath"])


def proxy_do_video(video_id: int) -> Path:
    return CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"


def segmentar(video: Dict[str, Any], S, beats: bool) -> List[Dict[str, Any]]:
    """Uma segmentação por vídeo (no proxy quando existir, como o app). Local, sem custo de API."""
    proxy = proxy_do_video(video["id"])
    origem = proxy if proxy.exists() else fonte_dos_quadros(video)
    return segment_video(
        origem, video["duration"],
        detect_threshold=S.get("segment.detect_threshold"),
        min_beat_shot_s=S.get("segment.min_beat_shot_s"),
        sample_interval_s=S.get("segment.beat_sample_interval_s"),
        drift_threshold=S.get("segment.beat_drift_threshold"),
        motion_enabled=False,
        embed_fn=None,
        detect_beats_enabled=beats,
    )


# ---------------------------------------------------------------------------
# Medida: o que a densidade mais densa acrescenta
# ---------------------------------------------------------------------------

def normalizar(texto: str) -> set:
    texto = unicodedata.normalize("NFKD", (texto or "").lower())
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return {p for p in re.findall(r"[a-z0-9]+", texto) if p not in STOPWORDS and len(p) > 1}


def similaridade(a: str, b: str) -> float:
    """Jaccard de palavras normalizadas sem stopwords; se uma das duas fica vazia, cai para difflib."""
    pa, pb = normalizar(a), normalizar(b)
    if pa and pb:
        return len(pa & pb) / len(pa | pb)
    return difflib.SequenceMatcher(None, (a or "").lower(), (b or "").lower()).ratio()


def novidades_perdidas(densa: List[Dict[str, Any]], menor: List[Dict[str, Any]],
                       janela: float = JANELA_S, minimo: float = SIMILARIDADE) -> Dict[str, Any]:
    """Para cada descrição da densa, existe uma da menor a até `janela` s com conteúdo parecido?

    As que não têm par são as "novidades" que a menor perdeu. Descrições vazias são ignoradas.
    """
    consideradas = [d for d in densa if (d.get("descricao") or "").strip()]
    perdidas = []
    for d in consideradas:
        tem_par = any(
            abs(m["timestamp"] - d["timestamp"]) <= janela
            and similaridade(d["descricao"], m["descricao"]) >= minimo
            for m in menor if (m.get("descricao") or "").strip())
        if not tem_par:
            perdidas.append(d)
    total = len(consideradas)
    return {"total": total, "perdidas": len(perdidas),
            "fracao": (len(perdidas) / total) if total else 0.0,
            "exemplos": [{"timestamp": round(p["timestamp"], 1), "descricao": p["descricao"][:200]}
                         for p in perdidas[:5]]}


def indice_mais_densa(resultado_video: Dict[str, Any]) -> str:
    """Rótulo da densidade com mais quadros (empate: a de menor intervalo)."""
    dens = resultado_video["densidades"]
    return max(dens, key=lambda r: (dens[r]["quadros"], -(dens[r]["intervalo"] or 1e9)))


def sugerir(resultado_video: Dict[str, Any], limite: float = LIMITE_PERDA) -> Optional[str]:
    """Menor densidade (menos quadros) que perde menos que `limite`; a mais densa sempre serve."""
    dens = resultado_video["densidades"]
    candidatas = [(d["quadros"], r) for r, d in dens.items()
                  if d.get("novidades_perdidas") is not None and d["novidades_perdidas"]["fracao"] < limite]
    return min(candidatas)[1] if candidatas else None


# ---------------------------------------------------------------------------
# Leitura às cegas
# ---------------------------------------------------------------------------

def texto_da_linha_do_tempo(descricoes: List[Dict[str, Any]]) -> str:
    return "\n".join(f"[{d['timestamp']:.0f}s] {d['descricao']}" for d in descricoes if d.get("descricao"))


def montar_cego(video_id: int, descricoes_por_densidade: Dict[str, List[Dict[str, Any]]],
                semente: int = SEMENTE) -> Dict[str, Any]:
    """Pares A/B (cada densidade contra a mais densa) com a ordem sorteada.

    'pares' é o que você lê; 'gabarito' (que lado é qual densidade) fica separado
    para não contaminar a leitura. 'voto' é para você preencher.
    """
    rotulos = list(descricoes_por_densidade)
    if len(rotulos) < 2:
        return {"pares": [], "gabarito": {}}
    densa = max(rotulos, key=lambda r: len(descricoes_por_densidade[r]))
    rng = random.Random(f"{semente}:{video_id}")
    pares, gabarito = [], {}
    for r in rotulos:
        if r == densa:
            continue
        lados = [r, densa]
        rng.shuffle(lados)
        n = len(pares) + 1
        pares.append({"par": n,
                      "A": texto_da_linha_do_tempo(descricoes_por_densidade[lados[0]]),
                      "B": texto_da_linha_do_tempo(descricoes_por_densidade[lados[1]]),
                      "voto": None})
        gabarito[str(n)] = {"A": lados[0], "B": lados[1]}
    return {"pares": pares, "gabarito": gabarito}


# ---------------------------------------------------------------------------
# Execução
# ---------------------------------------------------------------------------

def descrever_quadros(video: Dict[str, Any], timestamps: List[float], project_id: int) -> Dict[float, Optional[Dict[str, Any]]]:
    """Extrai cada quadro numa pasta temporária, chama a visão (prompt SEM categoria) e apaga o quadro."""
    prompt = get_vision_prompt(known_entities=[], detected_people=[], project_id=project_id, category=None)
    proxy = proxy_do_video(video["id"])
    saida: Dict[float, Optional[Dict[str, Any]]] = {}
    with tempfile.TemporaryDirectory(prefix="visao_calibrar_") as pasta:
        for i, ts in enumerate(timestamps):
            quadro = Path(pasta) / f"q_{video['id']}_{i}.jpg"
            try:
                if not extract_frame(fonte_dos_quadros(video), ts, quadro, proxy_fallback_path=proxy):
                    saida[ts] = None
                    continue
                b64 = base64.b64encode(quadro.read_bytes()).decode("utf-8")
                analise = PipelineService.call_openrouter_vision(b64, "jpg", prompt=prompt, project_id=project_id)
            finally:
                if quadro.exists():
                    quadro.unlink()
            saida[ts] = ({"timestamp": ts, "descricao": analise.get("descricao", ""),
                          "tags": analise.get("tags", []) or []} if analise else None)
    return saida


def rodar(banco: Path, project_id: int, ids: List[int], densidades: List[Dict[str, Any]], beats: bool = True,
          executar: bool = False, janela: float = JANELA_S, similar: float = SIMILARIDADE,
          max_quadros: int = 0) -> Dict[str, Any]:
    conn = abrir_banco_leitura(banco)
    try:
        S = configuracoes(conn, project_id)
        videos = ler_videos(conn, project_id, ids)
    finally:
        conn.close()
    min_gap = S.get("segment.min_keyframe_gap_s")

    resultado: Dict[str, Any] = {
        "gerado_em": date.today().isoformat(), "projeto": project_id, "executado": executar,
        "beats": beats, "janela_s": janela, "similaridade_minima": similar, "limite_perda": LIMITE_PERDA,
        "densidades": [d["rotulo"] for d in densidades], "videos": {}, "cego": {}, "gabarito_cego": {}}

    for v in videos:
        print(f"\n#{v['id']} ({v['duration']:.0f} s)")
        try:
            segmentos = segmentar(v, S, beats)
        except Exception as e:
            print(f"  falha na segmentação: {e}")
            resultado["videos"][str(v["id"])] = {"duracao": v["duration"], "erro": f"segmentação: {e}", "densidades": {}}
            continue
        por_dens, planos = {}, {}
        for d in densidades:
            jobs = planejar_densidade(segmentos, v["duration"], d, min_gap, max_quadros)
            planos[d["rotulo"]] = jobs
            por_dens[d["rotulo"]] = {"intervalo": d["intervalo"], "quadros": len(jobs),
                                     "timestamps": [round(j["timestamp"], 2) for j in jobs]}
        unicos = sorted({round(j["timestamp"], 2) for jobs in planos.values() for j in jobs})
        info = {"duracao": v["duration"], "categoria_no_banco": v.get("category"), "segmentos": len(segmentos),
                "chamadas_unicas": len(unicos), "densidades": por_dens}
        resultado["videos"][str(v["id"])] = info
        for r, dados in por_dens.items():
            print(f"  {r:<7} {dados['quadros']:4d} quadros")
        print(f"  chamadas de visão se executar: {len(unicos)} (quadros repetidos entre densidades contam uma vez)")
        if not executar:
            continue

        descritos = descrever_quadros(v, unicos, project_id)
        falhas = sum(1 for x in descritos.values() if x is None)
        info["falhas"] = falhas
        por_rotulo = {}
        for r, jobs in planos.items():
            lista = [descritos[round(j["timestamp"], 2)] for j in jobs]
            lista = [x for x in lista if x]
            por_rotulo[r] = lista
            por_dens[r]["descricoes"] = lista
        densa = indice_mais_densa(info)
        info["mais_densa"] = densa
        for r in por_dens:
            por_dens[r]["novidades_perdidas"] = novidades_perdidas(por_rotulo[densa], por_rotulo[r], janela, similar)
        info["sugestao"] = sugerir(info)
        cego = montar_cego(v["id"], por_rotulo)
        resultado["cego"][str(v["id"])] = cego["pares"]
        resultado["gabarito_cego"][str(v["id"])] = cego["gabarito"]
    return resultado


# ---------------------------------------------------------------------------
# Relatórios
# ---------------------------------------------------------------------------

def resumo_md(res: Dict[str, Any], limite: float = LIMITE_PERDA) -> str:
    L = [f"# Calibração da visão ({res['gerado_em']})", "",
         f"Projeto {res['projeto']}, beats {'sim' if res['beats'] else 'não'}, "
         f"{'EXECUTADO' if res['executado'] else 'só o plano (nada foi chamado)'}.", ""]
    for vid, info in res["videos"].items():
        L.append(f"## Vídeo {vid} ({info['duracao']:.0f} s)")
        if info.get("erro"):
            L += [f"Erro: {info['erro']}", ""]
            continue
        L += [f"{info['segmentos']} segmentos; {info['chamadas_unicas']} chamadas únicas.", "",
              "| Densidade | Quadros | Novidades perdidas |", "|---|---|---|"]
        for r, d in info["densidades"].items():
            np_ = d.get("novidades_perdidas")
            perda = f"{np_['fracao']:.0%} ({np_['perdidas']}/{np_['total']})" if np_ else "-"
            L.append(f"| {r} | {d['quadros']} | {perda} |")
        if res["executado"]:
            s = info.get("sugestao")
            L += ["", f"Sugestão (perde menos de {limite:.0%}): **{s or 'nenhuma'}**"]
            for r, d in info["densidades"].items():
                for ex in (d.get("novidades_perdidas") or {}).get("exemplos", [])[:2]:
                    if d["novidades_perdidas"]["fracao"] > 0:
                        L.append(f"- perdida em {r} @ {ex['timestamp']}s: {ex['descricao'][:120]}")
        L.append("")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", type=int, required=True)
    ap.add_argument("--videos", required=True, help="ids separados por vírgula (a amostra)")
    ap.add_argument("--densidades", default="plano,8,4", help="'plano' e/ou intervalos em s, ex.: plano,8,4")
    ap.add_argument("--beats", action=argparse.BooleanOptionalAction, default=True)
    ap.add_argument("--executar", action="store_true", help="chama a visão de verdade (custa API); sem isto só planeja")
    ap.add_argument("--saida", default="", help="arquivo .json de saída (o .md vai ao lado)")
    ap.add_argument("--janela", type=float, default=JANELA_S, help="segundos de tolerância para achar o par")
    ap.add_argument("--similaridade", type=float, default=SIMILARIDADE, help="Jaccard mínimo para 'parecido'")
    ap.add_argument("--limite", type=float, default=LIMITE_PERDA, help="perda máxima aceita na sugestão")
    ap.add_argument("--max-quadros", type=int, default=0, help="teto de quadros por densidade (0 = sem teto)")
    args = ap.parse_args(argv)

    ids = [int(x) for x in args.videos.split(",") if x.strip()]
    res = rodar(CONFIG.DB_PATH, args.project, ids, parse_densidades(args.densidades), beats=args.beats,
                executar=args.executar, janela=args.janela, similar=args.similaridade, max_quadros=args.max_quadros)
    res["limite_perda"] = args.limite
    if args.saida:
        destino = Path(args.saida)
    else:
        destino = SAIDA / (date.today().isoformat() + ("" if args.executar else "_plano") + ".json")
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    destino.with_suffix(".md").write_text(resumo_md(res, args.limite), encoding="utf-8")
    print(f"\nSalvo em {destino} (+ .md)")


if __name__ == "__main__":
    sys.exit(main())
