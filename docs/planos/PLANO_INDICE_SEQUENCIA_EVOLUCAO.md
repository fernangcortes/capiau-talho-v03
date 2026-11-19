# Plano de Evolução em 5 Ondas — Índice de Sequência (*Sequence Index*)

> **Base atual (`main` @ `2cac41f`):** **Estágio 2A concluído** ([`src/ui/js/sequenceIndex.js`](../../src/ui/js/sequenceIndex.js), aba nativa `tabpanel-index` em [`tabPanels.js`](../../src/ui/js/tabPanels.js) / [`dockModel.js`](../../src/ui/js/dockModel.js) / [`workspaceManager.js`](../../src/ui/js/workspaceManager.js), layout responsivo `@container seq-index` em [`styles.css`](../../src/ui/styles.css) e suíte [`tests/autoteste_sequence_index.mjs`](../../tests/autoteste_sequence_index.mjs)).
> **Bússola mestra:** [`GRANDE_PLANO_UNIFICADO_2026-11.md`](./GRANDE_PLANO_UNIFICADO_2026-11.md) (Estágios `0` a `7`).
> **Regra de execução para próximos chats:** este documento **não cria uma trilha paralela nem antecipa infraestrutura**. Cada onda abaixo encaixa exatamente na etapa do Grande Plano Unificado que entrega seus dados, APIs ou estruturas sem retrabalho.

---

## 1. Princípios Arquiteturais Inegociáveis

1. **Leitura única via fachada `TIMELINE_STATE` (`1A`):** toda linha, resumo e cálculo sobre a timeline continua lendo exclusivamente de `TIMELINE_STATE` e `STATE` — garantindo compatibilidade automática quando entrarem múltiplas abas (`2D` / Task 25) e Timelines Clone da IA (`3B`). Nunca manter cópia mutável própria dentro do painel do Índice.
2. **Mutações em lote sempre atômicas (`TIMELINE_HISTORY`):** o Índice v1 (`2A`) nasceu estritamente somente leitura + seleção/salto. A partir da Onda I (`2A.2`), qualquer edição disparada pela tabela (trocar cor em lote, desativar/excluir múltiplos clipes, fechar micro-gaps, unir *through edits*, marcar checklist ou aceitar/descartar diffs da IA) deve envolver todas as alterações numa **única transação `TIMELINE_HISTORY.record(...)`** (1 único `Ctrl+Z` desfaz a operação inteira).
3. **Desempenho 60 fps & zero N+1 HTTP:** detectores estruturais (offline, flash frames, micro-gaps, through edits, frames duplicados, dessincronia A/V, mismatch básico de FPS/resolução) rodam síncronos em JavaScript sobre os arrays em memória. Qualquer dado pesado de SQLite, disco ou Qdrant entra via **um único endpoint modular sob demanda** (`POST /api/timeline/index-enrich`), solicitado em *chunks*/seções opt-in e invalidado por hash/versão da sequência.
4. **Aderência total ao Design System NLE:** densidade adaptativa via `@container seq-index`, uso exclusivo de tokens neutros `--t-*` e `--accent` para foco/agulha/seleção, suporte integral a janela destacada (*pop-out* em segundo monitor) e zero modais ou barras que cubram a timeline.

---

## 2. Benchmark NLE × Diferenciais Exclusivos do CapIAu-Talho

Os grandes editores comerciais resolveram a navegação tabular da timeline, mas permanecem presos à camada **mecânica** (nomes de arquivo, timecodes, rótulos, efeitos). O CapIAu-Talho já produz no SQLite ([`src/db/schema.py`](../../src/db/schema.py)) e no Qdrant metadados **semânticos e técnicos** (fala palavra por palavra, medição real de LUFS/True Peak, rostos, escala de plano, movimento de câmera, triagem e roteiro) que permitem ir muito além:

