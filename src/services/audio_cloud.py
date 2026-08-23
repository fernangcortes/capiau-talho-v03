"""Servico de nuvem de audio (ETAPA 5 de PLANO_AJUSTES_DE_AUDIO, secao 8).

Um unico provedor por tras de uma interface: Auphonic. O que este modulo faz:

- ``AudioCloudProvider``: o Protocol exato da secao 8 do plano.
- ``AuphonicProvider``: implementacao contra a API documentada
  (POST https://auphonic.com/api/simple/productions.json, autenticacao Bearer).
- ``montar_algorithms``: funcao PURA que traduz a pre-analise local (secao 5)
  no bloco ``algorithms`` do Auphonic, seguindo a tabela da secao 8. Aceita
  ``overrides`` manuais, validados contra a grade AQUI, antes de qualquer
  rede - producao recusada por parametro invalido gasta o envio do mesmo jeito.
- ``campos_ajustaveis``: fonte unica de verdade do catalogo de ajustes
  manuais (rotulos e ajuda em pt-BR, grades do Auphonic). A rota valida o
  override contra ela e a interface monta os controles a partir dela - a
  grade e do Auphonic, pode mudar, e nada disso pode ser hardcoded longe.
- Controle de cota do free tier (2 h/mes, recorrentes): soma o consumo por mes
  e expoe ``quota_status``/``mensagem_cota`` para a UI perguntar quanto resta.

Regras de servico externo adotadas (obrigatorias):

- Toda chamada de rede tem tempo limite (timeout) configurado.
- Repeticao com espera crescente SO em erro transitorio (rede, 429, 5xx) e
  apenas nas operacoes idempotentes de leitura/baixar (poll, fetch).
- ``submit`` NUNCA e repetido automaticamente: um POST aceito cria uma
  producao nova e gasta cota. Se o envio falhar depois de sair daqui, o erro
  retornado diz para conferir o painel do Auphonic antes de reenviar.

A chave vem do settings_registry como secret (nome ``api.auphonic_key``, mesmo
padrao de ``api.assemblyai_key``), com fallback para a variavel de ambiente
``AUPHONIC_API_KEY``. Sem chave configurada os metodos levantam
``AudioCloudConfigError`` com instrucao acionavel - nunca stack trace cru.

Console cp1252: nenhum texto deste modulo usa setas, simbolos matematicos ou
emoji; logs usam "->" e a tag [AUDIO_CLOUD].
"""
import json
import os
import time
import wave
from datetime import date
from pathlib import Path
from threading import Lock
from typing import Any, Callable, Dict, List, Optional

# -- Constantes do servico ----------------------------------------------------

BASE_URL = "https://auphonic.com"
URL_SIMPLE_PRODUCITIONS = BASE_URL + "/api/simple/productions.json"

KEY_SETTINGS = "api.auphonic_key"
ENV_FALLBACK = "AUPHONIC_API_KEY"

# Free tier do Auphonic: 2 horas por mes, recorrentes (secao 8 do plano).
COTA_MENSAL_SEGUNDOS = 2 * 60 * 60

# Caminho padrao do registro de consumo (ver docstring de RegistroDeCota).


def caminho_cota_padrao() -> Path:
    """Pasta de dados do projeto: <raiz>/data/audio_cloud/cota_auphonic.json."""
    raiz = Path(__file__).resolve().parents[2]
    return raiz / "data" / "audio_cloud" / "cota_auphonic.json"


# -- Erros (sempre mensagem acionavel, nunca traceback cru) --------------------


class AudioCloudError(Exception):
    """Falha de servico externo de audio com mensagem pronta para o usuario."""


class AudioCloudConfigError(AudioCloudError):
    """Chave de API ausente ou ambiente mal configurado."""


class AudioCloudAuthError(AudioCloudError):
    """Chave presente mas recusada pelo provedor (401/403)."""


class AudioCloudTransientError(AudioCloudError):
    """Erro transitorio (rede, 429, 5xx): pode tentar de novo mais tarde.

    Para ``submit`` esta excecao traz o aviso de que a producao PODE ter sido
    criada no servidor - conferir la antes de reenviar, sob pena de gastar
    cota duas vezes.
    """


class AudioCloudQuotaExceededError(AudioCloudError):
    """Cota gratuita do mes acabou. Nenhuma requisicao foi enviada."""


class AudioCloudOverrideInvalidoError(AudioCloudError):
    """Sobrescrita manual invalida: campo desconhecido ou valor fora da grade.

    Levantada ANTES de qualquer rede (producao recusada pelo Auphonic gasta o
    envio do mesmo jeito). A mensagem sempre diz o campo e os valores aceitos
    - nunca se ignora um override calado, senao o usuario acredita que mandou
    algo que nao foi.
    """


# -- Resposta abstrata de transporte (permite duble nos testes) ----------------


class RespostaNuvem:
    """Envelope minimo de resposta HTTP usado pelo transporte injetavel.

    ``corpo`` sao os bytes completos (para JSON) e ``chunks`` um iterator de
    bytes opcional (para download em stream). Um duble de teste constroi isto
    direto, sem rede.
    """

    def __init__(self, status_code: int, corpo: bytes = b"", chunks=None):
        self.status_code = int(status_code)
        self.corpo = corpo or b""
        self.chunks = chunks

    def json(self) -> Any:
        return json.loads(self.corpo.decode("utf-8"))


def _parece_transitorio(exc: Exception) -> bool:
    """Classifica excecao de transporte como transitoria (vale reter/repetir)."""
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return True
    nome = type(exc).__name__.lower()
    return "timeout" in nome or "connection" in nome or "reset" in nome


