# Auditoria da documentação — 29/10/2026

Análise feita por seis agentes em paralelo. Quatro rodaram no Sonnet: README, USER_MANUAL, Wiki com o glossário, e a referência técnica (API, atalhos e configuração). Dois rodaram no Haiku: o inventário de `docs/` e uma varredura mecânica de links. Nenhum arquivo foi alterado. Este relatório é o único arquivo novo.

---

## 1. Resumo executivo

| Área | Situação | Problema principal |
| :--- | :--- | :--- |
| README.md (65 KB) | 🟡 Desatualizado | 6 âncoras quebradas, galeria vazia, roadmap atrasado (Tasks 23 e 24 já entregues), instalação só para Windows |
| USER_MANUAL.md (115 KB) | 🟠 Defasado | 20 links do índice quebrados, `U` descrito errado, nenhum dos 4 recursos recentes documentado, zero imagens |
| Wiki (18 páginas) | 🔴 Conteúdo incorreto | 66% das rotas do cap. 15 não existem, `.env` do cap. 02 fictício, comando `uvicorn` errado, denoise descrito como DeepFilterNet |
| Glossário (wiki 18) | 🟡 Bom esqueleto | 9 caminhos `src/` inexistentes, 8 âncoras de eixo quebradas, cerca de 25 termos faltando |
| docs/ (47 arquivos) | 🟡 Desorganizado | 4 docs citados no código nunca existiram, 2 órfãos, muitas sobreposições, sem índice |
| Atalhos | 🔴 4 fontes divergentes | Tabela do numpad trocada, cerca de 20 atalhos não documentados, conflitos no próprio keymap |
| API | 🔴 Cobertura de 15% | 180 rotas reais, só 27 documentadas corretamente |

O validador `scripts/validate_wiki_glossary.py` passa com 50 de 50 testes, mas só confere a estrutura do glossário. Ele não verifica se o conteúdo está certo.

---

## 2. Críticos (corrigir primeiro)

### Instruções que falham na prática
- **`wiki/02:125` e `wiki/16:31`** mandam rodar `uvicorn src.api.main:app`, mas esse módulo não existe. O comando correto é `src.api.server:app`.
- **Bloco `.env` em `wiki/02:76-110`.**
  - Estas variáveis não existem no código: `TRANSCRIPTION_PROVIDER`, `WHISPER_LOCAL_MODEL`, `DEVICE`, `WATCH_DIR`, `DATA_DIR`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `OLLAMA_BASE_URL`, `AUPHONIC_USER` e `AUPHONIC_PASSWORD`.
  - Falta `OPENROUTER_API_KEY`, que é a chave essencial.
  - Os nomes reais são `CAPIAU_*` e `AUPHONIC_API_KEY`.
- **Tabela de API em `wiki/15:29-82`:** 19 das 29 rotas não existem. Exemplos: `/api/transcription/*`, `/api/search/hybrid` e `/api/audio/{id}/filter/deepfilter`.
- **`docs/dev/api_endpoints.md`:** 7 rotas inexistentes, entre elas `batch-similar` (o nome real é `similar-batch`), `vision-model` e `upload-direct`. As seções estão fora de ordem e há dois "## 8".

### Descrições erradas de funcionalidades
- **USER_MANUAL.md:379** diz que `U` desvincula A/V. No código, `U` é a ferramenta Slide. Desvincular é `Ctrl+Shift+U` ou `Ctrl+L`.
- **Denoise.** A wiki (10, 15, 17, Home, 18) diz DeepFilterNet. O código (`src/media/audio_denoise.py`) usa **DPDFNet** e **GTCRN** via ONNX.
- **Numpad em `docs/usuario/shortcuts.md:205-227`.** `Num5`, `Num7`, `Num8`, `Num9`, `Alt+Num2` e `Alt+Num3` fazem coisas diferentes do que a doc diz. `Shift+←/→` (`:164`) é shuttle, não Trim OUT.
- **Modelos de IA.**
  - `docs/usuario/costs_and_security.md:36` diz que o padrão é `deepseek/deepseek-chat`. O real é `deepseek/deepseek-v4.1-flash`.
  - `ai_settings_pro_guide.md:64` cita `anthropic/claude-5-sonnet`. O slug real é `anthropic/claude-sonnet-5.5`.
  - `USER_MANUAL:1096` cita "Nemotron 70B Vision" como opção principal.