| Capacidade | DaVinci Resolve (*Edit Index*) | Premiere Pro 26.2+ (*Sequence Index*) | Final Cut Pro (*Timeline Index*) | CapIAu-Talho (`2A` atual + Ondas `I–V`) |
| :--- | :--- | :--- | :--- | :--- |
| Lista cronológica pesquisável + salto em 1 clique | Sim | Sim | Sim | ✅ Entregue (`2A`) |
| Alertas de mídia **offline**, trilhas mutadas e clipes desativados | Parcial | Sim | Via *Roles* | ✅ Entregue (`2A`) |
| Detecção de ***flash frames*** e **dessincronia A/V** no índice | Sem filtro unificado | Flash frames sim; sync fora | Não | ✅ Entregue (`2A`, `≤ 5f` + `SYNC ±Nf`) |
| *Seguir agulha* + janela destacável + exportação `.csv` | Sem destaque fluido | Sim | Sem destaque | ✅ Entregue (`2A`) |
| **Micro-gaps**, **Through Edits** (com *Unir*), **Duplicate Frames** e **Mismatch técnico** | Espalhados fora | Espalhados fora | Não | 🎯 **Onda I (`2A.2`)** |
| **Seleção múltipla + ações em lote** (1 Undo) + **Marcadores *To-Do*** + **Revisão de Títulos** + **Soma de duração** | Limitado na *Edit* | Sem *To-Do* / lote | **Sim** (`Cmd`/`Shift`, *To-Do*, *Titles*) | 🎯 **Onda I (`2A.2`)** |
| **Saúde Sonora** (`CLIPPING`, `SALTO LUFS`, `FALA SEM TRAT.`) + **Music Cue Sheet** | Separado no Fairlight | Não mede LUFS no índice | Não | 🎯 **Onda II (`2B-idx`)** |
| **Diff interativo da IA / Clone**, **`PALAVRA CORTADA`** (*Mid-Word Cut*), **`ORIGINAL OFF`** no HD e **Roteiro Pós-Montagem** | ❌ Inexistente | ❌ Inexistente | ❌ Inexistente | 🎯 **Onda III (`3B-idx`)** |
| **`LOG SEM COR` / `HDR→SDR`**, **Revisão de Legendas (42×2 / 17 cps)** e **`FALA SOBREPOSTA`** | ❌ Inexistente | Filtro simples de texto | Captions tab | 🎯 **Onda IV (`4A/4B/4C-idx`)** |
| **Busca Semântica na sequência**, **Cobertura de Roteiro**, **Ritmo Visual / *Jump Cut*** e **Tempo de Tela / Planilha de Direitos de Imagem** | ❌ Inexistente | ❌ Inexistente | ❌ Inexistente | 🎯 **Onda V (`5A–5E-idx`)** |

---

## 3. Mapa de Dependências & Ordem Lógica (Alinhado ao Grande Plano)

```text
==================================================================================================
   ONDE CADA ONDA DO ÍNDICE SE ENCAIXA NO GRANDE PLANO UNIFICADO (SEM RETRABALHO)
==================================================================================================

  [1A] TIMELINE_STATE + [2A] Sequence Index Base ✅ (2cac41f)
         │
         ├──► ONDA I (2A.2 · 100% Frontend)
         │       Micro-gaps · Through Edits · Duplicate Frames · Mismatch FPS/Res · fora_do_projeto
         │       Seleção múltipla + Ações em lote (1 Undo) · Marcadores To-Do · Títulos · Soma/Colunas
         │
         ├──(após 2B: audioCadeia.js + Frente F)──► ONDA II (2B-idx · Áudio & Cue Sheet)
         │       Endpoint base POST /api/timeline/index-enrich (seção "audio")
         │       CLIPPING · SALTO LUFS · FALA SEM TRAT. · Automação/Ducking · Preset Music Cue Sheet
         │
         ├──(após 2D + 3A + 3B: Abas + MCP + Clone IA)──► ONDA III (3B-idx · IA, Palavra & HD)
         │       Modo Diff da IA (unifica aba Changes) · Tool MCP get_sequence_index_alerts
         │       PALAVRA CORTADA (transcript) · Trecho falado · ORIGINAL OFF · As-Broadcast Script
         │
         ├──(ganchos no Estágio 4: 4A / 4B / 4C)──► ONDA IV (4A/4B/4C-idx · Cor, Legenda & Overlap)
         │       4A: LOG SEM COR / HDR→SDR  ·  4B: Aba Legendas (42×2 / 17 cps)  ·  4C: FALA SOBREPOSTA
         │
         └──(após 5A / 5C / 5E: Busca, Capítulos/Roteiro & ArcFace real)──► ONDA V (5A–5E-idx)
                 5A: Busca Semântica dentro da sequência + Repetição Semântica
                 5C: Cena / Capítulo + Cobertura de Roteiro + Diagnóstico Ritmo / Jump Cuts
                 5E: Tempo de Tela + Planilha de Direitos de Imagem (Clearance) sobre ArcFace 512-d
==================================================================================================
```

