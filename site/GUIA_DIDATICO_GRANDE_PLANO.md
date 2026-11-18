> **⚠️ AVISO PARA AGENTES DE IA (ECONOMIA DE CONTEXTO):**
> Este documento foi escrito exclusivamente para **leitura humana** (editores de vídeo, leigos e colaboradores humanos).
> **Não leia este arquivo durante tarefas normais de programação, debug ou execução de planos.** O roteiro técnico enxuto fica em [`docs/planos/GRANDE_PLANO_UNIFICADO_2026-11.md`](../docs/planos/GRANDE_PLANO_UNIFICADO_2026-11.md). Só atualize este arquivo quando o usuário pedir explicitamente para registrar uma nova entrega no diário vivo.

---

# Guia Didático do Grande Plano Unificado — CapIAu-Talho (Nov/2026)

**Versão interativa no site:** abra [`site/plano.html`](./plano.html) (ou *Plano Vivo* no site publicado) para explorar mapas clicáveis, diagramas SVG, seletor de lente (*Montador* vs *Programador*) e trechos de código com tooltips.

**Data-base do acompanhamento:** 18/11/2026 (`main` @ `d6d6f78`, com último código em `11efef5`).

---

## 1. O que é este plano e o que ele vai entregar?

Imagine que o **CapIAu-Talho** nasceu com vários cadernos de obras separados:
- um caderno de **ferramentas clássicas de edição** (timeline, abas, rótulos de cor, VU meter, borracha de volume);
- um caderno de **paridade de render** (as 9 frentes *HyperFrames*, garantindo que o que você ouve e vê no Player do editor saia exatamente igual no vídeo exportado pelo FFmpeg);
- um caderno de **busca inteligente, roteiro e cor** (CLIP, faces, OCR, OCIO);
- um caderno de **segurança, banco de dados e nuvem**;
- e **5 levantamentos novos de IA** (como abrir o editor com segurança para assistentes externos como Claude Code, Antigravity, Cursor, Gemini CLI e Hermes Agent).

Se tentássemos construir tudo ao mesmo tempo ou na ordem errada, um recurso quebraria o outro. O **Grande Plano Unificado** pega mais de 15 documentos, corrige informações desatualizadas descobertas por auditoria no código real e organiza a obra inteira em **8 Estágios (31 frentes, de `0A` a `7D`)** — do conserto mais urgente até a nuvem e IA adaptativa.

### O que o CapIAu-Talho entrega ao final do plano

| Bloco da Obra | O que muda para quem edita (Sala de Corte) | Status em 18/11/2026 |
|---|---|---|
| **Estágio 0 (`0A`–`0C`)** | Conserta bugs que atrapalham hoje (arraste de alças, Crop seguro, cores nos clipes, áudio mono/EQ no export, segurança XSS e preflight real). | ✅ **100% Concluído** |
| **Estágio 1 (`1A`–`1C`)** | Prepara o chassi: transforma a timeline única em várias "bandejas" independentes, blinda o banco/sync/segurança local e cria a rede de provas automática do render + navegador invisível único. | 🟡 **1A e 1B concluídos · 1C em andamento** (`D1 E1–E2` pronto) |
| **Estágio 2 (`2A`–`2E`)** | Fecha a **Suíte NLE Clássica**: Índice de Sequência pesquisável, VU Meter, Borracha de Volume e Auto-Ducking com som idêntico no export, composição de 3+ pistas de vídeo e **Abas de Múltiplas Timelines**. | ⏳ **Planejado (Prioridade 1)** |
| **Estágio 3 (`3A`–`3C`)** | Abre o Talho para **5 IAs externas via MCP** sem travar o banco, com a IA editando em uma **Timeline "Clone" isolada**, painel de *Changes*, *Undo* em 1 clique e revisão visual de títulos. | ⏳ **Planejado (Prioridade 2)** |
| **Estágio 4 (`4A`–`4D`)** | Cor técnica fiel (`BT.709` e HDR→SDR no proxy), legendas completas (`.srt`/`.vtt`/`.ass` e karaokê), transcrição local **Parakeet** + alinhamento palavra a palavra e prova final do vídeo (**Proofcut** + *Smart Cut*). | ⏳ **Planejado** |
| **Estágio 5 (`5A`–`5E`)** | Busca por objetos e barras pretas corrigida, leitura de **claquetes por OCR local**, capítulos automáticos de cena, **5 mapas visuais do acervo**, busca com Gemma 2 int8 e reconhecimento facial real (**ArcFace 512-d**). | ⏳ **Planejado** |
| **Estágio 6 (`6A`–`6D`)** | Decisão inteligente calibrada com gabarito (`talho-bench`), cor criativa (LUT `.cube`, curvas PCHIP), animações HTML nativas (WAAPI), rampas de áudio e conciliação com o banco principal (~506 vídeos). | ⏳ **Planejado** |
| **Estágio 7 (`7A`–`7D`)** | Nuvem criptografada (Cloudflare R2 + cofre de chaves), *Editorial DNA* (o programa aprende seu estilo de corte), micro-renders em GPU na nuvem e satélites (Blender MCP, Resolve, proxies Wi-Fi). | ⏳ **Sob Demanda** |

---

## 2. O Mapa das Conexões: Onde as coisas se conectam e por que esta ordem?

Muita gente pergunta: *"Por que não fazer logo as abas de timeline, o MCP ou o VU meter antes de mexer em infraestrutura?"*
Porque existem **4 correntes físicas** dentro do código. Se você puxar um elo sem ter travado o anterior, precisa jogar fora o trabalho depois (**retrabalho**).