### Recursos recentes sem nenhuma documentação
| Commit | Recurso | Atalhos |
| :--- | :--- | :--- |
| 0799f7e | Trava total de pista (cadeado), diferente de Sync Lock | `Shift+L`, `Ctrl+Alt+Shift+L` |
| 3d5813c | Margens de segurança e máscaras 16:9, 9:16, 1:1 e 2.39:1 | `Ctrl+Shift+G`, `Ctrl+Alt+G` |
| 02a7180 | Camada facial no Source e modo alt-peek | `Ctrl+Alt+B`, segurar `Alt` |
| 85ed259 | Diálogos NLE glassmorphism e multi-monitor | — |

O roadmap ainda marca a Task 23 e a Task 24 como pendentes. O mesmo vale para `PLANO_SUITE_NLE_CLASSICO.md:145`, além do README e da wiki 17.

### Links quebrados (39 âncoras e 10 arquivos)
- **USER_MANUAL.md:13-47:** as 20 entradas do índice estão quebradas. Títulos que começam com emoji geram um slug com hífen inicial.
- **README.md:56, 57, 475, 708, 742 e 785:** apontam para `#passo-a-passo` e `#executando`, que não existem mais.
- **wiki/18:43-50:** os 8 links de eixo omitem os acentos que o GitHub mantém no slug.
- **docs/planos/PLANO_SUITE_NLE_CLASSICO.md:** 6 entradas de índice com texto diferente do título.
- **docs/arquivo/PLANO_PESQUISA_19082026.md:** o link para a pesquisa de origem aponta para um arquivo inexistente. Outros 9 links usam o sufixo `arquivo.py:linha`, que quebra o destino.

### O código cita docs que nunca existiram
| Doc citado | Onde é citado |
| :--- | :--- |
| `PLANO_AJUSTES_DE_AUDIO.md` | settings_registry.py, media.py, schema.py, watcher.py |
| `PLANO_EXPORTACAO_VIDEO.md` | settings_registry.py, exportVideo.js, schemas.py |
| `PLANO_HISTORICO_METADADOS_E_WORKER_ASR.md` | schema.py, proteger_metadados.py |
| `PLANO_JANELAS_DRAG_DOCK.md` | dockDrag.js e outros 4. O arquivo real é `HANDOFF_JANELAS_DRAG_DOCK.md` |

---

## 3. Importantes

- **Python.** O README e o Dockerfile dizem 3.12. A wiki 02 diz "3.10 ou 3.11". O badge diz "3.10+". Há um teto real abaixo de 3.14, por causa do OTIO, que nenhuma dessas fontes menciona.
- **Instalação local fora do Docker.** Só há comandos para Windows (`.venv\Scripts`, `.ps1`). Três requisitos não são citados:
  - o `playwright install chromium`, necessário para o Titler;
  - o `git`, usado pelo CLIP via `git+https`;
  - o `pytest`, que não está no `requirements.txt`.
- **Variáveis de ambiente.** O README documenta só 4 provedores. Ficam de fora `DEEPGRAM`, `TYPESAFE`, `HF_TOKEN`, `GEMINI`, `ANTHROPIC`, `DEEPSEEK`, `NVIDIA` e `CAPIAU_WATCH/ORIGINALS/PROXIES/CACHE/QDRANT_DB`. O README também diz que a chave Auphonic "não fica no `.env`", o que o código contradiz.
- **Glossário.**
  - Os caminhos de 9 verbetes não existem, como `src/search/hybrid.py` e `src/transcription/diarization.py`.
  - O verbete "Hybrid Search BM25 + Qdrant + MMR" não corresponde ao código.
  - O índice A-Z tem "Gaps" apontando para OpenTimelineIO e "3D LUT" sob a letra Z.
  - A âncora `#retorcao` tem erro de digitação.
