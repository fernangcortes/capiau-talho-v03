# Plano: importar e categorizar áudio

> Criado em 06/10/2026. Decidido com o Fernando: a lista de categorias abaixo serve; implementar
> **genérico** e **calibrar depois**. ⚠ **FALTA CALIBRAR**: não há arquivos de efeito, room tone
> e ambiente no acervo (seção 6). Contexto: `docs/REVISAO_CATEGORIAS.md`.

## 1. Situação hoje (lida no código)

- A ingestão aceita `.wav .mp3 .m4a .bwf` (`src/services/ingest.py:18`) e grava esses arquivos
  **na tabela `video`** (`ingest.py:109`, `media_type = "video"`). Não existe a noção de
  "material de áudio".
- Consequência: arquivo de áudio entra na triagem por visão e na análise de quadros sem ter
  imagem. O vídeo 555 ("TUDO E NADA (DEMO).mp4", trilha do filme) é imagem parada com música
  (diferença de pixels zero entre quadros de 20 s, 196 s e 370 s) e passou pela visão inteira.
- O app **trata** áudio (`worker_audio.py`: limpeza de ruído, cadeia de efeitos, stems), mas não
  **classifica**: não há classificador de som em `src/`.
- Fala já tem caminho: VAD local + ASR (`PipelineService.transcribe_video`).

## 2. Categorias de áudio (aprovadas)

Valem quando o material é áudio (seção 3). São um conjunto à parte das categorias de imagem,
no mesmo campo `video.category`; `depoimento` é a mesma chave do vídeo, de propósito (a busca
acha entrevista em vídeo e em áudio juntas).

| Chave | O que é | Sinais principais |
|---|---|---|
| `depoimento` | entrevista gravada só em áudio | fala na maior parte, 2+ vozes ou pergunta/resposta |
| `locucao` | narração, voz limpa de um falante | fala contínua, 1 voz, ruído de fundo baixo |
| `trilha` | música | AudioSet "Music" dominante |
| `efeito` | som pontual: porta, passo, impacto | curto (< ~10 s), transiente, sem fala nem música |
| `ambiente` | som do lugar com eventos (rua, set) | sem fala dominante, eventos variados, nível médio |
| `room_tone` | silêncio do lugar, constante | nível baixo e quase constante, sem eventos, ~20 s a 2 min |

O vídeo 555 (`Trilha`, fora das taxonomias) vira `trilha` quando isto existir.

## 3. Arquitetura em três camadas

### Camada 1: reconhecer que é áudio (determinística, sem IA)
- `natureza` do material: `video` ou `audio`. Coluna nova em `video` (ex.: `natureza TEXT DEFAULT 'video'`).
- É `audio` quando: o arquivo não tem faixa de vídeo (ffprobe), **ou** a imagem é parada
  (3 a 5 quadros espalhados com diferença média de pixels ~0, como o teste feito no 555).
- Efeito no pipeline: material `audio` **não** passa pela triagem por visão, pela análise de
  quadros nem pelo CLIP. Vai para a camada 2 e, se tiver fala, para o ASR.
- Marcar na ingestão (barato) e reconferir na análise.

### Camada 2: classificar o tipo de som (local, genérico)
- Classificador AudioSet local, pequeno, em CPU: **YAMNet** (~15 MB, 521 classes) ou **PANNs
  CNN14** (mais preciso, ~300 MB). Escolha na implementação, medindo tempo; preferir o menor.
  Baixar pelo esquema de modelos locais do app (`src/services/modelos_locais.py`, com aviso e
  download a pedido).
- Janelas de ~1 s; agregar as probabilidades por arquivo.
- Mapa AudioSet -> categoria (genérico, a calibrar):
  - "Music" e filhas -> `trilha`
  - "Speech" dominante -> `depoimento` ou `locucao` (decidir por número de vozes/diarização do
    ASR e por continuidade)
  - "Silence"/ruído estacionário com RMS baixo e variância baixa -> `room_tone`
  - eventos variados sem fala/música dominante -> `ambiente`
  - arquivo curto com evento único -> `efeito`
- Sinais simples somados: duração, RMS médio e desvio, proporção de fala (VAD), nome e pasta
  (`trilha`, `musica`, `sfx`, `efeito`, `rt`, `room`, `ambiente`, `amb`).
