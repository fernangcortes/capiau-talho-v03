/* =============================================================================
   CapIAu-Talho — site de apresentação
   plano.js: dados didáticos e interatividade do Plano Vivo (Estágios 0 a 7):
   - Seletor de lente global (Completa · Montador · Programador)
   - Mapa interativo de dependências em 4 pistas estilo timeline NLE
   - Diário de obra (Planejado × Realizado × Mudanças pelo caminho em 0A–1C)
   - Raio-X completo das 31 frentes (0A–7D) com esquemas SVG e código com tooltips
   - Tradutor de tecniquês filtrável
   ========================================================================== */
(() => {
    "use strict";

    const TRACKS = [
        { id: "v1", code: "V1", name: "Mesa & Clones", sub: "UI, abas e timeline", tone: "cyan" },
        { id: "v2", code: "V2", name: "Player, Som & Render", sub: "Paridade e navegador", tone: "emerald" },
        { id: "a1", code: "A1", name: "Banco, Segurança & MCP", sub: "Token, sync e 5 IAs", tone: "violet" },
        { id: "a2", code: "A2", name: "Cor, Busca, OCR & IA", sub: "Acervo e decisão", tone: "amber" },
    ];

    const DIARY = [
        {
            id: "0A",
            title: "Estágio 0A — Quick Wins UI/NLE + Color Labels",
            status: "done",
            statusLabel: "✅ Concluído",
            commits: "ae252e0 · a59fc02",
            planned: "Corrigir arraste manual das alças no Player, abrir Inspetor pelo botão da Sequência, travar Crop em ≤90%, ajustar Drag & Dock e entregar a Task 22 (8 cores nos clipes) mais controle de densidade (--space-scale).",
            delivered: "Todos os ajustes de UI/alças/Crop/Dock entregues, FPS/resolução salvos no histórico de Desfazer, eliminação de bloco triplicado de auto-config do 1º clipe, Task 22 concluída com autotestes (autoteste_color_labels.mjs e autoteste_transform_overlay_manual_ctrl.mjs).",
            changed: "Ao testar a Task 22, descobriu-se que o submenu de cores cortava na borda inferior em clipes baixos — corrigido no commit extra a59fc02. Já o controle --space-scale foi adiado de propósito para virar um simulador HTML próprio (espacamento-space-scale.html) e evitar retrabalho visual.",
        },
        {
            id: "0B",
            title: "Estágio 0B — Quick Wins Render & Paridade Fila 0",
            status: "done",
            statusLabel: "✅ Concluído",
            commits: "9972298 · ead9c01 · 4b5c023 · dbfddf3 · 945b843",
            planned: "Igualar EQ e ganho mono no FFmpeg (Frente A E0), corrigir perda de 1 quadro no export, implementar Dip to White no grafo de vídeo, alinhar desfoque de clipe aos títulos, suportar velocidade no OTIO e alinhar a curva 'bezier'.",
            delivered: "EQ com width exato de WebAudio + compensação -3 dB em mono, eof_action=pass preservando o último frame, ramo dedicado video_dip_white, gblur com FATOR_SIGMA_DESFOQUE = 1.05 (steps=4) e LinearTimeWarp no otio_export.py.",
            changed: "A decisão entre implementar a curva 'bezier' real ou padronizar os testes em 's_curve' foi separada em um comparador visual interativo (curvas-bezier-vs-s-curve.html) antes de mexermos na Frente F e nos testes de regressão.",
        },
        {
            id: "0C",
            title: "Estágio 0C — Higiene Operacional, Segurança Básica & Schema",
            status: "done",
            statusLabel: "✅ Concluído",
            commits: "44077f0 · 1c4848a · 8cc01fa · 2e57224 · a1dc7b2",
            planned: "Fechar CORS local, tirar --reload automático do padrão, escapar HTML contra XSS, adicionar face.embedding no schema, limpar chaves mortas de configuração e alinhar dependências/wiki.",
            delivered: "CORS restrito, --reload isolado sob -Dev, XSS blindado em chat.js e timelineInteraction.js (SEC-03), coluna face.embedding no CREATE TABLE, preflight real de Edge/Chrome, hardware.ai_device conectado, requirements.txt completo e docs/wiki sincronizadas.",
            changed: "Durante a limpeza de chaves antigas, a auditoria provou que assemblyai_key, deepgram_key e auphonic_key têm leitores reais no código — por isso foram preservadas em vez de apagadas às cegas.",
        },
        {
            id: "1A",
            title: "Estágio 1A — Estado da Timeline por Instância + Fachada Proxy",
            status: "done",
            statusLabel: "✅ Concluído",
            commits: "5e05296 · d2a3437",
            planned: "Extrair uma classe de estado por sequência (TimelineSequenceState) para destravar as abas de timeline (Task 25) sem quebrar o editor inteiro.",
            delivered: "TimelineSequenceState, TimelineSequenceManager (SEQUENCE_MANAGER) e fachada Proxy transparente (TIMELINE_STATE e TIMELINE_HISTORY) preservando todas as 1.555 referências em 21 arquivos e todos os autotestes + novo autoteste_timeline_sequence_state.mjs.",
            changed: "Com a nova diretriz do usuário para permitir que a IA edite diretamente em timelines 'clone' (múltiplas sequências fantasmas), o 1A já nasceu com suporte a ghostTrack, histórico isolado por instância e protótipo visual dedicado (timeline-clone-ia.html).",
        },
        {
            id: "1B",
            title: "Estágio 1B — Saneamento Crítico de Segurança & Banco",
            status: "done",
            statusLabel: "✅ Concluído",
            commits: "98656c7 · 5561def · d4957d1 · 4678990 · 6b17c9c",
            planned: "Trocar eval() do ffprobe, remover hardcodes F:/, corrigir sync.py, versionar schema SQLite e colocar autenticação local + proteção contra zip-bomb e path traversal.",
            delivered: "Guardas configuráveis em src/core/storage_guards.py, schema versionado (PRAGMA user_version) + backup consistente em WAL (src/db/backup.py), sync.py cobrindo todas as 30 tabelas + v2 + proxy_photo_ + outbox Qdrant, e token Bearer local + limites de upload em src/api/security.py.",
            changed: "A auditoria revelou que o arquivo 'src/services/task_manager.py' citado em planos antigos não existe no projeto (o real é src/core/tasks.py). Além disso, corrigimos o sync.py para parar de mutar hashes com prefixo '_imp_' e copiar os arquivos físicos antes do commit.",
        },
        {
            id: "1C",
            title: "Estágio 1C — Rede de Segurança de Render & Navegador Único",
            status: "done",
            statusLabel: "✅ Concluído",
            commits: "11efef5 · 3fe1d6b · 916cf27 · da91a0c",
            planned: "Criar navegador headless centralizado em 127.0.0.1 (Frente D1 E0–E3), montar suíte de regressão de render sem perdas (Frente B Nível 1 com ffv1) e registrar Video Receipts por exportação.",
            delivered: "Frente D1 E0–E3 completa (src/navegador/ em 127.0.0.1 + migração bit-a-bit de titulos.py/execucao.py/fidelidade.py com abort imediato no cancelamento e diagnostico_barato em 16,24 ms); Video Receipts em src/export/video_render/recibo.py (<destino>.receipt.json + GET /api/timeline/{id}/render/ultimo); e suíte tests/render_regressao/ (FFV1 + PCM s16le, mídias sintéticas com código de barras 11 bits, oráculos NumPy e 18 cenários Nível 1).",
            changed: "A entrega foi fatiada em 4 commits verificados, comprovou paridade bit-a-bit dos títulos contra o legado (ImageChops.difference == None), contornou proxies locais com --proxy-bypass-list=127.0.0.1;localhost;<-loopback>, e isolou 2 divergências já conhecidas (REVERSO_UM_QUADRO para o 2C e HD_SEM_ETIQUETA_BT709 para o 4A) via @pytest.mark.xfail(strict=True) para manter a suíte 100% verde como guarda-costas do render.",
        },
    ];

    const STAGES = [
        {
            id: "0A", stage: 0, track: "v1", status: "done", statusLabel: "✅ Concluído",
            meta: "Commits ae252e0, a59fc02 · ~1–1,5 d",
            origin: "09_quick_wins_estagio_0.md · Task 22 · Viewport/Transform/Dock",
            title: "Quick Wins UI/NLE & Rótulos de Cor (Task 22)",
            deps: [], unlocks: ["1A", "2A", "2C"],
            whyOrder: "Corrige bugs que atrapalham o uso imediato da interface e unifica trechos duplicados antes de refatorar o estado da timeline.",
            whatBreaks: "Se deixássemos as alças destruindo o Inspetor no mousemove ou 3 cópias do auto-config de clipe, o Estágio 1A herdaria código duplicado e instável.",
            metaphor: "Consertar as dobradiças frouxas da mesa de luz e colar etiquetas coloridas nas latas de filme.",
            practical: "Arrastar alças no Player ficou fluido; o botão Configurações da Sequência abre o Inspetor fechado; o Crop trava em 90% por eixo; e cada clipe ganha 8 cores pelo menu de contexto.",
            importance: "Elimina frustrações diárias do editor e reduz duplicação antes de mexer no coração da timeline.",
            diagram: [
                { t: "Arraste / Crop", s: "player.js + interaction", c: "cyan" },
                { t: "Update in-place", s: "sem recriar DOM", c: "emerald" },
                { t: "8 Color Labels", s: "Task 22 + autoteste", c: "violet" },
            ],
            code: {
                lang: "JavaScript", label: "src/ui/js/player.js (arraste manual sem travar)",
                lines: [
                    "STATE.activeTimelineCuts = cuts;",
                    "this.{{syncVideoToPlayhead()::Atualiza o frame no monitor; agora chama syncProgramViewport() no início para enquadramento fiel.}};",
                    "const interaction = window.timelineInteraction;",
                    "if (interaction && interaction.syncTransformInputsInPlace) {",
                    "    interaction.{{syncTransformInputsInPlace(localTf)::Atualiza apenas os números no Inspetor sem reconstruir os inputs — evita perder o foco durante o arraste!}};",
                    "}",
                ],
            },
            files: ["src/ui/js/player.js", "src/ui/js/timelineInteraction.js", "src/ui/js/main.js", "tests/autoteste_color_labels.mjs"],
            journey: "Desvio útil no caminho: ao testar a Task 22 na parte baixa da tela, o submenu cortava fora da janela; corrigido no commit a59fc02. Controle --space-scale foi adiado para simulador visual próprio.",
        },
        {
            id: "0B", stage: 0, track: "v2", status: "done", statusLabel: "✅ Concluído",
            meta: "Commits 9972298..945b843 · ~1,5 d",
            origin: "09_quick_wins_estagio_0.md · Frente A E0 · HyperFrames",
            title: "Quick Wins de Render & Paridade Fila 0",
            deps: [], unlocks: ["1C", "2B", "2C"],
            whyOrder: "Resolve desvios óbvios e pontuais entre o Player e o FFmpeg sem precisar esperar pela suíte completa de testes visuais.",
            whatBreaks: "Sem esses ajustes, o vídeo final continuaria perdendo o último quadro, saindo 3 dB mais baixo em áudios mono e ignorando velocidade constante no OTIO.",
            metaphor: "Calibrar a agulha e a balança da gráfica para o filme impresso bater com o monitor da ilha.",
            practical: "Áudio mono mantém o mesmo volume no arquivo final, EQ soa igual, o último frame não some, o clarão branco (Dip to White) funciona e velocidade constante exporta para o Resolve/Kdenlive.",
            importance: "Fecha 5 divergências críticas entre prévia e exportação logo na largada.",
            diagram: [
                { t: "Player WebAudio", s: "Q em dB + mono", c: "cyan" },
                { t: "Grafos FFmpeg", s: "width + pan + dip_white", c: "emerald" },
                { t: "Export / OTIO", s: "eof_action=pass + Warp", c: "violet" },
            ],
            code: {
                lang: "Python", label: "src/export/video_render/grafo_audio.py (paridade EQ WebAudio)",
                lines: [
                    "if params['hpf_hz'] > 0:",
                    "    filtros.append(f'{{highpass::Filtro passa-altas equivalente ao BiquadFilterNode do navegador.}}=f={hz}:width_type=q:{{width=1.122018::No WebAudio o Q padrão de 1 dB equivale matematicamente a 10^(1/20) ≈ 1.122018 linear.}}')",
                    "if params['low_db'] != 0.0:",
                    "    filtros.append(f'bass=g={db}:f=250:{{width_type=q:width=0.5::Converte slope S=1 de shelf no navegador para o formato aceito pelo filtro af_biquads do FFmpeg.}}')",
                ],
            },
            files: ["src/export/video_render/grafo_audio.py", "src/export/video_render/grafo_video.py", "src/export/video_render/comando.py", "src/export/otio_export.py"],
            journey: "Decisão consciente: o alinhamento da curva 'bezier' vs 's_curve' foi isolado em curvas-bezier-vs-s-curve.html para não segurar os fixes imediatos do 0B.",
        },
        {
            id: "0C", stage: 0, track: "a1", status: "done", statusLabel: "✅ Concluído",
            meta: "Commits 44077f0..a1dc7b2 · ~1–2 d",
            origin: "09_quick_wins_estagio_0.md · Plano Refatoração · Auditoria Docs",
            title: "Higiene Operacional, Segurança Básica & Schema",
            deps: [], unlocks: ["1B", "3A"],
            whyOrder: "Tranca portas óbvias (CORS/XSS) e corrige dependências quebradas antes de erguer autenticação e servidores novos.",
            whatBreaks: "Qualquer banco criado do zero quebraria ao buscar face.embedding, nomes de arquivo maliciosos podiam injetar HTML e o servidor reiniciava sozinho no meio da edição.",
            metaphor: "Trancar a porta da ilha por dentro e conferir a caixa de ferramentas antes de ligar o computador.",
            practical: "Nomes estranhos de mídia não quebram a tela do chat/timeline; o preflight testa se o Edge/Chrome abre de verdade; a chave CPU/GPU finalmente funciona.",
            importance: "Estabiliza o ambiente local e protege a interface contra falhas de segurança e schema.",
            diagram: [
                { t: "server.py / scripts", s: "CORS local + sem --reload", c: "amber" },
                { t: "chat.js / timeline", s: "Escape HTML (SEC-03)", c: "emerald" },
                { t: "schema.py + config", s: "face.embedding + ai_device", c: "cyan" },
            ],
            code: {
                lang: "JavaScript / SQL", label: "Proteção XSS + Schema completo (0C)",
                lines: [
                    "// 1) Interface escapa qualquer nome vindo de arquivo ou IA:",
                    "row.innerHTML = {{escapeHtml(clip.title)::Converte <, >, &, \" em entidades seguras — impede que um nome de arquivo rode JavaScript escondido (SEC-03).}};",
                    "",
                    "// 2) Banco já nasce com a coluna de vetor facial:",
                    "CREATE TABLE IF NOT EXISTS face ( id INTEGER PRIMARY KEY, {{embedding BLOB::Antes só existia em migração tardia; bancos novos falhavam ao gravar vetores de rosto.}} );",
                ],
            },
            files: ["src/api/server.py", "src/ui/js/chat.js", "src/db/schema.py", "requirements.txt", "scripts/launch_capiau.ps1"],
            journey: "Auditoria salvou chaves úteis: assemblyai_key, deepgram_key e auphonic_key tinham leitores reais no código e foram preservadas (só chaves realmente mortas saíram).",
        },
        {
            id: "1A", stage: 1, track: "v1", status: "done", statusLabel: "✅ Concluído",
            meta: "Commit 5e05296 · ~1,5–2 sem",
            origin: "PLANO_SUITE_NLE_CLASSICO.md · PROPOSTA_SEQUENCIA_FANTASMA_IA.md",
            title: "Timeline por Instância com Fachada Compatível",
            deps: ["0A"], unlocks: ["2A", "2D", "3B"],
            whyOrder: "Impossível ter várias abas ou clones de IA sem antes transformar a timeline global única em objetos independentes.",
            whatBreaks: "Sem a fachada Proxy compatível, seria preciso reescrever 1.555 referências em 21 arquivos de uma vez, quebrando os 44 autotestes.",
            metaphor: "Trocar uma mesa colada no chão por bandejas removíveis, mantendo um mordomo na porta para os antigos departamentos.",
            practical: "Visualmente tudo continua igual hoje, mas por baixo cada sequência agora tem cortes, trilhas, marcadores e histórico de Ctrl+Z próprios.",
            importance: "É a fundação que destrava Índice de Sequência (2A), Múltiplas Abas (2D) e Timeline Clone da IA (3B) sem retrabalho.",
            diagram: [
                { t: "21 arquivos NLE", s: "1.555 refs TIMELINE_STATE", c: "cyan" },
                { t: "Fachada Proxy", s: "createActiveFacadeProxy()", c: "amber" },
                { t: "SEQUENCE_MANAGER", s: "Aba 1 · Aba 2 · Clone IA", c: "emerald" },
            ],
            code: {
                lang: "JavaScript", label: "src/ui/js/timelineState.js:9962-9976 (código real)",
                lines: [
                    "export const SEQUENCE_MANAGER = new {{TimelineSequenceManager()::Guarda todas as sequências abertas (abas e clones da IA) e sabe qual está ativa na tela.}};",
                    "",
                    "export const TIMELINE_STATE = {{createActiveFacadeProxy(::Cria um Proxy JavaScript transparente: quem lê TIMELINE_STATE.cuts recebe os cortes da sequência ativa sem saber da troca!}}",
                    "    () => SEQUENCE_MANAGER.getActiveSequence(),",
                    "    { __isTimelineFacade: true, computeAdjustmentFadeFactor }",
                    ");",
                    "export const {{TIMELINE_HISTORY::Cada sequência agora possui sua própria pilha de Ctrl+Z (seq.history), isolando o Undo humano do Undo da IA.}} = createActiveFacadeProxy(() => SEQUENCE_MANAGER.getActiveSequence()?.history);",
                ],
            },
            files: ["src/ui/js/timelineState.js", "tests/autoteste_timeline_sequence_state.mjs"],
            journey: "Evolução importante: ganhou suporte a ghostTrack e sequências clones para a IA desde o nascimento, com protótipo em docs/planos/explicativos/timeline-clone-ia.html.",
        },
        {
            id: "1B", stage: 1, track: "a1", status: "done", statusLabel: "✅ Concluído",
            meta: "Commits 98656c7..6b17c9c · ~4–5 d",
            origin: "plano-de-refatoracao-capiau-talho.md · PLANO_NUVEM.md (NUV.43)",
            title: "Saneamento Crítico de Segurança, Sync & Banco",
            deps: ["0C"], unlocks: ["3A", "5B", "5C", "7A"],
            whyOrder: "Garante que o banco não corrompa, o sync leve o projeto inteiro sem quebrar IDs e a API local exija token antes de conectar agentes MCP.",
            whatBreaks: "Sem 1B, exportar/importar projetos perdia fotos, rostos e timelines v2, e qualquer programa na rede podia disparar rotas do sistema.",
            metaphor: "Instalar catraca com crachá, trancar o cofre dos brutos originais e revisar o caminhão de mudança do projeto.",
            practical: "Transferir um projeto entre máquinas leva todas as 30 tabelas e proxies intactos; uploads/ZIPs gigantes não travam o PC; backups ocorrem com segurança mesmo editando.",
            importance: "Remove riscos graves (eval() no ffprobe, F:/ fixo, zip-bomb, path traversal) e garante confiança absoluta nos dados.",
            diagram: [
                { t: "security.py", s: "127.0.0.1 + Bearer + anti-ZIP", c: "rose" },
                { t: "backup.py + WAL", s: "user_version + integrity_check", c: "emerald" },
                { t: "sync.py (30 tabs)", s: "mídia antes + outbox Qdrant", c: "violet" },
            ],
            code: {
                lang: "Python", label: "src/db/backup.py:67-79 (backup atômico WAL-safe)",
                lines: [
                    "{{src_conn.backup(dst_conn)::Copia as páginas do SQLite via API oficial, seguro mesmo se o editor estiver gravando dados em modo WAL.}}",
                    "_check_sqlite_integrity(dst_conn, 'Backup SQLite')",
                    "sha256_hex, size_bytes = _compute_sha256_and_size(tmp_path)",
                    "{{os.replace(tmp_path, dest_path)::Substituição atômica no sistema de arquivos: ou o backup inteiro válido vai para o lugar, ou o anterior fica intacto.}}",
                ],
            },
            files: ["src/api/security.py", "src/api/sync.py", "src/db/backup.py", "src/core/storage_guards.py", "src/media/ffmpeg.py"],
            journey: "Auditoria corrigiu falso caminho de planos antigos (task_manager.py não existe; real é src/core/tasks.py) e impediu o sync.py de mutar hashes com prefixo '_imp_'.",
        },
        {
            id: "1C", stage: 1, track: "v2", status: "done", statusLabel: "✅ Concluído",
            meta: "Commits 11efef5, 3fe1d6b, 916cf27, da91a0c",
            origin: "B_regressao_render.md · D1_navegador.md · NOVOS_PLANOS_IAS (§10) · 11_estagio_1c",
            title: "Rede de Segurança de Render + Navegador 127.0.0.1",
            deps: ["0B"], unlocks: ["2B", "3B", "4B", "4D", "6C"],
            whyOrder: "Cria um navegador único limpo e testes de vídeo sem perdas (FFV1) antes de mexer no áudio offline, revisão visual de títulos ou legendas.",
            whatBreaks: "Cada módulo continuaria abrindo Chromiums zumbis no Windows e qualquer bug de cor ou áudio no export passaria sem alarme.",
            metaphor: "Contratar um laboratório oficial com auditor sem perdas e recibo técnico assinado para cada filme.",
            practical: "Títulos renderizam via navegador seguro em 127.0.0.1 com cancelamento imediato e paridade bit-a-bit; todo export emite um recibo JSON (Video Receipt) com hashes, parâmetros FFmpeg e probe real; e 18 cenários lossless protegem o motor contra regressões.",
            importance: "Elimina processos zumbis, documenta o que saiu em cada render e protege futuras mudanças de áudio, cor e composição.",
            diagram: [
                { t: "src/navegador/ (D1)", s: "127.0.0.1 + titulos/abort", c: "emerald" },
                { t: "recibo.py (Receipts)", s: "<destino>.receipt.json", c: "cyan" },
                { t: "Frente B (18 cenários)", s: "FFV1 + PCM + oráculos", c: "violet" },
            ],
            code: {
                lang: "Python", label: "Navegador 127.0.0.1 + Recibo + Harness FFV1 (1C completo)",
                lines: [
                    "cmd = {{ajudantes.comando_intermediario(timeline)::Preserva o filter_complex real e troca só a saída para ffv1 + pcm_s16le sem perdas para medir pixels/áudio via NumPy.}}",
                    "recibo.{{gravar_recibo_export(destino, timeline, ffprobe_info)::Grava <destino>.receipt.json com sequence_sha256, hashes das mídias e dados reais do arquivo exportado.}}",
                    "nav.{{abortar()::Encerra imediatamente a árvore de processos Playwright no Windows ao cancelar o render — zero Chromium órfão.}}",
                ],
            },
            files: ["src/navegador/servidor.py", "src/export/video_render/titulos.py", "src/export/video_render/recibo.py", "tests/render_regressao/", "scripts/render_regressao.py"],
            journey: "Concluído em 4 commits: D1 E1–E2 (11efef5), D1 E0/E3 com bypass de proxy local e 16,24 ms no diagnostico_barato (3fe1d6b), Video Receipts + abort no cancelamento (916cf27) e suíte Frente B Nível 1 com 18 cenários + 2 xfail explícitos para 2C/4A (da91a0c).",
        },
        {
            id: "2A", stage: 2, track: "v1", status: "plan", statusLabel: "⏳ Planejado (Prioridade 1)",
            meta: "Estimativa: ~2–3 dias",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§3)",
            title: "Índice de Sequência (Sequence Index)",
            deps: ["1A"], unlocks: ["2D"],
            whyOrder: "Precisa do TIMELINE_STATE do 1A para ler os cortes da sequência ativa em formato de tabela e já ficar pronto para trocar de aba na Task 25.",
            whatBreaks: "Se fosse ligado direto a arrays soltos antes do 1A, mostraria a lista da sequência errada ao abrir múltiplas abas.",
            metaphor: "O índice remissivo vivo de um livro gigante de edição.",
            practical: "Painel em forma de tabela listando clipes, mídias offline, flash frames, transições, pistas mutadas e marcadores — clique para saltar até lá ou exporte CSV.",
            importance: "Acelera conferência técnica e decupagem em montagens longas.",
            diagram: [
                { t: "TIMELINE_STATE", s: "leitura somente via fachada", c: "cyan" },
                { t: "Sequence Index", s: "filtro + flash frames + offline", c: "violet" },
                { t: "Salto / CSV", s: "playhead ou planilha", c: "emerald" },
            ],
            code: {
                lang: "JavaScript", label: "Arquitetura prevista (aba nativa em tabPanels.js)",
                lines: [
                    "function buildSequenceIndexRows() {",
                    "    const cuts = {{TIMELINE_STATE.cuts::Lê via fachada Proxy (1A): se o usuário mudar de aba na Task 25, o Índice atualiza para a sequência nova automaticamente.}} || [];",
                    "    return cuts.filter(c => matchesSearch(c)).map(c => ({",
                    "        id: c.id, frame: c.timelineStart, {{isFlash: c.durationFrames <= 2::Detecta 'flash frames' — cortes acidentais de 1 ou 2 quadros invisíveis no zoom distante.}}",
                    "    }));",
                    "}",
                ],
            },
            files: ["src/ui/js/tabPanels.js", "src/ui/js/dockModel.js", "src/ui/js/timelineState.js"],
            journey: "Regra do plano: manter estritamente somente leitura via TIMELINE_STATE e registrar como aba nativa no gerenciador de abas.",
        },
        {
            id: "2B", stage: 2, track: "v2", status: "plan", statusLabel: "⏳ Planejado (Prioridade 1)",
            meta: "Estimativa: ~2,5–3 semanas",
            origin: "A_audio_paridade.md · F_audio_avancado_rampas.md · Tasks 19–21",
            title: "Áudio Completo com Paridade (VU + Borracha + Ducking)",
            deps: ["0B", "1C"], unlocks: ["4C", "6C"],
            whyOrder: "O VU Meter (Task 19) só pode ser ligado depois de extrair audioCadeia.js, e o compressor offline depende de src/navegador/ (1C) + Frente B.",
            whatBreaks: "Ligar AnalyserNode antes de unificar audioCadeia.js causa conflito de createMediaElementSource; usar specs antigas de Task 20/21 quebra a paridade com o FFmpeg.",
            metaphor: "Instalar medidores de agulha precisos, lápis de borracha na waveform e um operador automático que abaixa a música na fala.",
            practical: "VU Meter estéreo ao vivo (Task 19), borracha de volume editável com Ctrl+Clique na waveform (Task 20 / F0–F3), auto-ducking pela transcrição (Task 21 / F4–F5), trava anti-denoise em música/ambiente e teste A/B de DeepFilterNet 3.",
            importance: "Garante que todo desenho de volume e dinâmica soe idêntico na caixa de som do editor e no MP4 final.",
            diagram: [
                { t: "audioCadeia.js", s: "1 fonte → VU Meter (Task 19)", c: "cyan" },
                { t: "OfflineAudio + 1C", s: "Null test vs FFmpeg", c: "emerald" },
                { t: "Frente F (F0–F5)", s: "clip.keyframes.volume + ducking", c: "violet" },
            ],
            code: {
                lang: "JavaScript / FFmpeg", label: "Fluxo Frente F (substitui specs antigas de Task 20/21)",
                lines: [
                    "// 1) Extrair audioCadeia.js ANTES de ligar o VU Meter:",
                    "const analyser = {{audioCadeia.attachMasterAnalyser()::Usa o mesmo AudioContext único para evitar o erro clássico de ligar duas fontes ao mesmo elemento HTML.}};",
                    "// 2) Borracha de volume em frame exato com paridade FFmpeg:",
                    "clip.{{keyframes.volume::Pontos determinísticos usados tanto na rampa do player quanto no filtro volume=eval=frame com asetnsamples=256.}} = [{ frame: 120, gain: 0.35 }];",
                ],
            },
            files: ["src/ui/js/audioCadeia.js", "src/ui/js/automacaoFaixa.js", "src/export/video_render/automacao.py", "src/audio/audio_denoise.py"],
            journey: "Conflito resolvido na auditoria: especificações antigas das Tasks 20 e 21 foram substituídas integralmente pela Frente F.",
        },
        {
            id: "2C", stage: 2, track: "v2", status: "plan", statusLabel: "⏳ Planejado (Prioridade 1)",
            meta: "Estimativa: ~3–4 dias",
            origin: "plano_hyperframes/README.md (#6, #8) · PLANO_VIEWPORT_TRANSFORM_CROP.md",
            title: "Paridade de Viewport & Multi-Track no Player",
            deps: ["0A", "0B"], unlocks: ["4A", "4D"],
            whyOrder: "Resolve divergências visuais do próprio monitor Program que enganam o editor sobre o que vai sair no render.",
            whatBreaks: "Com 3 ou mais pistas de vídeo ocupadas, a pista do meio hoje simplesmente desaparece na tela do Program (Defeito #8).",
            metaphor: "Alinhar as lentes do projetor para mostrar todas as camadas transparentes empilhadas sem apagar nenhuma.",
            practical: "Composição real de 3+ pistas no Program, resolução da diferença de 1 quadro no clipe em reverso, consolidação do Crop/Fit e alinhamento do controle de volume (que ia até 200 mas travava em 100).",
            importance: "Garante confiança visual: o que você vê empilhado nas pistas é o que vai para o arquivo final.",
            diagram: [
                { t: "V1 + V2 + V3...", s: "player.js:4131-4200", c: "cyan" },
                { t: "Composição completa", s: "sem ocultar pista do meio", c: "emerald" },
                { t: "Reverso + ContentRect", s: "política definida em HTML", c: "amber" },
            ],
            code: {
                lang: "JavaScript", label: "player.js (composição multi-track + alinhamento)",
                lines: [
                    "// Defeito #8: compor TODAS as pistas de vídeo ativas, de baixo para cima",
                    "for (const track of {{visibleVideoTracksBottomToTop()::Antes a lógica considerava apenas base e topo, deixando pistas intermediárias invisíveis quando havia 3+ camadas.}}) {",
                    "    compositeTrackClip(track, {{computeContentRect(clip)::Unifica o cálculo exato de enquadramento (Fase 4) e garante limite seguro de fit no Crop (Fase 5).}});",
                    "}",
                ],
            },
            files: ["src/ui/js/player.js", "src/export/video_render/modelo.py"],
            journey: "Antes de fechar o reverso, consultar a decisão em docs/planos/explicativos/politica-reverso.html.",
        },
        {
            id: "2D", stage: 2, track: "v1", status: "plan", statusLabel: "⏳ Planejado (Prioridade 1)",
            meta: "Estimativa: ~1 semana",
            origin: "PLANO_SUITE_NLE_CLASSICO.md (Task 25)",
            title: "Task 25: Múltiplas Timelines em Abas",
            deps: ["1A", "2A"], unlocks: ["3B"],
            whyOrder: "Depende diretamente do TimelineSequenceState (1A) para cada aba ter estado próprio e do escopo por sequence_id no cache de render.",
            whatBreaks: "Sem isolar o renderCache.js por sequence_id, ao trocar de aba você veria frames pré-renderizados fantasmas da outra sequência.",
            metaphor: "Ter várias mesas de corte abertas no mesmo estúdio — Entrevista, Trailer e Corte Final — alternando em 1 clique.",
            practical: "Abas de sequência no topo da timeline, autosave separado no banco SQLite por aba e base pronta para os clones paralelos da IA.",
            importance: "Recurso essencial de qualquer ilha de edição profissional para organizar documentários e versões.",
            diagram: [
                { t: "SQLite (sequences)", s: "múltiplas por projeto", c: "violet" },
                { t: "SEQUENCE_MANAGER", s: "troca aba + autosave", c: "cyan" },
                { t: "renderCache.js", s: "isolado por sequence_id", c: "emerald" },
            ],
            code: {
                lang: "JavaScript", label: "Escopo por sequência no cache e autosave",
                lines: [
                    "const seqId = SEQUENCE_MANAGER.getActiveSequenceId();",
                    "renderCache.{{setActiveScope(seqId)::Impede que quadros em cache da 'Entrevista A' apareçam na aba 'Corte Final' e mantém bitmap.close() seguro.}};",
                    "await api.saveSequence({{project_id, sequence_id: seqId, payload::Migra da tabela antiga única para múltiplas linhas na tabela sequence do SQLite.}});",
                ],
            },
            files: ["src/ui/js/timelineState.js", "src/ui/js/renderCache.js", "src/ui/js/player.js", "src/db/schema.py"],
            journey: "Garantir que todas as trocas de aba preservem a regra de fechamento atômico de ImageBitmap (bitmap.close()) em VRAM.",
        },
        {
            id: "2E", stage: 2, track: "v1", status: "plan", statusLabel: "⏳ Opcional pós-decisão",
            meta: "Condicionado às 20 perguntas de design",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§3) · onda-lateral.html",
            title: "Onda Lateral da Biblioteca (Opcional)",
            deps: ["2D"], unlocks: [],
            whyOrder: "Não é prioridade estrutural; entra somente após Task 25 se o desenho respeitar o design system de painéis sem sobreposição.",
            whatBreaks: "Se colocada por cima de painéis existentes, violaria a regra máxima do design system NLE do Talho (painel nunca cobre outro).",
            metaphor: "Uma gaveta lateral dobrável para espiar o acervo sem tampar a bancada de trabalho.",
            practical: "Navegação rápida por arquivos presa estritamente à barra esquerda (panelRail.js).",
            importance: "Melhora conforto visual apenas se passar na revisão de usabilidade.",
            diagram: [
                { t: "20 Perguntas UX", s: "decisão do usuário", c: "amber" },
                { t: "panelRail.js", s: "coluna esquerda rígida", c: "cyan" },
                { t: "Zero sobreposição", s: "regra flat NLE", c: "emerald" },
            ],
            code: {
                lang: "CSS / JS", label: "Regra obrigatória de layout (panelRail.js)",
                lines: [
                    "// Restrição inegociável caso aprovada após a Task 25:",
                    "rail.{{attachDrawer('library-wave', { overlay: false })::Ocupa largura própria na coluna lateral empurrando o grid — nunca flutua cobrindo timeline ou inspetor.}};",
                ],
            },
            files: ["src/ui/js/panelRail.js", "src/ui/styles.css"],
            journey: "Aguardando revisão do artefato externo onda-lateral.html (fora da main).",
        },
        {
            id: "3A", stage: 3, track: "a1", status: "plan", statusLabel: "⏳ Planejado (Prioridade 2)",
            meta: "Estimativa: ~1–1,5 semana",
            origin: "PLANO_IMPLEMENTACAO.md (E4) · NOVOS_PLANOS_IAS (§10)",
            title: "Registro Único src/tools/ + MCP Multi-Harness",
            deps: ["0C", "1B"], unlocks: ["3B", "3C"],
            whyOrder: "As 5 IAs externas precisam passar por uma portaria única tipada dentro do FastAPI para não baterem de frente com o Qdrant embutido.",
            whatBreaks: "Se o servidor MCP rodasse como outro processo solto no terminal, o Qdrant travaria na hora com erro de lock de arquivo enquanto a GUI estivesse aberta.",
            metaphor: "Uma portaria única com crachá para 5 assistentes externos trabalharem na mesma sala sem trancar o arquivo.",
            practical: "Claude Code, Antigravity, Hermes Agent, Cursor e Gemini CLI ganham configs prontas para consultar acervo, transcrições e estado do editor em tempo real.",
            importance: "Unifica todas as ferramentas em src/tools/ (Pydantic), acabando com imports privados improvisados dentro do chat_agent.py.",
            diagram: [
                { t: "5 IAs (stdio_bridge)", s: "Claude, Antigravity, Cursor...", c: "violet" },
                { t: "/mcp no FastAPI", s: "Streamable HTTP + Bearer", c: "cyan" },
                { t: "src/tools/ + Qdrant", s: "1 único dono sem lock!", c: "emerald" },
            ],
            code: {
                lang: "Python", label: "Arquitetura MCP Anti-Lock (FastAPI + stdio_bridge.py)",
                lines: [
                    "@app.post('/mcp') # Roda DENTRO do processo FastAPI!",
                    "async def mcp_endpoint(request: Request, _=Depends({{require_local_token::Exige o token Bearer criado no Estágio 1B para bloquear acessos externos.}})):",
                    "    return await {{TOOL_REGISTRY.dispatch::Registro único Pydantic em src/tools/ compartilhado por UI, Chat, REST e MCP.}}(await request.json())",
                    "# Para CLIs que só falam stdio: src/mcp/stdio_bridge.py repassa para http://127.0.0.1:8000/mcp",
                ],
            },
            files: ["src/tools/", "src/mcp/stdio_bridge.py", "src/api/server.py", "src/ai/chat_agent.py"],
            journey: "Resolve de vez os imports privados encontrados pela auditoria em chat_agent.py:1088 e 1276.",
        },
        {
            id: "3B", stage: 3, track: "v1", status: "plan", statusLabel: "⏳ Planejado (Prioridade 2)",
            meta: "Estimativa: ~1–1,5 semana",
            origin: "PROPOSTA_SEQUENCIA_FANTASMA_IA.md · H_revisao_agente.md · Bypass chat_agent",
            title: "Timeline 'Clone' da IA, Fixes D1–D6 & Revisão Visual",
            deps: ["1A", "1C", "2D", "3A"], unlocks: ["3C"],
            whyOrder: "Usa o TimelineSequenceState (1A), as abas (2D), a portaria MCP (3A) e o navegador único (1C) para revisar títulos visualmente.",
            whatBreaks: "Hoje D1–D6 estão 100% quebrados e há um bypass grave em chat_agent.py:2275 onde SET_AV_OFFSET e ADD_EFFECT aplicam edições sem confirmação!",
            metaphor: "Dar à IA uma cópia da sua mesa ('Clone') onde ela testa cortes, mostra a lista de alterações e nunca toca no seu original sem OK.",
            practical: "A IA enxerga sua agulha e seleção (get_editor_state), edita numa sequência clone, mostra Changes + comparação A/B + Desfazer em 1 clique por turno, e tira foto dos títulos para revisar erros visuais (Frente H).",
            importance: "Fecha 6 bugs antigos de sugestão fantasma, tapa o bypass de edição sem confirmação e cria UX segura de co-edição com IA.",
            diagram: [
                { t: "Fix Bypass + D1–D6", s: "is_preview em todas ações", c: "rose" },
                { t: "Clone Sequência", s: "preview_compare + Undo turno", c: "cyan" },
                { t: "Frente H (via 1C)", s: "IA vê frame/título real", c: "violet" },
            ],
            code: {
                lang: "Python", label: "chat_agent.py:2275 + ferramentas WeftCut/CutVoke",
                lines: [
                    "# Fechar bypass crítico descoberto na auditoria:",
                    "ACTIONS_REQUIRING_PREVIEW = {..., {{'SET_AV_OFFSET', 'ADD_EFFECT'::Antes faltavam nesta lista; se a IA chamasse sozinha, alterava o clipe do usuário sem aprovação!}}}",
                    "# Novo ciclo seguro em sequência clone (base 1A + 2D):",
                    "clone_id = sequence_manager.{{clone_for_ai_turn::Cria uma sequência fantasma isolada; o editor compara na aba Changes ou desfaz o turno inteiro.}}(active_seq_id)",
                ],
            },
            files: ["src/ai/chat_agent.py", "src/ui/js/timelineInteraction.js", "src/ui/js/chat.js", "src/ui/js/api.js", "src/export/video_render/modelo.py"],
            journey: "UX fina da comparação Clone vs Original detalhada no protótipo docs/planos/explicativos/timeline-clone-ia.html.",
        },
        {
            id: "3C", stage: 3, track: "a1", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Estimativa: ~1 semana",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§1, §10) · PLANO_IMPLEMENTACAO.md",
            title: "Contratos entre Personas, Style Skills & Testes MCP",
            deps: ["3A", "3B"], unlocks: ["6A"],
            whyOrder: "Padroniza a conversa entre os papéis da IA e valida o servidor MCP inteiro com testes automáticos de contrato.",
            whatBreaks: "Sem contratos tipados, a Diretora manda texto livre que a Montadora interpreta mal, e o chat solta recusas hardcoded de Auphonic fora de hora.",
            metaphor: "Criar o roteiro oficial de passagem de bastão entre Diretora, Montadora e Designer de Som — com auditoria automática.",
            practical: "Respostas da equipe de IA mais consistentes, aprendizado de estilo via Style Skills (FireRed) e garantia de que atualizações não quebrem clientes MCP.",
            importance: "Profissionaliza o pipeline de agentes internos/externos com testes de contrato (MCP Inspector / @vexyo/core).",
            diagram: [
                { t: "Diretora → Montadora", s: "contrato JSON MASS", c: "violet" },
                { t: "Style Skills", s: "padrão FireRed", c: "cyan" },
                { t: "Suite MCP Contract", s: "test_f1_chat_agent + golden", c: "emerald" },
            ],
            code: {
                lang: "Python", label: "Contratos estruturados entre TIMELINE_PERSONAS",
                lines: [
                    "class {{MontadoraHandoff(BaseModel)::Schema Pydantic obrigatório entre personas (padrão MASS): elimina ambiguidade de texto livre.}}:",
                    "    beat_goals: list[str]",
                    "    style_skill: Optional[str]  # FireRed style skill aplicada",
                    "    {{allow_destructive::Sempre False por padrão — protege contra descarte sem revisão humana.}}: bool = False",
                ],
            },
            files: ["src/ai/chat_agent.py", "tests/test_f1_chat_agent.py"],
            journey: "Remover também _recusa_auphonic hardcoded quando não pertinente à tarefa atual.",
        },
        {
            id: "4A", stage: 4, track: "a2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Estimativa: ~8–9 dias",
            origin: "G_cor.md (G0–G2c) · PLANO_COR_OCIO.md (§0.3/§1.2)",
            title: "Cor Técnica Unificada (BT.709, HDR→SDR & RAW CR2)",
            deps: ["2C"], unlocks: ["6B"],
            whyOrder: "Conserta a cor na base (entrada HDR e padrão BT.709) antes de oferecer ferramentas criativas (LUTs e curvas) em 6B.",
            whatBreaks: "Aplicar LUT criativa em cima de vídeo HDR sem mapeamento HDR→SDR gera cores estouradas e lavadas no proxy.",
            metaphor: "Regular o revelador químico e a lâmpada da sala escura antes de escolher os filtros artísticos.",
            practical: "Vídeos HDR (iPhone/câmera Log) chegam com cor natural já no proxy; export HD marca bt709 corretamente; e as 1.092 fotos .CR2 param de estourar brilho automático.",
            importance: "Substitui a ideia cara de gerar um segundo proxy derivado: assa a entrada direto no proxy 720p via filtro_entrada.",
            diagram: [
                { t: "capacidades.py (G2a)", s: "lê metadata HDR/BT.709", c: "amber" },
                { t: "filtro_entrada() (G2b)", s: "tonemap direto no proxy", c: "cyan" },
                { t: "CR2 no_auto_bright", s: "preserva 1.092 fotos RAW", c: "emerald" },
            ],
            code: {
                lang: "Python", label: "src/color/transformacao.py::filtro_entrada (Frente G)",
                lines: [
                    "def {{filtro_entrada(probe_meta)::Função única compartilhada entre criação do proxy 720p e render master (descarta segundo proxy de cadeia.py).}}(probe_meta):",
                    "    if probe_meta.is_hdr:",
                    "        return 'zscale=t=linear:npl=100,tonemap=hable,zscale=p=bt709:t=bt709:m=bt709'",
                    "    return '{{in_color_matrix=bt709,format=gbrp::Evita deslocamento sutil de verde/magenta na conversão RGBA do master (G1a).}}'",
                ],
            },
            files: ["src/color/transformacao.py", "src/media/capacidades.py", "src/media/image_processing.py", "src/config/settings_registry.py"],
            journey: "Conflito de planos resolvido: descarta cadeia.py (segundo proxy) do PLANO_COR_OCIO e adota filtro_entrada da Frente G.",
        },
        {
            id: "4B", stage: 4, track: "v2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Estimativa: ~1 semana",
            origin: "C_legendas.md (E0–E9)",
            title: "Legendas Profissionais & Karaokê via D1",
            deps: ["1C"], unlocks: ["4C"],
            whyOrder: "Usa o navegador único (1C) para quebrar texto em tela e renderizar karaokê com tipografia idêntica ao player.",
            whatBreaks: "O código antigo exportava legendas por um blob JS solto em panels.js:2631 deixando subtitles_export.py morto.",
            metaphor: "Substituir legendas improvisadas por uma oficina tipográfica que respeita regras de cinema (42×2, 17 cps).",
            practical: "Quebra automática elegante em até 2 linhas de 42 caracteres, trava contra frases inventadas no silêncio, export .srt/.vtt/.ass direto do servidor e efeito karaokê.",
            importance: "Traz padrão de exibição/TV para legendagem e mata lógica duplicada no cliente.",
            diagram: [
                { t: "Bloco 'legenda'", s: "42 chars × 2 · 17 cps", c: "cyan" },
                { t: "/export/{srt,vtt,ass}", s: "subtitles_export.py", c: "emerald" },
                { t: "Karaokê (D1)", s: "render via src/navegador/", c: "violet" },
            ],
            code: {
                lang: "Python", label: "Rota unificada de legendas (Frente C)",
                lines: [
                    "@router.get('/export/{fmt}')",
                    "def export_subtitles(fmt: Literal['srt', 'vtt', 'ass'], seq_id: str):",
                    "    blocks = {{format_broadcast_lines(cues, max_chars=42, max_cps=17)::Aplica regras de legibilidade e filtro anti-alucinação antes de gerar o arquivo.}}(cues)",
                    "    return render_subtitle_file(blocks, fmt) # elimina blob morto de panels.js:2631",
                ],
            },
            files: ["src/export/subtitles_export.py", "src/ui/js/panels.js"],
            journey: "Elimina o gerador client-side morto em panels.js:2631-2679.",
        },
        {
            id: "4C", stage: 4, track: "a2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Estimativa: ~1 semana",
            origin: "E_parakeet.md · NOVOS_PLANOS_IAS_2026-11.md (§10)",
            title: "Parakeet Local + Alinhamento Forçado (fa-models)",
            deps: ["2B", "4B"], unlocks: ["5A", "5C"],
            whyOrder: "Precisa das regras de legenda (4B) e alimenta o auto-ducking fino (2B) além de preparar texto confiável para busca e capítulos (5A/5C).",
            whatBreaks: "Sem o gate PT-BR M1..M14, modelos novos podiam entrar piorando o português falado; e as tabelas dialogue_utterance/dialogue_word hoje são fantasmas.",
            metaphor: "Um estenógrafo ultrarrápido rodando na sua máquina que marca o milissegundo exato de cada sílaba.",
            practical: "Transcrição veloz sem nuvem com NVIDIA Parakeet TDT v3 e realinhamento palavra por palavra mesmo depois de você corrigir o texto da legenda.",
            importance: "Resolve o desalinhamento de transcrição editada e define um destino único para palavras no banco.",
            diagram: [
                { t: "sherpa_worker.py", s: "fatias ~60s ±5s", c: "violet" },
                { t: "Gate PT-BR M1..M14", s: "aprovação obrigatória", c: "amber" },
                { t: "fa-models", s: "tempo exato por palavra", c: "emerald" },
            ],
            code: {
                lang: "Python", label: "Subprocesso isolado sherpa_worker.py (Frente E)",
                lines: [
                    "words = {{sherpa_worker.transcribe_chunked::Roda em processo separado para proteger RAM da GUI; fatia áudios em janelas de ~60s ±5s.}}(audio_path, model='parakeet-tdt-v3')",
                    "if {{fa_models_available()::Alinhamento forçado: ajusta início e fim de cada palavra ao áudio original após edição humana.}}:",
                    "    words = realign_edited_transcript(audio_path, words)",
                ],
            },
            files: ["src/audio/sherpa_worker.py", "src/db/schema.py"],
            journey: "Decidir na implementação o destino único de dialogue_utterance/dialogue_word (hoje nunca gravadas) vs tabela transcript.",
        },
        {
            id: "4D", stage: 4, track: "v2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Estimativa: ~4–5 dias",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§10) · proofcut + ffmpeg-skill",
            title: "Verificação Pós-Render (proofcut) & Smart Cut",
            deps: ["1C", "2C"], unlocks: [],
            whyOrder: "Apoia-se nos Video Receipts do 1C e na paridade visual fechada em 2C para auditar o MP4 acabado.",
            whatBreaks: "Rodar Smart Cut em clipes com cor, velocidade ou efeitos causaria saltos de cor/tempo na junção dos GOPs.",
            metaphor: "O inspetor de qualidade que confere o rolo finalizado quadro a quadro — mais atalho sem recodificar cortes simples.",
            practical: "Após exportar, o proofcut verifica total de quadros, duração, LUFS e até confere falas por ASR; cortes retos sem efeitos exportam muito mais rápido por Smart Cut.",
            importance: "Transforma a entrega final em processo verificável e reduz drasticamente tempo de export em cortes secos.",
            diagram: [
                { t: "Export MP4", s: "Smart Cut se corte seco", c: "cyan" },
                { t: "proofcut", s: "nb_read_frames + LUFS", c: "emerald" },
                { t: "Video Receipt", s: "selo aprovado ou alerta", c: "violet" },
            ],
            code: {
                lang: "Python", label: "Guarda do Smart Cut + auditoria proofcut",
                lines: [
                    "if {{clip.has_no_effects_or_speed()::Smart Cut só é seguro em cortes diretos; qualquer filtro de cor, crop ou speed exige re-encode limpo.}}:",
                    "    export_smart_cut_gop_edges(clip) # recodifica só as bordas do GOP",
                    "receipt = {{proofcut.verify(output_mp4, expected_frames, target_lufs)::Conta quadros reais com ffprobe (nb_read_frames) e checa loudness final antes de dar OK.}}",
                ],
            },
            files: ["src/export/video_render/comando.py", "src/export/proofcut.py"],
            journey: "Smart Cut estritamente proibido em trechos com efeitos, transformação ou alteração de velocidade.",
        },
        {
            id: "5A", stage: 5, track: "a2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Estimativa: ~1–1,5 semana",
            origin: "ORDEM_DAS_ANALISES.md · PROPOSTA_BUSCA_OBJETOS.md · Chats 03/04",
            title: "Saneamento de Busca, VideoSeek & Busca por Objetos",
            deps: ["4C"], unlocks: ["5B", "5C"],
            whyOrder: "Conserta falhas silenciosas da busca atual (limite 100, LIKE inteiro, barras pretas) antes de indexar OCR e gerar mapas visuais.",
            whatBreaks: "Vídeos verticais ou com tarja preta distorcem a pontuação CLIP; buscas visuais truncavam em 100 itens; e capiau_images local precisava de reconstrução.",
            metaphor: "Limpar as lentes e tirar as molduras pretas das fotos antes de catalogar todo o arquivo.",
            practical: "Chips clicáveis de filtro por facetas na busca, busca por objetos/finalidade roteada sem API paga e resultados completos sem corte arbitrário em 100.",
            importance: "Multiplica a precisão da busca local com custo zero de API externa.",
            diagram: [
                { t: "VideoSeek Crop", s: "remove tarjas pretas", c: "amber" },
                { t: "Qdrant + SQLite", s: "pagina + video.title + tokens", c: "cyan" },
                { t: "intent_router", s: "objetos + chips facetas", c: "emerald" },
            ],
            code: {
                lang: "Python", label: "Saneamento semantic.py + rag.py + VideoSeek",
                lines: [
                    "# Antes: semantic.py:513 travava em limit=100 e rag.py fazia LIKE '%query inteira%'",
                    "clean_frame = {{videoseek.crop_static_black_bars(frame)::Remove letterbox/pillarbox estático antes do CLIP e do dHash para não comparar barras pretas!}}",
                    "results = {{qdrant.scroll_paginated::Pagina resultados em vez de cortar no item 100 e injeta video.title direto no payload.}}(collection='capiau_images')",
                ],
            },
            files: ["src/search/semantic.py", "src/search/rag.py", "src/search/intent_router.py", "src/ai/prompt_registry.py"],
            journey: "Resolver também os 2 prompts mortos detectados pela auditoria no PROMPT_REGISTRY (photo_vision e triage_batch_title).",
        },
        {
            id: "5B", stage: 5, track: "a2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Estimativa: ~1 semana",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§4) · 05_continuidade_C.md",
            title: "OCR Local (PP-OCRv6) + visual_memory Cacheado",
            deps: ["1B", "5A"], unlocks: ["5C"],
            whyOrder: "Usa RapidOCR em CPU gravando primeiro no SQLite para alimentar o vínculo automático com cenas do roteiro (5C) e a leitura pelo MCP.",
            whatBreaks: "Se o OCR gravasse direto só no Qdrant ou sem hash de invalidação, o visual_memory ficaria obsoleto após novas triagens.",
            metaphor: "Um assistente que lê cada claquete e placa na imagem e cola um resumo sempre em dia na mesa da IA.",
            practical: "Identifica número de cena/take na claquete (varredura de 2–3 fps nos 5s iniciais/finais) e acha textos que aparecem em tela nas buscas.",
            importance: "Automatiza vínculo de takes ao roteiro sem depender de visão em nuvem paga.",
            diagram: [
                { t: "RapidOCR (CPU)", s: "2-3 fps nas pontas (claquete)", c: "cyan" },
                { t: "SQLite (primeiro)", s: "video_keyframe + video_ocr", c: "emerald" },
                { t: "visual_memory", s: ".json/.md cache por hash", c: "violet" },
            ],
            code: {
                lang: "Python", label: "Pipeline OCR + memória visual cacheada",
                lines: [
                    "ocr_hits = {{rapidocr.scan_clapper(video_path, fps=2.5, edge_seconds=5)::Detector tiny + reconhecedor small em CPU (Apache-2.0) focado nos 5s iniciais e finais.}}",
                    "db.save_ocr_first(video_id, ocr_hits) # SQLite sempre antes do Qdrant",
                    "{{compile_visual_memory_if_hash_changed::Só recompila visual_memory.json/.md quando o estado do projeto muda — leitura instantânea pelo MCP!}}(project_id)",
                ],
            },
            files: ["src/vision/ocr_pipeline.py", "src/db/schema.py", "src/ai/visual_memory.py"],
            journey: "Nota da auditoria: o .venv atual já possui onnxruntime instalado para rodar RapidOCR 3.9 em CPU.",
        },
        {
            id: "5C", stage: 5, track: "a2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Estimativa: ~1 semana",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§8) · PLANO_IMPLEMENTACAO.md (P3)",
            title: "Capitularização Multimodal & Cobertura de Roteiro",
            deps: ["1B", "4C", "5A", "5B"], unlocks: ["5D"],
            whyOrder: "Funde silêncio, falantes, texto e saltos visuais em capítulos reais e cria a tabela scene_media com chaves estáveis antes das matrizes 5D.",
            whatBreaks: "A tabela media_segment atual bloqueia kind='chapter' por constraint, e replace_scenes_for_doc apagaria vínculos se não usar chaves estáveis.",
            metaphor: "Dividir entrevistas longas em capítulos de DVD e cruzar cada cena do roteiro com os takes já gravados.",
            practical: "Mostra automaticamente os tópicos de uma entrevista (marcadores exportáveis em OTIO) e gera relatório de quais cenas do roteiro ainda estão sem cobertura.",
            importance: "Liga finalmente o roteiro escrito ao material filmado de forma duradoura.",
            diagram: [
                { t: "Sinais Multimodais", s: "silêncio + speaker + CLIP", c: "cyan" },
                { t: "media_chapter", s: "tabela dedicada + OTIO", c: "emerald" },
                { t: "scene_media (P3)", s: "chaves estáveis de cena", c: "violet" },
            ],
            code: {
                lang: "SQL / Python", label: "Nova tabela dedicada + estabilidade de cenas",
                lines: [
                    "CREATE TABLE media_chapter ( id TEXT PRIMARY KEY, video_id INT, start_s REAL, title TEXT ); -- {{não força media_segment.kind::Evita violar a constraint CHECK existente em media_segment.}}",
                    "def replace_scenes_for_doc(doc_id, new_scenes):",
                    "    # {{Chave estável de scene::Preserva os vínculos existentes em scene_media mesmo quando o roteiro é reimportado ou revisado!}}",
                ],
            },
            files: ["src/db/schema.py", "src/narrative/chapters.py", "src/narrative/script_extract.py"],
            journey: "Integrar também PySceneDetect save-chapters / FFmetadata e os 5 scripts de 08_plano_sequencia.",
        },
        {
            id: "5D", stage: 5, track: "a2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Estimativa: ~1,5–2 semanas",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§7)",
            title: "5 Visualizações Operacionais & Knowledge Graph",
            deps: ["5C"], unlocks: ["6A"],
            whyOrder: "As 3 primeiras visualizações rodam sobre a rota já existente similar-batch; Matriz e Storyline dependem da tabela scene_media do 5C.",
            whatBreaks: "A rota citada em rascunhos antigos ('batch-similar') não existe (a real é /api/media/similar-batch em media.py:503), e relation tem um CHECK restritivo.",
            metaphor: "Olhar o acervo inteiro de helicóptero através de 5 painéis: linha do tempo, mapa de cores/temas, constelação visual e grafo narrativo.",
            practical: "Swimlane Temporal, Treemap por categoria/confiança, Mapa 2D CLIP (PCA+t-SNE), Matriz Cena×Material e Storyline de personagens (com sync opcional curado com Obsidian).",
            importance: "Ajuda montador e diretor a enxergarem buracos narrativos e acervos repetidos num relance.",
            diagram: [
                { t: "Onda 1 (imediata)", s: "Swimlane · Treemap · CLIP 2D", c: "cyan" },
                { t: "Onda 2 (pós-5C)", s: "Matriz Cena · Storyline", c: "violet" },
                { t: "Migra relation", s: "destrava Knowledge Graph", c: "emerald" },
            ],
            code: {
                lang: "Python / JS", label: "Rota real media.py:503 + migração Knowledge Graph",
                lines: [
                    "# Rota verificada no código real (media.py:503), invalidada em /api/search/reindex:",
                    "GET /api/media/{{similar-batch::Rascunhos citavam 'batch-similar', mas o endpoint real no backend é 'similar-batch'!}} -> calcula coordenadas PCA + t-SNE",
                    "-- Migração em schema.py:363-373 para o Evidence/Knowledge Graph:",
                    "ALTER TABLE relation ... -- remove CHECK restritivo para aceitar relações semânticas entre cenas, pessoas e evidências",
                ],
            },
            files: ["src/api/routes/media.py", "src/db/schema.py", "src/ui/js/visualizations.js"],
            journey: "Obsidian entra apenas como sincronização opcional do grafo curado após migrar o CHECK da tabela relation, nunca substituindo a busca vetorial.",
        },
        {
            id: "5E", stage: 5, track: "a2", status: "plan", statusLabel: "⏳ Quando priorizar",
            meta: "Evolução real de reconhecimento facial e texto",
            origin: "PLANO_EMBEDDINGGEMMA2.md · PLANO_MODERNIZACAO_ANALISES_IA_2026.md",
            title: "EmbeddingGemma 2 int8, ArcFace 512-d Real & VoxLock",
            deps: ["0C"], unlocks: ["6D"],
            whyOrder: "Substitui o reconhecimento facial antigo (YuNet+SFace 128-d e fallback silencioso por histograma Sobel!) que planos antigos achavam já estar trocado.",
            whatBreaks: "Confiar no estado atual sem corrigir local_backend.py mistura embeddings reais com fallback de histograma 512-d inútil para faces.",
            metaphor: "Trocar uma lupa embaçada de brinquedo por biometria facial real de cinema e busca semântica compacta.",
            practical: "Reconhecimento muito mais fiel da mesma pessoa em ângulos/luzes ruins (SCRFD + ArcFace 512-d), embeddings de texto leves int8 e teste de separação de vozes sobrepostas (VoxLock).",
            importance: "Corrige a maior divergência encontrada entre documentação antiga e código em produção.",
            diagram: [
                { t: "Remove fallback Sobel", s: "local_backend.py", c: "rose" },
                { t: "SCRFD + ArcFace 512-d", s: "face_engine + pipeline", c: "emerald" },
                { t: "Gemma 2 int8 + VoxLock", s: "ONNX leve em CPU", c: "violet" },
            ],
            code: {
                lang: "Python", label: "Substituição genuína no FacePipeline / LocalBackend",
                lines: [
                    "# Antes: planos diziam ArcFace ativo, mas face_engine.py ainda rodava SFace 128-d e Sobel!",
                    "embedding = {{arcface_engine.extract_512d(aligned_face)::Extrator ArcFace genuíno de 512 dimensões sem fallback silencioso para histograma Sobel.}}",
                    "text_vec = {{onnx_int8_embedder.encode(query)::Modelo quantizado int8 (jinqiu193/trace EmbeddingGemma 2) viável em máquina comum.}}",
                ],
            },
            files: ["src/vision/face_engine.py", "src/vision/face_pipeline.py", "src/search/local_backend.py"],
            journey: "Auditoria expôs 5 divergências graves no PLANO_MODERNIZACAO_ANALISES_IA_2026.md que serão saneadas aqui.",
        },
        {
            id: "6A", stage: 6, track: "a2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Calibração obrigatória antes de automatizar",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§1, §5) · REVISAO_CATEGORIAS.md",
            title: "Grafo de Decisões por Beat + talho-bench + MASS",
            deps: ["3C", "5D"], unlocks: ["6D", "7B"],
            whyOrder: "Nenhuma sugestão automática de descarte pode ligar antes de provar acurácia num conjunto de provas calibrado (talho-bench).",
            whatBreaks: "Em pilotos anteriores, Laya em sombra marcou apenas 2/23 e 3/20; automatizar sem gabarito jogaria takes preciosos fora.",
            metaphor: "A IA precisa fazer simulado com gabarito oficial e vencer torneios antes de opinar na sua seleção de takes.",
            practical: "Decisões granuladas por 'beat' (unidade dramática), pré-montagem estatística (HMM/Viterbi) validada no benchmark e títulos escolhidos por torneio comparativo.",
            importance: "Garante rigor científico e confiança editorial nas sugestões automáticas.",
            diagram: [
                { t: "system1_decisao", s: "granularidade por beat", c: "cyan" },
                { t: "talho-bench Gate", s: "trava contra falso descarte", c: "amber" },
                { t: "HMM/Viterbi + MASS", s: "RoughCut + Bradley–Terry", c: "emerald" },
            ],
            code: {
                lang: "Python", label: "Trava ética/técnica no talho-bench",
                lines: [
                    "score = {{talho_bench.evaluate(model_cfg, golden_set)::Compara decisões da IA contra gabarito humano por segmento antes de liberar na UI.}}",
                    "assert score.false_discard_rate <= MAX_TOLERANCE, 'Bloqueado: risco de descartar take bom!'",
                    "best_title = {{bradley_terry_tournament(candidates)::Torneio em pares para ranquear os melhores títulos e temas no PROMPT_REGISTRY.}}",
                ],
            },
            files: ["src/ai/system1_service.py", "src/ai/prompt_registry.py", "tests/talho_bench/"],
            journey: "Laya em sombra marcou 2/23 e 3/20 nos testes — reforçando a regra de jamais automatizar descarte sem calibragem no bench.",
        },
        {
            id: "6B", stage: 6, track: "a2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Após fechar Cor Técnica no Estágio 4A",
            origin: "G_cor.md (G3–G6) · PLANO_COR_OCIO.md (§1.4–§3.2)",
            title: "Cor Criativa (.cube, P10/P90, Curvas PCHIP & WebGL2)",
            deps: ["4A"], unlocks: [],
            whyOrder: "Depende da cor técnica normalizada no 4A; usa estatística P10/P90 no lugar de LLM para sugerir exposição/contraste sem custo.",
            whatBreaks: "Pedir ajuste de cor para LLM (auto_grade.py antigo) é lento e caro; a sugestão analítica P10/P90 responde na hora localmente.",
            metaphor: "Agora que a sala escura está calibrada, entram as tabelas de cor de cinema, curvas suaves e visualização imediata.",
            practical: "Importar LUTs .cube (inclusive ACES via ocio_manager sob demanda), auto-ajuste determinístico rápido, curvas suaves PCHIP sem quebras e análise de iluminação/continuidade entre planos.",
            importance: "Entrega colorização respeitável dentro do Talho e exportável em OTIO para acabamento final no Resolve.",
            diagram: [
                { t: "sugestao.py (P10/P90)", s: "substitui auto_grade LLM", c: "emerald" },
                { t: "LUT .cube + PCHIP", s: "ocio_manager + lut1d/SVG", c: "violet" },
                { t: "WebGL2 + Continuidade", s: "preview rápido + OTIO", c: "cyan" },
            ],
            code: {
                lang: "Python", label: "Sugestão analítica + LUT ACES sob demanda",
                lines: [
                    "# G4: sugestao.py substitui auto_grade.py baseado em LLM:",
                    "params = {{sugestao.analyze_percentiles(frame, low=10, high=90)::Calcula exposição e contraste ideais usando estatística de pixels local, sem chamar nuvem.}}",
                    "cube = ocio_manager.{{generate_aces_cube_on_demand::Só gera arquivo .cube ACES quando o projeto pede espaço de cor avançado (G3a).}}(src_cs, dst_cs)",
                ],
            },
            files: ["src/color/sugestao.py", "src/color/ocio_manager.py", "src/color/lighting.py", "src/color/continuidade.py"],
            journey: "Atualizar wiki/11 (que já avisa o que ainda não está pronto) somente ao concluir a Frente G.",
        },
        {
            id: "6C", stage: 6, track: "v2", status: "plan", statusLabel: "⏳ Planejado",
            meta: "Sem GSAP · Regressão Nível 2 · Dock F6",
            origin: "D2_composicoes_html.md · F_audio (F6–F8) · B_regressao · HANDOFF F6",
            title: "Composições HTML WAAPI, Rampas, Regressão N2 & Dock F6",
            deps: ["1C", "2B"], unlocks: [],
            whyOrder: "Usa o navegador único (1C) para gravar animações HTML frame a frame e validar o Program inteiro DOM × Export (Nível 2).",
            whatBreaks: "Usar GSAP traria incompatibilidade de licença com GPL-3.0; usar WAAPI nativa do navegador é 100% livre e determinístico.",
            metaphor: "Gerador de créditos animados suaves, música sincronizada à batida e inspetor fotográfico comparando tela × arquivo.",
            practical: "Letreiros animados nativos em HTML, detecção automática de batidas para rampas de velocidade, fontes da interface desenhadas direto na timeline Canvas 2D e janelas multi-monitor (Dock F6).",
            importance: "Fecha o ciclo de acabamento visual, acessibilidade por teclado e paridade pixel-a-pixel do editor.",
            diagram: [
                { t: "WAAPI Nativa (D2)", s: "animações sem GSAP", c: "cyan" },
                { t: "Batidas + Rampas", s: "F6–F8 via numpy", c: "amber" },
                { t: "Regressão Nível 2", s: "Program DOM × MP4 Export", c: "emerald" },
            ],
            code: {
                lang: "JavaScript", label: "Animação frame-exata com WAAPI nativa (sem GSAP)",
                lines: [
                    "const anim = element.{{animate(keyframes, { duration: 2000, fill: 'both' })::Web Animations API nativa do navegador: zero licença restritiva e controle exato do tempo.}};",
                    "anim.pause();",
                    "anim.{{currentTime = frameIndex * (1000 / fps)::Avança o relógio da animação exatamente quadro por quadro para o src/navegador/ capturar sem perder frames.}};",
                ],
            },
            files: ["src/ui/js/timelineRenderer.js", "src/export/video_render/composicoes_html.py", "src/ui/js/workspaceManager.js"],
            journey: "Decisão firme: GSAP proibido por questão de licença/GPL; usar somente WAAPI nativa.",
        },
        {
            id: "6D", stage: 6, track: "a2", status: "plan", statusLabel: "⏳ Bloqueado por Banco Casa / APIs",
            meta: "Quando retomar banco principal + orçamento API",
            origin: "PLANO_IMPLEMENTACAO.md (E1.T9–T10) · 06_gabaritos · 07_pendencias",
            title: "Reconciliação Banco de Casa (~506 vídeos) & Calibração Real",
            deps: ["5E", "6A"], unlocks: ["7B"],
            whyOrder: "Exige o banco real de casa disponível e as ferramentas de decisão/face/sync já maduras antes de rodar lotes pagos ou conciliar 506 vídeos.",
            whatBreaks: "Misturar o banco local de testes com o banco de casa sem usar o fluxo decidido no comparador ponte-banco-local-casa.html causaria conflito de IDs.",
            metaphor: "Trazer todo o arquivo histórico do estúdio (~506 fitas) para o novo sistema catalogado e testar contra a régua real.",
            practical: "Conciliação segura entre máquina local e banco de casa, triagem final dos ~506 vídeos, calibragem real de classificadores de áudio/visão e preenchimento dos gabaritos humanos.",
            importance: "Valida o sistema em escala de longa-metragem documental real.",
            diagram: [
                { t: "Banco Casa (E1.T9)", s: "~506 vídeos reais", c: "amber" },
                { t: "Ponte Sync vs Merge", s: "decidido via HTML 6D", c: "cyan" },
                { t: "Calibração Real", s: "PANNs + gabaritos 06", c: "emerald" },
            ],
            code: {
                lang: "Python", label: "Fluxo de reconciliação (decidir via ponte-banco-local-casa.html)",
                lines: [
                    "# Opção A: usar sync.py corrigido no Estágio 1B (30 tabelas + remapeamento de IDs)",
                    "# Opção B: dump/merge controlado em SQLite + reindex seletivo no Qdrant",
                    "{{verify_no_id_collisions_before_merge(local_db, home_db)::Checa hashes de mídia e sequence_json v2 antes de consolidar o acervo de ~506 vídeos.}}",
                ],
            },
            files: ["src/api/sync.py", "docs/agentes/proximos_chats/06_gabaritos_avaliacao.md"],
            journey: "Depende da disponibilidade do banco de casa e definição de orçamento de APIs pagas (DINO-X / Jev).",
        },
        {
            id: "7A", stage: 7, track: "a1", status: "plan", statusLabel: "⏳ Sob demanda",
            meta: "PLANO_NUVEM.md NUV.2..NUV.63",
            origin: "PLANO_NUVEM.md",
            title: "Nuvem Completa: Cofre AES-256, R2 & Worker Resiliente",
            deps: ["1B"], unlocks: ["7C"],
            whyOrder: "Constrói em cima do sync.py (1B) e de NUV.1 já pronto, guardando chaves em cofre criptografado local.",
            whatBreaks: "Subir proxies ou backups sem criptografia ou bloqueando a pasta originals quebraria o contrato de privacidade e baixo custo.",
            metaphor: "Um cofre trancado para suas senhas e um depósito na nuvem sem taxa de saída para compartilhar proxies.",
            practical: "Backup incremental criptografado, URLs assinadas temporárias no Cloudflare R2 (zero custo de egress), cofre AES-256-GCM (DPAPI/Keychain) e worker conectado por WebSocket.",
            importance: "Permite colaboração remota e backup seguro sem nunca subir os brutos pesados se você não quiser.",
            diagram: [
                { t: "Vault AES-256-GCM", s: "DPAPI / Keychain local", c: "rose" },
                { t: "s3_service.py (R2)", s: "presigned URLs · egress 0", c: "cyan" },
                { t: "Worker WebSocket", s: "backup incremental cifrado", c: "emerald" },
            ],
            code: {
                lang: "Python", label: "Configuração R2 + Cofre criptografado",
                lines: [
                    "client = boto3.client('s3', {{endpoint_url=CONFIG.R2_ENDPOINT::Hoje s3_service.py ainda não passa endpoint_url para R2; 7A corrige e ativa URLs assinadas.}})",
                    "api_key = {{vault.unseal_secret('OPENROUTER_KEY')::Lê chave cifrada com AES-256-GCM protegida pelo cofre nativo do sistema operacional.}}",
                ],
            },
            files: ["src/cloud/s3_service.py", "src/cloud/vault.py", "src/cloud/worker_ws.py"],
            journey: "NUV.1 já está em src/config.py:109-116; os itens NUV.2..NUV.63 entram sob demanda aqui.",
        },
        {
            id: "7B", stage: 7, track: "a2", status: "plan", statusLabel: "⏳ Sob demanda",
            meta: "Aprendizado editorial em 5 níveis",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§2)",
            title: "Editorial DNA (src/patterns/)",
            deps: ["6A", "6D"], unlocks: [],
            whyOrder: "Só faz sentido aprender o estilo do montador depois que a timeline de clones, a IA e os gabaritos estiverem estáveis.",
            whatBreaks: "Misturar regras de um projeto experimental com o estilo geral do editor poluirá futuras montagens se não houver isolamento estrito.",
            metaphor: "Um caderno onde o assistente anota tudo o que você mudou nas sugestões dele para entender seu ritmo de corte.",
            practical: "Compara os deltas entre o corte sugerido pela IA e o corte final que você deixou, evoluindo em 5 níveis até montar rough cuts com o seu estilo.",
            importance: "Diferencia estilo por Projeto → Estilo → Editor sem vazar preferências entre obras distintas.",
            diagram: [
                { t: "Sugestão IA vs Final", s: "calcula deltas de corte", c: "cyan" },
                { t: "Isolamento 3 camadas", s: "Projeto → Estilo → Editor", c: "amber" },
                { t: "src/patterns/", s: "Rough Cut adaptativo (5 nv)", c: "violet" },
            ],
            code: {
                lang: "Python", label: "Registro isolado de deltas editoriais",
                lines: [
                    "delta = extract_editorial_delta(ai_clone_cuts, human_final_cuts)",
                    "dna_store.record(delta, {{scope=(project_id, style_id, editor_id)::Isolamento rigoroso: estilo de um videoclipe nunca contamina o corte de um documentário observacional.}})",
                ],
            },
            files: ["src/patterns/"],
            journey: "Implementar somente quando as fases de edição assistida (3B/6A) já estiverem consolidadas em uso real.",
        },
        {
            id: "7C", stage: 7, track: "v2", status: "plan", statusLabel: "⏳ Sob demanda",
            meta: "BYOK GPU · UEG · Blender MCP · Trava APA",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§6, §9)",
            title: "Micro-Renders Híbridos, GPU Nuvem & Blender MCP",
            deps: ["7A"], unlocks: [],
            whyOrder: "Usa a nuvem R2 (7A) e o recorte GOP exato para processar trechos pesados em GPU alugada sem subir o filme inteiro.",
            whatBreaks: "Misturar modelos de licença comercial restritiva (NC) no mesmo catálogo que modelos livres geraria risco jurídico para produtoras.",
            metaphor: "Mandar só 4 segundos exatos do filme para uma placa de vídeo gigante na nuvem limpar e devolver com selo ético.",
            practical: "Probe de 10 MB + microbenchmark 8–16 frames para estimar custo antes de rodar; container BYOK (RunPod/Modal/Vast) ou cluster UEG; catálogo em duas vias (Permissivo vs NC isolado); Blender MCP e trava ética Archival Producers Alliance.",
            importance: "Traz restauração/geração pesada com transparência total de custo, integridade SHA-256 e ética documental.",
            diagram: [
                { t: "Recorte GOP + SHA-256", s: "probe 10MB + 8-16 frames", c: "cyan" },
                { t: "R2 + Worker GPU", s: "BYOK (RunPod/Modal) · UEG", c: "violet" },
                { t: "2 Vias + Trava APA", s: "Permissivo × NC isolado", c: "amber" },
            ],
            code: {
                lang: "Python", label: "Microbenchmark + separação de licença no catálogo",
                lines: [
                    "est = {{microbenchmark_8_16_frames::Roda uma amostra minúscula e informa tempo e custo exatos antes de enviar o trecho real.}}(gop_slice_path)",
                    "if model.license == 'NC': {{require_explicit_noncommercial_banner()::Mantém modelos não-comerciais isolados com aviso obrigatório e respeita diretrizes da Archival Producers Alliance.}}",
                ],
            },
            files: ["src/cloud/hybrid_render.py", "src/cloud/blender_bridge.py"],
            journey: "Catálogo obrigatório em duas vias (permissiva vs NC isolada com aviso) + trava ética Archival Producers Alliance.",
        },
        {
            id: "7D", stage: 7, track: "a1", status: "plan", statusLabel: "⏳ Sob demanda",
            meta: "Ecossistema externo & integrações de set",
            origin: "NOVOS_PLANOS_IAS_2026-11.md (§11)",
            title: "Ecossistema Satélite (B-Roll, Wi-Fi Set & Resolve)",
            deps: ["3A", "7A"], unlocks: [],
            whyOrder: "Integrações satélite externas ficam para o fim para não dispersar esforço antes de fechar o coração do editor.",
            whatBreaks: "Integrar pontes externas antes de estabilizar o formato de sequência v2 e o MCP exigiria refazer as integrações várias vezes.",
            metaphor: "Construir as estradas ligando o estúdio ao set de filmagem, arquivos públicos e outras ilhas.",
            practical: "Busca B-roll multi-fonte (Internet Archive, Pexels, Loki com anonimização), recepção de proxies Wi-Fi direto do set, roteamento local UEG (Lumi-4B/needle2), ponte DaVinci Resolve Free e integração MAM CriaLab / CapIAu-play / Communicator Set.",
            importance: "Conecta o CapIAu-Talho ao fluxo completo de campo, arquivo público e finalização externa.",
            diagram: [
                { t: "Acervos + Wi-Fi Set", s: "Archive · Pexels · proxies", c: "cyan" },
                { t: "Roteamento UEG", s: "Lumi-4B / needle2", c: "violet" },
                { t: "Pontes Externas", s: "Resolve · CriaLab · CapIAu-play", c: "emerald" },
            ],
            code: {
                lang: "Python", label: "Satélites plugáveis após núcleo estável",
                lines: [
                    "# Só acoplado após o núcleo NLE (E2) e MCP (E3) estarem maduros:",
                    "broll = {{search_public_archives(query, sources=['archive_org', 'pexels', 'loki'], anonymize=True)::Busca imagens de cobertura em múltiplas fontes públicas anonimizando consultas quando ativado.}}",
                ],
            },
            files: ["src/satellites/"],
            journey: "Execução sob demanda, sem interferir na estabilidade da linha principal do editor.",
        },
    ];

    const GLOSSARY = [
        { term: "Fachada / Proxy JS (1A)", aka: "TIMELINE_STATE, TIMELINE_HISTORY", def: "Um 'mordomo' no código: 21 arquivos antigos continuam pedindo dados no mesmo lugar de sempre, e o Proxy entrega os cortes da aba ou clone ativo sem ninguém quebrar." },
        { term: "MCP (Streamable HTTP + stdio)", aka: "Estágio 3A · 5 Harnesses", def: "Uma tomada universal para assistentes externos (Claude Code, Antigravity, Cursor, Gemini CLI, Hermes) operarem ferramentas do Talho com segurança, sem copiar/colar texto à mão." },
        { term: "Lock do Qdrant", aka: "Por que /mcp roda no FastAPI", def: "O banco vetorial Qdrant embutido tranca sua pasta se dois programas tentarem abri-la ao mesmo tempo. Rodar o /mcp dentro do próprio servidor do Talho mantém 1 único dono e zero erro." },
        { term: "Token Bearer & CORS", aka: "Segurança local (0C, 1B)", def: "Crachá secreto local + porteiro que só atende requisições do próprio computador (127.0.0.1), impedindo que sites abertos em outras abas disparem comandos no seu editor." },
        { term: "WAL (Write-Ahead Logging)", aka: "Backup consistente (1B)", def: "Modo do SQLite que anota mudanças num caderno de rascunho paralelo, permitindo fazer backup íntegro (backup.py) mesmo enquanto você continua editando." },
        { term: "FFV1 & Null Test", aka: "Frente B · Prova do Render", def: "FFV1 é um formato de vídeo sem perdas (negativo perfeito). Null Test inverte a fase do som do Player contra o export: se o resultado der silêncio absoluto, a paridade é 100%." },
        { term: "Video Receipts & proofcut", aka: "Estágios 1C e 4D", def: "Recibo JSON gerado a cada exportação com frames, duração e LUFS reais, conferido pelo proofcut após o render para garantir que nada saiu cortado." },
        { term: "GOP & Smart Cut", aka: "Estágios 4D e 7C", def: "Vídeos comprimidos guardam quadros em blocos chamados GOP. Smart Cut só recodifica as beiradas do corte e copia o miolo intacto quando não há filtros de cor ou velocidade." },
        { term: "LUFS", aka: "Loudness perceptual", def: "Medida de volume percebido pelo ouvido humano (padrão de cinema, TV e streaming), muito mais confiável do que apenas olhar o pico digital em dBFS." },
        { term: "BT.709 / OCIO / LUT .cube", aka: "Estágios 4A e 6B", def: "BT.709 é o padrão oficial de cor HD; OCIO é o padrão de gerenciamento de cor de cinema; LUT .cube é uma tabela pronta de transformação de cor." },
        { term: "Forced Alignment (fa-models)", aka: "Estágio 4C", def: "Alinha milissegundo a milissegundo uma transcrição já escrita contra o áudio real — essencial para legendas editadas e auto-ducking exato." },
        { term: "WAAPI", aka: "Estágio 6C (Frente D2)", def: "Sistema nativo de animação do navegador (Web Animations API). Permite animar títulos HTML frame a frame sem usar bibliotecas como GSAP que trazem conflito de licença GPL." },
        { term: "SCRFD + ArcFace 512-d", aka: "Estágio 5E (Faces)", def: "Dupla moderna de detecção e assinatura facial (512 números únicos por rosto) que reconhece a mesma pessoa sob iluminação e ângulos difíceis." },
        { term: "Timeline Clone / Sequência Fantasma", aka: "Estágios 1A, 2D e 3B", def: "Cópia isolada da sua timeline onde a IA testa edições sem tocar na sequência original. Você compara A/B, revisa a aba Changes e aceita ou desfaz tudo em 1 clique." },
    ];

    /* ── Helpers ──────────────────────────────────────────────────────────── */
    const esc = (s) => String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const stageMap = new Map(STAGES.map((s) => [s.id, s]));

    let activeLens = "both";
    let selectedMapId = "1A";
    let filterStage = "all";
    let filterStatus = "all";
    let filterQuery = "";
    const collapsedSet = new Set();

    // Inicia estágios 4–7 recolhidos para a página abrir leve e focada, mas 0–3 abertos (e buscas/expand-all abrem tudo)
    STAGES.forEach((s) => {
        if (s.stage >= 4) collapsedSet.add(s.id);
    });

    /* ── 1. Seletor de Lente Global ───────────────────────────────────────── */
    function initLens() {
        const app = document.querySelector("[data-plano-app]");
        const buttons = Array.from(document.querySelectorAll("[data-lens-value]"));
        if (!app || !buttons.length) return;

        const apply = (val) => {
            activeLens = val;
            app.setAttribute("data-lens", val);
            buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lensValue === val)));
        };

        buttons.forEach((b) => {
            b.addEventListener("click", () => apply(b.dataset.lensValue));
        });
    }

    /* ── 2. Mapa Interativo em 4 Pistas ───────────────────────────────────── */
    function renderMap() {
        const tracksEl = document.getElementById("pl-map-tracks");
        const inspectorEl = document.getElementById("pl-map-inspector");
        if (!tracksEl || !inspectorEl) return;

        const current = stageMap.get(selectedMapId) || STAGES[0];
        const deps = new Set(current.deps);
        const unlocks = new Set(current.unlocks);

        tracksEl.innerHTML = TRACKS.map((tr) => {
            const items = STAGES.filter((s) => s.track === tr.id);
            const nodesHtml = items.map((item) => {
                const cls = ["pl-node", `pl-node--${item.status}`];
                if (item.id === current.id) cls.push("is-selected");
                else if (deps.has(item.id)) cls.push("is-dep");
                else if (unlocks.has(item.id)) cls.push("is-unlock");
                else cls.push("is-dim");

                return `<button type="button" class="${cls.join(" ")}" data-map-id="${esc(item.id)}" aria-pressed="${item.id === current.id}">
                    <span class="pl-node__id">${esc(item.id)}</span>
                    <span>${esc(item.title.split(":")[0].split("(")[0].trim().slice(0, 24))}</span>
                </button>`;
            }).join("");

            return `<div class="pl-track-row">
                <div class="pl-track-head pl-track-head--${esc(tr.id)}">
                    <span class="pl-track-head__code">${esc(tr.code)}</span>
                    <span class="pl-track-head__name">${esc(tr.name)}</span>
                    <span class="pl-track-head__sub">${esc(tr.sub)}</span>
                </div>
                <div class="pl-track-lane">${nodesHtml}</div>
            </div>`;
        }).join("");

        const depPills = current.deps.length
            ? current.deps.map((id) => `<button type="button" class="pl-dep-pill pl-dep-pill--amber" data-map-jump="${esc(id)}">← ${esc(id)}</button>`).join("")
            : `<span class="muted" style="font-size:0.84rem">Nenhum (ponto de partida)</span>`;

        const unlockPills = current.unlocks.length
            ? current.unlocks.map((id) => `<button type="button" class="pl-dep-pill pl-dep-pill--violet" data-map-jump="${esc(id)}">${esc(id)} →</button>`).join("")
            : `<span class="muted" style="font-size:0.84rem">Entrega final deste ramo</span>`;

        inspectorEl.innerHTML = `
            <div class="pl-inspector__top">
                <div>
                    <div class="cluster" style="--cluster-gap:8px;">
                        <span class="pl-code-badge pl-code-badge--${esc(current.status)}">${esc(current.id)}</span>
                        <span class="chip ${current.status === "done" ? "chip--emerald" : current.status === "wip" ? "chip--cyan" : "chip--violet"}">${esc(current.statusLabel)}</span>
                        <span class="pl-stage-card__origin" style="margin:0">${esc(current.meta)}</span>
                    </div>
                    <h3 class="pl-inspector__title">${esc(current.title)}</h3>
                </div>
                <button type="button" class="btn btn--cyan btn--sm" data-open-stage="${esc(current.id)}">Ver explicação completa + código ↓</button>
            </div>
            <div class="pl-inspector__grid">
                <div class="pl-inspector__box">
                    <div class="pl-inspector__label">Por que vem nesta posição?</div>
                    <p>${esc(current.whyOrder)}</p>
                </div>
                <div class="pl-inspector__box">
                    <div class="pl-inspector__label">O que quebraria se invertêssemos?</div>
                    <p>${esc(current.whatBreaks)}</p>
                </div>
                <div class="pl-inspector__box">
                    <div class="pl-inspector__label">Metáfora da sala de corte</div>
                    <p>${esc(current.metaphor)}</p>
                </div>
            </div>
            <div class="pl-inspector__links">
                <div class="pl-dep-group"><span class="pl-dep-group__lbl">Precisa antes:</span>${depPills}</div>
                <div class="pl-dep-group"><span class="pl-dep-group__lbl">Destrava depois:</span>${unlockPills}</div>
            </div>
        `;
    }

    function initMapEvents() {
        const wrap = document.querySelector(".pl-map-wrap");
        if (!wrap) return;
        wrap.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-map-id], [data-map-jump]");
            if (btn) {
                selectedMapId = btn.dataset.mapId || btn.dataset.mapJump;
                renderMap();
                return;
            }
            const openBtn = e.target.closest("[data-open-stage]");
            if (openBtn) {
                jumpToStageCard(openBtn.dataset.openStage);
            }
        });
    }

    /* ── 3. Diário de Obra (0A–1C) ────────────────────────────────────────── */
    function renderDiary() {
        const grid = document.getElementById("pl-diary-grid");
        if (!grid) return;

        grid.innerHTML = DIARY.map((d) => `
            <article class="card pl-diary-card ${d.status === "wip" ? "pl-diary-card--wip" : ""}" data-reveal data-glow>
                <div class="pl-diary-card__head">
                    <div class="cluster" style="--cluster-gap:8px">
                        <span class="pl-diary-card__code">${esc(d.id)}</span>
                        <span class="chip ${d.status === "wip" ? "chip--cyan" : "chip--emerald"}">${esc(d.statusLabel)}</span>
                    </div>
                    <span class="pl-diary-card__commits">${esc(d.commits)}</span>
                </div>
                <h3 class="card__title">${esc(d.title)}</h3>
                <div class="pl-diary-cols">
                    <div class="pl-diary-step">
                        <div class="pl-diary-step__kicker">1. O que estava previsto no plano</div>
                        <p>${esc(d.planned)}</p>
                    </div>
                    <div class="pl-diary-step">
                        <div class="pl-diary-step__kicker">2. O que foi entregue de fato</div>
                        <p>${esc(d.delivered)}</p>
                    </div>
                    <div class="pl-diary-step pl-diary-step--shift">
                        <div class="pl-diary-step__kicker">3. O que mudou ou foi descoberto no caminho</div>
                        <p>${esc(d.changed)}</p>
                    </div>
                </div>
            </article>
        `).join("");
    }

    /* ── 4. Gerador de Diagrama SVG + Código Anotado com Tooltips ─────────── */
    function toneStroke(c) {
        if (c === "emerald") return "#34d399";
        if (c === "violet") return "#a78bfa";
        if (c === "amber") return "#fbbf24";
        if (c === "rose") return "#f472b6";
        return "#22d3ee";
    }

    function buildDiagramSvg(nodes, stageId) {
        const boxes = nodes.slice(0, 3);
        const xs = [12, 224, 436];
        const parts = [];
        boxes.forEach((b, i) => {
            const x = xs[i];
            const col = toneStroke(b.c);
            parts.push(`
                <rect x="${x}" y="12" width="172" height="62" rx="10" fill="rgba(255,255,255,0.03)" stroke="${col}" stroke-opacity="0.55" stroke-width="1.3"/>
                <text x="${x + 12}" y="35" fill="#f2f1f6" font-family="Inter, sans-serif" font-size="12" font-weight="600">${esc(b.t)}</text>
                <text x="${x + 12}" y="55" fill="#9ca3af" font-family="monospace" font-size="10.2">${esc(b.s)}</text>
            `);
            if (i < boxes.length - 1) {
                const ax = x + 176;
                parts.push(`
                    <line x1="${ax}" y1="43" x2="${ax + 28}" y2="43" stroke="#64748b" stroke-width="1.6" stroke-dasharray="3 3"/>
                    <polygon points="${ax + 34},43 ${ax + 26},38 ${ax + 26},48" fill="#22d3ee"/>
                `);
            }
        });
        return `<svg viewBox="0 0 620 86" role="img" aria-label="Fluxo de módulos do sub-estágio ${esc(stageId)}">${parts.join("")}</svg>`;
    }

    function renderAnnotatedLine(line) {
        // Substitui {{texto::explicacao}} ou {{texto::titulo::explicacao}} por botões interativos de tooltip
        let out = "";
        let lastIndex = 0;
        const re = /\{\{(.+?)::(.+?)\}\}/g;
        let m;
        while ((m = re.exec(line)) !== null) {
            out += esc(line.slice(lastIndex, m.index));
            const codeToken = m[1];
            const rest = m[2];
            const sepIdx = rest.indexOf("::");
            const tipTitle = sepIdx !== -1 ? rest.slice(0, sepIdx) : codeToken;
            const tipBody = sepIdx !== -1 ? rest.slice(sepIdx + 2) : rest;
            out += `<button type="button" class="pl-tip-token" data-tip-title="${esc(tipTitle)}" data-tip-body="${esc(tipBody)}">${esc(codeToken)}</button>`;
            lastIndex = re.lastIndex;
        }
        out += esc(line.slice(lastIndex));
        return out;
    }

    function renderStages() {
        const listEl = document.getElementById("pl-cards-list");
        const countEl = document.getElementById("pl-results-count");
        if (!listEl) return;

        const q = filterQuery.trim().toLowerCase();
        const filtered = STAGES.filter((s) => {
            if (filterStage !== "all" && String(s.stage) !== filterStage) return false;
            if (filterStatus !== "all" && s.status !== filterStatus) return false;
            if (q) {
                const hay = [
                    s.id, s.title, s.origin, s.metaphor, s.practical, s.importance,
                    s.journey, s.files.join(" "), s.code.lines.join(" "),
                ].join(" ").toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        if (countEl) {
            countEl.textContent = `Mostrando ${filtered.length} de ${STAGES.length} frentes`;
        }

        if (!filtered.length) {
            listEl.innerHTML = `<div class="pl-empty">
                <p>Nenhuma frente encontrada para esse filtro ou busca. Limpe a caixa de busca ou escolha <strong>Todos (31)</strong>.</p>
            </div>`;
            return;
        }

        listEl.innerHTML = filtered.map((s) => {
            const isCollapsed = !q && collapsedSet.has(s.id);
            const codeHtml = s.code.lines.map(renderAnnotatedLine).join("\n");
            const filesHtml = s.files.map((f) => `<code>${esc(f)}</code>`).join("");
            const depLinks = s.deps.length
                ? s.deps.map((d) => `<button type="button" class="pl-dep-pill pl-dep-pill--amber" data-card-jump="${esc(d)}">← ${esc(d)}</button>`).join("")
                : `<span class="muted">Sem pré-requisito</span>`;
            const unLinks = s.unlocks.length
                ? s.unlocks.map((d) => `<button type="button" class="pl-dep-pill pl-dep-pill--violet" data-card-jump="${esc(d)}">${esc(d)} →</button>`).join("")
                : `<span class="muted">Final deste ramo</span>`;

            return `
            <article class="pl-stage-card ${isCollapsed ? "is-collapsed" : ""}" id="stage-${esc(s.id)}" data-stage-id="${esc(s.id)}">
                <header class="pl-stage-card__top">
                    <div>
                        <div class="pl-stage-card__idwrap">
                            <span class="pl-code-badge pl-code-badge--${esc(s.status)}">${esc(s.id)}</span>
                            <span class="chip ${s.status === "done" ? "chip--emerald" : s.status === "wip" ? "chip--cyan" : "chip--violet"}">${esc(s.statusLabel)}</span>
                            <span class="pl-stage-card__origin" style="margin:0">${esc(s.meta)}</span>
                        </div>
                        <h3 class="pl-stage-card__title">${esc(s.title)}</h3>
                        <p class="pl-stage-card__origin">Origem no plano: ${esc(s.origin)}</p>
                    </div>
                    <button type="button" class="pl-stage-card__toggle" data-toggle-card="${esc(s.id)}" aria-expanded="${!isCollapsed}">
                        ${isCollapsed ? "Expandir detalhes ↓" : "Recolher ↑"}
                    </button>
                </header>

                <div class="pl-stage-card__body">
                    <div class="pl-dual">
                        <section class="pl-pane pl-pane--editor" data-lens-panel="editor" aria-label="Visão da Sala de Corte para ${esc(s.id)}">
                            <div class="pl-pane__kicker">🎬 Na Sala de Corte (Leigo / Montador)</div>
                            <div class="pl-fact">
                                <div class="pl-fact__lbl">Metáfora</div>
                                <p class="pl-fact__txt">${esc(s.metaphor)}</p>
                            </div>
                            <div class="pl-fact">
                                <div class="pl-fact__lbl">Na prática, o que entrega ao editor</div>
                                <p class="pl-fact__txt">${esc(s.practical)}</p>
                            </div>
                            <div class="pl-fact">
                                <div class="pl-fact__lbl">Por que é vital para o programa</div>
                                <p class="pl-fact__txt">${esc(s.importance)}</p>
                            </div>
                        </section>

                        <section class="pl-pane pl-pane--dev" data-lens-panel="dev" aria-label="Visão Técnica para ${esc(s.id)}">
                            <div class="pl-pane__kicker">⚙️ Debaixo do Capô (Código + Esquema)</div>
                            <div class="pl-diagram">${buildDiagramSvg(s.diagram, s.id)}</div>
                            <div class="pl-codebox">
                                <div class="pl-codebox__bar">
                                    <span>${esc(s.code.lang)} · ${esc(s.code.label)}</span>
                                    <span class="pl-codebox__hint">Passe o mouse ou clique nos destaques</span>
                                </div>
                                <pre><code>${codeHtml}</code></pre>
                                <div class="pl-tip-readout" data-tip-readout>
                                    <strong>Dica interativa:</strong> selecione qualquer trecho sublinhado em ciano acima para ler o que ele faz.
                                </div>
                            </div>
                        </section>
                    </div>

                    <div class="pl-stage-foot">
                        <div class="callout ${s.status === "done" ? "callout--emerald" : s.status === "wip" ? "" : "callout--amber"}">
                            <p><strong>${s.status === "plan" ? "Cuidado de percurso / Auditoria:" : "O que mudou pelo caminho:"}</strong> ${esc(s.journey)}</p>
                        </div>
                        <div class="pl-inspector__links" style="margin-top:0">
                            <div class="pl-dep-group"><span class="pl-dep-group__lbl">Depende de:</span>${depLinks}</div>
                            <div class="pl-dep-group"><span class="pl-dep-group__lbl">Destrava:</span>${unLinks}</div>
                        </div>
                        <div class="pl-files"><span>Arquivos-chave:</span>${filesHtml}</div>
                    </div>
                </div>
            </article>`;
        }).join("");
    }

    function jumpToStageCard(stageId) {
        if (!stageMap.has(stageId)) return;
        // Garante que o card estará visível mesmo se filtros anteriores estivessem ocultando
        filterStage = "all";
        filterStatus = "all";
        filterQuery = "";
        const input = document.getElementById("pl-search-input");
        if (input) input.value = "";
        syncFilterPills();
        collapsedSet.delete(stageId);
        renderStages();

        const card = document.getElementById(`stage-${stageId}`);
        if (card) {
            card.scrollIntoView({ behavior: window.Talho?.motion?.on ? "smooth" : "auto", block: "start" });
            card.classList.add("is-flash");
            setTimeout(() => card.classList.remove("is-flash"), 1600);
        }
    }

    function syncFilterPills() {
        document.querySelectorAll("[data-stage-filter]").forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.stageFilter === filterStage);
        });
        document.querySelectorAll("[data-status-filter]").forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.statusFilter === filterStatus);
        });
    }

    function initExplorerEvents() {
        document.querySelectorAll("[data-stage-filter]").forEach((btn) => {
            btn.addEventListener("click", () => {
                filterStage = btn.dataset.stageFilter;
                // Se escolheu um estágio específico, expande os cards dele para facilitar leitura
                if (filterStage !== "all") {
                    STAGES.forEach((s) => {
                        if (String(s.stage) === filterStage) collapsedSet.delete(s.id);
                    });
                }
                syncFilterPills();
                renderStages();
            });
        });

        document.querySelectorAll("[data-status-filter]").forEach((btn) => {
            btn.addEventListener("click", () => {
                filterStatus = btn.dataset.statusFilter;
                if (filterStatus !== "all") {
                    STAGES.forEach((s) => {
                        if (s.status === filterStatus) collapsedSet.delete(s.id);
                    });
                }
                syncFilterPills();
                renderStages();
            });
        });

        const searchEl = document.getElementById("pl-search-input");
        searchEl?.addEventListener("input", () => {
            filterQuery = searchEl.value || "";
            renderStages();
        });

        document.getElementById("pl-expand-all")?.addEventListener("click", () => {
            collapsedSet.clear();
            renderStages();
        });

        document.getElementById("pl-collapse-all")?.addEventListener("click", () => {
            STAGES.forEach((s) => collapsedSet.add(s.id));
            renderStages();
        });

        const listEl = document.getElementById("pl-cards-list");
        listEl?.addEventListener("click", (e) => {
            const toggleBtn = e.target.closest("[data-toggle-card]");
            if (toggleBtn) {
                const id = toggleBtn.dataset.toggleCard;
                if (collapsedSet.has(id)) collapsedSet.delete(id);
                else collapsedSet.add(id);
                renderStages();
                return;
            }
            const jumpBtn = e.target.closest("[data-card-jump]");
            if (jumpBtn) {
                jumpToStageCard(jumpBtn.dataset.cardJump);
            }
        });
    }

    /* ── 5. Tooltips Interativos de Código ────────────────────────────────── */
    function initCodeTooltips() {
        const tip = document.getElementById("pl-tooltip");
        const tipTitle = document.getElementById("pl-tooltip-title");
        const tipBody = document.getElementById("pl-tooltip-body");
        if (!tip || !tipTitle || !tipBody) return;

        let activeBtn = null;

        const show = (btn) => {
            if (!btn) return;
            if (activeBtn && activeBtn !== btn) activeBtn.classList.remove("is-active");
            activeBtn = btn;
            btn.classList.add("is-active");

            const title = btn.dataset.tipTitle || "";
            const body = btn.dataset.tipBody || "";

            // Atualiza também a barra de leitura fixa dentro do bloco de código (excelente no celular)
            const readout = btn.closest(".pl-codebox")?.querySelector("[data-tip-readout]");
            if (readout) {
                readout.innerHTML = `<strong>${esc(title)}:</strong> ${esc(body)}`;
            }

            tipTitle.textContent = title;
            tipBody.textContent = body;
            tip.classList.add("is-open");
            tip.setAttribute("aria-hidden", "false");

            const r = btn.getBoundingClientRect();
            const tw = tip.offsetWidth || 300;
            const th = tip.offsetHeight || 110;
            const left = Math.max(12, Math.min(window.innerWidth - tw - 12, r.left + r.width / 2 - tw / 2));
            let top = r.top - th - 10;
            if (top < 74) top = r.bottom + 10;
            tip.style.left = `${left}px`;
            tip.style.top = `${top}px`;
        };

        const hide = () => {
            tip.classList.remove("is-open");
            tip.setAttribute("aria-hidden", "true");
            if (activeBtn) {
                activeBtn.classList.remove("is-active");
                activeBtn = null;
            }
        };

        document.addEventListener("pointerover", (e) => {
            const btn = e.target.closest(".pl-tip-token");
            if (btn) show(btn);
        });
        document.addEventListener("pointerout", (e) => {
            const btn = e.target.closest(".pl-tip-token");
            if (btn && (!e.relatedTarget || !e.relatedTarget.closest?.(".pl-tip-token"))) {
                hide();
            }
        });
        document.addEventListener("focusin", (e) => {
            const btn = e.target.closest(".pl-tip-token");
            if (btn) show(btn);
        });
        document.addEventListener("focusout", (e) => {
            if (e.target.closest?.(".pl-tip-token")) hide();
        });
        document.addEventListener("click", (e) => {
            const btn = e.target.closest(".pl-tip-token");
            if (btn) show(btn);
            else if (!e.target.closest("#pl-tooltip")) hide();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") hide();
        });
        window.addEventListener("scroll", hide, { passive: true });
    }

    /* ── 6. Tradutor de Tecniquês (Glossário) ─────────────────────────────── */
    function renderGlossary(query = "") {
        const grid = document.getElementById("pl-glossary-grid");
        const countEl = document.getElementById("pl-glossary-count");
        if (!grid) return;

        const q = query.trim().toLowerCase();
        const items = GLOSSARY.filter((g) => {
            if (!q) return true;
            return `${g.term} ${g.aka} ${g.def}`.toLowerCase().includes(q);
        });

        if (countEl) {
            countEl.textContent = `${items.length} de ${GLOSSARY.length} termos`;
        }

        if (!items.length) {
            grid.innerHTML = `<div class="pl-empty" style="grid-column: 1 / -1;">Nenhum termo encontrado para "${esc(query)}".</div>`;
            return;
        }

        grid.innerHTML = items.map((g) => `
            <article class="card" data-glow>
                <h3 class="pl-term-card__term">${esc(g.term)}</h3>
                <p class="pl-term-card__aka">${esc(g.aka)}</p>
                <p class="pl-term-card__def">${esc(g.def)}</p>
            </article>
        `).join("");
    }

    function initGlossary() {
        renderGlossary("");
        const input = document.getElementById("pl-glossary-input");
        input?.addEventListener("input", () => renderGlossary(input.value || ""));
    }

    /* ── Inicialização ────────────────────────────────────────────────────── */
    initLens();
    renderMap();
    initMapEvents();
    renderDiary();
    renderStages();
    initExplorerEvents();
    initCodeTooltips();
    initGlossary();

    window.Talho?.observeReveal?.(document.getElementById("conteudo") || document);
})();
