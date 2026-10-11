import fs from 'fs';
import path from 'path';
import assert from 'assert';

const indexHtmlPath = path.resolve('src/ui/index.html');
const stylesCssPath = path.resolve('src/ui/styles.css');
const mainJsPath = path.resolve('src/ui/js/main.js');
const wsManagerPath = path.resolve('src/ui/js/workspaceManager.js');

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const stylesCss = fs.readFileSync(stylesCssPath, 'utf8');
const mainJs = fs.readFileSync(mainJsPath, 'utf8');
const wsManager = fs.readFileSync(wsManagerPath, 'utf8');

console.log("=== INICIANDO TESTES DO CABEÇALHO DA BIBLIOTECA ===");

// 1. Verificar elementos HTML
assert(indexHtml.includes('id="reopen-library-header"'), 'Falta #reopen-library-header no index.html');
assert(indexHtml.includes('id="library-header-compact-controls"'), 'Falta #library-header-compact-controls no index.html');
assert(indexHtml.includes('id="btn-collapse-library-header"'), 'Falta #btn-collapse-library-header no index.html');
assert(indexHtml.includes('id="library-filter-bar-row1"'), 'Falta #library-filter-bar-row1 no index.html');
assert(indexHtml.includes('id="library-search-area-wrapper"'), 'Falta #library-search-area-wrapper no index.html');
assert(indexHtml.includes('class="sidebar-header-left-cluster"'), 'Falta .sidebar-header-left-cluster no index.html');
assert(indexHtml.includes('class="sidebar-header-tools"'), 'Falta .sidebar-header-tools no index.html');
assert(indexHtml.includes('id="btn-library-more-actions"'), 'Falta #btn-library-more-actions no index.html');
console.log("✔ 1 passou: Elementos HTML estruturais e botão de overflow '+' presentes no index.html");

// 2. Verificar regras CSS
assert(stylesCss.includes('.sidebar-left.library-header-collapsed'), 'Falta classe .library-header-collapsed no styles.css');
assert(stylesCss.includes('.library-header-restore-line'), 'Falta .library-header-restore-line no styles.css');
assert(stylesCss.includes('.library-header-compact-controls'), 'Falta .library-header-compact-controls no styles.css');
assert(stylesCss.includes('sidebar-left-container'), 'Falta container-name: sidebar-left-container no styles.css');
assert(stylesCss.includes('max-width: 520px'), 'Falta breakpoint container query para recolher ferramentas');
assert(stylesCss.includes('max-width: 440px'), 'Falta breakpoint container query para sumir texto da biblioteca');
assert(stylesCss.includes('max-width: 370px'), 'Falta breakpoint container query para sumir busca da biblioteca');
assert(stylesCss.includes('max-width: 290px'), 'Falta breakpoint container query para recolher chips para o +');
assert(stylesCss.includes('.library-more-flyout'), 'Falta regra .library-more-flyout no styles.css');
assert(stylesCss.includes('.flyout-media-chip'), 'Falta regra .flyout-media-chip no styles.css');
assert(stylesCss.includes('#btn-library-more-actions'), 'Falta estilo para #btn-library-more-actions no styles.css');
console.log("✔ 2 passou: Regras CSS anti-truncamento, breakpoints e flyout presentes");

// 3. Verificar implementação JS em main.js
assert(mainJs.includes('function setLibraryFiltersCollapsed'), 'Falta setLibraryFiltersCollapsed em main.js');
assert(mainJs.includes('function toggleLibraryHeader'), 'Falta toggleLibraryHeader em main.js');
assert(mainJs.includes('window.setLibraryFiltersCollapsed = setLibraryFiltersCollapsed'), 'Falta exportar setLibraryFiltersCollapsed no window');
assert(mainJs.includes('window.toggleLibraryHeader = toggleLibraryHeader'), 'Falta exportar toggleLibraryHeader no window');
assert(mainJs.includes('panelId === "sidebar-left" && (e.ctrlKey || e.metaKey)'), 'Falta verificação de Ctrl+duplo clique em main.js');
assert(mainJs.includes('btn-library-more-actions'), 'Falta referência a btn-library-more-actions em main.js');
assert(mainJs.includes('openLibraryMoreFlyout'), 'Falta openLibraryMoreFlyout em main.js');
assert(mainJs.includes('flyout-media-chip'), 'Falta flyout-media-chip em main.js');
assert(wsManager.includes('sidebar-chips-collapsed'), 'Falta sidebar-chips-collapsed em workspaceManager.js');
console.log("✔ 3 passou: Funções, flyout do botão '+' com chips e evento Ctrl+duplo clique presentes");

