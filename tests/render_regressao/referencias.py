"""Gerenciamento de cenários, impressão digital de ambiente, aprovações e comparações."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import PIL
from PIL import Image

from . import ajudantes, metricas, relatorio

PASTA_RAIZ = Path(__file__).resolve().parent
PASTA_CENARIOS = PASTA_RAIZ / "cenarios"
PASTA_REFERENCIAS = PASTA_RAIZ / "referencias"
PASTA_SAIDA = PASTA_RAIZ / "_saida"
ARQ_LIMIARES_PADRAO = PASTA_RAIZ / "limiares_padrao.json"

SCHEMA_CONHECIDO = 1

# Guarda estrita: durante o pytest nenhuma chamada escreve em referencias/.
_PERMITIR_ESCRITA_REFERENCIAS = False


@contextmanager
def autorizar_escrita_referencias():
    global _PERMITIR_ESCRITA_REFERENCIAS
    anterior = _PERMITIR_ESCRITA_REFERENCIAS
    _PERMITIR_ESCRITA_REFERENCIAS = True
    try:
        yield
    finally:
        _PERMITIR_ESCRITA_REFERENCIAS = anterior


def exigir_permissao_escrita_referencias(destino: Path) -> None:
    destino_res = Path(destino).resolve()
    ref_res = PASTA_REFERENCIAS.resolve()
    dentro_ref = destino_res == ref_res or ref_res in destino_res.parents
    if dentro_ref and not _PERMITIR_ESCRITA_REFERENCIAS:
        raise PermissionError(
            "Escrita direta em tests/render_regressao/referencias/ é proibida fora de "
            "`scripts/render_regressao.py aprovar`."
        )


def impressao_digital_ambiente() -> Dict[str, str]:
    """Impressão digital do FFmpeg e stack Python para seleção de perfil estrito/deriva."""
    ff_ver = "indisponivel"
    buildconf_sha = "indisponivel"
    if shutil.which("ffmpeg"):
        try:
            r_ver = subprocess.run(
                ["ffmpeg", "-version"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=True,
            )
            ff_ver = (r_ver.stdout.splitlines() or ["desconhecida"])[0].strip()
        except Exception:
            pass
        try:
            r_bc = subprocess.run(
                ["ffmpeg", "-v", "quiet", "-buildconf"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=True,
            )
            buildconf_sha = hashlib.sha1((r_bc.stdout or "").encode("utf-8")).hexdigest()
        except Exception:
            pass

    return {
        "ffmpeg_version": ff_ver,
        "ffmpeg_buildconf_sha1": buildconf_sha,
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "pillow": PIL.__version__,
    }


def _validar_cenario(dados: Any, origem: str = "<mem>") -> Dict[str, Any]:
    if not isinstance(dados, dict):
        raise ValueError(f"Cenário {origem} deve ser um objeto JSON.")
    schema = dados.get("schema")
    if not isinstance(schema, int) or schema < 1:
        raise ValueError(f"Cenário {origem} com campo 'schema' inválido: {schema!r}")
    if schema > SCHEMA_CONHECIDO:
        raise ValueError(
            f"Cenário {origem} usa schema={schema}, maior que o suportado ({SCHEMA_CONHECIDO}). "
            "Execute `scripts/render_regressao.py migrar`."
        )
    for obrigatorio in ("id", "fps", "resolucao", "sequencia"):
        if obrigatorio not in dados:
            raise ValueError(f"Cenário {origem} sem campo obrigatório '{obrigatorio}'.")
    return dados


def carregar_cenario(cenario_id_ou_caminho: str | Path) -> Dict[str, Any]:
    p = Path(cenario_id_ou_caminho)
    if p.is_file():
        return _validar_cenario(json.loads(p.read_text(encoding="utf-8")), str(p))

    alvo_id = str(cenario_id_ou_caminho)
    candidato_direto = PASTA_CENARIOS / f"{alvo_id}.json"
    if candidato_direto.is_file():
        return _validar_cenario(
            json.loads(candidato_direto.read_text(encoding="utf-8")),
            str(candidato_direto),
        )

    for arq in sorted(PASTA_CENARIOS.glob("*.json")):
        dados = json.loads(arq.read_text(encoding="utf-8"))
        if dados.get("id") == alvo_id:
            return _validar_cenario(dados, str(arq))

    raise FileNotFoundError(f"Cenário não encontrado: {cenario_id_ou_caminho!r}")


def listar_cenarios() -> List[Dict[str, Any]]:
    if not PASTA_CENARIOS.is_dir():
        return []
    saida = []
    for arq in sorted(PASTA_CENARIOS.glob("*.json")):
        saida.append(_validar_cenario(json.loads(arq.read_text(encoding="utf-8")), str(arq)))
    return saida


def carregar_limiares_padrao() -> Dict[str, Any]:
    if ARQ_LIMIARES_PADRAO.is_file():
        return json.loads(ARQ_LIMIARES_PADRAO.read_text(encoding="utf-8"))
    return {
        "estrito": {"psnr_min": 50.0, "max_abs": 2, "ssim_min": 0.995, "tira_falha_max": 0.01},
        "deriva": {"psnr_min": 42.0, "max_abs": 6, "ssim_min": 0.985, "tira_falha_max": 0.02},
    }


def pasta_referencia(cenario_id: str, pasta_refs: Optional[Path] = None) -> Path:
    return (Path(pasta_refs) if pasta_refs else PASTA_REFERENCIAS) / str(cenario_id)


def pasta_candidata(cenario_id: str, pasta_saida: Optional[Path] = None) -> Path:
    return (Path(pasta_saida) if pasta_saida else PASTA_SAIDA) / str(cenario_id)


def perfil_tolerancia(
    cenario_id: str,
    *,
    pasta_refs: Optional[Path] = None,
    ambiente_atual: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    aprov_arq = pasta_referencia(cenario_id, pasta_refs) / "APROVADO.json"
    if not aprov_arq.is_file():
        return {"perfil": "estrito", "ambiente_mudou": False, "aprovado": None}
    aprov = json.loads(aprov_arq.read_text(encoding="utf-8"))
    amb_ref = aprov.get("ambiente") or {}
    amb_now = ambiente_atual or impressao_digital_ambiente()
    mesmo = (
        amb_ref.get("ffmpeg_version") == amb_now.get("ffmpeg_version")
        and amb_ref.get("ffmpeg_buildconf_sha1") == amb_now.get("ffmpeg_buildconf_sha1")
    )
    return {
        "perfil": "estrito" if mesmo else "deriva",
        "ambiente_mudou": not mesmo,
        "aprovado": aprov,
    }


def _git_head_curto() -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return r.stdout.strip() or "sem-git"
    except Exception:
        return "sem-git"


def gerar_candidata(
    cenario_id: str,
    *,
    pasta_saida: Optional[Path] = None,
) -> Dict[str, Any]:
    """Renderiza `cenario_id` e grava quadros-chave, `tira.png` e `audio.json` em `_saida/<id>/`."""
    cen = carregar_cenario(cenario_id)
    cid = str(cen["id"])
    dest_dir = pasta_candidata(cid, pasta_saida)
    dest_dir.mkdir(parents=True, exist_ok=True)
    render_dir = dest_dir / "_render"
    res = ajudantes.renderizar_cenario(cen, render_dir, modo="intermediario")
    video_path = res["caminho"]

    quadros = ajudantes.extrair_quadros(video_path)
    chave_indices = [int(i) for i in (cen.get("quadros_chave") or [])]
    salvos: List[str] = []
    for idx in chave_indices:
        if 0 <= idx < len(quadros):
            q_path = dest_dir / f"quadro_{idx:04d}.png"
            Image.fromarray(quadros[idx], "RGB").save(q_path, format="PNG")
            salvos.append(q_path.name)

    tira_img = metricas.montar_tira_miniaturas(quadros)
    tira_path = dest_dir / "tira.png"
    tira_img.save(tira_path, format="PNG")

    sonda = ajudantes.sondar_video(video_path)
    audio_info = None
    if sonda.get("tem_audio"):
        samples = ajudantes.extrair_audio(video_path, sr=48000, canais=2)
        rms_100ms = metricas.rms_janelas_db(samples, sr=48000, janela_ms=100.0)
        audio_info = {
            "sr": 48000,
            "amostras": int(len(samples)),
            "pico_dbfs": round(metricas.pico_dbfs(samples), 3),
            "rms_100ms_db": [round(float(x), 3) for x in rms_100ms],
        }
        (dest_dir / "audio.json").write_text(
            json.dumps(audio_info, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    resumo = {
        "cenario_id": cid,
        "ok": True,
        "n_quadros": int(len(quadros)),
        "quadros_chave_gravados": salvos,
        "tem_audio": bool(audio_info is not None),
        "ambiente": impressao_digital_ambiente(),
        "video_intermediario": str(video_path),
    }

    # Se já existir referência aprovada, inclui prévia de comparação no relatório
    ref_dir = pasta_referencia(cid)
    if (ref_dir / "APROVADO.json").is_file():
        comp = comparar_contra_referencia(cen, quadros, pasta_saida_cenario=dest_dir)
        resumo["comparacao_atual"] = comp
    else:
        relatorio.gerar_relatorio_html(cid, {"ok": True, "perfil": "candidata", "resumo": resumo}, dest_dir)
    return resumo


def comparar_contra_referencia(
    cenario: Dict[str, Any],
    quadros_atuais: np.ndarray,
    *,
    pasta_refs: Optional[Path] = None,
    pasta_saida_cenario: Optional[Path] = None,
    ambiente_atual: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Compara `quadros_atuais` contra a referência aprovada do cenário."""
    cid = str(cenario["id"])
    ref_dir = pasta_referencia(cid, pasta_refs)
    if not (ref_dir / "APROVADO.json").is_file():
        raise FileNotFoundError(
            f"Referência aprovada ausente para {cid!r} em {ref_dir}. "
            f"Execute `scripts/render_regressao.py gerar --cenario {cid}` e `aprovar`."
        )

    info_perf = perfil_tolerancia(cid, pasta_refs=pasta_refs, ambiente_atual=ambiente_atual)
    perfil = info_perf["perfil"]
    padroes = carregar_limiares_padrao()
    lim_cenario = (cenario.get("limiares") or {}).get(perfil) or {}
    lim = {**(padroes.get(perfil) or {}), **lim_cenario}

    psnr_min = float(lim.get("psnr_min", 50.0 if perfil == "estrito" else 42.0))
    max_abs_lim = int(lim.get("max_abs", 2 if perfil == "estrito" else 6))
    ssim_min = float(lim.get("ssim_min", 0.995 if perfil == "estrito" else 0.985))
    tira_falha_max = float(lim.get("tira_falha_max", 0.01))

    chave_indices = [int(i) for i in (cenario.get("quadros_chave") or [])]
    pasta_out = pasta_saida_cenario or pasta_candidata(cid)
    quadros_res: List[Dict[str, Any]] = []
    tudo_ok = True

    for idx in chave_indices:
        arq_ref = ref_dir / f"quadro_{idx:04d}.png"
        if not arq_ref.is_file():
            raise FileNotFoundError(f"Quadro-chave de referência ausente: {arq_ref}")
        if idx < 0 or idx >= len(quadros_atuais):
            quadros_res.append({"quadro": idx, "ok": False, "motivo": "fora do comprimento do render"})
            tudo_ok = False
            continue

        ref_rgb = np.asarray(Image.open(arq_ref).convert("RGB"), dtype=np.uint8)
        atual_rgb = np.asarray(quadros_atuais[idx], dtype=np.uint8)
        v_psnr = metricas.psnr(ref_rgb, atual_rgb)
        v_max = metricas.max_abs(ref_rgb, atual_rgb)
        v_ssim = metricas.ssim_luma(ref_rgb, atual_rgb)
        ok_q = (v_psnr >= psnr_min) and (v_max <= max_abs_lim) and (v_ssim >= ssim_min)
        if not ok_q:
            tudo_ok = False

        item: Dict[str, Any] = {
            "quadro": idx,
            "ok": bool(ok_q),
            "psnr_db": round(v_psnr, 2) if np.isfinite(v_psnr) else 999.0,
            "max_abs": v_max,
            "ssim_luma": round(v_ssim, 5),
        }
        if not ok_q or pasta_saida_cenario is not None:
            pasta_out.mkdir(parents=True, exist_ok=True)
            nome_diff = f"diff_{idx:04d}.png"
            relatorio.salvar_comparacao_quadro(ref_rgb, atual_rgb, pasta_out / nome_diff)
            item["diff_rel"] = nome_diff
        quadros_res.append(item)

    tira_ref_path = ref_dir / "tira.png"
    tira_res: Dict[str, Any] = {"ok": True}
    if tira_ref_path.is_file():
        tira_ref = Image.open(tira_ref_path)
        tira_atual = metricas.montar_tira_miniaturas(quadros_atuais)
        comp_tira = metricas.comparar_tira_miniaturas(tira_ref, tira_atual)
        ok_tira = bool(comp_tira["mesmo_tamanho"] and comp_tira["fracao_falha"] <= tira_falha_max)
        tira_res = {**comp_tira, "ok": ok_tira}
        if not ok_tira:
            tudo_ok = False

    resultado = {
        "cenario_id": cid,
        "ok": bool(tudo_ok),
        "perfil": perfil,
        "ambiente_mudou": bool(info_perf["ambiente_mudou"]),
        "limiares": lim,
        "quadros": quadros_res,
        "tira": tira_res,
    }
    if not tudo_ok or pasta_saida_cenario is not None:
        relatorio.gerar_relatorio_html(cid, resultado, pasta_out)
    return resultado