### Por que esta ordem é obrigatória? (O que quebraria se antecipássemos?)

| Onda | Por que NÃO fazer antes do estágio correspondente? |
| :--- | :--- |
| **Onda I (`2A.2`)** | Não depende de backend novo: aproveita diretamente `TIMELINE_STATE`, `TIMELINE_HISTORY` (`1A`) e campos já carregados em `STATE.allVideos`. Único cuidado: se o projeto ainda tiver só 1 timeline antes da Task 25 (`2D`), respeitar sempre `SEQUENCE_MANAGER.getActiveSequence()` para não quebrar as abas depois. |
| **Onda II (`2B-idx`)** | Sem o `2B` concluir `clip.keyframes.volume` (`Frente F`) e consolidar a medição/render de áudio, alertas de `SALTO LUFS` e `CLIPPING` ignorariam ganhos dinâmicos de automação/ducking e dariam falsos positivos na tabela. |
| **Onda III (`3B-idx`)** | Fazer o modo *Diff* antes de `2D` (Abas) + `3B` (Timeline Clone IA + Undo atômico por turno) obrigaria criar uma estrutura temporária que seria jogada fora ao conectar clones e MCP (`3A`). Já a checagem de original no HD deve reaproveitar a lógica real de preflight de [`narrative.py`](../../src/api/routes/narrative.py) em vez de duplicar regras de caminho. |
| **Onda IV (`4A/4B/4C-idx`)** | Sem `4A` (`src/media/capacidades.py`), `4B` (blocos de legenda `Frente C` com regra 42×2 / 17 cps) e `4C` (`fa-models` gravando timestamps finos e `dialogue_utterance`), cada coluna teria que ser reescrita duas vezes. |
| **Onda V (`5A–5E-idx`)** | **Crítico:** sem o **Estágio `5A`** o Qdrant em `semantic.py` ainda tem gargalos de paginação/payload; sem o **Estágio `5C`** não existe `scene_media` nem `media_chapter`; e sem o **Estágio `5E`**, `local_backend.py` usa fallback Sobel/SFace impreciso — uma planilha de direitos de imagem baseada em reconhecimento facial impreciso geraria risco jurídico e retrabalho manual ao editor. |

---

## 4. Especificação Detalhada das 5 Ondas

### Onda I (`2A.2`) — QC Mecânico de Elite, Lote, *To-Do* & Revisão de Títulos
* **Encaixe no Grande Plano:** Estágio 2 (pode rodar após `2C`/`2D` ou em qualquer janela livre antes de `2B`, como bloco puramente frontend).
* **Pré-requisitos já satisfeitos:** `1A` (`TimelineSequenceState` + `TIMELINE_HISTORY`) e `2A` (`src/ui/js/sequenceIndex.js`).
* **Detectores puros novos em [`src/ui/js/sequenceIndex.js`](../../src/ui/js/sequenceIndex.js):**
  * **Micro-gaps (`GAP ≤5f`):** varrer clipes ordenados por `timelineInFrame` dentro de cada pista (`trackId`); quando `0 < proximo.timelineInFrame - anterior.timelineOutFrame <= FLASH_FRAME_MAX_FRAMES`, gerar linha sintética `entryType: "gap"` com badge âmbar `GAP Nf` e ação pontual **Fechar gap** (deslocando em *ripple* ou estendendo o corte conforme política da pista).
  * **Through Edits (`CORTE INÚTIL`):** entre dois clipes contíguos da mesma pista (`a.timelineOutFrame === b.timelineInFrame`), mesmo `video_id`, mesmo `speed`/`reverse`/`disabled`, sem transição no ponto e com `a.outFrame === b.inFrame`, acender badge `CORTE INÚTIL` e botão **Unir corte** em 1 clique.
  * **Duplicate Frames (`DUPLICADO`):** detectar interseção de `[inFrame, outFrame)` entre duas ou mais ocorrências do mesmo `video_id` na sequência ativa (permitindo ignorar se estiverem vinculadas por `link_id` V+A do mesmo take), sinalizando em quais timecodes o plano já apareceu.
  * **Mismatch Técnico (`FPS/RES`) & Triagem (`FORA DO PROJETO`):** comparar `video.fps` / `video.resolution` em `STATE.allVideos` contra `TIMELINE_STATE.fps` / `width`×`height` (ex.: tomada `29.97 fps` ou vertical numa sequência `24 fps 16:9`); acender badge rosa **`FORA DO PROJETO`** quando `Boolean(video.fora_do_projeto)` for verdadeiro.
