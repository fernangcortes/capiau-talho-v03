# Novos Planos e Pesquisas Extraídos das 5 IAs do Navegador (16/11/2026)

> Consolidação das conversas, artefatos e automações encontrados no Chrome Dev (**Claude / Claude Code**, **Perplexity**, **DeepSeek**, **ChatGPT** e **Qwen**) em 16/11/2026, para auditoria cruzada contra o código-fonte atual (`main` em `7e82b92`) e os demais planos em `docs/`.

---

## 1. Auto-otimização de Prompts & Contratos de Personas — MASS (`arXiv:2610.12176`)

* **Origem:** Claude Code — [`ArXiv paper butcher shop analysis`](https://claude.ai/code/session_01RmQL55ANUemK5jHLU83kzA) (branch citada: `ccr-712c309b-cxlyit`, não mergeada; rascunho não enviado na caixa: *"faça o plano em docs com os itens 1, 2 e 5"*).
* **Resumo técnico:**
  1. **Laço interno de otimização no `PROMPT_REGISTRY` (`src/nlp/prompt_registry.py`):** rotina offline em projeto de referência que gera variações de prompts (`triage`, `vision`, `enrichment_rewrite`, `theme_naming`, `video_summary`), compara A/B contra o prompt atual na mesma amostra de mídias e usa um LLM forte apenas como **otimizador** (gargalo segundo o artigo), mantendo o modelo barato em produção.
  2. **Editor humano como avaliador gratuito:** em vez de autoavaliação por LLM (~73% de acerto no modelo base), usar aceitação/rejeição de sugestões da IA e correções humanas (`triage_feedback`, temas, títulos) como sinal de comparação em pares.
  3. **Guarda contra regressão:** nenhuma versão nova de prompt vira padrão sem vencer a atual num conjunto fixo de mídias de teste, mantendo rollback imediato.
  4. **Contratos e *hops* entre personas (`src/services/timeline_ai.py`):** definir contratos estruturados entre `TIMELINE_PERSONAS` (`diretora -> {arco, lacunas_narrativas}` → `montadora -> {INSERT/DELETE/REPLACE, motivo}` → `sound_designer -> {revisão de J/L-cuts}`).
  5. **Torneio em pares com Bradley–Terry:** para escolher entre múltiplos candidatos (nomes de temas em `_name_clusters_llm`, sinopses, títulos em lote), mais estável que nota 0–10.

---

## 2. Micro-Renders Híbridos, GPU na Nuvem (BYOK + Self-Hosted) & Blender via MCP

* **Origem:**
  * Claude — [`Capiau talho repository`](https://claude.ai/chat/151beaed-07bc-46c9-b3c1-ea131ca3e569) (10/10) + artefatos *Catálogo de efeitos pesados em GPU na nuvem (2025–2026)* e *Micro-renders híbridos no CapIAu: viabilidade técnica e econômica*.
  * Qwen — [`Efeitos Pesados Open Source`](https://chat.qwen.ai/c/be87a0fe-8aa2-4962-bbc2-ffcc875263d7).
* **Resumo técnico:**
  * **Licença e modelo de custeio:** manter **`GPL-3.0-or-later`** (compatível com MIT/BSD/Apache/LGPL/GPL/AGPL; ferramentas externas chamadas via subprocesso/HTTP). Usuário paga sua própria GPU via **BYOK** (RunPod, Modal, Vast.ai) ou roda o container como **worker autohospedado** (PC com GPU de colega, coletivo ou cluster UEG com 7 PCs × 16 GB VRAM).
  * **Catálogo em duas vias:**
    * *Via padrão (permissiva):* **SeedVR2-3B/7B** (Apache-2.0 — validar `LICENSE` na fonte) / **FlashVSR** / **Real-ESRGAN** (upscale); **Practical-RIFE 4.25** (MIT) e **FILM** (slow-mo em grandes deslocamentos); **SAM 2 / 2.1** (Apache-2.0) + **Cutie** (MIT) para máscaras leves PNG/EXR alfa; **Gyroflow CLI** (GPL-3.0) + `vidstab` / `Deep Online Fused Video Stabilization` (estabilização).
    * *Via NC isolada (download à parte com aviso, pois filme comercial/festival viola peso NC):* **ProPainter** / **LTX Video Inpainting** (remoção de boom, tripé, logos), **MatAnyone**, **CodeFormer** / **BVFR** (`face_focused_blend` em material de arquivo), **CoTracker3**, **DepthCrafter**.
  * **Blender headless + MCP (`blender-mcp` / Blender Lab v1.0.x):** agente usa MCP para criar cenas, *depth maps*, máscaras de oclusão ou assets 3D (`Hunyuan3D` / Poly Haven) em container efêmero isolado; render em lote roda com `blender -b` sem MCP.
  * **Regra de rede e motor de decisão:** nunca subir ProRes/intermediários; recortar GOPs da fonte original comprimida (`SHA-256`), medir banda com probe de 10 MB + microbenchmark local de 8–16 quadros (`local viável | local lento | remoto obrigatório`) com UI estilo Topaz (*tempo estimado + custo*), usando Cloudflare R2 (egress zero) no retorno.
  * **Ética documental (Archival Producers Alliance):** rotular tudo gerado/restaurado por IA, preservar original e proibir síntese em material com valor de prova.

---

## 3. Onda Lateral da Biblioteca (`onda-lateral.html`) & Índice de Sequência

* **Origem:**
  * Claude Code — [`Menu lateral para biblioteca de mídias`](https://claude.ai/code/session_01KKapd47KWnXHaULFtEfxUo) + Artefato [`Onda Lateral da Biblioteca`](https://claude.ai/artifact/6bjgfEkqFEyc1XX8AJmvMR) (`onda-lateral.html`, 1.279 linhas, branch `ccr-63e58089-4mr3t5`, publicado em 12/11).
  * DeepSeek — [`Configuração UXP OTIO`](https://chat.deepseek.com/a/chat/s/cfbd3f1a-38cc-4e3e-85f2-b337c2f55550) (Sequence Index).
* **Resumo técnico:**
  * **Onda Lateral:** transformar a coluna barra de 36 px da Biblioteca (`src/ui/js/panelRail.js`) num trilho estilo dock/lupa com slots numerados e miniaturas flutuantes ao passar o mouse (sem empurrar o layout). Há **69 maquetes interativas** cobrindo **20 perguntas de design** aguardando resposta do usuário.
  * **Índice de Sequência (*Sequence Index*):** painel tabular filtrável/pesquisável dos clipes da timeline (mídia offline, flash frames, transições, trilhas mutadas, marcadores por cor/nome) com exportação CSV e salto direto ao corte.

---

## 4. OCR Local em Vídeo (Claquete + Letreiros) & Dossiê Compilado (`visual_memory.md`)

* **Origem:** Claude — [`Aproveitamento de repositório para projeto Capiau`](https://claude.ai/chat/45a885ff-d6d9-40f7-876b-850b8ad1552e) (20/10, analisando `vaibhav-space/vindex`); Qwen — [`Media Asset Management Innovations`](https://chat.qwen.ai/c/d596ad19-9469-42c4-b74c-30fdb95694b1).
* **Resumo técnico:**
  * **PP-OCRv6 via RapidOCR 3.9 (ONNX Runtime / OpenVINO, Apache-2.0, CPU):**
    * Detector `tiny` (~0,20s/frame) nos keyframes para detectar presença de texto;
    * Reconhecedor `small` (~0,60s/frame, 50 idiomas incluindo `pt`) apenas onde há texto (93,2% contra 80,6% de Qwen3-VL em fidelidade literal sem autocorrigir grafias);
    * **Varredura de claquete:** 2–3 fps apenas nos primeiros/últimos ~5s do clipe; enviar ao Gemini apenas frames com texto que exijam parsing estruturado (`cena`, `plano`, `take`);
    * Otimizações de `videocr`/`VideOCR`: pular frame por `dHash` e recortar região antes do OCR.
  * **Artefato compilado por mídia (`visual_memory.json` + `visual_memory.md`):** dossiê legível unificado (falas, shots, descrições, rostos, OCR) para o servidor MCP ler numa única consulta.
  * **Cache versionado & golden fixtures:** chave `(sha256 + model + config + schema_version)` para evitar reprocessamento pago duplicado; *golden fixtures* (`syrupy`) no CI contra deriva de parsing.

---

## 5. Grafo de Decisões Calibradas vs. Prompt Único + `talho-bench`

* **Origem:** Perplexity — [`Grafo de Decisões para Edição de Vídeo com IA`](https://www.perplexity.ai/session/88fe0744-6504-4f18-81d4-4d158d5453a7) (18/09) e [`Avaliação do Typesafe para Agente de Vídeo com IA`](https://www.perplexity.ai/session/4075e6b5-27b5-4df4-9b10-fdd038a66b29); DeepSeek — [`Jev RLCD no agente`](https://chat.deepseek.com/a/chat/s/9b2f3c2b-c436-4c4b-9fc1-ec8d4184268a).
* **Resumo técnico:**
  * **Decomposição atômica + fan-out em 1 chamada:** usar portões baratos `Noul` (`claquete`, `fala_aproveitavel`, `audio_condenado`) antes de `Score`/`Choice`, persistindo probabilidades por *beat* no SQLite. Permite reordenar cortes offline em milissegundos trocando apenas o vetor de coeficientes (`OBSERVACIONAL` vs `MAKING_OF`), sem chamar API novamente.
  * **Montagem dialogada via HMM + Viterbi (*RoughCut*, SIGGRAPH 2017 / Galvane & Ronfard):** usar os rótulos estruturados de cada beat como observações para programação dinâmica na sequência de entrevistas.
  * **`talho-bench` (pronto no Perplexity, ZIP + README):** 30 trechos em PT-BR anotados propriedade por propriedade; no fan-out já validou **8.274 vs. 50.400 tokens** de entrada e concentração de acertos por confiança (25% abaixo de `0.50` vs. 88,5% acima), pronto para rodar contra `qwen2.5:14b`/Ollama ou APIs e validar 150 *beats* reais (`fala_aproveitavel`).

---

## 6. Aprendizado Editorial Contínuo ("Editorial DNA" / Etapa 5 — `src/patterns/`)

* **Origem:**
  * ChatGPT — [`Organizar análise do repositório`](https://chatgpt.com/c/6a83f4a3-e590-83e9-9313-40fe32f59d13) (18/08) e [`Integração ML para Edição`](https://chatgpt.com/c/6a661f3b-9368-83e9-b28a-c87a09db115c) (26/07).
  * Qwen — [`ML para Padrões de Edição Automatizados`](https://chat.qwen.ai/c/2dabd206-0700-4ad5-9b4b-526eafcbd672) e [`Integração de ML`](https://chat.qwen.ai/c/b69c9adc-3983-4b25-ad39-211de410c01d).
  * DeepSeek — [`Analise ML para padroes edicao`](https://chat.deepseek.com/a/chat/s/ba4c5913-b78d-413f-bd2c-f7637234e6cd).
* **Resumo técnico:**
  * **3 níveis isolados:** `Projeto` (este filme) → `Estilo` (documentário / making of / observacional) → `Editor` (*Editorial DNA*), evitando contaminar preferências permanentes com escolhas de um único filme.
  * **Aprender pelo *delta*:** registrar a diferença entre o bloco proposto pela IA e o corte final realmente ajustado pelo editor (duração, J/L-cut, tipo de plano, transição).
  * **Escada incremental em 5 níveis:** (1) Estatística descritiva de timelines finalizadas (`ASL`, J/L-cuts, transições) → (2) Ranking de candidatos → (3) Recomendação dos 3 próximos planos → (4) Predição sequencial (encoding 8 dimensões estilo AVE com *soft-labels* via CLIP zero-shot / TinyLSTM) → (5) Rough Cut.
  * **Unificação do ecossistema CapIAu:** integrar `CapIAudio` (captura/claquete/marcadores em set), `facevision-hub` (cascata facial), `capIAu-play` (revisão por timestamp como feedback loop) e `CapIAu-Talho`.

---

## 7. Visualizações de Acervo (5 Gráficos Operacionais) & Knowledge/Evidence Graph

* **Origem:** Claude — [`Análise de grafo Obsidian para projeto Capiau`](https://claude.ai/chat/35bcc8c2-12da-4de5-abfb-d5537af56692) (19/08); ChatGPT — [`Análise Do Obsidian Graph`](https://chatgpt.com/c/6a853cbc-f8d4-83e9-a4cd-eca1920c91e6) (19/08); Qwen — [`Obisidian Graph`](https://chat.qwen.ai/c/c374455a-0fa7-41be-9a65-6fa22baa7c24).
* **Resumo técnico:**
  * Um grafo global estilo Obsidian sobre 7.042 vetores CLIP colapsa (~84k arestas) e joga fora a ordem temporal.
  * **5 visualizações superiores dentro da UI (sincronizadas via `BroadcastChannel` com o playhead):**
    1. **Matriz de Cobertura `Cena × Material`** (`111` cenas × facetas; célula = contagem + melhor score).
    2. **Mapa 2D dos embeddings CLIP com miniaturas** (`proj_x`/`proj_y` via `PCA + t-SNE` usando `scikit-learn` já instalado, evitando `umap-learn`/`numba`, com seleção em laço → `/api/media/batch-similar` e invalidação conjunta com `/api/search/reindex`).
    3. **Storyline / Arc Diagram de co-presença** (`scene.characters_json` + clusters faciais).
    4. **Swimlane temporal de proveniência** (diária × câmera/pasta × categoria).
    5. **Treemap `Categoria × Confiança`** (revela anomalias de alta confiança fora da fila por limiar, como 68% `cotidiano`).
  * **Obsidian / Grafo de Sentido:** reservar Obsidian (via URI bidirecional) para o grafo de sentido curado (~200 nós: `MEDIA`, `SEMANTIC`, `PEOPLE`, `STORY`, `EDITORIAL`), *Local Graph* (profundidade 1–2), *kNN* para merge facial e *Evidence Graph* investigativo usando a tabela `relation`.

---

## 8. Capitularização Automática Multimodal ("Divisores de Ato")

* **Origem:** Qwen — [`Capitularização de Vídeos com IA`](https://chat.qwen.ai/c/5fdcae0d-000b-4f03-b81f-f9a1d44a09c6); Perplexity `Radar semanal` (16/11: `PySceneDetect save-chapters`).
* **Resumo técnico:** Detectar fronteiras de capítulo em entrevistas longas combinando **silêncio (>3s) / troca de falante (diarização) + queda de similaridade semântica em janelas MiniLM + salto visual CLIP**, extrair palavras-chave locais via **TF-IDF (`sklearn`, custo zero)** e pedir ao LLM apenas o título curto (até 4 palavras). Exportar como **Markers** na régua do Canvas 2D, OTIO/Kdenlive e FFmetadata (`PySceneDetect save-chapters`).

---

## 9. Limpeza de Áudio CPU (`DeepFilterNet 3 ONNX` + `RNNoise`) & Diretor Musical

* **Origem:** Perplexity — [`Alternativas ao Auphonic`](https://www.perplexity.ai/session/ca404b1e-e3c1-4707-b39b-fafd26cc790d) (23/08); Qwen — [`IA para Pós-Produção de Áudio Barata`](https://chat.qwen.ai/c/80699d25-f495-4de9-bc8b-e9933b54485b); ChatGPT — [`Geração de Trilha Sonora`](https://chatgpt.com/c/6a4936f3-9710-83e9-a72e-6954ed120653) (04/07).
* **Resumo técnico:**
  * **Áudio local CPU-only:** separar 3 modos — **DeepFilterNet 3 ONNX** (~7× realtime em 1 núcleo, 48 kHz, padrão para diálogo), **RNNoise** (BSD, frames de 10 ms, modo econômico/preview) e **UVR/Demucs** (resgate experimental). Salvar `*_orig.wav` + versão tratada + JSON de auditoria; nunca automatizar denoise sobre ambiente/música/multidão sem revisão A/B.
  * **Diretor Musical / "Music Necessity AI" (futuro):** avaliar antes se a cena pede silêncio, função dramática, *Leitmotiv* por personagem e "Mapa de Respiração do Filme".

---

## 10. Radar Semanal de NLEs/IA no GitHub & Testes de Contrato MCP (até 16/11/2026)

* **Origem:** Perplexity — [`Radar semanal`](https://www.perplexity.ai/session/41edd6a0-cb65-5d4d-8fb3-02af4b6f2cc2) (16/11, 09/11, 02/11, 26/10) e [`Novos Repositórios de IA`](https://www.perplexity.ai/session/11611003-1a77-4a0a-9f84-d95a811a6548); DeepSeek — [`Testes regressivos para MCP`](https://chat.deepseek.com/a/chat/s/f1719414-e183-41d9-a98b-7954df3fcc80).
* **Achados acionáveis:**
  * **`tydude001/proofcut`:** validação **pós-render** (transcrever o MP4 exportado e conferir palavra por palavra contra a edição + frame count + loudness + end cards).
  * **`WeftCut/WeftCut` & `frankShan001/CutVoke`:** aba **Changes** (diff não aprovado) + leitura de playhead via MCP + `preview_compare` antes/depois sem confirmar edição.
  * **`KyaniteLabs/Kinocut` (Apache-2.0):** 196 tools FFmpeg com preflight, falha fechada e **"Video Receipts"** com hashes de proveniência.
  * **`OpenReel Video` (MIT) & `FilmCraft` (MIT/Apache-2.0):** registro único de comandos tipados compartilhado entre **UI, CLI, JSON e MCP**, com undo de turno inteiro da IA e preservação de pitch na velocidade.
  * **`k2-fsa/sherpa-onnx` (out–nov/2026, Apache-2.0):** **`fa-models`** (forced alignment local em C++/WASM), **`VoxLock`** (isolamento da voz-alvo), confiança por segmento na diarização e scripts ONNX para **Parakeet Ultra/Redux**.
  * **`jinqiu193/trace` (MIT, 05/11):** EmbeddingGemma 2 **int8 via ONNX** local indexando keyframes e segmentos de áudio com timestamp.
  * **`6v17/VideoSeek` (AGPL-3.0, 15/11):** remoção automática de **barras pretas estáticas** em vídeos verticais/letterbox antes de extrair embeddings.
  * **`FireRed-OpenStoryline` & `metiutek/editorvideo-ai` (MIT):** **Style Skills** reutilizáveis + separação de memória (`série × filme × skills`).
  * **`kajisho5/ffmpeg-skill` (v3.2.3, MIT):** fluxo `probe → editar → checar → verificar` e **smart cut frame-exato com reencode só nas bordas**.
  * **`AlexandreRL/claude-video-studio` (MIT):** ponte de comandos para **DaVinci Resolve Free**.
  * **`Breakthrough/PySceneDetect` (v0.7.3 + 16/11, BSD-3) & `modelscope/FunASR` (ONNX 0.4.11, MIT):** `save-chapters` para FFmetadata via `--stdin`; ingestão direta de áudio não-WAV sem arquivo intermediário.
  * **Testes de Contrato MCP:** **MCP Inspector**, **`@vexyo/core`** (*golden sets* de respostas canônicas), **`agent-regress`** e **`trip-test`** reaproveitando os autotestes existentes como base de contrato.

---

## 11. Ecossistema Satélite (Pesquisa Web, Hardware, Set e UEG)

* **Busca/download multi-fonte para B-roll** (DeepSeek [`APIs para busca de vídeos`](https://chat.deepseek.com/a/chat/s/65a5095f-ef18-49f7-b606-5837a9915027), Perplexity [`pesquisa API YouTube`](https://www.perplexity.ai/session/63d0eec6-12d6-4d9a-bc61-3ce4a0450d1e), Qwen [`Jornalismo + yt-dlp`](https://chat.qwen.ai/c/3d33b310-91f6-4589-bfc9-e552abc76b0a)): YouTube Data API v3, Vimeo API, Internet Archive API, Pexels/Pixabay, `yt-dlp`, Torznab/Jackett + TMDB, checagem factual (Loki) e anonimização automática.
* **Proxies automáticos no set via Wi-Fi** (DeepSeek [`Câmeras com proxy automático`](https://chat.deepseek.com/a/chat/s/eb0a74d6-f434-441d-8ea5-c1e4d8ff4c8d)): Atomos Zato CONNECT, Hollyland Vcore, Sony FX / RED enviando proxies H.264/H.265 direto ao corte do take.
* **Cluster local UEG (7 PCs × 16 GB VRAM) + `ceia-br/lumi-4b` + `Cactus-Compute/needle2`** (DeepSeek [`Lumi 4B`](https://chat.deepseek.com/a/chat/s/c99ae859-a8c1-4e74-98ab-6a7fec24ec2f), Perplexity [`needle2`](https://www.perplexity.ai/session/b8f438bc-1dd9-4700-83b9-2d692cc05a61)): pré-processamento PT-BR / anonimização local e micro-roteador HTTP local de tool calling.
* **Projetos irmãos UEG/CriaLab:** MAM institucional 100 TB (`OxiMedia MAM` / `Eyevinn Open VideoCore` / `ResourceSpace`, DeepSeek [`MAM CriaLab`](https://chat.deepseek.com/a/chat/s/a4305164-4cf5-4604-9404-462da6d6880f)) e App Android Comunicador de Set v0.7 (Claude [`Aplicativo comunicador`](https://claude.ai/chat/98304247-b0b5-4115-b929-a47d502dc1da)).