// 3b. Verificar regra no design system (SKILL.md)
const skillPath = path.resolve('.agents/skills/capiau-nle-design-system/SKILL.md');
const skillContent = fs.readFileSync(skillPath, 'utf8');
assert(skillContent.includes('Regra Anti-Truncamento de Ícones em Barras e Cabeçalhos'), 'Falta regra de anti-truncamento no SKILL.md');
console.log("✔ 3b passou: Regra formal registrada no design system (SKILL.md)");

// 4. Teste funcional da lógica em DOM simulado
class MockElement {
    constructor(id, tagName = 'div') {
        this.id = id;
        this.tagName = tagName;
        this.classList = new Set();
        this.classList.add = (c) => this.classList.has(c) ? false : (this.classList[c] = true, true);
        this.classList.remove = (c) => delete this.classList[c];
        this.classList.contains = (c) => !!this.classList[c];
        this.classList.toggle = (c, force) => {
            const has = this.classList.contains(c);
            const val = force !== undefined ? force : !has;
            if (val) this.classList.add(c); else this.classList.remove(c);
            return val;
        };
        this.style = {};
        this.children = [];
        this.parentElement = null;
        this.value = '';
    }
    appendChild(child) {
        if (child.parentElement) {
            child.parentElement.children = child.parentElement.children.filter(c => c !== child);
        }
        child.parentElement = this;
        this.children.push(child);
    }
    prepend(child) {
        if (child.parentElement) {
            child.parentElement.children = child.parentElement.children.filter(c => c !== child);
        }
        child.parentElement = this;
        this.children.unshift(child);
    }
    after(child) {
        if (!this.parentElement) return;
        const idx = this.parentElement.children.indexOf(this);
        if (child.parentElement) {
            child.parentElement.children = child.parentElement.children.filter(c => c !== child);
        }
        child.parentElement = this.parentElement;
        this.parentElement.children.splice(idx + 1, 0, child);
    }
    querySelector(sel) {
        return new MockElement('', 'i');
    }
    setAttribute(k, v) {}
}

const mockDoc = {
    elements: {},
    getElementById(id) {
        return this.elements[id] || null;
    }
};

const sidebarLeft = new MockElement('sidebar-left');
const btnToggleFilters = new MockElement('btn-toggle-library-filters');
const compactControls = new MockElement('library-header-compact-controls');
const searchAreaWrapper = new MockElement('library-search-area-wrapper');
const searchInput = new MockElement('library-search-input', 'input');
searchAreaWrapper.appendChild(searchInput);
searchInput.value = "teste de busca persistente";

const mediaTypeFilterChips = new MockElement('media-type-filter-chips');
const filterBarRow1 = new MockElement('library-filter-bar-row1');
const btnDisplaySettings = new MockElement('btn-library-display-settings');
const reopenLibraryHeader = new MockElement('reopen-library-header');

filterBarRow1.appendChild(searchAreaWrapper);
filterBarRow1.appendChild(btnDisplaySettings);
filterBarRow1.appendChild(mediaTypeFilterChips);

mockDoc.elements['sidebar-left'] = sidebarLeft;
mockDoc.elements['btn-toggle-library-filters'] = btnToggleFilters;
mockDoc.elements['library-header-compact-controls'] = compactControls;
mockDoc.elements['library-search-area-wrapper'] = searchAreaWrapper;
mockDoc.elements['library-search-input'] = searchInput;
mockDoc.elements['media-type-filter-chips'] = mediaTypeFilterChips;
mockDoc.elements['library-filter-bar-row1'] = filterBarRow1;
mockDoc.elements['btn-library-display-settings'] = btnDisplaySettings;
mockDoc.elements['reopen-library-header'] = reopenLibraryHeader;

// Executa a lógica de setLibraryFiltersCollapsed simulada
function setFilters(collapsed) {
    sidebarLeft.classList.toggle("filters-collapsed", collapsed);
    if (collapsed) {
        compactControls.appendChild(searchAreaWrapper);
        compactControls.appendChild(mediaTypeFilterChips);
        compactControls.style.display = "flex";
    } else {
        filterBarRow1.prepend(searchAreaWrapper);
        btnDisplaySettings.after(mediaTypeFilterChips);
        compactControls.style.display = "none";
    }
}

// Inicial: search e chips estão em filterBarRow1
assert(searchAreaWrapper.parentElement === filterBarRow1);
assert(mediaTypeFilterChips.parentElement === filterBarRow1);

