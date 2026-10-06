# Chat 07: pendências que dependem de chave ou de decisão

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Use quando a chave do DINO-X chegar ou para fechar os itens soltos abaixo.

---

Itens soltos do trabalho de modelos do CapIAu Talho (05/10/2026). Faça só os que eu indicar; confira
no código antes de afirmar.

## 1. DINO-X (quando a chave chegar)

- Hoje `dino_x` em `src/vision/detectores.py` levanta `DetectorIndisponivel("DINO-X ainda sem chave")`.
- Leia a documentação da API do DINO-X (DeepDataSpace) e me diga: endpoint, autenticação, formato de
  caixa (há `dinox_to_gemini_box` em `src/vision/spatial_grounding.py:106`), preço, limite.
- Chave: só pelas Configurações (banco local, nova `api.dinox_key` com fallback no `.env`) ou `.env`;
  nunca no código nem no log. Eu mesmo colo; não peça no chat.
- Implementar como os outros (`_gemini` serve de modelo: HTTP injetável, chave fora das mensagens de
  erro), testes com HTTP falso, e uma rodada real em `scripts/detectores_comparar.py`.

## 2. SenseVoice com áudio real

- Ligado em 05/10 (`transcrever_sensevoice` em `src/transcription/motores.py`, worker
  `sensevoice` em `src/transcription/venv_nemo_worker.py`), **sem teste real**: o modelo (940 MB)
  não foi baixado por decisão minha.
- Se eu pedir: baixar pelo botão em Configurações > Modelos locais, achar um clipe em inglês, rodar
  `scripts/asr_comparar.py --idioma en --motores assemblyai_universal_35,sensevoice` e me mostrar.

## 3. Ambiente `.venv-nemo` reprodutível

- Montado à mão em 05/10 (`requirements-nemo.txt` tem a receita). Nunca foi recriado do zero.
- Recriar numa pasta temporária (`CAPIAU_VENV_NEMO` aponta para ela), rodar os testes e uma
  diarização real com Nemotron e pyannote, e ajustar a receita se faltar algo. Avise o tamanho antes.
- Atenção: o `pyannote.audio` traz o `torchcodec`, que no Windows quebra o `load_audio` do
  transformers; o worker lê WAV com `soundfile` por isso.

## 4. Suíte completa e push

- Rodar a suíte inteira (`pytest` e os `tests/*.mjs`), separar falhas antigas das novas (o
  `docs/HANDOFF_DESIGN_UI.md` lista as que já falhavam) e me mostrar.
- A main local está à frente do origin; **push é comigo**. Prepare o resumo dos commits para eu
  revisar e empurrar.

## 5. Arquivos de cache que sobraram

- No cache do Hugging Face ficaram arquivos que o Talho não usa: o `.nemo` e o `.gguf` do Nemotron
  (~300 MB), e o `faster-whisper-base` (145 MB, baixado por outro código?). Liste com tamanho e
  origem; só apague o que eu aprovar.

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev`. Outra sessão mexe na interface: commit só dos seus trechos,
  direto na main, sem coautoria, sem push.
- Chaves só pelas Configurações ou `.env`; nunca no código, no log ou no chat.
- Scripts de edição em arquivo, com `PYTHONUTF8=1`. Português, direto. Verifique antes de afirmar.