class TransporteRequests:
    """Transporte real sobre a biblioteca ``requests`` (import adiante)."""

    def get(self, url: str, *, headers: Optional[Dict[str, str]] = None,
            timeout: float = 120.0, stream: bool = False) -> RespostaNuvem:
        import requests

        resp = requests.get(url, headers=headers, timeout=timeout, stream=stream)
        if stream:
            return RespostaNuvem(
                resp.status_code, b"", chunks=resp.iter_content(chunk_size=64 * 1024)
            )
        return RespostaNuvem(resp.status_code, resp.content)

    def post(self, url: str, *, headers: Optional[Dict[str, str]] = None,
             data: Optional[Dict[str, str]] = None,
             files: Optional[Dict[str, Any]] = None,
             timeout: float = 120.0) -> RespostaNuvem:
        import requests

        resp = requests.post(url, headers=headers, data=data, files=files, timeout=timeout)
        return RespostaNuvem(resp.status_code, resp.content)


# -- Protocolo publico (secao 8 do plano, literal) -----------------------------

try:
    from typing import Protocol, runtime_checkable
except ImportError:  # pragma: no cover - Python de suporte antigo
    Protocol = object
    runtime_checkable = lambda cls: cls  # noqa: E731


@runtime_checkable
class AudioCloudProvider(Protocol):
    def submit(self, wav: Path, algorithms: dict) -> str: ...   # -> uuid
    def poll(self, uuid: str) -> dict: ...                      # -> {status, progress}
    def fetch(self, uuid: str, dest: Path) -> Path: ...


# -- montar_algorithms: pre-analise local -> bloco algorithms do Auphonic ------
# Tabela da secao 8 do plano:
#   alvo de entrega      -> loudnesstarget (clamp -13 a -31) + normloudness True
#   teto de pico         -> maxpeak (clamp 0 a -6 dBTP)
#   noise_floor          -> denoise/denoiseamount pela regra corrigida da secao 7:
#                           piso >= -35  : clamp(piso - (-45), 6, 18) dB
#                           -45..-35     : denoise leve fixo de 6 dB
#                           piso <  -45  : denoise desligado (material limpo)
#   ruido variavel?      -> denoisemethod dynamic; senao static (preserva
#                           musica e ambiencia - motivo do servico valer a pena)
#   resgate extremo      -> denoisemethod speech_isolation + filtermethod studiovoice
#   agudos ausentes      -> filtermethod bwe
#   padrao entrevista    -> filtermethod autoeq
#   LRA                  -> leveler True + strength proporcional; LRA < 5
#                           DESLIGA o leveler (ja esmagado, comprimir piora)
#   zumbido 50/60 Hz     -> dehum 0 + dehumamount 0 (Auto nos dois: detector
#                           do Auphonic decide - deteccao local ja falhou)
#   documentario         -> silence_cutter False e filler_cutter False, SEMPRE.
#                           Nem por sobrescrita manual (CAMPOS_NUNCA_AJUSTAVEIS).

LIMITE_PISO_RUIDO = -35.0     # acima disso: denoise forte pela regra da secao 7
LIMITE_PISO_LEVE = -45.0      # entre -45 e -35: denoise leve de 6 dB
DENOISE_MAX_DB = 18
DENOISE_MIN_DB = 6
LRA_BLOQUEIO_LEVELER = 5.0    # abaixo disso o material ja esta esmagado
LRA_REFERENCIA_LEVELER = 12.0  # a partir daqui strength saturada em 100

# Resgate extremo derivado de medidas, sem depender de dica humana:
# pico estourado + sala muito ruidosa + clipping audivel simultaneos.
EXTREMO_PISO_MINIMO = -25.0   # piso acima disso = sala muito ruim
EXTREMO_CLIP_PCT = 0.001      # 0,1% das amostras em fundo de escala

# Grades de valores ACEITOS pelo Auphonic. Nao sao faixas continuas: cada campo
# aceita apenas os valores desta lista. Conferidas em 23/08/2026 no catalogo
# autoritativo publico https://auphonic.com/api/info/algorithms.json (endpoint de
# informacao, nao consome cota). Mandar valor fora da grade e pedir para a
# producao ser recusada - e uma producao recusada gasta o envio do mesmo jeito.
#
# O bug que isto corrige: os valores vinham da tabela em prosa da secao 8 do
# plano, que descreve a INTENCAO ("levelerstrength proporcional ao LRA") sem
# dizer que o campo e discreto. A formula produzia 53, 86, 36 - todos invalidos.
GRADE_LOUDNESSTARGET = (-13, -14, -15, -16, -18, -19, -20, -23, -24, -26, -27, -31)
GRADE_MAXPEAK = (0.0, -0.5, -1.0, -1.5, -2.0, -3.0, -4.0, -5.0, -6.0, -9.0)
# Escala de intensidade usada pelo montador (so os degraus de dB); para
# validar override use GRADE_DENOISEAMOUNT_ACEITOS logo abaixo.
GRADE_DENOISEAMOUNT = (3, 6, 9, 12, 15, 18, 24, 30, 36, 100)
# Catalogo completo de denoiseamount conferido em 23/08/2026: inclui os
# marcadores especiais 0 = Automatico e -1 = Desligado (nao sao degraus).
GRADE_DENOISEAMOUNT_ACEITOS = (0, -1) + GRADE_DENOISEAMOUNT
GRADE_LEVELERSTRENGTH = (0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120)