* **Seleção múltipla & Ações em lote (inspirado no Final Cut Pro):**
  * Checkbox por linha + `Ctrl`/`Shift` + clique na tabela sincronizados com `TIMELINE_STATE.selectClips(ids)`.
  * Barra contextual fixa no rodapé da aba (aparece só com `>= 2` itens ou filtro de lote ativo): **Aplicar rótulo de cor** (`setClipColorLabel`), **Desativar / Ativar**, **Remover da timeline**, **Remover Flash Frames selecionados** e **Unir Through Edits**, sempre dentro de 1 único `TIMELINE_HISTORY.record(...)`.
* **Marcadores *To-Do* (Checklist de Direção):**
  * Estender `addMarker` e `updateMarker` em [`src/ui/js/timelineState.js`](../../src/ui/js/timelineState.js#L1827-L1930) com campos retrocompatíveis `kind: "standard" | "todo"` e `completed: false` (sem quebrar projetos salvos que não têm essas chaves).
  * Na tabela do Índice: chip/filtro **`To-Do Pendentes`**, checkbox inline para concluir/reabrir marcador sem sair da lista e atalho de teclado para avançar ao próximo pendente.
* **Modo Revisão de Títulos, Navegação por Teclado & Produtividade:**
  * Filtro **`Títulos`** (pista `T` / `mediaKind === "text"`): setas `↑`/`↓` navegam pelos letreiros movendo o playhead; `Enter` / duplo clique abre edição rápida do texto ou foca o Inspetor de Títulos.
  * **Somatório de duração no rodapé:** além de *"X de Y itens"*, exibir duração líquida dos clipes filtrados (sem contar dupla duração de V1+A1 vinculados com mesmo `link_id`) em `HH:MM:SS:FF`.
  * **Colunas configuráveis + Micro-miniatura opcional:** popover com persistência em `localStorage` para ligar/desligar colunas (`Fonte IN/OUT`, `Notas`, `Cor`, `Miniatura`), utilizando `/api/video/{video_id}/thumbnail-at` sob demanda apenas quando a coluna *Miniatura* estiver ativa e somente para linhas visíveis.
* **Critério de aceite & testes:** expandir [`tests/autoteste_sequence_index.mjs`](../../tests/autoteste_sequence_index.mjs) cobrindo micro-gaps, through edits, frames duplicados, mismatch técnico, `fora_do_projeto`, lote em 1 único `undo()`, checklist *To-Do* e somatório de duração filtrada.

---

### Onda II (`2B-idx`) — Saúde Sonora & *Music Cue Sheet*
* **Encaixe no Grande Plano:** acoplada à entrega do **Estágio `2B` (Áudio Completo com Paridade)**, após `audioCadeia.js` + `Frente F` (`clip.keyframes.volume` e ducking determinístico).
* **Base de dados/rotas existentes:** tabela `audio_render` (`analysis_json` com `lufs_i`, `lra`, `true_peak_db`) e coluna `video.natureza` / categorias de áudio já usadas em [`src/api/routes/media.py`](../../src/api/routes/media.py#L1992).
* **Entregas desta onda:**
  * Criar o contrato inicial do endpoint em lote `POST /api/timeline/index-enrich` (aceitando nesta onda `sections: ["audio"]`) para devolver métricas medidas de `audio_render` + natureza sonora de todos os `video_id`/intervalos da sequência numa única consulta SQLite.
  * Cruzamento no frontend com o ganho estático do clipe e os pontos de `clip.keyframes.volume` (`Frente F`):
    * **`CLIPPING`:** verdadeiro pico estimado (`true_peak_db + ganho_efetivo_db`) `> -1.0 dBTP`.
    * **`SALTO LUFS`:** variação `>= 6 LUFS` entre dois clipes contíguos de fala (`fala`/`interview`) na mesma pista ou trilhas de diálogo.
    * **`FALA SEM TRAT.`:** clipe de fala com ruído de fundo elevado sem cadeia `audio_render` aplicada.
  * Filtro **`Saúde do Áudio`** na barra de chips do Índice e **Preset de Exportação `Music Cue Sheet (.csv)`** (filtrando ou isolando clipes de natureza `trilha`/`música`, com Nome, Fonte, Entrada/Saída na Timeline, Duração exata por entrada e Tempo Total por faixa).

---

### Onda III (`3B-idx`) — *Diff* Interativo da IA, *Corte na Palavra*, *Original Off* & Roteiro Pós-Montagem
* **Encaixe no Grande Plano:** executada junto com os **Estágios `3A` (Registro Único `src/tools/` + `/mcp`) e `3B` (Timeline Clone + `D1–D6`)**.
* **Por que aqui é o momento exato:** evita duplicar UI construindo uma aba *Changes* separada no `3B` para depois refazê-la no Índice. O modo *Diff* nasce integrado diretamente no Índice.
* **Entregas desta onda:**
  1. **Modo `Diff da IA` (estendido em `sequenceIndex.js`):**
     * Compara a sequência ativa contra sua sequência-mãe (quando a aba ativa for uma **Timeline Clone**) ou compara `cuts` × `ghostTrack` (`D1–D6` corrigidos).
     * Exibe badges `+ INSERIDO`, `~ APARADO (Δf)`, `↔ MOVIDO`, `- REMOVIDO`, saldo líquido de duração (ex.: `-00:01:14:00`) e botões **Aceitar / Descartar** por linha ou lote integrados ao Undo atômico por turno da IA (`3B`).
  2. **Ferramenta MCP `get_sequence_index_alerts` (`3A`):**
     * Registrar em `src/tools/` (compartilhada entre REST/Chat/MCP) uma tool tipada que consulta os diagnósticos estruturais do Índice para o agente e os 5 harnesses externos auditarem a sequência antes de responder ao usuário ou disparar um render.
  3. **Seção `"transcript"` no `POST /api/timeline/index-enrich` (*Corte no Meio da Palavra* & Trecho Falado):**
     * Cruza os intervalos `[in, out]` de cada corte contra a tabela `transcript` (`word`, `start_time`, `end_time`, `speaker_id`).
     * Acende o badge **`PALAVRA CORTADA`** (*Mid-Word Cut*) quando `in` ou `out` recair estritamente dentro de `(word.start_time + tolerância, word.end_time - tolerância)`, exibindo na nota a palavra exata aparada (ex.: `…histó[ria]`) e devolvendo os timecodes corretos para ajuste fino.
     * Preenche na linha o **trecho de abertura/fechamento falado** (`"A gente guardava tudo … cada disco"`) para o montador ler a sequência como roteiro contínuo.
  4. **Seção `"disk"` no `POST /api/timeline/index-enrich` (`ORIGINAL OFF`):**
     * Reutiliza a lógica de verificação de disco já implementada no preflight de [`src/api/routes/narrative.py`](../../src/api/routes/narrative.py#L1193) (`_contexto_preflight`), retornando `original_available: false` para clipes cujo proxy roda leve, mas o original está em HD externo desconectado — gerando badge **`ORIGINAL OFF`** no Índice antes mesmo de abrir o modal de render.
  5. **Preset de Exportação `Roteiro Pós-Montagem (As-Broadcast / Paper Edit)`:**
     * Exporta `.md`, `.txt` ou `.csv` consolidando para cada trecho: `[TC IN → TC OUT] FALANTE (Pista): "Texto exato entre [in, out]" | Cobertura V2+: nome do B-roll`.

---

### Onda IV (`4A/4B/4C-idx`) — Cor Técnica, Legendas Profissionais & Fala Sobreposta
* **Encaixe no Grande Plano:** pequenos ganchos acoplados ao fechamento de cada sub-estágio do **Estágio `4`** (`4A`, `4B`, `4C`).
* **Entregas distribuídas pelos marcos:**
  * **Pós-`4A` (`Cor Técnica`):** adicionar seção `"color"` ao `index-enrich` usando `src/media/capacidades.py` (`G2a`) e perfil de cor do `FFprobe` para sinalizar **`LOG SEM COR`** / **`HDR→SDR`** quando clipes Log (`S-Log`, `V-Log`, `D-Log`, `HLG`) estiverem sem transformação técnica ou LUT configurada *(ganha validação de LUT `.cube`/curvas PCHIP quando entrar o `6B`)*.
  * **Pós-`4B` (`Legendas Frente C`):** adicionar filtro/aba **`Legendas`** lendo os blocos da `Frente C`, destacando violações de quebra `> 42×2` ou velocidade de leitura `> 17 cps` para correção direta pelo editor antes de gerar `.srt`/`.vtt`/`.ass`.
  * **Pós-`4C` (`Parakeet + fa-models`):**
    * Usar timestamps palavra-a-palavra realinhados por `fa-models` para zerar falsos positivos em `PALAVRA CORTADA`.
    * Adicionar badge **`FALA SOBREPOSTA`** sempre que o trecho usado no corte interceptar `dialogue_utterance.is_overlapping = 1` (ou o modelo `VoxLock` no `5E`).

---

### Onda V (`5A–5E-idx`) — Busca Semântica na Sequência, Cobertura de Roteiro, Ritmo Visual & Direitos de Imagem
* **Encaixe no Grande Plano:** acoplada aos **Estágios `5A`, `5C` e `5E`** — somente depois que busca Qdrant, roteiro×material (`scene_media`), capítulos (`media_chapter`) e reconhecimento facial (`SCRFD + ArcFace 512-d`) estiverem maduros e confiáveis.
* **Entregas distribuídas pelos marcos:**
  * **Pós-`5A` (`Saneamento de Busca & Qdrant`):**
    * **Busca Semântica *dentro* da Sequência:** consulta Qdrant + `video_keyframe` + `transcript` filtrada estritamente pelos `video_id` e janelas `[in, out]` presentes na timeline ativa (ex.: buscar *"contraluz"* ou *"greve"* e filtrar só os cortes já montados no filme).
    * **Repetição Semântica:** sinalizar quando duas falas muito similares (alta similaridade vetorial no texto) foram mantidas em pontos distantes do mesmo corte.
  * **Pós-`5C` (`Capítulos + scene_media`):**
    * Seção `"scenes"` no `index-enrich`: exibe coluna **Cena / Capítulo** (`scene` + `scene_media` + `media_chapter`) e card resumido **"Cenas do roteiro sem cobertura na sequência"** (ligado à futura Matriz Cena × Material do `5D`).
    * **Diagnóstico de Ritmo Visual (`Jump Cuts`):** cruza `media_segment.shot_scale` e `motion_label` entre clipes contíguos da mesma pista para acender alerta quando dois takes seguidos do mesmo entrevistado e mesma escala ficarem colados sem B-roll cobrindo em `V2+`.
  * **Pós-`5E` (`SCRFD + ArcFace 512-d real`):**
    * Seção `"people"` no `index-enrich`: cruza `[in, out]` dos clipes contra `face` + `person` (quem aparece em imagem) e `transcript.speaker_id` (quem fala).
    * Sub-visão **Pessoas no Corte & Direitos de Imagem (*Clearance*)**: mostra tempo total em tela/fala por pessoa e `%` da sequência; clique no nome filtra apenas as aparições dela; acende badge **`ROSTO SEM NOME`** quando houver `face` relevante sem `person_id` confirmado no intervalo; libera o preset **`Planilha de Elenco e Direitos de Imagem (.csv)`** com todos os trechos IN/OUT por pessoa.

---

## 5. Contrato Técnico de Enriquecimento & Presets de Exportação

### Contrato sugerido para `POST /api/timeline/index-enrich` (introduzido na Onda II)
* **Princípio de leveza:** só retorna seções pedidas explicitamente em `sections` (ex.: `["audio"]` na Onda II; `["audio", "transcript", "disk"]` na Onda III; `color`, `scenes`, `people` nas Ondas IV–V) e pode ser cacheado no backend/frontend por `(project_id, sequence_hash, sections)`.
* **Entrada resumida:**
  * `project_id`: inteiro do projeto ativo.
  * `sequence_hash`: hash curto do recorte atual `(cuts[].{id, video_id, photo_id, in, out, track, disabled})`.
  * `sections`: subconjunto ativo conforme a onda e as colunas/filtros ligados na UI.
  * `cuts`: lista enxuta dos intervalos presentes na timeline.
* **Saída resumida:**
  * `by_cut_id`: mapa `{ [cutId]: { audio?, transcript?, disk?, color?, scenes?, people? } }`.
  * `aggregates`: objetos globais da sequência usados nos subpainéis (`people_summary` na `5E`, `uncovered_scenes` na `5C`, `semantic_duplicates` na `5A`).

### Consolidação dos Presets de Exportação

| Preset de Exportação | Onda | Conteúdo Principal | Uso na Ilha / Produção |
| :--- | :--- | :--- | :--- |
| **QC Técnico completo (`.csv`)** | `2A` (✅) + `Onda I` | Clipes, transições, marcadores (*To-Do*), gaps, alertas e notas | Revisão técnica pré-render e passagem para assistentes |
| **Music Cue Sheet (`.csv`)** | `Onda II (2B-idx)` | Somente trilhas musicais (`natureza`), IN/OUT na timeline, duração por entrada e total acumulado | Prestação de contas ECAD / direitos musicais |
| **Roteiro Pós-Montagem (`.md`/`.txt`/`.csv`)** | `Onda III (3B-idx)` | Timecode IN/OUT, falante, transcrição exata do intervalo `[in, out]` e clipes de cobertura em `V2+` | Tradução, legendagem, audiodescrição, Ancine e direção |
| **Direitos de Imagem & Elenco (`.csv`)** | `Onda V (5E-idx)` | Todas as aparições por pessoa (`person_id` / `speaker_id`), soma de tempo em tela/fala e alertas de rosto não identificado | Liberação jurídica (*clearance*) e cartelas de crédito |

---

## 6. Matriz Rápida para Próximos Chats ("Qual Onda Ativar Agora?")

| Se você estiver abrindo um chat para executar… | Ative no escopo do Índice | Pré-requisito que já deve estar pronto |
| :--- | :--- | :--- |
| Uma melhoria dedicada de **UI NLE no Estágio 2** | **Onda I (`2A.2`)** | `1A` + `2A` (`2cac41f`) ✅ |
| **Estágio `2B` (Áudio Completo)** | **Onda II (`2B-idx`)** ao final do bloco de áudio | `audioCadeia.js` + `Frente F` (`2B`) |
| **Estágios `3A` + `3B` (MCP + Timeline Clone)** | **Onda III (`3B-idx`)** junto com a UX de revisão/clone | `2D` (Abas) + `src/tools/` (`3A`) |
| **Estágios `4A`, `4B` ou `4C`** | **Onda IV (`4A/4B/4C-idx`)** como gancho leve em cada bloco | `capacidades.py` (`4A`), `Frente C` (`4B`), `fa-models` (`4C`) |
| **Estágios `5A`, `5C` ou `5E`** | **Onda V (`5A–5E-idx`)** usando busca limpa, `scene_media` e ArcFace | `5A` (Qdrant), `5C` (`scene_media`), `5E` (ArcFace 512-d) |
