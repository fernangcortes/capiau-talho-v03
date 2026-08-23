#!/usr/bin/env python3
"""Baixa e valida por hash o modelo de denoise DPDFNet 48 kHz (ETAPA 4 do plano).

Modelo : dpdfnet2_48khz_hr.onnx -> data/models/dpdfnet2_48khz_hr.onnx
Origem : release do k2-fsa/sherpa-onnx (asset publicado junto dos modelos de
         speech-denoiser usados pelo OfflineSpeechDenoiser).

O ponto delicado ja registrado em docs/PLANO_AJUSTES_DE_AUDIO.md (Etapa 4 e
tabela de Riscos): **o release do k2-fsa NAO publica hash deste arquivo** -- o
checksum.txt que acompanha so cobre o GTCRN. Entao a referencia de integridade
e construida AQUI, na primeira copia baixada:

    1a execucao com download : baixa, calcula sha256 e GRAVA o hash num arquivo
                               de referencia versionado ao lado do modelo
                               (data/models/dpdfnet2_48khz_hr.onnx.sha256),
                               com origem/tamanho/data no corpo.
    execucoes seguintes      : valida o modelo contra essa referencia e RECUSA
                               um arquivo diferente (hash trocado = modelo
                               corrompido ou substituido; nunca usar sem decisao
                               explicita -- ver --fixar-referencia).
    --verificar              : SO confere (presenca + hash contra a referencia),
                               nao baixa nada. Seguro para rodar em rotina.

Idempotente: com modelo valido e referencia conferida, uma nova execucao nao
baixa nada e sai 0. O formato da primeira linha do .sha256 segue o padrao
sha256sum ("<hash>  <nome>") e e o mesmo que src/media/audio_denoise.py le em
hash_modelo_confere() antes de cada denoise -- uma referencia so, dois leitores.

Quem baixa e o DONO do projeto (decisao registrada no briefing): este script
nunca e chamado automaticamente por codigo da casa. Sem rede, ele falha com
mensagem clara e nao deixa arquivo pela metade (download em .part + rename).

Uso:
    python scripts/baixar_modelo_denoise.py                # baixa se falta
    python scripts/baixar_modelo_denoise.py --verificar    # so confere
    python scripts/baixar_modelo_denoise.py --url <outra>  # origem alternativa

Codigos de saida: 0 ok | 1 modelo ausente (--verificar) | 2 hash divergente |
3 uso invalido / erro de rede ou disco.
"""
import argparse
import hashlib
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Optional, Tuple

# Origem padrao do asset. O release correto e "speech-enhancement-models"
# (nao "asr-models"): conferido por HEAD em 23/08/2026 -> HTTP 200,
# Content-Length 10.596.848 bytes (~10,1 MB). Se o projeto mover o arquivo de
# lugar, passe --url; nada mais muda.
#
# O checksum.txt desse mesmo release cobre apenas gtcrn_simple.onnx,
# inp_16k.wav e speech_with_noise.wav -- o dpdfnet NAO esta la (conferido na
# mesma data). Por isso o hash de referencia e fixado na primeira copia baixada
# e validado nas seguintes, como manda a Etapa 4 do plano.
URL_PADRAO = ("https://github.com/k2-fsa/sherpa-onnx/releases/"
              "download/speech-enhancement-models/dpdfnet2_48khz_hr.onnx")
TAMANHO_ESPERADO_BYTES = 10_596_848
NOME_MODELO = "dpdfnet2_48khz_hr.onnx"
_TIMEOUT_S = 60          # conexao/leitura por bloco
_BLOCO = 1024 * 1024     # 1 MiB por leitura


def _raiz_projeto() -> Path:
    """Raiz do repo (scripts/.. ) -- o script roda de qualquer diretorio."""
    return Path(__file__).resolve().parents[1]


def _caminho_modelo() -> Path:
    """Mesmo caminho que o motor espera (fonte unica da verdade em audio_denoise)."""
    sys.path.insert(0, str(_raiz_projeto()))
    from src.media.audio_denoise import caminho_modelo
    return caminho_modelo("dpdfnet", _raiz_projeto())


def _human(bytes_: Optional[int]) -> str:
    if bytes_ is None:
        return "tamanho desconhecido"
    valor = float(bytes_)
    for unidade in ("B", "KiB", "MiB", "GiB"):
        if valor < 1024.0 or unidade == "GiB":
            return f"{valor:.1f} {unidade}" if unidade != "B" else f"{int(valor)} B"
        valor /= 1024.0
    return f"{bytes_} B"


def _sha256(caminho: Path) -> str:
    digest = hashlib.sha256()
    with open(caminho, "rb") as fh:
        for bloco in iter(lambda: fh.read(_BLOCO), b""):
            digest.update(bloco)
    return digest.hexdigest()