# Demais grades da MESMA conferencia de 23/08/2026 no mesmo catalogo
# (https://auphonic.com/api/info/algorithms.json), incluindo os campos novos
# do bloco automatico (zumbido da rede eletrica) e os que so chegam pela
# sobrescrita manual.
GRADE_DENOISEMETHOD = ("classic", "static", "dynamic", "speech_isolation")
GRADE_FILTERMETHOD = ("hipfilter", "autoeq", "bwe", "studiovoice")
GRADE_DEHUM = (0, 50, 60)   # 0 = Automatico; 50/60 = frequencia da rede
GRADE_DEHUMAMOUNT = (0, -1, 3, 6, 9, 12, 15, 18, 24, 30, 100)
GRADE_COMPRESSOR = ("auto", "off", "soft", "medium", "hard")
GRADE_MSCLASSIFIER = ("on", "speech", "music")
GRADE_MAXLRA = (0, 3, 4, 5, 6, 8, 9, 10, 12, 15, 18, 20, 25, 30)
GRADE_LOUDNESSMETHOD = ("program", "dialog", "rms")

# Regra em negrito do plano (secao 8): documentario NUNCA corta automatico,
# nem por sobrescrita manual. Estes dois campos ficam SEMPRE False, NAO
# aparecem em campos_ajustaveis() e qualquer override neles e recusado.
CAMPOS_NUNCA_AJUSTAVEIS = ("silence_cutter", "filler_cutter")


def _na_grade(valor, grade):
    """Prende o valor ao item MAIS PROXIMO da grade aceita pelo Auphonic.

    Empate resolve para o mais conservador (menor intensidade), porque errar
    para menos e recuperavel e errar para mais estraga o material.
    """
    if valor is None:
        return None
    alvo = float(valor)
    return min(grade, key=lambda v: (abs(float(v) - alvo), -float(v)))


def _num(valor: Any, padrao: Optional[float] = None) -> Optional[float]:
    try:
        return float(valor)
    except (TypeError, ValueError):
        return padrao


def _clamp(valor: float, minimo: float, maximo: float) -> float:
    return max(minimo, min(maximo, valor))


# -- campos_ajustaveis: fonte unica de verdade dos ajustes manuais -------------
#
# A rota valida o override contra este catalogo (contrato L2) e a interface
# monta os controles a partir dele (contrato L4). Rotulos e ajudas em pt-BR
# claro para quem nao e tecnico: a ajuda explica o EFEITO pratico no som,
# nao repete o nome do campo. Tudo cp1252-safe (sem acento), padrao do modulo.


def campos_ajustaveis() -> Dict[str, Dict[str, Any]]:
    """Catalogo dos ajustes manuais da nuvem, pronto para rota e interface.

    Formato do contrato:
        {campo: {"tipo": "bool"|"select", "valores": tupla|None,
                 "rotulo": "<pt-BR curto>", "ajuda": "<uma linha em pt-BR>"}}

    Devolve copias novas a cada chamada (quem recebe pode mexer sem corromper
    o modulo). silence_cutter e filler_cutter de proposito NAO aparecem aqui.
    """
    return {
        "loudnesstarget": {
            "tipo": "select", "valores": GRADE_LOUDNESSTARGET,
            "rotulo": "Alvo de volume",
            "ajuda": "Volume final que o clipe vai ter; cada numero e um "
                     "padrao de entrega (streaming costuma ficar entre -16 e -14).",
        },
        "normloudness": {
            "tipo": "bool", "valores": None,
            "rotulo": "Aplicar o alvo de volume",
            "ajuda": "Faz o clipe terminar exatamente no volume escolhido; "
                     "desligado, ele sai perto mas sem garantia.",
        },
        "maxpeak": {
            "tipo": "select", "valores": GRADE_MAXPEAK,
            "rotulo": "Teto de pico",
            "ajuda": "Limite que nenhum instante do audio pode ultrapassar; "
                     "evita aquela distorcao de som estourado.",
        },
        "denoise": {
            "tipo": "bool", "valores": None,
            "rotulo": "Reducao de ruido",
            "ajuda": "Diminui chiado, ventilador e ronco de sala que ficam "
                     "atras da voz.",
        },
        "denoiseamount": {
            "tipo": "select", "valores": GRADE_DENOISEAMOUNT_ACEITOS,
            "rotulo": "Forca da reducao",
            "ajuda": "Quanto ruido sai, em decibeis: alto deixa limpo porem "
                     "pode soar artificial. -1 desliga; 0 deixa o servico decidir.",
        },
        "denoisemethod": {
            "tipo": "select", "valores": GRADE_DENOISEMETHOD,
            "rotulo": "Metodo de reducao",
            "ajuda": "'static' preserva musica e ambiencia; 'dynamic' segue um "
                     "ruido que muda; 'speech_isolation' deixa somente a voz, "
                     "para resgates dificeis.",
        },
        "filtering": {
            "tipo": "bool", "valores": None,
            "rotulo": "Realce de voz",
            "ajuda": "Liga os filtros que deixam a fala mais clara e "
                     "inteligivel; desligado, o tipo de realce fica inerte.",
        },
        "filtermethod": {
            "tipo": "select", "valores": GRADE_FILTERMETHOD,
            "rotulo": "Tipo de realce",
            "ajuda": "'autoeq' equilibra a voz gravada em campo; 'bwe' "
                     "recompoe agudos de fita antiga; 'studiovoice' busca som "
                     "de estudio; 'hipfilter' so tira o grave.",
        },
        "leveler": {
            "tipo": "bool", "valores": None,
            "rotulo": "Nivelador",
            "ajuda": "Levanta os trechos baixos e segura os altos, para dar "
                     "para ouvir tudo sem mexer no volume da caixa.",
        },
        "levelerstrength": {
            "tipo": "select", "valores": GRADE_LEVELERSTRENGTH,
            "rotulo": "Forca do nivelador",
            "ajuda": "Vai de 0 (quase nada) a 120 (tudo bem parelho); "
                     "exagerar apaga a expressao natural da fala.",
        },
        "dehum": {
            "tipo": "select", "valores": GRADE_DEHUM,
            "rotulo": "Zumbido da rede eletrica",
            "ajuda": "Tira o tom grave que luzes e tomadas pescam na "
                     "gravacao. 0 deixa o servico detectar; 50 ou 60 e a "
                     "frequencia da rede do pais.",
        },
        "dehumamount": {
            "tipo": "select", "valores": GRADE_DEHUMAMOUNT,
            "rotulo": "Forca contra o zumbido",
            "ajuda": "Intensidade dessa remocao, em decibeis; -1 desliga e "
                     "0 deixa o servico decidir quanto tirar.",
        },
        "gate": {
            "tipo": "bool", "valores": None,
            "rotulo": "Silenciar entre falas",
            "ajuda": "Nos intervalos sem fala, abaixa o audio em vez de "
                     "deixar o ruido de fundo aparecendo.",
        },
        "compressor": {
            "tipo": "select", "valores": GRADE_COMPRESSOR,
            "rotulo": "Compressor",
            "ajuda": "Segura as partes fortes e levanta as fracas: 'soft' "
                     "mexe pouco, 'medium' e equilibrado, 'hard' deixa tudo "
                     "bem parelho.",
        },
        "msclassifier": {
            "tipo": "select", "valores": GRADE_MSCLASSIFIER,
            "rotulo": "Separar musica e fala",
            "ajuda": "Diz ao servico com o que esta lidando: 'speech' trata "
                     "tudo como fala, 'music' preserva trechos musicais, "
                     "'on' deixa ele separar sozinho.",
        },
        "maxlra": {
            "tipo": "select", "valores": GRADE_MAXLRA,
            "rotulo": "Variacao de volume permitida",
            "ajuda": "Limita a diferenca entre o trecho mais baixo e o mais "
                     "alto do clipe; numero menor deixa tudo mais proximo.",
        },
        "loudnessmethod": {
            "tipo": "select", "valores": GRADE_LOUDNESSMETHOD,
            "rotulo": "Jeito de medir o volume",
            "ajuda": "'program' olha o clipe inteiro, 'dialog' foca na fala "
                     "e 'rms' usa uma media simples.",
        },
    }