- **Termos que faltam no glossário:** OpenRouter, fallback de modelo, Triagem, Ghost Clips/Sequência Fantasma, Bins, RTF, DPDFNet, Track Lock vs Sync Lock, Safe Margins, Lift vs Extract, Replace Edit, Match Frame, Rate Stretch, Freeze Frame, Diarização e LUFS.
- **Conflitos de atalho no código.** No preset CapIAu, `Ctrl+L`, `R`, `X`, `Y`, `N`, `Enter`, `Delete` e `[` estão ligados a dois comandos cada. A regra de precedência por contexto não está documentada.
- **Duplicação.** Os atalhos têm 4 fontes editadas à mão: `docs/usuario/shortcuts.md`, `wiki/14`, `USER_MANUAL §15` e o README. O diff só entre as duas primeiras dá 346 linhas.
- **Segurança.** Há CORS `*` e porta 8000 aberta em todas as interfaces, sem autenticação. O aviso fica enterrado na seção Docker.
- **Imagens.** O README tem 5 PNGs comentados que não existem. O USER_MANUAL tem 0 imagens. 4 dos 6 SVGs em `docs/images` não aparecem na documentação de usuário.

---

## 4. Inventário de `docs/` e reorganização proposta

- **Órfãos:** `PLANO_PESQUISA_19082026.md` e `plano_reorganizacao_workspaces.md`, que já está concluído.
- **Concluídos ou obsoletos:** `proximos_chats/01` (8 de 8 itens feitos) e `prototipos/welcome-hub-v2.html` (já implementado).
- **Afirmação falsa:** `PROPOSTA_SEQUENCIA_FANTASMA_IA.md` diz que `PLANO_SUITE_NLE_CLASSICO.md` não está no repositório, mas ele está.
- **Grupos sobrepostos:**
  - categorias de análise: 5 arquivos;
  - busca de objetos: 3 arquivos;
  - interface e dock: 4 arquivos;
  - pesquisas: 3 arquivos.

Estrutura sugerida, a aplicar em duas etapas. Primeiro um índice e as correções. Depois a mudança das pastas, num commit que também atualize as referências em `src/`, `scripts/` e `tests/`.

```text
docs/
├── README.md        ← índice com status de cada doc
├── usuario/         ai_settings_pro_guide, costs_and_security, kdenlive_workflow, TESTE_MANUAL
├── dev/             api_endpoints (gerado), AUPHONIC guide, walkthrough
├── planos/          PLANO_* ativos + ORDEM_DE_IMPLEMENTACAO(+csv)
├── propostas/       PROPOSTA_*
├── handoffs/        HANDOFF_*
├── agentes/         PROMPT_* + proximos_chats/
├── pesquisas/
├── arquivo/         concluídos/obsoletos
└── images/
```

---

## 5. Ideias