def aprovar_candidata(
    cenario_id: str,
    *,
    motivo: str,
    sim: bool = False,
    pasta_refs: Optional[Path] = None,
    pasta_saida: Optional[Path] = None,
) -> Dict[str, Any]:
    """Promove candidatas de `_saida/<id>/` para `referencias/<id>/` com log e impressão digital."""
    motivo_limpo = str(motivo or "").strip()
    if not motivo_limpo:
        raise ValueError("Informe --motivo não vazio para aprovar uma referência.")

    cen = carregar_cenario(cenario_id)
    cid = str(cen["id"])
    cand_dir = pasta_candidata(cid, pasta_saida)
    if not cand_dir.is_dir() or not list(cand_dir.glob("quadro_*.png")):
        raise FileNotFoundError(
            f"Nenhuma candidata encontrada em {cand_dir}. Execute `gerar --cenario {cid}` antes."
        )

    ref_root = Path(pasta_refs) if pasta_refs else PASTA_REFERENCIAS
    ref_dir = ref_root / cid
    exigir_permissao_escrita_referencias(ref_dir)

    psnr_anterior: Dict[str, Any] = {}
    for png_cand in sorted(cand_dir.glob("quadro_*.png")):
        png_ref = ref_dir / png_cand.name
        if png_ref.is_file():
            a = np.asarray(Image.open(png_ref).convert("RGB"), dtype=np.uint8)
            b = np.asarray(Image.open(png_cand).convert("RGB"), dtype=np.uint8)
            v = metricas.psnr(a, b)
            psnr_anterior[png_cand.name] = round(v, 2) if np.isfinite(v) else "inf"

    if not sim:
        print(f"Cenário: {cid}")
        if psnr_anterior:
            print(f"PSNR contra referência atual: {json.dumps(psnr_anterior, ensure_ascii=False)}")
        else:
            print("Primeira aprovação deste cenário.")
        resp = input("Confirmar aprovação e gravação em referencias/? [s/N]: ").strip().lower()
        if resp not in ("s", "sim", "y", "yes"):
            return {"aprovado": False, "cancelado": True, "cenario_id": cid}

    ref_dir.mkdir(parents=True, exist_ok=True)
    for antigo in ref_dir.glob("quadro_*.png"):
        antigo.unlink(missing_ok=True)

    copiados: List[str] = []
    for src_png in sorted(cand_dir.glob("quadro_*.png")):
        shutil.copy2(src_png, ref_dir / src_png.name)
        copiados.append(src_png.name)
    for extra in ("tira.png", "audio.json"):
        src_ext = cand_dir / extra
        if src_ext.is_file():
            shutil.copy2(src_ext, ref_dir / extra)
            copiados.append(extra)

    registro = {
        "cenario_id": cid,
        "aprovado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "motivo": motivo_limpo,
        "commit": _git_head_curto(),
        "ambiente": impressao_digital_ambiente(),
        "arquivos": copiados,
        "psnr_contra_anterior": psnr_anterior,
    }
    aprov_json = ref_dir / "APROVADO.json"
    aprov_json.write_text(json.dumps(registro, ensure_ascii=False, indent=2), encoding="utf-8")

    jsonl_path = ref_root / "APROVACOES.jsonl"
    with jsonl_path.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(registro, ensure_ascii=False) + "\n")

    return {"aprovado": True, **registro}


def migrar_cenarios(destino_schema: int = SCHEMA_CONHECIDO) -> List[str]:
    """Atualiza metadados `schema` de cenários antigos até `destino_schema`."""
    alterados: List[str] = []
    if not PASTA_CENARIOS.is_dir():
        return alterados
    for arq in sorted(PASTA_CENARIOS.glob("*.json")):
        dados = json.loads(arq.read_text(encoding="utf-8"))
        atual = int(dados.get("schema") or 1)
        if atual < destino_schema:
            dados["schema"] = destino_schema
            arq.write_text(json.dumps(dados, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            alterados.append(arq.name)
    return alterados