def _aplicar_overrides(bloco: dict, overrides: Optional[dict]) -> None:
    """Sobrescrita manual DEPOIS da decisao automatica, alterando ``bloco``.

    Valida cada entrada contra ``campos_ajustaveis()`` ANTES de aceitar:
    campo desconhecido, valor fora da grade, tipo errado ou tentativa de
    mexer nos cortadores levanta ``AudioCloudOverrideInvalidoError`` dizendo
    o campo e os valores aceitos - nunca ignora calado, porque producao
    recusada gasta o envio do mesmo jeito e o usuario precisaria saber.
    """
    if overrides is None or overrides == {}:
        return
    if not isinstance(overrides, dict):
        raise AudioCloudOverrideInvalidoError(
            f"overrides deve ser um dicionario {{campo: valor}}; recebi "
            f"{type(overrides).__name__}."
        )
    ajustaveis = campos_ajustaveis()
    for campo, valor in overrides.items():
        if campo in CAMPOS_NUNCA_AJUSTAVEIS:
            raise AudioCloudOverrideInvalidoError(
                f"Sobrescrita recusada para '{campo}': este corte e FIXO neste "
                f"projeto - documentario nunca corta automatico, nem por "
                f"sobrescrita manual ({', '.join(CAMPOS_NUNCA_AJUSTAVEIS)} "
                f"ficam sempre desligados)."
            )
        spec = ajustaveis.get(campo)
        if spec is None:
            raise AudioCloudOverrideInvalidoError(
                f"Sobrescrita recusada: campo desconhecido '{campo}'. Campos "
                f"aceitos: {', '.join(sorted(ajustaveis))}."
            )
        if spec["tipo"] == "bool":
            if not isinstance(valor, bool):
                raise AudioCloudOverrideInvalidoError(
                    f"Valor {valor!r} recusado para '{campo}' "
                    f"({spec['rotulo']}): campo liga/desliga, envie true ou false."
                )
        else:
            # bool e subclasse de int em Python: False == 0 burlaria a grade
            # de campos numericos (ex.: dehum=0) se nao fosse barrado antes.
            if isinstance(valor, bool) or valor not in spec["valores"]:
                aceitos = ", ".join(repr(v) for v in spec["valores"])
                raise AudioCloudOverrideInvalidoError(
                    f"Valor {valor!r} recusado para '{campo}' "
                    f"({spec['rotulo']}). Valores aceitos pelo Auphonic: "
                    f"{aceitos}."
                )
        bloco[campo] = valor