def _ler_referencia(lado_car: Path) -> Tuple[Optional[str], dict]:
    """Le o .sha256 versionado: (hash|None, metadados {origem,tamanho,gravado_em})."""
    if not lado_car.is_file():
        return None, {}
    meta: dict = {}
    hash_ref: Optional[str] = None
    for linha in lado_car.read_text(encoding="utf-8").splitlines():
        texto = linha.strip()
        if not texto:
            continue
        if texto.startswith("#"):
            corpo = texto.lstrip("#").strip()
            if ":" in corpo:
                chave, _, valor = corpo.partition(":")
                meta[chave.strip().lower()] = valor.strip()
            continue
        if hash_ref is None:
            hash_ref = texto.split()[0].lower()
    return hash_ref, meta


def _gravar_referencia(lado_car: Path, digest: str, url: str, tamanho: int,
                       nota: str) -> None:
    """Grava a referencia versionada (atomico). Linha 1 no padrao sha256sum;
    comentarios # com proveniencia -- lidos so pela casa, ignorados pelo sha256sum."""
    conteudo = (
        f"{digest}  {NOME_MODELO}\n"
        f"# origem: {url}\n"
        f"# tamanho_bytes: {tamanho}\n"
        f"# gravado_em: {time.strftime('%Y-%m-%dT%H:%M:%S')} ({nota}; "
        "o release k2-fsa nao publica hash deste arquivo)\n"
    )
    tmp = lado_car.with_suffix(".sha256.part")
    tmp.write_text(conteudo, encoding="utf-8")
    os.replace(str(tmp), str(lado_car))


def _tamanho_remoto(url: str) -> Optional[int]:
    """Content-Length sem baixar o corpo (HEAD; fallback Range se HEAD falhar)."""
    pedido = urllib.request.Request(url, method="HEAD",
                                    headers={"User-Agent": "capiau-baixar-modelo/1"})
    try:
        with urllib.request.urlopen(pedido, timeout=_TIMEOUT_S) as resp:
            bruto = resp.headers.get("Content-Length")
            if bruto and int(bruto) > 0:
                return int(bruto)
    except OSError:
        pass
    pedido = urllib.request.Request(url, headers={"User-Agent": "capiau-baixar-modelo/1",
                                                  "Range": "bytes=0-0"})
    try:
        with urllib.request.urlopen(pedido, timeout=_TIMEOUT_S) as resp:
            alcance = resp.headers.get("Content-Range") or ""
            if "/" in alcance:
                total = alcance.rsplit("/", 1)[1]
                if total.isdigit():
                    return int(total)
    except OSError:
        pass
    return None


def _baixar(url: str, destino: Path) -> Tuple[int, str]:
    """Baixa em .part e renomeia. Devolve (tamanho, sha256). Nunca deixa o
    destino final pela metade."""
    parcial = destino.with_suffix(".onnx.part")
    pedido = urllib.request.Request(url, headers={"User-Agent": "capiau-baixar-modelo/1"})
    digest = hashlib.sha256()
    recebido = 0
    marco = 0
    inicio = time.monotonic()
    try:
        with urllib.request.urlopen(pedido, timeout=_TIMEOUT_S) as resp, \
                open(parcial, "wb") as fh:
            while True:
                bloco = resp.read(_BLOCO)
                if not bloco:
                    break
                fh.write(bloco)
                digest.update(bloco)
                recebido += len(bloco)
                if recebido - marco >= 16 * _BLOCO:      # 1 linha a cada ~16 MiB
                    marco = recebido
                    print(f"   ... {_human(recebido)} baixados "
                          f"({time.monotonic() - inicio:.0f}s)", flush=True)
    except BaseException:
        try:
            parcial.unlink()
        except OSError:
            pass
        raise
    if recebido <= 0:
        parcial.unlink(missing_ok=True)
        raise OSError("download veio vazio (0 bytes); nada foi instalado.")
    os.replace(str(parcial), str(destino))
    return recebido, digest.hexdigest()