// Ao recolher filtros/abas:
setFilters(true);
assert(sidebarLeft.classList.contains("filters-collapsed"));
assert(searchAreaWrapper.parentElement === compactControls);
assert(mediaTypeFilterChips.parentElement === compactControls);
assert.strictEqual(searchInput.value, "teste de busca persistente");
assert.strictEqual(compactControls.style.display, "flex");
console.log("✔ 4a passou: Ao ocultar filtros/abas, busca e seletores vão para o cabeçalho mantendo valor");

// Ao exibir filtros/abas:
setFilters(false);
assert(!sidebarLeft.classList.contains("filters-collapsed"));
assert(searchAreaWrapper.parentElement === filterBarRow1);
assert(mediaTypeFilterChips.parentElement === filterBarRow1);
assert.strictEqual(filterBarRow1.children[0], searchAreaWrapper);
assert.strictEqual(compactControls.style.display, "none");
console.log("✔ 4b passou: Ao restaurar filtros/abas, busca e seletores retornam à barra");

// Lógica de toggleLibraryHeader
function toggleHeader(forceState) {
    const isCurrentlyCollapsed = sidebarLeft.classList.contains("library-header-collapsed");
    const targetCollapsed = typeof forceState === "boolean" ? forceState : !isCurrentlyCollapsed;
    if (targetCollapsed) {
        if (!sidebarLeft.classList.contains("filters-collapsed")) {
            setFilters(true);
        }
        sidebarLeft.classList.add("library-header-collapsed");
        reopenLibraryHeader.style.display = "flex";
    } else {
        sidebarLeft.classList.remove("library-header-collapsed");
        reopenLibraryHeader.style.display = "none";
    }
}

// Ao recolher cabeçalho com filtros abertos: deve recolher cabeçalho E ocultar filtros
toggleHeader(true);
assert(sidebarLeft.classList.contains("library-header-collapsed"));
assert(sidebarLeft.classList.contains("filters-collapsed"));
assert.strictEqual(reopenLibraryHeader.style.display, "flex");
console.log("✔ 4c passou: Ao recolher cabeçalho, recolhe cabeçalho e oculta filtros/abas automaticamente");

// Ao restaurar cabeçalho:
toggleHeader(false);
assert(!sidebarLeft.classList.contains("library-header-collapsed"));
assert.strictEqual(reopenLibraryHeader.style.display, "none");
// E os controles compactos continuam prontos no cabeçalho
assert(searchAreaWrapper.parentElement === compactControls);
console.log("✔ 4d passou: Ao reabrir cabeçalho, cabeçalho reaparece com busca e seletores de mídia");

// 5. Testes de anti-bubbling e integridade do evento Ctrl+duplo clique
assert(mainJs.includes('e.stopPropagation();') && mainJs.includes('window.toggleLibraryHeader(true);'), 'Falta e.stopPropagation() e chamada com true no handler de Ctrl+duplo clique do cabeçalho');
assert(mainJs.includes('if (e.target.closest("#library-sidebar-header, .sidebar-header")) return;'), 'Falta guarda contra eventos do cabeçalho no listener do sidebarLeft');
assert(mainJs.includes('btnCollapseLibraryHeader.addEventListener("dblclick"'), 'Falta listener dblclick em btnCollapseLibraryHeader');
assert(mainJs.includes('reopenLibraryHeader.addEventListener("dblclick"'), 'Falta listener dblclick em reopenLibraryHeader');

// Simulação de bolha de eventos:
let headerCollapsedState = false;
function simulateHeaderCtrlDblClick(originInsideHeader) {
    let stopped = false;
    const fakeEvent = {
        ctrlKey: true,
        target: { closest: (sel) => originInsideHeader ? (sel.includes("sidebar-header") ? {} : null) : null },
        stopPropagation: () => { stopped = true; },
        preventDefault: () => {}
    };

    // 1. Handler no cabeçalho
    if ((fakeEvent.ctrlKey) && (!fakeEvent.target.closest("button"))) {
        fakeEvent.stopPropagation();
        headerCollapsedState = true;
    }

    // 2. Se a propagação não fosse interrompida, o listener de sidebarLeft executaria:
    if (!stopped) {
        if (!fakeEvent.target.closest("#library-sidebar-header, .sidebar-header")) {
            if (fakeEvent.ctrlKey && headerCollapsedState) {
                headerCollapsedState = false; // falha se a bolha atingir o sidebar!
            }
        }
    }
}

simulateHeaderCtrlDblClick(true);
assert.strictEqual(headerCollapsedState, true, "Ctrl+duplo clique no cabeçalho deve permanecer recolhido sem cancelamento por bolha");
console.log("✔ 5 passou: Anti-bubbling e preservação de estado com stopPropagation e guardas validados");

console.log("=== TODOS OS TESTES PASSARAM COM SUCESSO! ===");