def montar_algorithms(diag: dict, alvo_lufs: float, teto_dbtp: float,
                      overrides: Optional[dict] = None) -> dict:
    """Monta o bloco ``algorithms`` do Auphonic a partir da pre-analise local.

    Funcao pura: nao le disco, nao chama rede e nao altera ``diag``.

    ``diag`` usa as chaves gravadas em ``analysis_before`` (secao 3 do plano):
    ``lufs``, ``tp`` (true peak dBTP), ``nf`` (piso de ruido dB), ``lra``,
    ``clip_pct`` (fracao de amostras clipadas, ex.: 0.00651 = 0,651%). Dicas
    opcionais: ``ruido_variavel`` (True -> denoisemethod dynamic),
    ``sem_agudos`` (True -> filtermethod bwe, material de arquivo) e
    ``resgate_extremo`` (forca speech_isolation + studiovoice).

    ``overrides``: sobrescrita manual {campo: valor} aplicada DEPOIS da
    decisao automatica (o dono discorda da maquina num clipe especifico).
    Validada contra ``campos_ajustaveis()`` antes de qualquer rede; campo
    desconhecido, valor fora da grade ou tentativa de ligar os cortadores
    levanta ``AudioCloudOverrideInvalidoError`` dizendo o campo e os valores
    aceitos. Campos que NAO estao no bloco automatico (gate, compressor,
    msclassifier, maxlra, loudnessmethod) entram via override.
    """
    diag = diag or {}
    tp = _num(diag.get("tp"), 0.0)
    nf = _num(diag.get("nf"))
    lra = _num(diag.get("lra"))
    clip_pct = _num(diag.get("clip_pct"), 0.0)

    ruido_variavel = bool(diag.get("ruido_variavel", False))
    sem_agudos = bool(diag.get("sem_agudos", False))
    resgate_extremo = bool(diag.get("resgate_extremo", False))

    # Derivacao objetiva de resgate extremo (alem da dica explicita).
    if (not resgate_extremo and tp is not None and nf is not None
            and tp > 0.0 and nf > EXTREMO_PISO_MINIMO and clip_pct >= EXTREMO_CLIP_PCT):
        resgate_extremo = True

    # Denoise: regra corrigida da secao 7 (clamp(noise_floor - (-45), 6, 18)).
    if resgate_extremo:
        denoise, denoiseamount = True, DENOISE_MAX_DB
    elif nf is None:
        denoise, denoiseamount = False, 0
    elif nf >= LIMITE_PISO_RUIDO:
        denoise = True
        denoiseamount = int(round(_clamp(nf + 45.0, DENOISE_MIN_DB, DENOISE_MAX_DB)))
    elif nf >= LIMITE_PISO_LEVE:
        denoise, denoiseamount = True, DENOISE_MIN_DB
    else:
        denoise, denoiseamount = False, 0

    if resgate_extremo:
        denoisemethod, filtermethod = "speech_isolation", "studiovoice"
    elif ruido_variavel:
        denoisemethod, filtermethod = "dynamic", "autoeq"
    elif sem_agudos:
        denoisemethod, filtermethod = "static", "bwe"
    else:
        denoisemethod, filtermethod = "static", "autoeq"

    # Leveler proporcional ao LRA. LRA < 5: material ja esmagado, comprimir
    # de novo piora (regra da secao 7) -> leveler desligado.
    if lra is None or lra < LRA_BLOQUEIO_LEVELER:
        leveler, levelerstrength = False, 0
    else:
        leveler = True
        levelerstrength = int(round(_clamp(20.0 + (lra - 5.0) * 11.0, 20.0, 100.0)))
        if lra >= LRA_REFERENCIA_LEVELER:
            levelerstrength = 100

    # Tudo o que e numerico vai para a grade aceita antes de sair daqui.
    # denoiseamount tem dois valores especiais fora da grade de intensidade:
    # -1 = desligado (0 significaria "automatico", que NAO e a mesma coisa).
    denoiseamount = _na_grade(denoiseamount, GRADE_DENOISEAMOUNT) if denoise else -1

    # "filtermethod" so tem efeito com "filtering" ligado - o campo existe
    # separado no catalogo do Auphonic e nao era enviado, o que provavelmente
    # deixava AutoEQ, BWE e StudioVoice inertes.
    filtering = filtermethod != "hipfilter"

    bloco = {
        "loudnesstarget": _na_grade(alvo_lufs, GRADE_LOUDNESSTARGET),
        "normloudness": True,
        "maxpeak": _na_grade(teto_dbtp, GRADE_MAXPEAK),
        "denoise": denoise,
        "denoiseamount": denoiseamount,
        "denoisemethod": denoisemethod,
        "filtering": filtering,
        "filtermethod": filtermethod,
        "leveler": leveler,
        "levelerstrength": _na_grade(levelerstrength, GRADE_LEVELERSTRENGTH),
        # Zumbido da rede eletrica (50/60 Hz): Auto nos dois campos. NAO ha
        # deteccao local - foi tentada nesta sessao (bandpass e FFT) e FALHOU
        # na verificacao: o biquad de 2a ordem nao separa 60 de 65 Hz, o
        # ganho medido da injecao de zumbido ficou em 0,3 a 4,5 dB e o
        # arquivo LIMPO dava falso positivo maior que o arquivo com zumbido.
        # O detector do Auphonic, validado em escala real, decide.
        "dehum": 0,
        "dehumamount": 0,
        # Regra em negrito do plano: documentario NUNCA corta automatico.
        "silence_cutter": False,
        "filler_cutter": False,
    }
    # A palavra final e do usuario: sobrescrita manual validada DEPOIS da
    # decisao automatica (e antes de qualquer rede).
    _aplicar_overrides(bloco, overrides)
    return bloco


# -- Duracao do WAV (stdlib, para estimar custo em cota) ------------------------


