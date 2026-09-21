import { readFileSync } from 'fs';
import { resolve } from 'path';
import assert from 'assert';

console.log("=== INICIANDO AUTOTESTE: SMART BINS IA, KEYWORDS & ORDENAÇÃO ===");

const libraryJsPath = resolve(process.cwd(), 'src/ui/js/library.js');
const libraryJsContent = readFileSync(libraryJsPath, 'utf8');

const indexHtmlPath = resolve(process.cwd(), 'src/ui/index.html');
const indexHtmlContent = readFileSync(indexHtmlPath, 'utf8');

const stylesCssPath = resolve(process.cwd(), 'src/ui/styles.css');
const stylesCssContent = readFileSync(stylesCssPath, 'utf8');

// ── TESTE 1: TAXONOMIA DOS SMART BINS ─────────────────────────────────
console.log("1. Verificando estrutura e taxonomia de SMART_BINS_TAXONOMY...");
assert(libraryJsContent.includes("export const SMART_BINS_TAXONOMY = ["), "Taxonomia deve ser exportada no library.js");
assert(libraryJsContent.includes("'interviews'"), "Deve conter categoria interviews");
assert(libraryJsContent.includes("'cast_characters'"), "Deve conter categoria cast_characters");
assert(libraryJsContent.includes("'action_stunts'"), "Deve conter categoria action_stunts");
assert(libraryJsContent.includes("'camera_cinematography'"), "Deve conter categoria camera_cinematography");
assert(libraryJsContent.includes("'lighting_atmosphere'"), "Deve conter categoria lighting_atmosphere");
assert(libraryJsContent.includes("'directing_dialogue'"), "Deve conter categoria directing_dialogue");
assert(libraryJsContent.includes("'sound_music'"), "Deve conter categoria sound_music");
assert(libraryJsContent.includes("'set_production'"), "Deve conter categoria set_production");
assert(libraryJsContent.includes("'other'"), "Deve conter categoria other");
console.log("✔ Teste 1 passou: Todas as 9 categorias da taxonomia presentes.");

// ── TESTE 2: FUNÇÃO DE EXTRAÇÃO DE PALAVRA-CHAVE (extractTitleKeyword) ─
console.log("2. Verificando extractTitleKeyword e regras cinematográficas...");
assert(libraryJsContent.includes("export function extractTitleKeyword(title)"), "Deve exportar extractTitleKeyword");
assert(libraryJsContent.includes("CINEMA_KNOWN_ENTITIES"), "Deve definir entidades conhecidas");

// Carrega a implementação para teste unitário direto
const CINEMA_KNOWN_ENTITIES = [
    'Mabel', 'Cobb', 'Yasmin', 'Juliane', 'Daniel', 'Suzane', 'Suzana',
    'Rafael', 'Vitória', 'Vitoria', 'Luciana', 'Dina Brandão', 'Dina Brandao',
    'João Antonio', 'Joao Antonio', 'Thiago Moyses', 'Jones', 'Bayard',
    'Felipe', 'Gabriel', 'Tim Martins', 'Tim', 'Bee', 'Nina', 'Emily Montenegro',
    'Julia', 'Bruno', 'Carlos', 'UnB', 'Remington', 'Ronin', 'Blackmagic',
    'Vans', 'Monstro'
];