- Confiança: as mesmas regras de incerteza da triagem (`analysis_policy.categoria_incerta`);
  incerto vai para a fila de revisão.
- Futuro: o EmbeddingGemma 2 (branch `ccr-760500b3-ihwuzl`, fase 3) põe áudio e texto no mesmo
  espaço; se ganhar a bancada, dá para classificar por similaridade com textos das categorias.

### Camada 3: fala
- `depoimento` e `locucao`: ASR como hoje (transcrição, resumo de fala, temas).
- `trilha`: sem ASR (Whisper em música gera lixo). Opcional depois: BPM/tonalidade para a edição.

## 4. Onde mexer (estimativa)

- `src/db/schema.py`: coluna `natureza`; categorias de áudio no dicionário (ex.:
  `AUDIO_CATEGORIES` em `prompt_registry.py`, ao lado de `TRIAGE_CATEGORIES`), aceitas por
  `normalizar_categoria` só quando a natureza é áudio.
- `src/services/ingest.py`: detectar natureza na ingestão.
- `src/services/pipeline.py`: desvio no início de `analyze_video_vision` / `analyze_video_all`
  para material `audio`; novo `classificar_audio`.
- Novo `src/media/audio_classificador.py` (YAMNet/PANNs + heurísticas), com motor falso nos
  testes (padrão de `tests/laya_falsa.py`).
- `src/ui/js/library.js`: rótulos das categorias de áudio (sessão de interface).

## 5. Testes (sem baixar modelo)

- Camada 1: arquivo sem faixa de vídeo e vídeo de imagem parada viram `audio`; vídeo normal não.
  Gerar fixtures com ffmpeg (tom, ruído, silêncio, imagem parada + tom).
- Pipeline: material `audio` não chama visão nem triagem por visão; chama ASR só com fala.
- Camada 2 com classificador falso: mapa AudioSet -> categoria, heurísticas de RMS/duração,
  incerteza para a fila.

## 6. ⚠ Calibração pendente

Material disponível hoje (`D:\makinof-monstro`):
- `Entrevistas\todas juncoes\*.wav`: 3 entrevistas em áudio (arte, figurino, som) -> `depoimento`
- `trilha\TUDO E NADA (DEMO).mp3.mpeg` e o vídeo 555 -> `trilha`

**Faltam exemplos reais de `efeito`, `room_tone`, `ambiente` e `locucao`.** Os limiares de RMS,
duração e o mapa AudioSet ficam com valores genéricos até o Fernando juntar ~10 arquivos de cada.
Fazer uma bancada como `scripts/visao_calibrar.py` (só leitura) para medir acerto por categoria.

## 7. Feito em 07/10/2026: camada 1

- `src/media/natureza.py`: `detectar_natureza(caminho)` -> `audio` quando há som e (a) nenhuma
  faixa de imagem (capa de MP3/M4A, `attached_pic`, não conta) ou (b) imagem parada: 4 quadros a
  10/35/60/85% da duração, cinza 160x90, e o par **mais diferente** abaixo de 0,5. Na dúvida
  (ffprobe falhou, offline, < 2 s, sem som) fica `video`.
  - Limiar medido: o 555 dá 0,0 em todos os pares; 25 vídeos reais sorteados dão no mínimo 1,15
    no par mais parecido e >= 3 no mais diferente. Os 3 `.wav` de entrevista e o `.mp3.mpeg` da
    trilha também saem `audio`.
- `video.natureza TEXT DEFAULT 'video'` (`SCHEMA_SQL` + `migrar_natureza`, idempotente; ao criar a
  coluna marca `.wav .mp3 .m4a .bwf` pela extensão).
- Ingestão: extensão de áudio marca na hora; a sondagem completa roda na tarefa de proxy, em
  segundo plano (`IngestService._registrar_natureza`).
- Análise: `analyze_video_vision` confere a natureza logo depois de resolver a fonte (só promove
  para `audio`, nunca desfaz) e desvia para `_analisar_material_audio`: sem Laya, sem triagem por
  visão, sem planos, quadros, CLIP ou Qdrant de imagem; ASR se não houver transcrição (o VAD de
  `transcribe_video` filtra quem não tem voz), resumo e temas se `finalizar`. Todos os caminhos
  (rota, lote, reanálise de falhas, `analyze_video_all`) passam por ali. `analyze_video_all` não
  procura rosto em material de áudio.