def duracao_wav_segundos(wav: Path) -> Optional[float]:
    """Duracao em segundos lendo o cabecalho WAV; None se nao for WAV legivel."""
    try:
        with wave.open(str(wav), "rb") as w:
            frames = w.getnframes()
            rate = w.getframerate() or 1
            return frames / float(rate)
    except Exception:
        return None


# -- Registro de cota (persistencia local simples) ------------------------------
#
# Escolha de persistencia: arquivo JSON em data/audio_cloud/. As duas casas
# naturais ficam fora da propriedade desta etapa - o settings_registry exige
# entrada catalogada para a chave resolver no SettingsService/painel, e a tabela
# audio_render tem schema voltada a cadeia de render (chain_hash/path/status),
# nao a somatorios mensais. O JSON e auto-suficiente, sobrevive a reinicios e
# e auditavel a olho nu. Migracao futura sugerida: chave global
# "audio.auphonic.cota_usada_segundos" no settings_registry (escopo global) OU
# coluna na tabela audio_render; ver relatorio da etapa.


class RegistroDeCota:
    """Soma consumo mensal do free tier (2 h/mes recorrentes) num JSON local."""

    FORMATO = {"meses": {}}

    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else caminho_cota_padrao()
        self._lock = Lock()

    def _ler(self) -> Dict[str, Any]:
        try:
            bruto = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(bruto, dict) and isinstance(bruto.get("meses"), dict):
                return bruto
        except Exception:
            pass  # arquivo ausente/corrompido: recomeca do zero (sem traceback)
        return json.loads(json.dumps(self.FORMATO))

    def _mes_atual(self) -> str:
        return date.today().strftime("%Y-%m")

    def usado_segundos(self, mes: Optional[str] = None) -> float:
        mes = mes or self._mes_atual()
        with self._lock:
            dados = self._ler()
        return float(dados["meses"].get(mes, 0.0))

    def registrar(self, segundos: float, mes: Optional[str] = None) -> None:
        if segundos <= 0:
            return
        mes = mes or self._mes_atual()
        with self._lock:
            dados = self._ler()
            atual = float(dados["meses"].get(mes, 0.0))
            dados["meses"][mes] = round(atual + float(segundos), 3)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(
                json.dumps(dados, indent=2, sort_keys=True), encoding="utf-8"
            )

    def status(self, limite_segundos: float = COTA_MENSAL_SEGUNDOS,
               perto_do_limite_a_partir: float = 0.8) -> Dict[str, Any]:
        """Retrato da cota do mes corrente, pronto para a UI."""
        mes = self._mes_atual()
        usado = self.usado_segundos(mes)
        restante = max(0.0, float(limite_segundos) - usado)
        fracao_uso = usado / float(limite_segundos) if limite_segundos > 0 else 1.0
        return {
            "mes": mes,
            "limite_segundos": float(limite_segundos),
            "usado_segundos": usado,
            "restante_segundos": restante,
            "perto_do_limite": fracao_uso >= perto_do_limite_a_partir,
            "estourado": restante <= 0.0,
        }


# -- Implementacao concreta: Auphonic ------------------------------------------
# Codigos de status de producao conhecidos da API publica; codigos
# desconhecidos caem em "processando" (nunca travam o poll).

MAPA_STATUS = {
    0: "criado",
    3: "concluido",
    4: "erro",
    12: "concluido_com_avisos",
}


