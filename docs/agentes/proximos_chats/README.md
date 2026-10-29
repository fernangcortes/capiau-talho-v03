# Próximos chats: modelos, análises e busca por objeto

Escrito em 05/10/2026, no fim do chat que ligou os modelos (commits `dece708` … `cfc105e`).
Cada arquivo `NN_*.md` desta pasta é um **prompt pronto para colar** num chat novo. Eles repetem
as regras do repositório de propósito: cada chat começa sem memória deste.

## Onde paramos

Feito e commitado na main (sem push):

- **Transcrição** numa interface comum (`src/transcription/motores.py`): AssemblyAI 3.5 Pro (padrão),
  Deepgram Nova-3, Whisper local (17 tamanhos), Canary 1B v2, SenseVoice (só zh/en/ja/ko/yue).
- **Diarização**: do próprio motor, Nemotron 3 Diarization ou pyannote community-1 (estes dois no
  ambiente separado `.venv-nemo`, via `src/transcription/venv_nemo_worker.py`).
- **Sistema 1**: Laya local em modo sombra e Jev em nuvem (`src/services/system1_service.py`),
  decisões em `system1_decisao`; segunda opinião do Jev nos cortes do agente (`agent.jev_audit`).
- **Detectores de objeto** (`src/vision/detectores.py`): Gemini, YOLO-World, OWLv2, Grounding DINO,
  Florence-2; DINO-X sem chave. Padrão `none`.
- **Modelos locais**: catálogo (`src/services/modelos_locais.py`), nada baixa sozinho, tela em
  Configurações > Modelos locais (`src/ui/js/modelosLocais.js`), rota `/api/modelos`.
- Scripts de comparação: `scripts/system1_avaliar.py`, `scripts/asr_comparar.py`,
  `scripts/detectores_comparar.py`.
- Documentos: `docs/propostas/PROPOSTA_BUSCA_OBJETOS.md` (rotas A/B/C/D) e `docs/planos/ORDEM_DAS_ANALISES.md`
  (dependências, bugs, ordem recomendada).

## Ordem dos chats

| # | Chat | Depende de | Tamanho |
|---|---|---|---|
| 01 | [Correções e ordem das análises](01_correcoes_ordem_analises.md) | — | médio |
| 02 | [Limpeza de configurações e dispositivo de IA](02_limpeza_configuracoes_dispositivo.md) | — | pequeno |
| 03 | [Checagem técnica de take (B)](03_checagem_tecnica_B.md) | 01 | grande |
| 04 | [Busca por objeto (A), roteador e clique no player (D)](04_busca_objeto_A_D.md) | 03 (coluna `finalidade`) | grande |
| 05 | [Continuidade com o roteiro (C)](05_continuidade_C.md) | 03, 04 | médio |
| 06 | [Gabaritos humanos e avaliação honesta](06_gabaritos_avaliacao.md) | — (pode ir em paralelo) | médio |
| 07 | [Pendências externas](07_pendencias_externas.md) | chaves/decisões do Fernando | pequeno |
| 08 | [Planos-sequência: do teste ao Talho](08_plano_sequencia.md) (07/10) | revisão do Fernando | grande |

01, 02 e 06 podem rodar em paralelo (arquivos diferentes). 03 → 04 → 05 em sequência.

## Decisões já tomadas pelo Fernando (não reabrir)

- Nenhum modelo grande é requisito; o programa avisa e o usuário escolhe o que baixar.
- O sistema é **barato**, não offline: custo zero só com tudo local escolhido à mão.
- Checagem técnica (B) roda na ingestão **quando pedida** pelo chat de onboarding ou manualmente.
- Todas as buscas (A, B, C, D) coexistem; nenhuma pode contaminar outra.
- Todos os tamanhos de Whisper ficam disponíveis para baixar.
- A ordem das análises deve aproveitar o contexto de uma na outra sem criar viés de confirmação.
- Triagem local em dupla, Jev + Laya (o Jev é quase de graça); detalhes no chat 06, item 4.

## Decisões ainda abertas (cada prompt diz onde perguntar)

- B: Gemini (pago, mais preciso) ou OWLv2 (grátis, mais lento) como padrão? (chat 03)
- Coluna `finalidade` em `detected_object` ou tabela separada para B? (chat 03; recomendado: coluna)
- Chips de sugestão só no player ou também na biblioteca? (chat 04)
- Aceitar "na dúvida, busca comum (A)"? (chat 04; recomendado: sim)

## Medições que valem como referência (sem gabarito humano)

- Triagem em 23 vídeos, referência = triagem por visão: Laya 2/23, Jev 13/23, chute "processo" 16/23.
- Transcrição (clipes de bastidor; WER contra a AssemblyAI, não contra humano): Deepgram ~77%,
  Whisper turbo ~50%; Canary entrou em loop num clipe. Tempos: AssemblyAI ~7 s, Deepgram ~1,7 s,
  Whisper turbo ~0,4× o áudio, Canary ~1,5× o áudio (CPU i7-10700).
- Diarização no clipe 517 (2 pessoas): pyannote 2 falantes, Nemotron 4, AssemblyAI 2.
- Detectores (6 quadros de bastidor, lista fechada de equipamento): Gemini melhor no olho; Florence-2
  marca toda classe pedida; YOLO-World só responde com nota ~0,1.