def verificar(so_conferir: bool, url_padrao: str, fixar_referencia: bool = False) -> int:
    modelo = _caminho_modelo()
    lado_car = Path(str(modelo) + ".sha256")

    print(f"[Modelo ] {modelo.name}")
    print(f"[Destino] {modelo}")
    print(f"[Origem ] {url_padrao}")
    print(f"[Ref    ] {lado_car.name} (criado na primeira copia; o release "
          "k2-fsa nao publica hash deste arquivo)")
    print()

    hash_ref, meta = _ler_referencia(lado_car)

    # ---- modo --verificar: SO confere, nunca baixa ----
    if so_conferir:
        if not modelo.is_file():
            print(f"[VERIFICAR] MODELO AUSENTE em {modelo}")
            print("[VERIFICAR] Rode 'python scripts/baixar_modelo_denoise.py' "
                  "(sem --verificar) para baixar.")
            return 1
        tamanho_local = modelo.stat().st_size
        print(f"[VERIFICAR] Modelo presente ({_human(tamanho_local)}).")
        if hash_ref is None:
            print("[VERIFICAR] Sem referencia gravada ainda: rode sem --verificar "
                  "para fixar o hash desta copia.")
            return 3
        if not modelo.stat().st_size:
            print("[VERIFICAR] REJEITADO: arquivo com 0 bytes.")
            return 2
        obtido = _sha256(modelo)
        if obtido != hash_ref:
            print(f"[VERIFICAR] RECUSADO: hash divergente da referencia "
                  f"({lado_car.name}).")
            print(f"[VERIFICAR] esperado {hash_ref}")
            print(f"[VERIFICAR] obtido   {obtido}")
            print("[VERIFICAR] O arquivo mudou desde a primeira copia. Se a mudanca "
                  "foi deliberada, rode com --fixar-referencia.")
            return 2
        print(f"[VERIFICAR] OK: hash confere com a referencia gravada "
              f"(origem: {meta.get('origem', '?')}, gravado_em: "
              f"{meta.get('gravado_em', '?')}).")
        return 0

    # ---- modo download ----
    if modelo.is_file() and modelo.stat().st_size > 0:
        if hash_ref is None:
            # Primeira vez COM o arquivo ja presente (ex.: copia manual do dono):
            # fixa o hash desta copia como referencia. Nada e baixado.
            digest = _sha256(modelo)
            _gravar_referencia(lado_car, digest, url_padrao,
                               modelo.stat().st_size, "primeira copia ja existente")
            print(f"[REFERENCIA] Copia ja existente adotada como primeira: hash "
                  f"{digest} gravado em {lado_car.name}.")
            return 0
        obtido = _sha256(modelo)
        if obtido == hash_ref:
            print(f"[OK] Ja baixado e conferido ({_human(modelo.stat().st_size)}); "
                  "nada a fazer (idempotente).")
            return 0
        print(f"[RECUSADO] O modelo em disco difere da referencia "
              f"({lado_car.name}): esperado {hash_ref[:12]}..., obtido {obtido[:12]}...")
        print("[RECUSADO] Nao vou sobrescrever por cima nem validar arquivo "
              "diferente. Se a substituicao foi deliberada, rode com "
              "--fixar-referencia apos revisar a nova origem.")
        return 2

    tamanho_remoto = _tamanho_remoto(url_padrao)
    print(f"[DOWNLOAD] Origem : {url_padrao}")
    print(f"[DOWNLOAD] Destino: {modelo}")
    print(f"[DOWNLOAD] Tamanho anunciado: {_human(tamanho_remoto)}")
    print("[DOWNLOAD] Baixando...", flush=True)
    modelo.parent.mkdir(parents=True, exist_ok=True)
    try:
        tamanho, digest = _baixar(url_padrao, modelo)
    except OSError as e:
        print(f"[ERRO] Falhou o download: {e}")
        print("[ERRO] Nenhum arquivo foi instalado; tente de novo ou passe "
              "--url com outra origem.")
        return 3
    print(f"[DOWNLOAD] Concluido: {_human(tamanho)} em {NOME_MODELO}.")
    if tamanho_remoto is not None and tamanho != tamanho_remoto:
        print(f"[AVISO] Tamanho baixado difere do anunciado "
              f"({tamanho} vs {tamanho_remoto}); seguindo com o hash.")

    _gravar_referencia(lado_car, digest, url_padrao, tamanho,
                       "primeira copia baixada por este script")
    hash_relido, _ = _ler_referencia(lado_car)
    if hash_relido != digest or _sha256(modelo) != digest:
        print("[ERRO] Auto-conferencia da referencia falhou; remova o .part/.sha256 "
              "e repita.")
        return 3
    print(f"[OK] Hash da primeira copia fixado em {lado_car.name}: {digest}")
    print("[OK] Proximas execucoes (e o worker de audio, via "
          "src/media/audio_denoise.hash_modelo_confere) validam contra ele.")
    return 0


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Baixa/valida dpdfnet2_48khz_hr.onnx para data/models/ com "
                    "hash fixado localmente (o release k2-fsa nao publica hash dele).")
    parser.add_argument("--verificar", action="store_true",
                        help="So confere presenca + hash contra a referencia; nao baixa.")
    parser.add_argument("--fixar-referencia", action="store_true",
                        help="Deliberado: adota o arquivo atual como nova referencia "
                             "quando o hash diverge. Requer revisao humana antes.")
    parser.add_argument("--url", default=URL_PADRAO,
                        help="URL alternativa do asset (default: release k2-fsa).")
    args = parser.parse_args(argv)

    if args.fixar_referencia and not args.verificar:
        modelo = _caminho_modelo()
        lado_car = Path(str(modelo) + ".sha256")
        if not modelo.is_file():
            print("[ERRO] --fixar-referencia exige o modelo ja presente em disco.")
            return 3
        digest = _sha256(modelo)
        _gravar_referencia(lado_car, digest, args.url, modelo.stat().st_size,
                           "referencia RE-FIXADA por decisao humana")
        print(f"[FIXADA] Nova referencia gravada: {digest}")
        return 0
    try:
        return verificar(args.verificar, args.url, args.fixar_referencia)
    except Exception as e:  # noqa: BLE001 - mensagem clara e codigo de saida, nunca traceback cru
        print(f"[ERRO] {type(e).__name__}: {e}")
        return 3


if __name__ == "__main__":
    sys.exit(main())