class AuphonicProvider:
    """Implementa ``AudioCloudProvider`` contra a API do Auphonic.

    ``transporte`` permite injetar um duble HTTP nos testes (nenhuma rede);
    por padrao usa ``requests`` com timeout em toda chamada. ``espera_fn``
    existe para os testes observarem a espera crescente sem dormir de verdade.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        project_id: Optional[int] = None,
        transporte: Any = None,
        timeout: float = 120.0,
        max_tentativas: int = 3,
        espera_base: float = 1.0,
        espera_fn: Callable[[float], None] = time.sleep,
        cota_path: Optional[Path] = None,
    ):
        self._api_key = api_key
        self._project_id = project_id
        self.transporte = transporte if transporte is not None else TransporteRequests()
        self.timeout = float(timeout)
        self.max_tentativas = max(1, int(max_tentativas))
        self.espera_base = float(espera_base)
        self._espera = espera_fn or (lambda _seg: None)
        self.cota = RegistroDeCota(cota_path)
        # Producoes cujo POST foi ACEITO pelo servidor (nunca reenviar).
        self.producoes_aceitas: List[str] = []

    # -- chave ----------------------------------------------------------------

    def _resolver_chave(self) -> str:
        if self._api_key:
            return self._api_key
        try:
            from src.services.settings_service import SettingsService

            S = SettingsService.get_settings(self._project_id)
            try:
                valor = S.get(KEY_SETTINGS)
            except KeyError:
                # Registro ainda nao cadastrado no settings_registry desta maquina.
                valor = ""
            if valor:
                return str(valor)
        except Exception:
            valor = None  # sem banco/settings: segue para o fallback de ambiente
        return os.getenv(ENV_FALLBACK, "") or ""

    def _exigir_chave(self) -> str:
        chave = self._resolver_chave()
        if not chave:
            raise AudioCloudConfigError(
                f"Chave de API do Auphonic nao configurada. Cadastre-a no painel "
                f"'Configuracoes da IA' > 'Modelos & Chaves' (campo 'Chave Auphonic', "
                f"configuracao '{KEY_SETTINGS}') ou defina a variavel de ambiente "
                f"{ENV_FALLBACK}. O free tier inclui 2 h/mes."
            )
        return chave

    # -- infra de retry ---------------------------------------------------------

    def _headers_json(self, chave: str) -> Dict[str, str]:
        return {"Authorization": f"Bearer {chave}", "Content-Type": "application/json"}

    def _falha_http(self, codigo: int, corpo: bytes, acao: str) -> AudioCloudError:
        trecho = (corpo or b"").decode("utf-8", "replace")[:300].strip()
        if codigo in (401, 403):
            return AudioCloudAuthError(
                f"Auphonic recusou a chave (HTTP {codigo}) ao {acao}. "
                f"Confira '{KEY_SETTINGS}' no painel de configuracoes."
            )
        if 400 <= codigo < 500:
            return AudioCloudError(
                f"Auphonic recusou o pedido (HTTP {codigo}) ao {acao}: {trecho}"
            )
        return AudioCloudTransientError(
            f"Auphonic indisponivel (HTTP {codigo}) ao {acao}: {trecho}"
        )

    def _com_retry(self, acao: str, operacao: Callable[[], RespostaNuvem]) -> RespostaNuvem:
        """Executa ``operacao`` repetindo SO erro transitorio, com espera crescente.

        Usado apenas em operacoes seguras de repetir (poll, fetch). ``submit``
        NAO passa por aqui - ver comentario em ``submit``.
        """
        ultimo: Optional[Exception] = None
        for tentativa in range(self.max_tentativas):
            try:
                resposta = operacao()
            except Exception as exc:  # noqa: BLE001 - classificada logo abaixo
                if not _parece_transitorio(exc):
                    raise AudioCloudError(
                        f"Falha de rede ao {acao}: {type(exc).__name__}: {exc}"
                    ) from None
                ultimo = exc
            else:
                if resposta.status_code in (429,) or resposta.status_code >= 500:
                    ultimo = self._falha_http(resposta.status_code, resposta.corpo, acao)
                    if not isinstance(ultimo, AudioCloudTransientError):
                        raise ultimo
                else:
                    if resposta.status_code >= 400:
                        raise self._falha_http(resposta.status_code, resposta.corpo, acao)
                    return resposta
            if tentativa < self.max_tentativas - 1:
                pausa = min(16.0, self.espera_base * (2 ** tentativa))
                self._espera(pausa)
        detalhe = f"{type(ultimo).__name__}: {ultimo}" if ultimo else "sem detalhe"
        raise AudioCloudTransientError(
            f"Auphonic ficou indisponivel apos {self.max_tentativas} tentativas "
            f"ao {acao} ({detalhe}). Tente novamente mais tarde."
        ) from ultimo

    # -- Protocolo --------------------------------------------------------------

    def submit(self, wav: Path, algorithms: dict) -> str:
        """Envia o WAV com o bloco algorithms e devolve o uuid da producao.

        UMA UNICA tentativa de POST, sempre: se algo falha depois de o pedido
        partir daqui, nao ha como garantir que o Auphonic nao criou a producao
        - reenviar poderia gastar cota duas vezes. O erro transitorio devolvido
        deixa isso explicito.
        """
        chave = self._exigir_chave()
        wav = Path(wav)
        if not wav.exists():
            raise AudioCloudError(f"WAV de entrada nao encontrado: {wav}")

        # Cota: bloqueio ANTES de qualquer rede quando o mes ja estourou.
        retrato = self.cota.status()
        if retrato["estourado"]:
            raise AudioCloudQuotaExceededError(
                f"Cota gratuita do Auphonic do mes {retrato['mes']} acabou "
                f"(usado {_min_txt(retrato['usado_segundos'])} de "
                f"{_min_txt(retrato['limite_segundos'])}). Aguarde o proximo mes "
                f"ou contrate o plano pago."
            )

        duracao = duracao_wav_segundos(wav)
        formulario = {
            "name": f"CapIAu-Talho - {wav.stem}"[:120],
            "algorithms": json.dumps(algorithms or {}),
        }
        with open(wav, "rb") as fh:
            arquivos = {"input_file": (wav.name, fh, "audio/x-wav")}
            try:
                resposta = self.transporte.post(
                    URL_SIMPLE_PRODUCITIONS,
                    headers={"Authorization": f"Bearer {chave}"},
                    data=formulario,
                    files=arquivos,
                    timeout=self.timeout,
                )
            except Exception as exc:  # noqa: BLE001 - convertido em erro claro
                if _parece_transitorio(exc):
                    raise AudioCloudTransientError(
                        f"Rede falhou durante o envio ao Auphonic "
                        f"({type(exc).__name__}). NAO reenvie automaticamente: "
                        f"a producao pode ter sido criada e consumira cota; "
                        f"confira em auphonic.com antes de enviar de novo. "
                        f"Detalhe: {exc}"
                    ) from None
                raise AudioCloudError(
                    f"Falha durante o envio ao Auphonic: {type(exc).__name__}: {exc}"
                ) from None

        if resposta.status_code in (200, 201):
            try:
                dados = resposta.json()
            except Exception:
                raise AudioCloudError(
                    "Auphonic respondeu sucesso com corpo nao-JSON; producao pode "
                    "existir - confira o painel antes de reenviar."
                ) from None
            uuid = str((dados or {}).get("uuid") or "")
            if not uuid:
                raise AudioCloudError(
                    "Resposta do Auphonic veio sem uuid; confira o painel antes "
                    "de reenviar para nao gastar cota duplicada."
                )
            self.producoes_aceitas.append(uuid)
            if duracao:
                self.cota.registrar(duracao)
            print(
                f"[AUDIO_CLOUD] Producao aceita ({uuid}), "
                f"duracao {_min_txt(duracao or 0.0)}; cota registrada."
            )
            return uuid

        erro = self._falha_http(resposta.status_code, resposta.corpo, "enviar producao")
        if isinstance(erro, AudioCloudTransientError):
            raise AudioCloudTransientError(
                erro.args[0] + " NAO reenvie automaticamente: a producao pode ter "
                "sido criada mesmo com esse erro; confira em auphonic.com primeiro."
            )
        raise erro

    def poll(self, uuid: str) -> dict:
        """Consulta o estado da producao -> {'status': str, 'progress': float}.

        Seguro de repetir: GET somente leitura, com retry transitorio e espera
        crescente (1s, 2s, 4s...).
        """
        chave = self._exigir_chave()
        url = f"{BASE_URL}/api/production/{uuid}.json"
        resposta = self._com_retry(
            f"consultar producao {uuid}",
            lambda: self.transporte.get(url, headers=self._headers_json(chave),
                                        timeout=self.timeout),
        )
        try:
            dados = resposta.json()
        except Exception:
            raise AudioCloudError(
                f"Auphonic devolveu corpo invalido ao consultar {uuid}."
            ) from None
        bruto = (dados or {}).get("status")
        if isinstance(bruto, dict):
            codigo = bruto.get("status")
            progresso = bruto.get("progress", 0.0)
        else:
            codigo = bruto
            progresso = (dados or {}).get("progress", 0.0)
        try:
            progresso = float(progresso)
        except (TypeError, ValueError):
            progresso = 0.0
        return {
            "status": MAPA_STATUS.get(codigo, "processando"),
            "progress": progresso,
            "status_code": codigo,
        }

    def fetch(self, uuid: str, dest: Path) -> Path:
        """Baixa o resultado processado em WAV para ``dest`` e devolve o Path.

        Download e idempotente: pode ser repetido sem custo. Se o fluxo quebrar
        no meio, o arquivo parcial e apagado antes da proxima tentativa.
        """
        chave = self._exigir_chave()
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        url = f"{BASE_URL}/api/production/{uuid}/download_result.json?format=wav"

        def baixar() -> Path:
            resposta = self.transporte.get(
                url, headers=self._headers_json(chave),
                timeout=self.timeout, stream=True,
            )
            if resposta.status_code >= 400:
                raise self._falha_http(resposta.status_code, resposta.corpo,
                                       f"baixar resultado {uuid}")
            try:
                with open(dest, "wb") as fh:
                    for pedaco in (resposta.chunks or iter(())):
                        fh.write(pedaco)
            except Exception as exc:
                try:
                    dest.unlink(missing_ok=True)
                except OSError:
                    pass
                if _parece_transitorio(exc):
                    raise
                raise AudioCloudError(f"Falha ao gravar {dest}: {exc}") from None
            return dest

        resultado: Optional[Path] = None
        # Download e idempotente: se der erro transitorio no meio do stream,
        # refaz a partir do zero (nunca gasta cota). Erro HTTP (AudioCloudError)
        # sobe direto, sem repetir.
        ultima_exc: Optional[Exception] = None
        for tentativa in range(self.max_tentativas):
            try:
                resultado = baixar()
                break
            except AudioCloudTransientError as exc:
                ultima_exc = exc  # 5xx/429 no download: idempotente, vale repetir
            except AudioCloudError:
                raise
            except Exception as exc:  # noqa: BLE001
                if not _parece_transitorio(exc):
                    raise AudioCloudError(
                        f"Falha ao baixar resultado {uuid}: "
                        f"{type(exc).__name__}: {exc}"
                    ) from None
                ultima_exc = exc
            if tentativa < self.max_tentativas - 1:
                self._espera(min(16.0, self.espera_base * (2 ** tentativa)))
        if resultado is None:
            detalhe = f"{type(ultima_exc).__name__}: {ultima_exc}" if ultima_exc else "?"
            raise AudioCloudTransientError(
                f"Nao consegui baixar o resultado {uuid} apos "
                f"{self.max_tentativas} tentativas ({detalhe})."
            )
        print(f"[AUDIO_CLOUD] Resultado {uuid} salvo em {dest}")
        return resultado

    # -- cota: interface para a UI ------------------------------------------------

    def quota_status(self) -> Dict[str, Any]:
        """Quanto resta da cota gratuita do mes (para botoes/avisos da UI)."""
        return self.cota.status()

    def mensagem_cota(self) -> str:
        """Texto humano do estado da cota; destaca aviso quando perto do fim."""
        r = self.quota_status()
        base = (
            f"Auphonic: {_min_txt(r['restante_segundos'])} livres dos "
            f"{_min_txt(r['limite_segundos'])} gratis do mes {r['mes']} "
            f"(usado {_min_txt(r['usado_segundos'])})."
        )
        if r["estourado"]:
            return base + " ATENCAO: cota esgotada neste mes."
        if r["perto_do_limite"]:
            return base + " ATENCAO: a cota esta perto do fim."
        return base


def _min_txt(segundos: float) -> str:
    """Segundos em texto 'Xh Ymin' (cp1252-safe, sem simbolos)."""
    segundos = max(0.0, float(segundos))
    horas = int(segundos // 3600)
    minutos = int(round((segundos - horas * 3600) / 60.0))
    if minutos == 60:
        horas, minutos = horas + 1, 0
    if horas and minutos:
        return f"{horas}h {minutos}min"
    if horas:
        return f"{horas}h"
    return f"{minutos}min"