```text
==============================================================================================
   MAPA DE CONEXÕES DO GRANDE PLANO UNIFICADO (AS 4 CORRENTES QUE DEFINEM A ORDEM)
==============================================================================================

[CORRENTE 1] DA MESA ÚNICA ÀS MÚLTIPLAS SEQUÊNCIAS E CLONES DA IA
----------------------------------------------------------------------------------------------
  (0A) Fixes UI + Task 22
         │
         ▼
  (1A) TimelineSequenceState + Fachada Proxy  ✅ FEITO (5e05296)
         │  "Em vez de uma mesa fixa no chão, cada sequência vira uma bandeja móvel.
         │   A fachada Proxy engana as 1.555 referências antigas para nada quebrar."
         ├──────────────────────────┬────────────────────────────┐
         ▼                          ▼                            ▼
  (2A) Índice de Sequência   (2D) Task 25: Abas          (3B) IA edita em Timeline
       lê via fachada Proxy       de Sequência + Escopo       "Clone" isolada + Undo
                                  do renderCache por aba      atômico por turno
                                          │                      ▲
                                          └──────────────────────┘

[CORRENTE 2] DO PLAYER AO FFMPEG (PARIDADE DE SOM, IMAGEM E NAVEGADOR INVISÍVEL)
----------------------------------------------------------------------------------------------
  (0B) EQ/Mono + -1 frame + dip_white + gblur + OTIO  ✅ FEITO
         │
         ▼
  (1C) Rede de Segurança: src/navegador/ (D1 E1-E2 ✅) + Regressão FFV1 + Video Receipts  🟡
         │  "Cria um mini-servidor seguro 127.0.0.1 e controla 1 único Chromium limpo."
         ├──────────────────────────┬────────────────────┬───────────────────┐
         ▼                          ▼                    ▼                   ▼
  (2B) Áudio Completo:       (3B) Frente H:       (4B) Legendas      (6C) Animações
       audioCadeia.js ──►         IA tira foto         Karaokê            HTML WAAPI
       Task 19 VU Meter           do título            via D1             + Regressão
       Compressor Offline         renderizado                             Nível 2
       Task 20/21 Frente F        para revisar
         │
         ▼
  (2C) 3+ pistas no Program + Reverso  ──►  (4D) Proofcut (audita MP4 final) + Smart Cut GOP

[CORRENTE 3] PORTA TRANCADA, BANCO CONFIÁVEL E PORTARIA ÚNICA PARA 5 IAS (MCP)
----------------------------------------------------------------------------------------------
  (0C) CORS + XSS + face.embedding + preflight  ✅ FEITO
         │
         ▼
  (1B) Token Bearer + Sync 30 tabelas + WAL + sem eval()  ✅ FEITO
         │  "Garante que ninguém de fora da máquina mexa nos arquivos nem corrompa o banco."
         ▼
  (3A) Registro Único src/tools/ + Servidor /mcp DENTRO do FastAPI + stdio_bridge
         │  "Por que DENTRO do FastAPI? Porque o banco vetorial Qdrant embutido tranca o
         │   arquivo se dois programas tentarem abri-lo ao mesmo tempo!"
         ▼
  (3C) Contratos entre Personas (Diretora → Montadora → Sound Designer) + Testes MCP
         │
         ▼
  (7A) Nuvem Completa: Vault AES-256 + Cloudflare R2 (reaproveita o sync corrigido em 1B)

[CORRENTE 4] OLHOS E OUVIDOS NO ACERVO (COR → FALA → BUSCA → OCR → CAPÍTULOS → DECISÃO)
----------------------------------------------------------------------------------------------
  (4A) Cor Técnica (BT.709 + HDR→SDR no proxy + CR2) ──────────────────────► (6B) Cor Criativa
                                                                                  LUT .cube +
  (4C) Parakeet TDT v3 (fala) + fa-models (palavra exata) ──┐                     curvas PCHIP
         │                                                  ▼
         └──► (5A) Saneamento Qdrant + VideoSeek ──► (5B) OCR Claquete + visual_memory
                                                            │
                                                            ▼
              (5C) Capítulos + scene_media ──► (5D) 5 Visualizações + Grafo
                                                            │
                                                            ▼
              (5E) Gemma 2 int8 + ArcFace ──► (6A) talho-bench + Decisões ──► (6D) Banco Casa
                                                                                    │
                                                                                    ▼
                                                                             (7B/7C/7D) DNA/GPU
==============================================================================================
```

### Tabela Rápida: "Por que X tem que vir antes de Y?"

| O que vem antes | O que vem depois | Metáfora simples: o que quebraria se invertêssemos? |
|---|---|---|
| **0A–0C (Estancar sangramento)** | **1A–1C (Base arquitetural)** | Não adianta reformar o motor com o pneu furado e a porta destrancada. Resolver bugs rápidos e falhas de XSS/CORS limpa o terreno em poucos dias. |
| **1A (`TimelineSequenceState`)** | **2A, 2D e 3B (Índice, Abas, Clone IA)** | Se a timeline fosse uma única variável global espalhada em 21 arquivos, cada aba nova ou clone da IA atropelaria os cortes do editor. |
| **1C (`src/navegador/` + Regressão FFV1)** | **2B, 3B (Frente H), 4B, 6C** | Sem o navegador único em `127.0.0.1` e a "prova dos nove" automática (`ffv1`), mexer no compressor de áudio ou em animações criaria processos zumbis e regressões invisíveis no export. |
| **`audioCadeia.js` (dentro do 2B)** | **Task 19 (VU Meter)** | O navegador só permite conectar **um** nó de leitura (`createMediaElementSource`) por `<audio>`/`<video>`. Se o VU Meter fosse feito antes de extrair a cadeia de áudio única, o som ficaria mudo ou duplicado. |
| **`Frente F` (dentro do 2B)** | **Task 20 e Task 21** | O plano antigo de Task 20/21 usava parâmetros incompatíveis com o FFmpeg. Seguir a `Frente F` garante que a borracha de volume e o auto-ducking soem idênticos no Player e no vídeo exportado. |
| **1B (Bearer) + 3A (`/mcp` no FastAPI)** | **3B e 3C (5 IAs operando o editor)** | O Qdrant embutido **não aceita dois processos abrindo a mesma pasta**. Se o MCP fosse um processo solto no terminal, o Talho aberto travaria na hora com erro de lock. |
| **5C (`scene_media` + chaves estáveis)** | **5D (Matriz e Storyline)** | Não dá para desenhar um mapa ligando cenas do roteiro aos vídeos gravados enquanto a tabela que faz essa ponte (`scene_media`) não existir e os IDs das cenas mudarem a cada reimportação. |
| **6A (`talho-bench` com gabarito humano)** | **Automação de descartes/cortes** | Regra de ouro da sala de montagem: **nunca deixar a IA jogar material fora automaticamente** antes de provar contra um conjunto de provas humano que ela não erra. |

---

## 3. Estágio 0 — Quick Wins Imediatos & Estancamento (✅ CONCLUÍDO)

### 0A — Quick Wins de Interface e Ferramentas NLE (`✅ Concluído: ae252e0, a59fc02`)
- 🎬 **Na Sala de Corte (Leigo / Montador):**
  - **Metáfora:** Ajustar as dobradiças frouxas da mesa de luz e colocar etiquetas coloridas nas latas de filme.
  - **Uso prático no editor:** Você pode arrastar as 8 alças de escala/rotação direto no monitor Program sem a interface travar ou recarregar o painel; clicar em *Configurações da Sequência* abre o Inspetor mesmo se ele estiver fechado; o recorte (*Crop*) impede que você corte mais de 90% somando dois lados (evitando sumir a imagem por acidente); e você ganha **8 Rótulos de Cor** nos clipes (**Task 22**) pelo menu de contexto.
  - **Por que importa para o programa:** Fecha erros imediatos de uso diário, consolida 3 cópias repetidas de código que configuravam o 1º clipe da timeline e guarda a resolução/FPS no histórico de Desfazer (`TIMELINE_HISTORY`).