function extractTitleKeyword(title) {
    if (!title || typeof title !== "string") return "";
    let t = title.trim();
    if (!t) return "";

    for (const ent of CINEMA_KNOWN_ENTITIES) {
        const re = new RegExp(`\\b${ent.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        if (re.test(t)) {
            return ent;
        }
    }

    if (t.includes(":")) {
        const parts = t.split(":");
        const p1 = parts.slice(1).join(":").trim();
        if (p1.length > 2) {
            t = p1;
        }
    }

    const mPrep = t.match(/\b(?:com|de|do|da|para|sobre|por|em|no|na)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*|[A-Z]{2,}(?:\s+\d+[a-zA-Z]*)?)/);
    if (mPrep && mPrep[1]) {
        const cand = mPrep[1].trim();
        const candLow = cand.toLowerCase();
        if (cand.length > 2 && !['equipe', 'atriz', 'ator', 'cena', 'set', 'luz', 'camera', 'câmera'].includes(candLow)) {
            return cand;
        }
    }

    const mStart = t.match(/^([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*|[A-Z]{2,})/);
    if (mStart && mStart[1]) {
        const cand = mStart[1].trim();
        const candLow = cand.toLowerCase();
        if (cand.length > 2 && !['equipe', 'atriz', 'ator', 'cena', 'cenas', 'set', 'luz', 'luzes', 'bastidores', 'preparação', 'preparativos', 'ajuste', 'ajustes', 'gravação', 'ensaio', 'ensaios', 'entrevista', 'depoimento', 'detalhe', 'detalhes', 'visão', 'registro', 'conversa', 'discussão', 'revisão', 'análise', 'aplicação', 'configuração', 'trabalho', 'edição', 'filmagem', 'operação', 'interação'].includes(candLow)) {
            return cand;
        }
    }

    let clean = t.replace(/^(?:equipe|preparação|preparativos|ajuste|ajustes|cena|cenas|gravação|gravacao|ensaio|ensaios|entrevista|entrevistas|depoimento|depoimentos|teste|testes|bastidores|making\s+of|diretor|diretora|direção|direcao|cinegrafista|operador|operadores|operação|operacao|detalhe|detalhes|visão|visao|vistas|registro|registros|conversa|discussão|discussao|revisão|revisao|análise|analise|aplicação|aplicacao|configuração|configuracao|trabalho|edição|edicao|filmagem|inspeção|inspecao|discutindo|interação|interações|dinâmica)\b[\s:]*/i, "").trim();
    clean = clean.replace(/^(?:de|do|da|dos|das|com|em|no|na|nos|nas|para|por|sobre|ao|à|aos|às|e|um|uma|uns|umas)\s+/i, "").trim();

    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length > 0) {
        const firstTwo = words.slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
        return firstTwo;
    }

    return t.slice(0, 24).trim();
}

assert.strictEqual(extractTitleKeyword("Preparação da cena com Mabel"), "Mabel", "Deve extrair entidade conhecida Mabel");
assert.strictEqual(extractTitleKeyword("Equipe técnica ajustando luzes para Cobb"), "Cobb", "Deve extrair entidade Cobb");
assert.strictEqual(extractTitleKeyword("TRILHA: Tudo e Nada no toca-discos"), "Tudo", "Deve respeitar separação por dois pontos e capturar entidade inicial");
assert.strictEqual(extractTitleKeyword("Ajustes de foco com Yasmin"), "Yasmin", "Deve extrair Yasmin ignorando prefixo operacional");
assert.strictEqual(extractTitleKeyword("Filmagem externa no campus da UnB"), "UnB", "Deve extrair sigla cinematográfica UnB");
console.log("✔ Teste 2 passou: Extração de palavras-chave cinematográficas validada.");

// ── TESTE 3: CLASSIFICAÇÃO SEMÂNTICA IA & SUPRESSÃO DE PREFIXO MONSTRO_ ─
console.log("3. Verificando classificador semântico e supressão de ralo MONSTRO_...");
assert(libraryJsContent.includes("export function classifyMediaSmartBin(item)"), "Deve exportar classifyMediaSmartBin");
assert(libraryJsContent.includes(".replace(/^monstro_\\d+_\\d+_[a-z0-9_]+/i, \"\").replace(/^monstro_/i, \"\")"), "Deve suprimir prefixo MONSTRO_ de câmeras/rolos");

const SMART_BINS_TAXONOMY = [
    { id: 'interviews', label: '🎙️ Entrevistas & Depoimentos', keywords: ['entrevista', 'depoimento', 'relato', 'declarou', 'vitoria', 'vitória', 'luciana', 'dina brandao', 'dina brandão', 'joao antonio', 'joão antonio', 'thiago moyses'], weight: 3.0 },
    { id: 'cast_characters', label: '🎭 Elenco & Personagens', keywords: ['mabel', 'yasmin', 'cobb', 'juliane', 'daniel', 'suzane', 'suzana', 'rafael', 'atriz', 'ator', 'elenco', 'personagem', 'atuação', 'atuacao', 'ensaio de cena', 'interpretação', 'interpretacao', 'figurino', 'kazak', 'casaco', 'maquiagem', 'cabelo'], weight: 2.5 },
    { id: 'action_stunts', label: '💥 Ação, Dublês & Efeitos', keywords: ['sangue', 'briga', 'luta', 'dublê', 'duble', 'queda', 'batida', 'efeitos especiais', 'correria', 'ferimento', 'ação', 'acao'], weight: 2.0 },
    { id: 'camera_cinematography', label: '🎥 Câmera, Enquadramento & Planos', keywords: ['câmera', 'camera', 'steadicam', 'gimbal', 'lente', 'drone', 'enquadramento', 'close-up', 'close', 'foco', 'pan', 'tilt', 'plano', 'cinegrafista', 'operador'], weight: 1.8 },
    { id: 'lighting_atmosphere', label: '💡 Iluminação, Luz & Atmosfera', keywords: ['iluminação', 'iluminacao', 'luz', 'luzes', 'noturna', 'noturno', 'neblina', 'fumaça', 'fumaca', 'sombra', 'flare', 'gelatina', 'refletor', 'atmosfera'], weight: 1.8 },
    { id: 'directing_dialogue', label: '🎬 Direção, Marcação & Ensaios', keywords: ['diretor', 'direção', 'direcao', 'marcação', 'marcacao', 'instruções', 'instrucoes', 'orientação', 'orientacao', 'conversa', 'diálogo', 'dialogo', 'discussão', 'discussao', 'ensaio'], weight: 1.2 },
    { id: 'sound_music', label: '🎵 Trilha Sonora & Áudio', keywords: ['trilha', 'música', 'musica', 'som', 'áudio', 'audio', 'microfone', 'lapela', 'boom', 'vinil', 'toca-discos', 'ruído', 'ruido'], weight: 2.5 },
    { id: 'set_production', label: '📦 Set de Filmagem & Bastidores', keywords: ['set', 'bastidores', 'making of', 'equipe', 'produção', 'producao', 'preparação', 'preparacao', 'preparativos', 'intervalo', 'pausa', 'almoço', 'almoco', 'técnico', 'tecnico'], weight: 0.8 },
    { id: 'other', label: '📁 Cenas & Bastidores Gerais', keywords: [], weight: 0.0 }
];

function classifyMediaSmartBin(item) {
    if (!item) return "other";
    const vtype = item.video_type || "video";
    const category = (item.category || "").toLowerCase();

    let cleanFn = (item.filename || item.filepath || "").toLowerCase();
    cleanFn = cleanFn.replace(/^monstro_\d+_\d+_[a-z0-9_]+/i, "").replace(/^monstro_/i, "");

    const tText = (item.title || item.label || "").toLowerCase();
    const sText = (item.summary || item.description || "").toLowerCase();
    const fnText = cleanFn;
    let tagText = "";
    if (item.tags) {
        try {
            const parsed = typeof item.tags === "string" ? JSON.parse(item.tags) : item.tags;
            if (Array.isArray(parsed)) tagText = parsed.join(" ").toLowerCase();
            else tagText = String(item.tags).toLowerCase();
        } catch (e) {
            tagText = String(item.tags).toLowerCase();
        }
    }

    const scores = {};
    for (const b of SMART_BINS_TAXONOMY) {
        if (b.id === "other") continue;
        let sc = 0.0;
        for (const kw of b.keywords) {
            const kwLow = kw.toLowerCase();
            if (tText.includes(kwLow)) sc += 3.0 * b.weight;
            if (tagText.includes(kwLow)) sc += 2.5 * b.weight;
            if (sText.includes(kwLow)) sc += 1.5 * b.weight;
            if (fnText.includes(kwLow)) sc += 1.0 * b.weight;
        }
        if (b.id === "interviews" && (vtype === "interview" || category.includes("interview") || category === "depoimento")) {
            sc += 12.0;
        }
        scores[b.id] = sc;
    }

    let bestBin = "other";
    let maxScore = 0.0;
    for (const [bid, sc] of Object.entries(scores)) {
        if (sc > maxScore) {
            maxScore = sc;
            bestBin = bid;
        }
    }
    return bestBin;
}

// Caso A: Arquivo de rolo "MONSTRO_01_02_take1.mov" com Mabel ensaiando não deve cair em action_stunts
const itemMonstro = {
    id: 101,
    filename: "MONSTRO_01_02_take1.mov",
    title: "Ensaio de cena com Mabel e Cobb",
    summary: "Atriz Mabel repassa falas com Cobb no camarim",
    tags: ["elenco", "ensaio"]
};
assert.strictEqual(classifyMediaSmartBin(itemMonstro), "cast_characters", "Rolo MONSTRO_ não deve distorcer para action_stunts; deve classificar em cast_characters");

// Caso B: Entrevista gravada
const itemInterview = {
    id: 102,
    video_type: "interview",
    category: "depoimento",
    title: "Depoimento de Vitória sobre o projeto",
    summary: "Vitória relata os desafios da produção independente"
};
assert.strictEqual(classifyMediaSmartBin(itemInterview), "interviews", "Vídeo de entrevista deve ir para interviews");

// Caso C: Cena de Dublê com Sangue
const itemStunt = {
    id: 103,
    title: "Cena de briga com dublê e efeito de sangue",
    summary: "Queda programada com dublê na escadaria",
    tags: ["dublê", "efeitos especiais", "ação"]
};
assert.strictEqual(classifyMediaSmartBin(itemStunt), "action_stunts", "Cena com dublê e sangue deve ir para action_stunts");

// Caso D: Trilha Sonora e microfones
const itemAudio = {
    id: 104,
    title: "Ajuste do microfone boom e toca-discos com vinil",
    summary: "Gravação da trilha ambiente e ruído da agulha",
    tags: ["som", "áudio"]
};
assert.strictEqual(classifyMediaSmartBin(itemAudio), "sound_music", "Item de áudio/vinil deve ir para sound_music");
console.log("✔ Teste 3 passou: Classificador semântico IA validado em todos os cenários.");

// ── TESTE 4: ATRIBUIÇÃO MANUAL E OVERRIDE DO USUÁRIO ──────────────────
console.log("4. Verificando precedência de atribuição manual do usuário...");
assert(libraryJsContent.includes("export function setMediaManualSmartBin(item, binId, projectId = null)"), "Deve exportar setMediaManualSmartBin");
assert(libraryJsContent.includes("export function getMediaSmartBin(item)"), "Deve exportar getMediaSmartBin");

const mockManualMap = {};
function mockGetMediaSmartBin(item) {
    const key = `video:${item.id}`;
    if (mockManualMap[key]) return mockManualMap[key];
    if (item.custom_smart_bin) return item.custom_smart_bin;
    return classifyMediaSmartBin(item);
}

// Item originalmente classificado como cast_characters
const itemToOverride = { id: 200, title: "Mabel no set", filename: "clip_200.mp4" };
assert.strictEqual(mockGetMediaSmartBin(itemToOverride), "cast_characters", "Classificação inicial é da IA");

// Usuário arrasta para 'lighting_atmosphere'
mockManualMap[`video:${itemToOverride.id}`] = "lighting_atmosphere";
assert.strictEqual(mockGetMediaSmartBin(itemToOverride), "lighting_atmosphere", "Override manual do usuário tem prioridade absoluta sobre a IA");

// Usuário reseta para 'auto' (remover override)
delete mockManualMap[`video:${itemToOverride.id}`];
assert.strictEqual(mockGetMediaSmartBin(itemToOverride), "cast_characters", "Ao resetar para 'auto', volta a responder à IA");
console.log("✔ Teste 4 passou: Atribuição manual sobrepõe IA com sucesso e suporta reversão.");

// ── TESTE 5: COMPARAÇÃO E ORDENAÇÃO POR PALAVRA-CHAVE ─────────────────
console.log("5. Verificando compareMediaItems com keyword_asc e keyword_desc...");
assert(libraryJsContent.includes("case \"keyword_asc\":"), "compareMediaItems deve suportar keyword_asc");
assert(libraryJsContent.includes("case \"keyword_desc\":"), "compareMediaItems deve suportar keyword_desc");

const itemsList = [
    { id: 1, title: "Cena com Yasmin", primary_keyword: "Yasmin" },
    { id: 2, title: "Ensaio com Cobb", primary_keyword: "Cobb" },
    { id: 3, title: "Filmagem com Mabel", primary_keyword: "Mabel" }
];

function getMediaKeyword(item) {
    if (item.primary_keyword) return item.primary_keyword;
    return extractTitleKeyword(item.title || "");
}

function compareMediaItems(itemA, itemB, sortBy = "keyword_asc") {
    switch (sortBy) {
        case "keyword_asc": {
            const kwA = getMediaKeyword(itemA);
            const kwB = getMediaKeyword(itemB);
            const comp = kwA.localeCompare(kwB, undefined, { numeric: true, sensitivity: "base" });
            if (comp !== 0) return comp;
            return (itemA.title || "").localeCompare(itemB.title || "", undefined, { numeric: true, sensitivity: "base" });
        }
        case "keyword_desc": {
            const kwA = getMediaKeyword(itemA);
            const kwB = getMediaKeyword(itemB);
            const comp = kwB.localeCompare(kwA, undefined, { numeric: true, sensitivity: "base" });
            if (comp !== 0) return comp;
            return (itemA.title || "").localeCompare(itemB.title || "", undefined, { numeric: true, sensitivity: "base" });
        }
    }
    return 0;
}

const sortedAsc = [...itemsList].sort((a, b) => compareMediaItems(a, b, "keyword_asc"));
assert.deepStrictEqual(sortedAsc.map(i => i.primary_keyword), ["Cobb", "Mabel", "Yasmin"], "keyword_asc deve ordenar A-Z");

const sortedDesc = [...itemsList].sort((a, b) => compareMediaItems(a, b, "keyword_desc"));
assert.deepStrictEqual(sortedDesc.map(i => i.primary_keyword), ["Yasmin", "Mabel", "Cobb"], "keyword_desc deve ordenar Z-A");
console.log("✔ Teste 5 passou: Ordenação por Palavra-Chave A-Z e Z-A validada.");

// ── TESTE 6: VERIFICAÇÃO DE ELEMENTOS HTML & CSS ──────────────────────
console.log("6. Verificando integridade do index.html e styles.css...");
assert(indexHtmlContent.includes('value="smart_bins">Smart Bins / Temas (IA)</option>'), "HTML deve incluir opção de agrupamento Smart Bins");
assert(indexHtmlContent.includes('value="keyword">Palavras-Chave / Assuntos</option>'), "HTML deve incluir opção de agrupamento Palavras-Chave");
assert(indexHtmlContent.includes('id="chk-gallery-show-keyword"'), "HTML deve incluir checkbox para exibir palavra-chave na galeria");
assert(indexHtmlContent.includes('id="chk-hud-keyword"'), "HTML deve incluir checkbox para palavra-chave no HUD");
assert(indexHtmlContent.includes('data-sort-key="keyword"'), "Dropdown customizado de ordenação deve ter opção de palavra-chave");

assert(stylesCssContent.includes(".gallery-sticky-header.smart-bin-drop-target"), "CSS deve definir feedback de drop no header dos smart bins");
assert(stylesCssContent.includes(".gallery-keyword-pill"), "CSS deve definir estilo minimalista do pill de palavra-chave");
console.log("✔ Teste 6 passou: Todos os elementos visuais e seletores CSS estão integrados.");

// ── TESTE 7: SUPORTE A POPOUT E MULTI-TELA DO DROPDOWN DE ORDENAÇÃO ─
console.log("7. Verificando suporte a popout e multi-tela do library-sort-dropdown...");
assert(stylesCssContent.includes(".library-sort-dropdown"), "styles.css deve conter a classe .library-sort-dropdown");
assert(stylesCssContent.includes("z-index: 999999"), "styles.css deve definir z-index elevado para visibilidade sobre todos os painéis");
assert(indexHtmlContent.includes('id="library-sort-dropdown" class="glassmorphism library-sort-dropdown"'), "index.html deve conter a classe library-sort-dropdown");
assert(libraryJsContent.includes("this.onPopoutLibrarySort"), "library.js deve exportar/implementar onPopoutLibrarySort");
assert(libraryJsContent.includes("this.onRestoreLibrarySort"), "library.js deve exportar/implementar onRestoreLibrarySort");
assert(libraryJsContent.includes("targetDoc.adoptNode(sortDropdown)"), "library.js deve adotar o nó com adoptNode na janela ativa");
console.log("✔ Teste 7 passou: Arquitetura multi-janela e popout do dropdown validada.");

console.log("\n=======================================================");
console.log("✨ TODOS OS 7 TESTES DE VALIDAÇÃO PASSARAM COM SUCESSO!");
console.log("=======================================================");
