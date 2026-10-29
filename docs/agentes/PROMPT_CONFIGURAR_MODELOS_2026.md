# Prompt: configurar os modelos do Sistema 1, diarização, transcrição e detecção

Cole o bloco abaixo num chat novo do Claude Code aberto em `C:\Users\FGC\dev\capiau\talho`.

---

Vamos ligar de verdade cinco modelos no CapIAu Talho. Hoje eles existem só no texto e nas
Configurações; nenhum código usa. Antes de escrever qualquer coisa, leia o repositório e me
confirme o estado real. Verifique antes de afirmar: se uma API, pacote ou arquivo não existe ou
não funciona como imaginado, me diga em vez de inventar.

## Os modelos (fontes que eu passei)

| Nome no programa | Fonte | Chave |
|---|---|---|
| Laya (Sistema 1 local, triagem de mídia na ingestão) | https://github.com/receptron/laya | não precisa |
| Jev (TypeSafe, auditoria de mutação na timeline) | https://typesafe.ai/blog/introducing-system-one-models-and-jev | tenho a chave |
| Nemotron 3 Diarization (quem fala, fala sobreposta) | https://huggingface.co/nvidia/Nemotron-3-Diarization | — |
| AssemblyAI Universal 3.5 (transcrição/diarização em nuvem) | https://www.assemblyai.com/ | tenho a chave |
| YOLO-World v2 (detecção de objetos local) | https://huggingface.co/AXERA-TECH/YOLO-World-V2 | — |

Leia cada fonte primeiro (README, model card, docs da API) e me diga, para cada um: o que é de
fato, como se instala ou chama, licença, requisito de hardware (CPU/GPU/NPU; o YOLO-World da
AXERA-TECH pode ser só para chip Axera, confira), tamanho do download e se roda no Windows desta
máquina. Se algo não servir, proponha a alternativa antes de implementar.

## O que já existe no código (conferido em 30/09/2026)

- `src/services/system1_service.py`: `System1LayaEngine`, `System1JevClient`, `System1Orchestrator`.
  **Nenhum outro arquivo importa isso.** A Laya procura `data/models/laya_triage_modernbert.onnx`,
  que não existe, e cai numa heurística. O endpoint do Jev (`https://api.typesafe.ai/v1/jev`,
  via `TYPESAFE_ENDPOINT`) foi chutado; confira na documentação.
- `src/services/settings_registry.py`: `api.typesafe_key`, `api.assemblyai_key`,
  `transcription.engine` (nvidia_canary, whisper_turbo, sensevoice, assemblyai_universal_35,
  deepgram_nova_3), `diarization.engine` (nemotron_3_diarization, pyannote_40,
  assemblyai_universal_35, none), `diarization.max_speakers`, `object.detector_engine`
  (gemini_spatial, yolo_world, dino_x, florence_2, none), `triage.system1_enabled`,
  `triage.escalation_threshold`. **Nenhum código lê as três `*.engine`**; confira com grep.
- Transcrição real hoje: `src/transcription/asr_engine.py` e `src/services/audio_cloud.py`
  (já fala com a AssemblyAI de algum jeito; veja qual versão/modelo usa).
- Pipeline de ingestão: `src/services/pipeline.py`.
- Textos que citam esses modelos: perfis em `src/ui/js/welcomeHub.js` (`WELCOME_HUB_PROFILES`),
  conhecimento do chat em `src/services/onboarding_agent.py` (`CAPIAU_TALHO_KNOWLEDGE`).
  Ajuste os textos para bater com o que ficar funcionando.

## O que eu quero

1. Plano curto por modelo: onde entra no pipeline, qual configuração liga, o que acontece quando
   falta chave/modelo/hardware (tem de cair num caminho que funciona e **avisar**, nunca fingir).
2. Implementar um modelo por vez, começando pelo que dá mais resultado com menos risco
   (provavelmente AssemblyAI 3.5, que já tem chave e cliente). Cada um com teste e um commit.
3. As opções de `*.engine` que não forem implementadas saem da lista das Configurações, em vez de
   ficarem lá sem fazer nada.
4. Chaves: só pelas Configurações (banco local) ou `.env`; nunca no código nem no log. As chaves
   eu mesmo colo no painel; não peça para eu colar no chat.

## Regras deste repositório

- Leia `CLAUDE.md` da pasta `dev` e `docs/agentes/HANDOFF_DESIGN_UI.md` (regras de interface: tamanhos
  pequenos, painéis empurram, nada abre sozinho).
- **Tem outra sessão trabalhando no mesmo repo** (Welcome Hub, streaming do chat de onboarding em
  `onboarding_agent.py` e `welcomeHub.js`, e outra em `timelineState.js`/painéis). Não faça
  `git add` de arquivo inteiro que você não escreveu; commite só os seus trechos, direto na main,
  sem linha de coautoria. Se precisar mexer em `onboarding_agent.py`, mexa só no texto de
  conhecimento e me avise.
- Testes que gravam em Configurações escrevem no banco de verdade: guarde e devolva os valores
  (veja o fixture `preserve_real_api_keys` em `tests/test_onboarding_agent.py`).
- Servidor para testar: `capiau-server-venv` do `.claude/launch.json` (porta 8022, usa o `.venv`).
  Downloads grandes de modelo (centenas de MB ou mais): me pergunte antes, dizendo o tamanho.
- Português, direto. Comece me mostrando o levantamento das cinco fontes e do código.