- ⚙️ **Debaixo do Capô (Programador):**
  ```text
  MouseMove nas alças (player.js:6820)
     ├── ANTES: chamava refreshClipInspector() a cada pixel ──► recriava DOM e quebrava o arraste
     └── AGORA: chama syncTransformInputsInPlace(localTf) ──► só atualiza os números nos inputs
                e só abre/atualiza o inspetor completo no mouseup!
  ```
  ```js
  // src/ui/js/player.js (trecho real pós-0A)
  STATE.activeTimelineCuts = cuts;
  this.syncVideoToPlayhead(); // agora chama syncProgramViewport() no início
  if (interaction && typeof interaction.syncTransformInputsInPlace === "function") {
      interaction.syncTransformInputsInPlace(localTf); // atualiza números sem destruir o foco
  }
  ```
- 📓 **O que mudou pelo caminho:**
  - Durante o teste da **Task 22 (Color Labels)**, notou-se que o submenu de cores cortava na borda inferior da tela quando o clipe ficava muito embaixo; isso gerou o commit extra `a59fc02` reposicionando o submenu.
  - O controle visual `--space-scale` (para aumentar/diminuir o espaçamento da UI) foi **adiado de propósito** e transformado no simulador interativo [`espacamento-space-scale.html`](../docs/planos/explicativos/espacamento-space-scale.html) para você decidir depois com calma.

---

### 0B — Quick Wins de Render e Paridade Fila 0 (`✅ Concluído: 9972298, ead9c01, 4b5c023, dbfddf3, 945b843`)
- 🎬 **Na Sala de Corte (Leigo / Montador):**
  - **Metáfora:** Afinar os alto-falantes da ilha e a balança da gráfica para que a cor, o brilho, o som e o último quadro do filme impresso batam exatamente com o que você viu na tela.
  - **Uso prático no editor:** Áudios mono não saem mais 3 dB mais baixos no arquivo exportado; a equalização (graves, médios, agudos) soa igual no Player e no MP4; o último frame do vídeo não some na exportação; a transição *Dip to White* (clarão branco) passa a existir de verdade no render; o desfoque de clipe iguala o dos títulos; e mudanças de velocidade constante agora são entendidas ao exportar para DaVinci Resolve / Kdenlive via OTIO.
  - **Por que importa para o programa:** Elimina os 5 desvios mais fáceis e graves entre o que você monta no navegador e o que o cliente recebe no arquivo final.
- ⚙️ **Debaixo do Capô (Programador):**
  ```text
  WebAudio (player.js)                     FFmpeg (grafo_audio.py / grafo_video.py / comando.py)
  ─────────────────────                    ───────────────────────────────────────────────────
  hpf / low / high Q      ═══════►         highpass width=1.122018 · shelves width=0.5
  mono -> 2 canais iguais ═══════►         pan=stereo|c0=c0|c1=c0 (compensa -3 dB do pan padrão)
  último quadro visível   ═══════►         fps=...:eof_action=pass (não corta o frame final)
  dip_white               ═══════►         ramo dedicado video_dip_white em grafo_video.py
  ```
  ```python
  # src/export/video_render/grafo_audio.py (trecho real pós-0B)
  # No WebAudio o highpass usa Q em dB (1 dB ≈ 1.122018) e shelves S=1 equivalem a width=0.5
  if params["hpf_hz"] > 0:
      filtros.append(f"highpass=f={_num(params['hpf_hz'])}:width_type=q:width=1.122018")
  if params["low_db"] != 0.0:
      filtros.append(f"bass=g={_num(params['low_db'])}:f=250:width_type=q:width=0.5")
  ```
- 📓 **O que mudou pelo caminho:**
  - Ao conferir as curvas de transição, decidiu-se **adiar** o alinhamento da curva `"bezier"` vs `"s_curve"` para não atrasar os ganhos rápidos do `0B`. Foi criado o plotter interativo [`curvas-bezier-vs-s-curve.html`](../docs/planos/explicativos/curvas-bezier-vs-s-curve.html) para resolver antes da `Frente F` e da `Frente B Nível 1`.

---

### 0C — Higiene Operacional, Segurança Básica & Schema (`✅ Concluído: 44077f0, 1c4848a, 8cc01fa, 2e57224, a1dc7b2`)
- 🎬 **Na Sala de Corte (Leigo / Montador):**
  - **Metáfora:** Fechar a porta da sala de edição por dentro para que nenhum site aleatório aberto noutra aba possa espiar seu projeto, e conferir a caixa de ferramentas antes de ligar a máquina.
  - **Uso prático no editor:** Nomes de arquivos ou mensagens no chat com símbolos especiais (`<script>`, etc.) nunca executam código indesejado; o diagnóstico de sistema (*preflight*) testa de verdade se o Chrome/Edge está funcionando em vez de assumir que sim; o painel de hardware realmente passa a obedecer à escolha CPU/GPU do usuário; e todas as dependências Python ficam declaradas corretamente.
  - **Por que importa para o programa:** Fecha brechas clássicas de segurança local (CORS aberto, XSS), evita falha silenciosa ao criar banco do zero sem a coluna `face.embedding` e remove o `--reload` automático que reiniciava o servidor no meio de uma edição se algum arquivo mudasse.
- ⚙️ **Debaixo do Capô (Programador):**
  - `server.py`: CORS restrito às origens locais permitidas; `--reload` movido apenas para `-Dev`.
  - `chat.js` e `timelineInteraction.js`: escaping seguro de HTML contra XSS (`SEC-03`).
  - `schema.py`: coluna `embedding` incluída diretamente no `CREATE TABLE face` + migração segura em `init_db`.
  - `requirements.txt` + `modelos_locais.py` + `settings_registry.py`: dependências explícitas (`pypdf`, `sherpa-onnx`, `soundfile`, `pytest`, `syrupy`), conexão real de `hardware.ai_device` e alinhamento da Wiki/`face_pipeline.py`.
- 📓 **O que mudou pelo caminho:**
  - Planos antigos mandavam apagar as chaves `assemblyai_key`, `deepgram_key` e `auphonic_key` achando que eram código morto. A verificação no código real provou que **elas têm leitores ativos**, então foram **preservadas** com segurança enquanto só as chaves realmente mortas saíram.

---

## 4. Estágio 1 — Fundação Arquitetural Sem Retrabalho

### 1A — Estado da Timeline por Instância com Fachada Compatível (`✅ Concluído: 5e05296`)
- 🎬 **Na Sala de Corte (Leigo / Montador):**
  - **Metáfora:** Antes, a mesa de montagem era uma folha gigante colada no chão: só cabia uma sequência por vez. Agora, cada sequência vira uma **bandeja removível completa** (com seus clipes, trilhas, marcadores, agulha e histórico de Ctrl+Z próprios). E colocamos um "mordomo" na porta para que os 21 departamentos antigos da oficina continuem trabalhando sem perceber que a mesa trocou de sistema.
  - **Uso prático no editor:** Prepara o programa para abrir **várias sequências em abas**, isolar o Ctrl+Z de cada sequência e permitir que a IA trabalhe em uma **Timeline Clone** sem jamais bagunçar a sua montagem original.
  - **Por que importa para o programa:** Existiam **1.555 referências diretas** a `TIMELINE_STATE`, `TIMELINE_HISTORY` e `STATE.activeTimelineCuts` espalhadas por 21 arquivos e 44 autotestes. Reescrever tudo à força quebraria o editor por semanas; a fachada compatível preserva 100% do código atual funcionando no dia 1.