### Fonte única de verdade, com geração automática
1. **`scripts/gerar_docs_api.py`:** usa `app.openapi()` para gerar `docs/dev/api_endpoints.md` e o trecho da wiki 15. Um teste pytest falha se a doc divergir do código.
2. **`scripts/gerar_atalhos.mjs`:** lê o `KEYMAP_PRESETS` e o `COMMANDS_CATALOG` e gera `shortcuts.md`, a wiki 14, a §15 do manual e um **cartão A4 imprimível por perfil** (Premiere, Resolve, FCP, Kdenlive, CapIAu).
3. **Lint de atalhos:** falha se houver combinação duplicada sem estar numa allowlist de contexto, ou comando sem documentação.
4. **Lint de `.env`:** compara o `os.getenv` e o `settings_service` com o `.env.example` e com os blocos ` ```env ` das docs.
5. **Lint de slugs de modelo:** todo `provedor/modelo` citado nas docs precisa existir em `config.py`.
6. **Validador da wiki ampliado:** confere caminhos `src/...` citados e âncoras com acento. O conjunto roda num **job de CI** a cada PR.

### Conteúdo novo
- **Quickstart de 5 minutos** no topo do README, com 4 comandos.
- Seção **"O que é / o que não é"** no README: não é um NLE final, não envia originais à nuvem e não tem autenticação.
- **Tabela de status por recurso**, com os níveis Estável, Beta e Planejado, no lugar dos bullets de "Recursos".
- **"Primeiros 15 minutos"** na wiki: ingerir 3 clipes, transcrever, montar e exportar OTIO.
- **Receitas:**
  - entrevista com B-roll em 10 minutos;
  - versão vertical 9:16 usando as máscaras e as margens novas;
  - limpar áudio com vento;
  - achar todos os planos de uma pessoa;
  - estimar o custo antes de um lote grande.
- **Trilhas "Vindo do Premiere / Resolve / FCP / Kdenlive"**, com tabela de equivalências gerada do keymap.
- **Troubleshooting por sintoma.** Exemplos de entrada:
  - "Não consigo mover o clipe": verificar Track Lock, Sync Lock ou In/Out.
  - "O player está cortando a imagem": a máscara está ligada.
  - "Os rostos não aparecem": usar `Ctrl+Alt+B`.
- **Página "O que sai da sua máquina":** mapa de privacidade por provedor (OpenRouter, AssemblyAI, Deepgram, Auphonic, TypeSafe).
- **ADRs curtos.** O `config.py` já registra decisões que caberiam aqui: a volta ao Gemini por causa dos erros 504 do Nemotron `:free`, e os embeddings multilíngues no lugar do MiniLM.
- **"Novidades" e CHANGELOG** gerados dos commits `feat(...)`.
- **Glossário com níveis** Básico, Editor e Técnico. Cada verbete ganha "No dia a dia" e "No código", mais "Veja também", e as páginas 01 a 17 passam a linkar o glossário.
- **GIFs de 5 a 10 segundos**, capturados com o Playwright já instalado:
  - ingestão;
  - busca visual;
  - ghost clips;
  - trava de pista;
  - camada facial.
- **README como vitrine.** O manual de recursos (cerca de 350 linhas) e o troubleshooting (cerca de 120) passam para a wiki.

---

## 6. Situação após as correções (29/10/2026)

Aplicado na branch `claude/docs-multiagent-analysis-o5drof`:

- **README:** vira vitrine enxuta, de 65 KB para 15 KB.
- **USER_MANUAL:** voltado só ao usuário final, com os 4 recursos novos.
- **Wiki:**
  - 02 e 15 reescritas a partir do código;
  - 16 organizada por sintoma;
  - 10, 07 e 11 corrigidas;
  - nova página 19, "Primeiros 15 minutos e Receitas".
- **Glossário:** 94 verbetes, todos com nível, caminhos e funções conferidos no código.
- **Geradores:** atalhos (`scripts/gerar_atalhos.mjs`, com cartões A4 em `docs/usuario/atalhos/`) e rotas da API (`scripts/gerar_docs_api.py`, 190 rotas).
- **Verificação:** `scripts/verificar_docs.py` roda no CI (`.github/workflows/docs.yml`) e hoje termina com **0 problemas**. O `validate_wiki_glossary.py` passa nos 68 testes.
- **Índice:** criado `docs/README.md`. As referências do código a planos inexistentes foram corrigidas, alterando só comentários.
- **Dockerfile:** passa a instalar `git`, de que a dependência CLIP via `git+https` precisa.

### Pendências para o autor

- O `.gitignore` ignora `docs/PLANO_*.md`, `docs/HANDOFF_*.md` e `docs/Pesquisas/`. Os planos citados no código e marcados como "não versionado" provavelmente estão só na máquina local. Decida se eles devem ser versionados.
- A versão oficial de Python ainda não está definida. As docs dizem "3.12 recomendado, < 3.14".
- **Capturas e GIFs:** a lista do que falta está em `docs/images/README.md`.
- **A confirmar na UI:**
  - O tooltip de `Ctrl+Alt+G` diz "opções", mas o código alterna a máscara.
  - Não há botão Solo nas pistas.
  - Não há filtro de biblioteca por pessoa.
  - As docstrings de rostos citam YuNet + SFace, enquanto o backend usa SCRFD + ArcFace.
- **RTF do DPDFNet:** o código registra 0,82 em `audio_denoise.py` e 0,71 em `settings_registry.py`.
- **Glossário, eixo 6:** os conceitos de cor ainda não implementados (LUT, Color Wheels, White Balance) estão marcados com status. Falta decidir se ficam assim ou saem.
- **`walkthrough.md`:** candidato a `docs/arquivo/` como diário histórico.
- **Reorganização de `docs/` em subpastas:** não foi feita. Exige atualizar as referências em `src/`, `scripts/` e `tests/`.