- Testes: `tests/test_natureza_audio.py` (fixtures de ffmpeg) e o bloco "Camada 1" de
  `tests/test_ordem_analises.py`.

Ficou de fora, de propósito:
- **Dados de visão antigos** do material que vira áudio (o 555 tem keyframes e vetores de imagem)
  não são apagados: a reanálise só para de gerar novos. Decidir se limpa.
- **Trilha ainda passa pelo ASR** se o VAD achar voz (música cantada): a camada 2 decide `trilha`
  e aí o ASR sai (camada 3).
- Não há como corrigir à mão uma marca `audio` errada (só por SQL). Interface fica para depois.
- O lote de visão (`vision_batch._select_videos`) ainda conta o material de áudio como vídeo da
  fila; o desvio acontece dentro da análise, sem custo de API de visão.

## 8. Feito em 07/10/2026: camada 2 (genérica) e camada 3

- **Modelo: PANNs Cnn10** (`nicofarr/panns_Cnn10`, 25 MB, Apache-2.0; arquitetura MIT de
  qiuqiangkong). STFT e banco mel vêm nos pesos: roda em `torch` puro, sem librosa e sem
  TensorFlow. YAMNet oficial pede TF (fora do venv) e só há cópias de terceiros; Cnn14 (300 MB)
  e AST (346 MB) não foram baixados porque o Cnn10 já separou o acervo (abaixo). Entrou no
  catálogo de modelos locais (`panns_cnn10`) e na chave `audio.classificar_tipo` (padrão ligado).
- `src/media/audio_classificador.py`: ffmpeg lê o som inteiro (mono, 32 kHz); nível RMS em quadros
  de 0,5 s no arquivo todo; o modelo vê janelas de 5 s, no máximo 48 por arquivo, espalhadas por
  igual. `decidir`: música em >= 50% das janelas (e acima da fala) -> `trilha`; fala em >= 40% ->
  `depoimento`; < 10 s -> `efeito`; mediana < -50 dBFS e desvio < 4 dB -> `room_tone`; senão
  `ambiente`. Nome do arquivo ou de até 3 pastas acima: concorda -> confiança 0,9; discorda -> vale
  o nome com 0,5 (fila de revisão).
- Pipeline (`_analisar_material_audio`): categoria de áudio já gravada vale (o `Trilha` do 555 vira
  `trilha`); correção humana (1,0) vale mesmo sendo de imagem; senão classifica. Decisão e sinais em
  `system1_decisao` (`tarefa='tipo_de_som'`, `motor='panns-cnn10'`). `trilha`, `efeito`, `ambiente`
  e `room_tone` **não vão ao ASR**; `analyze_video_all` não transcreve material de áudio antes da
  classificação. Sem modelo ou com a chave desligada: segue sem categoria e o VAD decide.
- Correção humana (`PATCH /api/video/{id}/category`) aceita as categorias de áudio quando
  `natureza='audio'` (e só elas); `locucao` deriva `interview`; não marca análise desatualizada.
  A fila de revisão devolve `natureza`.
- Bancada: `scripts/audio_calibrar.py PASTA` (subpastas com o nome da categoria; só leitura; decide
  sem a dica do nome).

Medição no acervo (07/10/2026): as 3 entrevistas `.wav` -> `depoimento` (fala em 95-100% das
janelas); `TUDO E NADA (DEMO)` `.mp3.mpeg` e o 555 -> `trilha` (música em 100%). O modelo leva ~2 s
por arquivo; nos `.wav` de 16 a 24 min o total foi 45-70 s, quase tudo leitura do disco D:.

### ⚠ Ainda sem calibrar
- `efeito`, `room_tone`, `ambiente`, `locucao`: limiares genéricos, **nenhum exemplo real**. Junte
  ~10 de cada e rode a bancada.
- `depoimento` x `locucao`: sem diarização, fala é sempre `depoimento`; locução só pelo nome.
  Próximo passo natural: depois do ASR, 1 falante + fala contínua + fundo baixo -> `locucao`.
- Dicas de nome curtas (`rt`, `vo`, `off`, `fx`, `amb`, `ost`) podem acertar por acaso.
- Interface: rótulos das categorias de áudio na biblioteca (`library.js`, sessão de UI).