- ⚙️ **Debaixo do Capô (Programador):**
  ```text
  21 arquivos do Editor (1.555 chamadas a TIMELINE_STATE / TIMELINE_HISTORY)
                         │
                         ▼ (Proxy transparente — createActiveFacadeProxy)
              SEQUENCE_MANAGER.getActiveSequence()
               ├── Aba "Principal"  ──► TimelineSequenceState { cuts, tracks, history... }
               ├── Aba "Cena 04"    ──► TimelineSequenceState { cuts, tracks, history... }
               └── Clone IA (Turno) ──► TimelineSequenceState { isolado da principal }
  ```
  ```js
  // src/ui/js/timelineState.js:9907-9969 (código real implementado em 5e05296)
  export const SEQUENCE_MANAGER = new TimelineSequenceManager();

  export const TIMELINE_STATE = createActiveFacadeProxy(
      () => SEQUENCE_MANAGER.getActiveSequence(),
      { __isTimelineFacade: true, computeAdjustmentFadeFactor, computeClipFadeFactor }
  );
  // Qualquer leitura em TIMELINE_STATE.cuts redireciona automaticamente para a aba ativa!
  ```
- 📓 **O que mudou pelo caminho:**
  - A diretriz de **Timeline Clone / Múltiplas Sequências Fantasmas para a IA** exigiu que a `TimelineSequenceState` já nascesse preparada não só para abas de usuário (Task 25), mas também para `ghostTrack`, metadados de clone e histórico independente (`TIMELINE_HISTORY` também virou Proxy para `seq.history`), validado com o protótipo [`timeline-clone-ia.html`](../docs/planos/explicativos/timeline-clone-ia.html) e coberto por `tests/autoteste_timeline_sequence_state.mjs`.

---

### 1B — Saneamento Crítico de Segurança & Banco (`✅ Concluído: 98656c7, 5561def, d4957d1, 4678990, 6b17c9c`)
- 🎬 **Na Sala de Corte (Leigo / Montador):**
  - **Metáfora:** Colocar tranca eletrônica com crachá na sala de máquinas, impedir que qualquer ferramenta passe perto do HD onde ficam os brutos originais, e consertar o caminhão de mudança do projeto para não esquecer metade das caixas no caminho.
  - **Uso prático no editor:** Se você exportar/importar um projeto entre dois computadores (`sync.py`), todas as **30 tabelas** (incluindo fotos, rostos, cenas e timelines v2) viajam juntas sem perder IDs nem deixar o buscador visual Qdrant dessincronizado; uploads de ZIP gigantes ou caminhos maliciosos são bloqueados; e o banco faz backup seguro mesmo enquanto está em uso (`WAL`).
  - **Por que importa para o programa:** Eliminou `eval()` no `ffprobe` (risco grave de execução arbitrária), removeu letras de disco `F:/` travadas no código (substituídas por guardas configuráveis em `storage_guards.py`), impediu acesso de rede externa sem token (`127.0.0.1` + Bearer) e protegeu contra *zip-bomb* e *path traversal*.
- ⚙️ **Debaixo do Capô (Programador):**
  ```text
  Requisição sensível ──► security.py (exige loopback + token Bearer local)
  Import/Export ZIP   ──► limites de taxa/tamanho (anti zip-bomb) + normalização anti "../"
  Sync de Projeto     ──► copia proxies/mídia ANTES do commit SQLite ──► remapeia IDs ──► outbox Qdrant
  Backup SQLite       ──► sqlite3.Connection.backup() + PRAGMA integrity_check + os.replace atômico
  ```
  ```python
  # src/db/backup.py:67-79 (código real implementado em 5561def)
  src_conn.backup(dst_conn)                 # Copia páginas de forma segura mesmo com WAL ativo
  _check_sqlite_integrity(dst_conn, "Backup SQLite")
  sha256_hex, size_bytes = _compute_sha256_and_size(tmp_path)
  os.replace(tmp_path, dest_path)           # Troca atômica: ou o backup inteiro existe, ou nada mudou
  ```
- 📓 **O que mudou pelo caminho:**
  - Planos antigos citavam `src/services/task_manager.py`, mas a auditoria mostrou que esse arquivo não existe — o gerenciador real é `src/core/tasks.py` (`TASK_MANAGER`).
  - A estratégia de backup/sync precisou incluir `proxy_photo_{id}.webp` e **parar de mutar hashes com prefixo `_imp_`** durante importações (o que quebrava a ligação com o Qdrant).

---

### 1C — Rede de Segurança de Render & Navegador Único (`🟡 EM ANDAMENTO — D1 E1–E2 pronto em 11efef5`)
- 🎬 **Na Sala de Corte (Leigo / Montador):**
  - **Metáfora:** Contratar um laboratório oficial com **auditor** e **recibo assinado** para cada filme que sai da sala de edição. Antes de mexer em efeitos complexos de áudio, legendas e animações, o programa ganha uma "prova dos nove" matemática e um navegador invisível bem-educado que nunca deixa processos fantasma comendo memória RAM.
  - **Uso prático no editor:** Hoje o código já tem a fundação (`src/navegador/`): quando o Talho precisa de um navegador invisível para renderizar algo pesado (títulos, áudio offline, legendas), ele sobe um servidor próprio seguro em `127.0.0.1`, testa se Edge/Chrome funciona pela interface/API (`/api/navegador/diagnostico`) e limpa processos antigos ao fechar. Quando fecharmos a parte pendente, todo export ganhará um "recibo técnico" (**Video Receipt**) provando que duração, quadros e áudio batem com a timeline.
  - **Por que importa para o programa:** Sem essa rede de segurança (`Frente B Nível 1` com vídeo sem perdas `ffv1`), cada melhoria futura no Player ou no FFmpeg poderia quebrar alguma coisa sem ninguém perceber até o dia da exibição. E sem o `src/navegador/` unificado, cada módulo abria um Chrome separado e deixava threads órfãs no Windows quando o usuário cancelava um render.
- ⚙️ **Debaixo do Capô (Programador):**
  ```text
  [Já entregue em 11efef5 — Frente D1 E1-E2]
  src/navegador/
   ├── servidor.py     -> HTTP 127.0.0.1/<token>/ (libera AudioWorklet via isSecureContext, Range HTTP, PUT atômico)
   ├── lancador.py     -> sobe Playwright Edge/Chrome controlando ciclo de vida
   ├── diagnostico.py  -> checagem rápida & teste completo (/api/navegador/diagnostico e /testar)
   └── orfaos.py       -> registra PIDs em disco e encerra árvore de processos se cair/fechar

  [Falta para fechar 1C]
   ├── D1 E3           -> migrar titulos.py e execucao.py:110 para usar src/navegador/ (fim da thread daemon órfã)
   └── Frente B Nível 1 + Video Receipts -> suíte ffv1 + pcm_s16le, comparação pixel/sample via numpy + JSON receipt
  ```
  ```python
  # src/navegador/servidor.py:1-6 (código real entregue em 11efef5)
  """Servidor HTTP local em loopback (`127.0.0.1`) para o navegador headless.
  Fornece origem segura (`http://127.0.0.1:<porta>/<token>/...`, destravando
  `AudioWorklet` e APIs que exigem `window.isSecureContext === true`), suporte a
  `GET`/`HEAD` com `Range` e `PUT`/`POST` atômico em disco sem base64 via CDP."""
  ```
- 📓 **O que mudou pelo caminho:**
  - O Estágio `1C` foi dividido de forma pragmática: primeiro entregou-se a fundação limpa de `src/navegador/` (`D1 E1–E2` em `11efef5` com suíte `test_navegador_servidor.py` e `test_navegador_lancador.py`), deixando a migração de `titulos.py`/`execucao.py` (`D1 E3`) e a suíte `Frente B Nível 1 + Video Receipts` para a rodada final de fechamento do `1C`.

---

## 5. Estágio 2 — Prioridade 1: Ferramentas NLE Restantes & Fluxo de Áudio/Sequência

### 2A — Índice de Sequência (*Sequence Index*, `⏳ Planejado`)
- 🎬 **Na Sala de Corte:** **Metáfora:** O *índice remissivo* de um livro gigante. **Na prática:** Uma tabela pesquisável e filtrável mostrando todos os clipes da timeline atual, arquivos offline, "flash frames" (cortes curtos demais por acidente), transições, trilhas mutadas e marcadores. Um clique na linha pula a agulha direto para aquele segundo — e ainda exporta tudo para CSV (planilha de decupagem/relatório de entrega). **Por que importa:** Em documentários longos com centenas de cortes, procurar um clipe offline ou um marcador na mão leva minutos.
- ⚙️ **Debaixo do Capô:** Nova aba nativa em `tabPanels.js` / `dockModel.js`, alimentada **somente leitura** pela fachada `TIMELINE_STATE` (para já funcionar automático quando trocarmos de aba na Task 25).
  ```js
  // Arquitetura prevista (leitura limpa via fachada 1A)
  const rows = TIMELINE_STATE.cuts.map(c => ({
      id: c.id, track: c.trackId, startFrame: c.timelineStart,
      durFrames: c.durationFrames, offline: Boolean(c.offline),
  }));
  ```
- 📓 **Cuidado de engenharia:** Nunca guardar cópia própria dos cortes; ler direto de `TIMELINE_STATE` e registrar como aba nativa do `tabPanels.js`.

### 2B — Áudio Completo com Paridade (`Frente A` + `Task 19` + `Task 20` + `Task 21`, `⏳ Planejado`)
- 🎬 **Na Sala de Corte:** **Metáfora:** A mesa de som profissional com medidor de agulha ao vivo, lápis de borracha para desenhar o volume na pista e um operador automático que abaixa a música quando alguém fala (*auto-ducking*). **Na prática:** (1) Medidor estéreo ao vivo (**Task 19**), (2) Borracha de volume com pontos editáveis direto na waveform (`Ctrl+Clique`, **Task 20**), (3) Auto-ducking pela transcrição (**Task 21**), (4) Gate/compressor soando idênticos no Player e no MP4, e (5) trava impedindo que o redutor de ruído automático estrague trilhas musicais ou som ambiente (mais teste A/B com **DeepFilterNet 3**).
- ⚙️ **Debaixo do Capô:** Ordem interna estrita: primeiro extrair `audioCadeia.js` de `player.js:5684+` → acoplar `AnalyserNode` (**Task 19**) → rodar `OfflineAudioContext` via `src/navegador/` (`1C`) + *null tests* → implementar automação de volume em `clip.keyframes.volume` + `asetnsamples=256` no FFmpeg (**Frente F**).
  ```text
  player.js (WebAudio) ──► extrai audioCadeia.js ──► 1 única fonte ──► AnalyserNode (VU Meter)
                                                    └──► OfflineAudioContext via src/navegador/ ──► Null Test vs FFmpeg
  ```
- 📓 **Cuidado de engenharia:** As especificações antigas das Tasks 20 e 21 foram **descartadas** porque criavam som diferente no WebAudio e no FFmpeg; seguir exclusivamente a `Frente F`.

### 2C — Paridade de Viewport & Multi-Track no Player (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** **Metáfora:** Alinhar as lentes do projetor para que todas as camadas transparentes empilhadas apareçam de verdade e ninguém desapareça entre pistas. **Na prática:** Corrige o bug grave (**Defeito #8**) em que ter 3 ou mais pistas de vídeo ocupadas faz sumir a pista do meio no monitor Program; resolve o desvio de 1 frame ao rodar um clipe de trás para frente (**Defeito #6**, após você decidir no HTML [`politica-reverso.html`](../docs/planos/explicativos/politica-reverso.html)); consolida `computeContentRect()` e garante encaixe (`fit`) no Crop; e alinha o controle de volume do inspetor que hoje sobe até 200% no slider enquanto o player trava em 100%.
- ⚙️ **Debaixo do Capô:** Ajustar laço de composição em `player.js:4131-4200` para renderizar todas as trilhas visíveis na ordem correta de Z-index/blend mode e alinhar `player.js:4539` a `modelo.py:172` (ou vice-versa conforme decisão).

### 2D — Task 25: Múltiplas Timelines em Abas (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** **Metáfora:** Poder abrir várias mesas de corte ao mesmo tempo — uma para a entrevista, outra para o trailer, outra para o corte final — e alternar entre elas com um clique. **Na prática:** Abas no topo da timeline com autosave separado por sequência e espaço livre para a IA abrir timelines paralelas ("clones"). **Por que importa:** Nenhum projeto médio ou grande vive com uma sequência só.
- ⚙️ **Debaixo do Capô:** Migra o armazenamento de `timeline` única para múltiplas `sequence`s por projeto no SQLite, escopa `renderCache.js` e `player.js` por `sequence_id` (para frames pré-renderizados de uma aba não vazarem na outra e manter o `bitmap.close()` atômico), apoiado diretamente no `TimelineSequenceManager` entregue no **Estágio 1A**.

### 2E — *(Opcional pós-decisão)* Onda Lateral da Biblioteca (`⏳ Opcional`)
- 🎬 **Na Sala de Corte:** **Metáfora:** Uma gaveta sanfonada na lateral esquerda para espiar mídias sem cobrir o que você está olhando. **Na prática:** Só entra se você aprovar após responder às 20 perguntas do mockup interativo `onda-lateral.html`, sempre presa à barra lateral (`panelRail.js`) sem jamais sobrepor outros painéis.

---

## 6. Estágio 3 — Prioridade 2: MCP Multi-Harness, Registro Único & Sequência Fantasma

### 3A — Registro Único de Ferramentas & Servidor MCP Multi-Harness (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** **Metáfora:** Em vez de ter cinco portas dos fundos improvisadas, construir **uma portaria única com crachá** por onde qualquer assistente externo (Claude Code, Antigravity, Cursor, Gemini CLI, Hermes Agent) entra, consulta seu acervo e sugere cortes — mesmo com o Talho aberto na sua frente.
- ⚙️ **Debaixo do Capô:**
  ```text
  UI / Chat Interno / REST / 5 Agentes MCP Externos
                         │
                         ▼
               [src/tools/ — Registro Único Pydantic]
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
     Processo FastAPI            stdio_bridge.py (ponte fina)
     rota /mcp (Streamable HTTP) ◄──── stdio dos CLIs/IDEs + Bearer Token (1B)
            │
            ▼
     1 única instância do Qdrant embutido (ZERO erro de lock!)
  ```
  - Elimina imports privados perigosos dentro de `chat_agent.py:1088, 1276`.

### 3B — Edição da IA em Timeline "Clone", Fixes `D1–D6`, Bypass & Revisão Visual (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** **Metáfora:** Quando você pede para o assistente tentar uma montagem nova, ele **nunca** mexe na sua mesa principal: ele copia sua sequência para uma mesa ao lado ("Clone / Sequência Fantasma"), faz os cortes lá, mostra uma aba **Changes** com tudo o que mexeu e permite aceitar, comparar A/B ou desfazer o turno inteiro em um clique. Além disso, a IA passa a enxergar o que está exatamente debaixo da sua agulha e "olhar" uma foto real dos títulos antes de te entregar (**Frente H**).
- ⚙️ **Debaixo do Capô:**
  - Fecha **6 bugs antigos (`D1–D6`)** + **1 falha de segurança editorial**: `SET_AV_OFFSET` e `ADD_EFFECT` em `chat_agent.py:2275` hoje não estão na lista que exige `is_preview = True` (ou seja, se chamados sozinhos, alteram a timeline sem pedir confirmação!).
  - Corrige: `D1` (hit-test em todas as pistas, não só `"ai"`), `D2` (`in` vs `in_s` `NaN` e `suggestions_output`), `D3` (chamar `populateRoughCutMarkers`), `D4` (padrão `"V2"`), `D5` (aviso visível se offline) e `D6` (preservar campos de fotos/textos/mattes).
  - Expõe `get_editor_state`, `preview_compare`, Undo atômico por turno via `TIMELINE_HISTORY` (`1A`) e **Frente H (`E1–E4`)** usando `src/navegador/` (`1C`).

### 3C — Contratos entre Personas, Style Skills & Testes de Contrato MCP (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** **Metáfora:** Definir o manual de passagem de bastão dentro da equipe de IA (a *Diretora* passa um roteiro estruturado para a *Montadora*, que passa marcas limpas para o *Designer de Som*), sem mensagens de recusa sem sentido.
- ⚙️ **Debaixo do Capô:** Contratos estruturados entre `TIMELINE_PERSONAS` (padrão **MASS**), remoção de `_recusa_auphonic` hardcoded quando não aplicável, *Style Skills* (`FireRed`) e suíte de contrato **MCP Inspector / `@vexyo/core`** estendendo `tests/test_f1_chat_agent.py`.

---

## 7. Estágio 4 — Cor Técnica, Legendas, Transcrição Parakeet & Prova Final

### 4A — Cor Técnica Unificada (`Frente G G0–G2c` + `OCIO §0.3/§1.2`, `⏳ Planejado`)
- 🎬 **Na Sala de Corte:** Garantir que arquivos gravados em HDR no celular ou câmeras profissionais não saiam "lavados" ou estourados no proxy e no master, e impedir que fotos `.CR2` (1.092 no acervo) tenham o brilho esticado automaticamente à força.
- ⚙️ **Debaixo do Capô:** Medição no Edge (`G0`), tags `bt709` e conversão `in_color_matrix=bt709`/`gbrp` (`G1a`/`G1b`), detector `capacidades.py` (`G2a`), função única `src/color/transformacao.py::filtro_entrada` assando HDR→SDR direto no proxy 720p (descartando a ideia antiga de criar um segundo proxy) e flag `color.raw_auto_bright` (`no_auto_bright` em `image_processing.py`).

### 4B — Legendas Profissionais (`Frente C E0–E9`, `⏳ Planejado`)
- 🎬 **Na Sala de Corte:** Legendas que respeitam padrão profissional (máximo 42 caracteres × 2 linhas e 17 caracteres por segundo), sem frases inventadas no silêncio, exportação confiável em `.srt`/`.vtt`/`.ass` direto do servidor e efeito karaokê palavra por palavra.
- ⚙️ **Debaixo do Capô:** Reescrita de `subtitles_export.py` + rota `/export/{srt|vtt|ass}` substituindo o gerador client-side antigo em `panels.js:2631-2679`, mais render karaokê via `src/navegador/` (`D1`).

### 4C — Parakeet Local + Alinhamento Forçado (`Frente E` + `fa-models`, `⏳ Planejado`)
- 🎬 **Na Sala de Corte:** Transcrição local super-rápida em português com **Parakeet TDT v3** e sincronia exata até a última sílaba quando você editar o texto da legenda ou aplicar auto-ducking.
- ⚙️ **Debaixo do Capô:** Subprocesso isolado `sherpa_worker.py` (fatias de ~60 s ±5 s + **gate obrigatório PT-BR M1..M14**), exploração de `sherpa-onnx fa-models` para *forced alignment* e decisão definitiva sobre gravar ou unificar as tabelas mortas `dialogue_utterance`/`dialogue_word` com `transcript`.

### 4D — Verificação Pós-Render (`proofcut`) & Smart Cut (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** Um inspetor automático que assiste ao MP4 acabado antes de dizer "Pronto!": confere se tem exatamente o número certo de quadros, a duração exata, o volume LUFS combinado e (opcionalmente) se as falas estão audíveis — além de um modo turbo (*Smart Cut*) que só recodifica as beiradas do corte quando não há efeitos nem cor.
- ⚙️ **Debaixo do Capô:** Pós-validador `proofcut` acoplado ao fluxo de Video Receipts (`1C`), e módulo `smart_cut` restrito estritamente a trechos sem efeitos/velocidade/cor (re-encode apenas nos limites do GOP).

---

## 8. Estágio 5 — Busca Híbrida, OCR Local, Conhecimento do Acervo & Visualizações

### 5A — Saneamento de Busca, Prompts & Busca por Objetos (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** Corrigir buscas que cortavam após 100 resultados ou só achavam nomes exatos de pessoa se você digitasse a frase inteira igual; cortar automaticamente barras pretas antes da IA analisar o quadro (*VideoSeek*) para o enquadramento não enganar a busca visual; e ativar botões/chips de filtro rápido e busca por objetos sem depender de API paga.
- ⚙️ **Debaixo do Capô:** Paginação em `semantic.py:513` (hoje trava em `limit=100`), inclusão de `video.title` no payload Qdrant, reconstrução de `capiau_images`, pré-recorte **VideoSeek**, troca do `LIKE '%query inteira%'` em `rag.py` por tokens/entidades, integração de `intent_router.py` + `E2.D3-UI`, e resolução dos 2 prompts mortos (`photo_vision`, `triage_batch_title`) no `PROMPT_REGISTRY`.

### 5B — OCR Local (`PP-OCRv6`) + `visual_memory` Cacheado (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** **Metáfora:** Um assistente que lê cada claquete, placa de rua ou letreiro que aparece na câmera e já anota sozinho a qual cena do roteiro aquele take pertence.
- ⚙️ **Debaixo do Capô:** `rapidocr_onnxruntime` (CPU, Apache-2.0) com detector `tiny` + reconhecedor `small` + `dHash` + varredura intensiva de claquete (2–3 fps nos 5s iniciais/finais). Grava **primeiro no SQLite** (`video_keyframe`/`video_ocr`) e só depois no Qdrant; gera `visual_memory.json`/`visual_memory.md` cacheado por hash para o MCP ler instantaneamente.

### 5C — Capitularização Multimodal & Cobertura de Roteiro (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** Dividir automaticamente entrevistas longas em "capítulos" por assunto e cruzar o roteiro com o acervo para responder: *"Quais cenas já têm material gravado e quais ainda estão descobertas?"*
- ⚙️ **Debaixo do Capô:** Nova tabela `media_chapter` (silêncio + falante + queda semântica MiniLM + salto visual CLIP + TF-IDF + título curto), persistência em marcadores/OTIO/`PySceneDetect save-chapters`, e criação da tabela **`scene_media`** com chaves estáveis em `replace_scenes_for_doc` para não perder vínculos ao reprocessar o roteiro.

### 5D — 5 Visualizações Operacionais & Knowledge Graph (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** Cinco painéis visuais para enxergar o filme de helicóptero: **Swimlane** (linha do tempo de tudo), **Treemap** (proporção por categoria e confiança), **Mapa 2D CLIP** (agrupando planos visualmente parecidos), **Matriz Cena × Material** e **Storyline** (arco narrativo dos personagens).
- ⚙️ **Debaixo do Capô:** Sub-onda 1 (Swimlane, Treemap, PCA+t-SNE sobre `/api/media/similar-batch` já existente em `media.py:503`); Sub-onda 2 (Matriz e Storyline após `scene_media` do `5C`). Inclui migração da tabela `relation` (`schema.py:363-373`) removendo `CHECK` restritivo para destravar o *Evidence/Knowledge Graph*.

### 5E — Embeddings Int8, ArcFace Real & Separação de Falantes (`⏳ Quando priorizar`)
- 🎬 **Na Sala de Corte:** Trocar o "quebra-galho" antigo de reconhecimento facial por um identificador facial de cinema (SCRFD + ArcFace 512-d) que realmente reconhece a mesma pessoa em ângulos e luzes diferentes, melhorar a busca de texto com `EmbeddingGemma 2 int8` e testar separação de falantes (`VoxLock`) em entrevistas com gente falando por cima.
- ⚙️ **Debaixo do Capô:** Substituir de verdade `pipeline.py`/`face_engine.py`/`local_backend.py` (que ainda caem em YuNet+SFace 128-d e fallback silencioso Sobel+histograma 512-d!) por **SCRFD + ArcFace 512-d** real, testar `jinqiu193/trace` (`EmbeddingGemma 2 int8 ONNX`) e corrigir a documentação enganosa anterior.

---

## 9. Estágio 6 — Qualidade de Decisão IA, Cor Criativa, WAAPI & Rodada Casa

### 6A — Grafo de Decisões Calibradas + `talho-bench` + Otimização (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** Antes de a IA sugerir quais trechos funcionam melhor numa cena, ela precisa fazer "simulado com gabarito" (`talho-bench`) e escolher os melhores títulos por torneio comparativo.
- ⚙️ **Debaixo do Capô:** Estender `system1_decisao` para granularidade por *beat*, validar portões no `talho-bench` antes de habilitar HMM/Viterbi (*RoughCut*) e rodar torneio offline **Bradley–Terry** + ajuste de prompts no `PROMPT_REGISTRY` usando feedback real de triagem.

### 6B — Cor Criativa (`Frente G G3–G6` + `OCIO §2.1` + Facetas, `⏳ Planejado`)
- 🎬 **Na Sala de Corte:** Aplicar LUTs `.cube`, receber sugestão automática equilibrada de exposição/contraste sem depender de nuvem, ajustar curvas suaves e temperatura/tint em tempo real no player.
- ⚙️ **Debaixo do Capô:** LUT técnica `.cube` (`G3`) + `ocio_manager.py` sob demanda para ACES (`G3a`), `sugestao.py` analítica P10/P90 (`G4`, substituindo `auto_grade.py` por LLM), curvas PCHIP `lut1d`+SVG + `temperature`/`tint` (`G5`), WebGL2 após gate (`G6`) + `lighting.py`/`continuidade.py`/`otio` de cor.

### 6C — Composições HTML WAAPI (`Frente D2`), Rampas, Regressão Nível 2 & Dock F6 (`⏳ Planejado`)
- 🎬 **Na Sala de Corte:** Créditos e letreiros animados com suavidade nativa (sem bibliotecas com licença restritiva), rampas suaves de velocidade/áudio no ritmo da música e comparação visual pixel-a-pixel entre o que aparece no monitor e o arquivo final.
- ⚙️ **Debaixo do Capô:** Animações com **Web Animations API (WAAPI)** nativa (sem GSAP), detecção de batidas via numpy + rampa `rate` (`F6–F8`), `Frente B Nível 2` (Program DOM × Export), fontes da UI dentro do Canvas 2D (`timelineRenderer.js`) e acabamento Drag & Dock `F6` (Window Management API, FLIP, acessibilidade).

### 6D — Execução Pós-`E1.T9`: Banco de Casa & Calibração Real (`⏳ Bloqueado por Banco de Casa / APIs`)
- 🎬 **Na Sala de Corte:** Trazer para dentro da versão nova todo o banco histórico de casa (~506 vídeos), conciliar sem perder anotações e calibrar detectores com material real de produção.
- ⚙️ **Debaixo do Capô:** Reconciliar banco local × banco de casa (escolhendo via `ponte-banco-local-casa.html`), concluir triagem (~506 vídeos + `E1.T10`), calibrar PANNs/`visao_calibrar`, testes pagos `DINO-X`/`Jev`, integrar scripts `08_plano_sequencia` ao banco e preencher `06_gabaritos_avaliacao.md`.

---

## 10. Estágio 7 — Nuvem Completa, Aprendizado Editorial, GPU Híbrida & Satélites (⏳ Sob Demanda)

- **7A — Nuvem Completa (`PLANO_NUVEM.md` `NUV.2..NUV.63`):** Cofre criptografado AES-256-GCM (DPAPI/Keychain) para chaves de API, armazenamento em Cloudflare R2 (`s3_service.py` sem egress fee e sem bloquear pasta `"originals"`), backup incremental criptografado e worker resiliente via WebSocket.
- **7B — `Editorial DNA` (`src/patterns/`):** O programa observa a diferença (*delta*) entre o corte que a IA sugeriu e o corte que você realmente deixou na timeline, aprendendo suas preferências em camadas isoladas (*Projeto → Estilo → Editor*) até sugerir montagens com a "sua cara".
- **7C — Micro-Renders Híbridos, GPU na Nuvem (BYOK + UEG) & Blender MCP:** Mandar apenas um trechinho exato por GOP (sem subir o filme inteiro) para rodar restauração ou 3D em GPUs alugadas (RunPod/Modal/Vast) ou locais (UEG), com catálogo separando modelos permissivos de modelos não-comerciais e trava ética *Archival Producers Alliance*.
- **7D — Ecossistema Satélite:** Busca B-roll multi-fonte (Internet Archive, Pexels, Loki com anonimização), recebimento de proxies via Wi-Fi direto do set de filmagem, roteamento local (`Lumi-4B`), ponte para DaVinci Resolve Free e integração com `MAM CriaLab` / `CapIAu-play`.

---

## 11. As Decisões Visuais Adiadas (Central em `docs/planos/explicativos/`)

Nenhuma decisão abaixo trava o trabalho imediato; cada uma ganhou um protótipo HTML interativo em [`docs/planos/explicativos/index.html`](../docs/planos/explicativos/index.html) para você testar visualmente antes de bater o martelo:

| Decisão | Quando decidir | O que comparar visualmente |
|---|---|---|
| **Timeline Clone da IA** *(Diretriz já definida)* | Detalhar UX fina antes de `3B` | [`timeline-clone-ia.html`](../docs/planos/explicativos/timeline-clone-ia.html): Aba/Clone vs A/B Contracampo vs Sobreposição + Undo por turno. |
| **Curva `"bezier"` vs `"s_curve"`** | Antes da `Frente F` (`2B`) | [`curvas-bezier-vs-s-curve.html`](../docs/planos/explicativos/curvas-bezier-vs-s-curve.html): implementar Bezier real no Python/JS ou padronizar em `s_curve` (Hermite Smoothstep). |
| **Espaçamento `--space-scale`** | Antes de retomar Tema | [`espacamento-space-scale.html`](../docs/planos/explicativos/espacamento-space-scale.html): expor controle de densidade da UI na Aparência ou manter fixo. |
| **Política do Reverso (1 frame)** | Estágio `2C` | [`politica-reverso.html`](../docs/planos/explicativos/politica-reverso.html): alinhar Player ao Export (`out - 1` quadro, padrão `modelo.py`) ou o oposto. |
| **Onda Lateral da Biblioteca** | Estágio `2E` (opcional) | Protótipo externo `onda-lateral.html` (20 perguntas) respeitando a barra lateral esquerda sem sobrepor painéis. |
| **Ponte Banco Local × Banco de Casa (`E1.T9`)** | Estágio `6D` | [`ponte-banco-local-casa.html`](../docs/planos/explicativos/ponte-banco-local-casa.html): `sync.py` corrigido (`1B`) vs dump/merge SQLite direto. |

---

## 12. Tradutor de Tecniquês (Glossário de Bolso)

| Termo Técnico | Tradução para a Sala de Corte |
|---|---|
| **Fachada / `Proxy` JS (`1A`)** | Um "mordomo" no código: todo o programa antigo continua pedindo informações ao mesmo endereço (`TIMELINE_STATE`), e o mordomo entrega os dados da aba ou clone ativo naquele momento. |
| **MCP (`Streamable HTTP` + `stdio_bridge`)** | Uma tomada padrão universal para plugar assistentes externos (Claude Code, Antigravity, Cursor, Gemini CLI, Hermes) dentro do Talho sem precisar copiar e colar texto à mão. |
| **Lock do Qdrant (`3A`)** | Como uma gaveta que só pode ser aberta por uma pessoa por vez: se o Talho e outro programa tentassem abrir o arquivo do banco vetorial ao mesmo tempo, dava erro. Colocar o `/mcp` dentro do servidor do Talho resolve isso. |
| **Bearer Token / CORS (`0C`, `1B`)** | Um crachá secreto local + porteiro que só atende ligações vindas do próprio computador (`127.0.0.1`), impedindo que páginas externas da internet enviem comandos ao seu editor. |
| **WAL (`Write-Ahead Logging`)** | Um caderno de rascunho seguro do banco SQLite que permite fazer cópia de segurança (`backup.py`) sem travar quem está editando ao mesmo tempo. |
| **FFV1 / Null Test (`1C`, `2B`)** | FFV1 é um formato de vídeo sem nenhuma perda (como guardar negativo perfeito). *Null test* é inverter a fase do áudio do Player contra o áudio do FFmpeg: se sobrar silêncio absoluto, a matemática dos dois é 100% idêntica. |
| **Video Receipts & `proofcut` (`1C`, `4D`)** | O recibo técnico do vídeo exportado (quantos quadros, qual duração, qual volume LUFS) e a conferência automática pós-render provando que nada saiu cortado ou fora de sincronia. |
| **GOP / Smart Cut (`4D`, `7C`)** | Um vídeo comprimido agrupa quadros em blocos chamados GOP. *Smart Cut* só recodifica os blocos da beirada onde você fez o corte e copia o miolo intacto (muito mais rápido e sem perda). |
| **LUFS** | Medida de volume percebido pelo ouvido humano (diferente do pico digital simples), usada para TV, cinema e streaming não ficarem nem baixos demais nem estourados. |
| **BT.709 / OCIO / LUT `.cube`** | BT.709 é o padrão de cores de vídeo HD; OCIO é o sistema de gerenciamento de cor de cinema; LUT `.cube` é uma tabela pronta de conversão de cores/visual. |
| **Forced Alignment (`fa-models`)** | Pegar uma transcrição que você já tem e encaixar o milissegundo exato de entrada e saída de cada palavra falada no áudio. |
| **WAAPI (`6C`)** | Sistema nativo de animações dos navegadores modernos (*Web Animations API*), usado para mover títulos sem depender de bibliotecas externas com restrições de licença (como GSAP). |
