// creditsNormalizer.js - Central de Ficha Técnica, Extração por IA e Normalização de Nomes e GCs
import { STATE } from "./state.js";
import { TIMELINE_STATE, TIMELINE_HISTORY } from "./timelineState.js";

// Helper: Formatação de Nome Próprio (Title Case) com partículas e siglas preservadas
export function toTitleCaseName(name) {
    if (!name) return "";
    const lowerParticles = new Set(["de", "da", "do", "dos", "das", "e", "del", "de la", "van", "von", "di", "du", "san", "la", "le"]);
    const upperAcronyms = new Set(["FX", "DF", "VFX", "I-MAGE", "SENAC", "UEG", "HQ", "GC", "NLE", "AI", "IA", "LLM", "CGI"]);

    let cleaned = String(name).replace(/^[*_~`#\-—–:·•\s]+|[*_~`#\-—–:·•\s]+$/g, '').trim();

    return cleaned.split(/\s+/).map((word, index) => {
        const upperWord = word.toUpperCase();
        if (upperAcronyms.has(upperWord)) return upperWord;

        // Sobrenomes com apóstrofo (ex: Sant'Anna, D'Ávila)
        if (word.includes("'")) {
            return word.split("'").map((part, pIdx) => {
                if (pIdx === 0 && lowerParticles.has(part.toLowerCase())) return part.toLowerCase();
                return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
            }).join("'");
        }

        // Nomes compostos com hífen (ex: Jean-Luc)
        if (word.includes("-")) {
            return word.split("-").map((part) => {
                return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
            }).join("-");
        }

        const lowerWord = word.toLowerCase();
        if (index > 0 && lowerParticles.has(lowerWord)) {
            return lowerWord;
        }

        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(" ");
}

// Helper: Formatação e Limpeza de Cargo/Função
export function formatRoleName(role) {
    if (!role) return "Personagem / Entrevistado(a)";
    let cleaned = String(role).replace(/^[*_~`#\-—–:·•\s]+|[*_~`#\-—–:·•\s]+$/g, '').trim();
    if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return cleaned;
}

// Dicionário cinematográfico para desambiguação heurística
const ROLE_KEYWORDS = [
    "diretor", "diretora", "direção", "roteiro", "roteirista", "produção", "produtor", "produtora",
    "executiva", "elenco", "fotografia", "câmera", "camera", "som", "áudio", "audio", "diálogos", "dialogos",
    "arte", "cenografia", "figurino", "adereços", "aderecos", "maquiagem", "cabelo", "caracterização",
    "caracterizacao", "efeitos", "fx", "vfx", "montagem", "edição", "edicao", "montador", "montadora",
    "color", "grading", "colorista", "foley", "trilha", "música", "musica", "canção", "cancao", "letra",
    "voz", "guitarra", "baixo", "bateria", "teclado", "orquestra", "arranjos", "compositor", "controller",
    "jurídico", "juridico", "advogado", "advogada", "advocacia", "contador", "contabilidade", "motorista",
    "motoristas", "catering", "psicólogo", "psicologa", "making of", "assistente", "ass.", "estagiário",
    "estagiaria", "estagiários", "estagiárias", "coordenação", "coordenacao", "chefe", "contra-regra",
    "dublê", "duble", "policial", "policiais", "detetive", "figuração", "figuracao", "locação", "locacoes",
    "acessibilidade", "libras", "audiodescrição", "áudio-descrição", "legenda", "legendas", "revisão", "distribuição"
];

// Seções institucionais a ignorar (empresas de apoio, copyright, etc.)
const SKIP_SECTION_PATTERNS = [
    /^(apoio|agradecimentos|distribuição|distribuicao|patrocínio|patrocinio|copyright|realização|realizacao|fomento)/i,
    /\b(apoio|agradecimentos|distribuição)\b/i
];

// Linhas institucionais e metadados a ignorar
const IGNORE_LINES_PATTERNS = [
    /^>/,
    /^©/,
    /^transcrito/i,
    /^servem de fonte/i,
    /^uma cultura forte/i,
    /^a realização deste filme/i,
    /^brasília/i,
    /^distribuído por/i,
    /^distribuido por/i,
    /^performada por/i
];

function isLikelyRole(text) {
    if (!text) return false;
    const lower = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return ROLE_KEYWORDS.some(kw => {
        const normKw = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const regex = new RegExp(`\\b${normKw}\\b`, 'i');
        return regex.test(lower);
    });
}

function isAllUpper(text) {
    const letters = text.replace(/[^A-Za-zÀ-Úà-ú]/g, '');
    if (letters.length < 3) return false;
    return letters === letters.toUpperCase();
}

function expandNames(rawNamesStr) {
    let str = rawNamesStr.trim();
    const rawSegments = str.split(/,\s*|\s+(?:e|&|and)\s+/i).map(n => n.trim()).filter(Boolean);
    const finalNames = [];

    let lastFoundSurname = "";
    for (let i = rawSegments.length - 1; i >= 0; i--) {
        const seg = rawSegments[i].replace(/[*_`]/g, '').trim();
        const words = seg.split(/\s+/);
        if (words.length >= 3) {
            lastFoundSurname = words.slice(1).join(" ");
            finalNames.unshift(seg);
        } else if (words.length === 1 && lastFoundSurname) {
            finalNames.unshift(`${seg} ${lastFoundSurname}`);
        } else {
            if (words.length >= 2) {
                lastFoundSurname = words.slice(1).join(" ");
            } else {
                lastFoundSurname = "";
            }
            finalNames.unshift(seg);
        }
    }

    return finalNames;
}

function findCreditSeparator(item) {
    const dashMatch = item.match(/\s*([—–])\s*/);
    if (dashMatch) {
        return { sep: dashMatch[0], index: item.indexOf(dashMatch[0]) };
    }
    const colonMatch = item.match(/:\s+/);
    if (colonMatch) {
        return { sep: colonMatch[0], index: item.indexOf(colonMatch[0]) };
    }
    const spacedHyphenMatch = item.match(/\s+-\s+/);
    if (spacedHyphenMatch) {
        return { sep: spacedHyphenMatch[0], index: item.indexOf(spacedHyphenMatch[0]) };
    }
    return null;
}

export class CreditsNormalizer {
    constructor() {
        this.isOpen = false;
        this.modalEl = null;
        this.extractionModalEl = null;
        this.searchQuery = "";
        this.extractedReviewItems = [];
    }

    getOfficialCredits() {
        if (STATE.projectData && Array.isArray(STATE.projectData.official_credits)) {
            return STATE.projectData.official_credits;
        }
        return [];
    }

    saveOfficialCredits(creditsList) {
        STATE.projectData = STATE.projectData || {};
        STATE.projectData.official_credits = creditsList;
        STATE.emit("officialCreditsUpdated", creditsList);
    }

    /**
     * Busca por correspondência aproximada (fuzzy match) de um nome digitado ou falado.
     */
    findMatchingCredit(query) {
        if (!query || typeof query !== "string") return null;
        const cleanQuery = query.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const list = this.getOfficialCredits();

        // 1. Busca exata ou variações
        for (const item of list) {
            const cleanName = item.name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (cleanName === cleanQuery) return item;

            if (Array.isArray(item.variations)) {
                for (const v of item.variations) {
                    const cleanVar = v.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    if (cleanVar === cleanQuery) return item;
                }
            }
        }

        // 2. Busca parcial (contém)
        for (const item of list) {
            const cleanName = item.name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (cleanQuery.includes(cleanName) || cleanName.includes(cleanQuery)) {
                return item;
            }
        }

        return null;
    }

    /**
     * Extrai e padroniza automaticamente nomes e funções a partir de documentos complexos de cinema/TV.
     */
    extractCreditsFromText(rawText) {
        if (!rawText || typeof rawText !== "string") return [];

        const rawLines = rawText.split(/\r?\n/);
        const sections = [];
        let currentSecTitle = "Geral";
        let currentSecLines = [];

        for (let rawLine of rawLines) {
            const trimmed = rawLine.trim();
            if (!trimmed) {
                if (currentSecLines.length > 0) {
                    currentSecLines.push("\n");
                }
                continue;
            }

            if (trimmed.startsWith("#")) {
                if (currentSecLines.length > 0) {
                    sections.push({ title: currentSecTitle, lines: currentSecLines });
                    currentSecLines = [];
                }
                currentSecTitle = trimmed.replace(/^#+\s*/, '').replace(/[*_]/g, '').trim();
            } else {
                currentSecLines.push(trimmed);
            }
        }
        if (currentSecLines.length > 0) {
            sections.push({ title: currentSecTitle, lines: currentSecLines });
        }

        const results = [];

        for (const section of sections) {
            if (SKIP_SECTION_PATTERNS.some(p => p.test(section.title))) {
                continue;
            }

            let combinedText = "";
            for (let i = 0; i < section.lines.length; i++) {
                const line = section.lines[i];
                if (line === "\n") {
                    combinedText += " · ";
                    continue;
                }
                if (line.endsWith(",") || line.endsWith("·") || line.endsWith("—") || line.endsWith("-") || line.endsWith(":")) {
                    combinedText += line + " ";
                } else {
                    combinedText += line + " · ";
                }
            }

            const rawItems = combinedText.split(/[·•|]/).map(it => it.trim()).filter(Boolean);
            let subContext = "";

            for (let item of rawItems) {
                item = item.replace(/^[*_~`]+|[*_~`]+$/g, '').trim();
                if (!item || item.length < 3) continue;

                if (IGNORE_LINES_PATTERNS.some(p => p.test(item))) continue;

                if (/^\*\*[^*]+\*\*$/.test(item) || /^(figuração|figuracao|making of|acessibilidade)$/i.test(item)) {
                    subContext = item.replace(/\*/g, '').trim();
                    continue;
                }

                if (item.startsWith("**") && item.includes("**")) {
                    const boldMatch = item.match(/^\*\*([^*]+)\*\*\s*([—–:\-]|\s)\s*(.*)$/);
                    if (boldMatch) {
                        subContext = boldMatch[1].trim();
                        item = boldMatch[3].trim();
                        if (!item) continue;
                    }
                }

                const sepInfo = findCreditSeparator(item);

                if (sepInfo) {
                    let part1 = item.substring(0, sepInfo.index).trim();
                    let part2 = item.substring(sepInfo.index + sepInfo.sep.length).trim();

                    part1 = part1.replace(/[*_~`]/g, '').trim();
                    part2 = part2.replace(/[*_~`]/g, '').trim();

                    if (!part1 || !part2) continue;

                    let role = "";
                    let namePart = "";

                    const isElenco = /elenco|cast|actores|atores/i.test(section.title);
                    const part1HasRoleKW = isLikelyRole(part1);
                    const part2HasRoleKW = isLikelyRole(part2);
                    const part1IsCaps = isAllUpper(part1);
                    const part2IsCaps = isAllUpper(part2);

                    if (isElenco) {
                        if (part2IsCaps || !part1IsCaps) {
                            role = part1;
                            namePart = part2;
                        } else {
                            namePart = part1;
                            role = part2;
                        }
                    } else {
                        if (part1HasRoleKW && !part2HasRoleKW) {
                            role = part1;
                            namePart = part2;
                        } else if (part2HasRoleKW && !part1HasRoleKW) {
                            role = part2;
                            namePart = part1;
                        } else if (part2IsCaps && !part1IsCaps) {
                            role = part1;
                            namePart = part2;
                        } else if (part1IsCaps && !part2IsCaps) {
                            namePart = part1;
                            role = part2;
                        } else {
                            role = part1;
                            namePart = part2;
                        }
                    }

                    if (subContext) {
                        if (/figuração|figuracao/i.test(subContext) && !role.toLowerCase().includes("figuração")) {
                            role = `Figuração (${role})`;
                        } else if (/canção|musica|trilha/i.test(subContext) && !role.toLowerCase().includes("canção")) {
                            role = `${role} (${subContext})`;
                        } else if (/making of/i.test(subContext) && !role.toLowerCase().includes("making of")) {
                            role = `${role} - Making of`;
                        }
                    }

                    if (/locações|locacoes/i.test(section.title)) {
                        if (part2.includes(":")) {
                            const locSplit = part2.split(":");
                            const locName = locSplit[0].trim();
                            namePart = locSplit.slice(1).join(":").trim();
                            role = `Locação (${locName})`;
                        } else if (part1) {
                            role = `Locação (${part1})`;
                        }
                    }

                    const individualNames = expandNames(namePart);

                    individualNames.forEach(rawN => {
                        const cleanN = toTitleCaseName(rawN);
                        if (cleanN && cleanN.length >= 3 && !isLikelyRole(cleanN) && !IGNORE_LINES_PATTERNS.some(p => p.test(cleanN))) {
                            results.push({
                                id: `cred_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                                name: cleanN,
                                role: formatRoleName(role || section.title),
                                section: section.title,
                                variations: [cleanN.normalize("NFD").replace(/[\u0300-\u036f]/g, "")],
                                notes: `Seção: ${section.title}`,
                                selected: true
                            });
                        }
                    });
                } else {
                    const individualNames = expandNames(item);
                    individualNames.forEach(rawN => {
                        const cleanN = toTitleCaseName(rawN);
                        if (cleanN && cleanN.length >= 3 && !isLikelyRole(cleanN) && !IGNORE_LINES_PATTERNS.some(p => p.test(cleanN))) {
                            let fallbackRole = section.title || "Personagem / Entrevistado(a)";
                            if (/produzido por/i.test(section.title)) {
                                fallbackRole = "Produção";
                            }
                            results.push({
                                id: `cred_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                                name: cleanN,
                                role: formatRoleName(fallbackRole),
                                section: section.title,
                                variations: [cleanN.normalize("NFD").replace(/[\u0300-\u036f]/g, "")],
                                notes: `Seção: ${section.title}`,
                                selected: true
                            });
                        }
                    });
                }
            }
        }

        // Consolidação de funções múltiplas
        const mergedMap = new Map();
        results.forEach(entry => {
            const key = entry.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (!mergedMap.has(key)) {
                mergedMap.set(key, { ...entry, allRoles: [entry.role] });
            } else {
                const existing = mergedMap.get(key);
                if (!existing.allRoles.includes(entry.role)) {
                    existing.allRoles.push(entry.role);
                    if (existing.role === "Produção" || existing.role === "Geral" || existing.role === "Personagem / Entrevistado(a)") {
                        existing.role = entry.role;
                    }
                }
            }
        });

        return Array.from(mergedMap.values()).map(item => ({
            id: item.id,
            name: item.name,
            role: item.role,
            section: item.section,
            allRoles: item.allRoles,
            variations: item.variations,
            notes: item.allRoles.length > 1 ? `Cargos: ${item.allRoles.join(', ')}` : item.notes,
            selected: true
        }));
    }

    /**
     * Gera e dispara download do modelo de regras e formato de créditos para preenchimento.
     */
    downloadCreditTemplate() {
        const templateText = `# MODELO OFICIAL DE CRÉDITOS & FICHA TÉCNICA - CAPIAU TALHO
# Você pode colar rolos de créditos, roteiros com elenco ou preencher por linhas:
# Exemplo 1: Nome Completo — Função ou Cargo
# Exemplo 2: Personagem — ATOR COMPLETO
# Exemplo 3: Função: Nome 1, Nome 2, Nome 3

## Elenco
Daniel — FILIPE LIMA · Karin — YASMIM SANT'ANNA · Advogada — NZINGA PANTA

## Direção e fotografia
Direção e Roteiro — THIAGO MOYSES
Direção de Fotografia — DANIEL MOUTINHO
Primeiro Ass. de Direção — FERNANDO GOMES

## Som
Técnico de Som Direto — BRUNO WAMBIER · Ass. de Som — PAMELA MARTÍNEZ

## Arte e Figurino
Direção de Arte — JÚLIA LIBÂNIO · Figurino — JÚLIA STAVROS
`;
        const blob = new Blob([templateText], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "modelo_ficha_tecnica_capiau.txt";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    openModal() {
        this.isOpen = true;
        this.render();
    }

    closeModal() {
        this.isOpen = false;
        if (this.modalEl && this.modalEl.parentNode) {
            this.modalEl.parentNode.removeChild(this.modalEl);
        }
        this.modalEl = null;
    }

    // Modal Dedicada de Extração Interativa com IA
    openExtractionModal(initialText = "") {
        if (!this.extractionModalEl) {
            this.extractionModalEl = document.createElement("div");
            this.extractionModalEl.id = "credits-ai-extractor-modal";
            this.extractionModalEl.className = "nle-modal-overlay";
            this.extractionModalEl.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); z-index: 1050; display: flex; align-items: center; justify-content: center; padding: 20px;";
            document.body.appendChild(this.extractionModalEl);
        }

        this.extractedReviewItems = initialText ? this.extractCreditsFromText(initialText) : [];
        this.renderExtractionModal(initialText);
    }

    closeExtractionModal() {
        if (this.extractionModalEl && this.extractionModalEl.parentNode) {
            this.extractionModalEl.parentNode.removeChild(this.extractionModalEl);
        }
        this.extractionModalEl = null;
        this.extractedReviewItems = [];
    }

    renderExtractionModal(currentRawText = "") {
        if (!this.extractionModalEl) return;

        const count = this.extractedReviewItems.length;

        this.extractionModalEl.innerHTML = `
            <div class="nle-modal-container" style="background: var(--bg-glass-active, #181524); border: 1px solid var(--border-glass); border-radius: 8px; width: 980px; max-width: 96vw; height: 740px; max-height: 92vh; display: flex; flex-direction: column; box-shadow: var(--shadow-premium); overflow: hidden;">
                <!-- Header -->
                <div style="padding: 14px 18px; border-bottom: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.3);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fa-solid fa-wand-magic-sparkles" style="color: #f59e0b; font-size: 16px;"></i>
                        <h2 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0;">Extração Inteligente de Ficha Técnica & Créditos</h2>
                    </div>
                    <button id="btn-close-extraction-modal" class="btn-flat-action" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px 8px; font-size: 14px;"><i class="fa-solid fa-xmark"></i></button>
                </div>

                <!-- Body (Split Layout: Textarea + Live Preview) -->
                <div style="flex: 1; display: flex; gap: 14px; padding: 14px 18px; overflow: hidden; min-height: 0;">
                    <!-- Coluna da Esquerda: Área de Colagem -->
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 0;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label style="font-size: 11px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.5px;">Cole o Documento / Créditos</label>
                            <span style="font-size: 10px; color: var(--text-muted);">Markdown, rolos de créditos, roteiros ou TXT</span>
                        </div>
                        <textarea id="ai-extract-textarea" placeholder="Cole aqui o texto dos créditos finais, roteiro de elenco ou ficha técnica completa..." style="flex: 1; background: rgba(0,0,0,0.35); border: 1px solid var(--border-glass); border-radius: 6px; padding: 12px; font-family: monospace; font-size: 11px; color: #fff; line-height: 1.4; resize: none; outline: none; white-space: pre;">${currentRawText}</textarea>
                        <button id="btn-run-ai-extract" class="btn-primary" style="height: 34px; font-size: 11.5px; font-weight: 700; background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Analisar com IA & Padronizar
                        </button>
                    </div>

                    <!-- Coluna da Direita: Tabela de Pré-visualização & Ajustes -->
                    <div style="flex: 1.25; display: flex; flex-direction: column; gap: 10px; min-width: 0; background: rgba(0,0,0,0.2); border: 1px solid var(--border-glass); border-radius: 6px; padding: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); padding-bottom: 8px;">
                            <div style="font-size: 11px; font-weight: 700; color: var(--color-cyan);">
                                ${count > 0 ? `${count} Pessoa(s) e Cargo(s) Detectados` : 'Aguardando Análise'}
                            </div>
                            ${count > 0 ? `
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <label style="font-size: 10px; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                        <input type="checkbox" id="chk-extract-select-all" checked> Marcar Todos
                                    </label>
                                </div>
                            ` : ''}
                        </div>

                        <div style="flex: 1; overflow-y: auto;">
                            ${count === 0 ? `
                                <div style="text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: 11.5px; display: flex; flex-direction: column; align-items: center; gap: 10px;">
                                    <i class="fa-solid fa-file-lines" style="font-size: 28px; opacity: 0.3;"></i>
                                    <div>Cole o documento ao lado e clique em <strong>"Analisar com IA"</strong>.</div>
                                    <div style="font-size: 10px; color: var(--text-secondary); max-width: 320px;">O motor detecta automaticamente seções de elenco, direção, equipe, expande múltiplos nomes e formata acentuações.</div>
                                </div>
                            ` : `
                                <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
                                    <thead>
                                        <tr style="border-bottom: 1px solid var(--border-glass); color: var(--text-muted); font-size: 9.5px; text-transform: uppercase;">
                                            <th style="padding: 6px 4px; width: 28px; text-align: center;"></th>
                                            <th style="padding: 6px 8px; width: 44%;">Nome Padronizado</th>
                                            <th style="padding: 6px 8px; width: 44%;">Função / Cargo</th>
                                            <th style="padding: 6px 4px; width: 28px; text-align: center;"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${this.extractedReviewItems.map((item, idx) => `
                                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); opacity: ${item.selected ? 1 : 0.45};">
                                                <td style="padding: 6px 4px; text-align: center;">
                                                    <input type="checkbox" class="extract-item-chk" data-idx="${idx}" ${item.selected ? 'checked' : ''}>
                                                </td>
                                                <td style="padding: 4px 6px;">
                                                    <input type="text" class="nle-input-flat extract-edit-name" data-idx="${idx}" value="${item.name}" style="width: 100%; background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 2px 4px; font-size: 11px; color: #fff; font-weight: 600;">
                                                </td>
                                                <td style="padding: 4px 6px;">
                                                    <input type="text" class="nle-input-flat extract-edit-role" data-idx="${idx}" value="${item.role}" style="width: 100%; background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 2px 4px; font-size: 10.5px; color: var(--color-cyan);">
                                                </td>
                                                <td style="padding: 4px; text-align: center;">
                                                    <button class="btn-remove-extract-item" data-idx="${idx}" style="background: none; border: none; color: var(--color-rose); cursor: pointer; padding: 2px 4px; font-size: 10px;"><i class="fa-solid fa-xmark"></i></button>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            `}
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div style="padding: 12px 18px; border-top: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.3);">
                    <div style="display: flex; gap: 16px; align-items: center;">
                        <label style="font-size: 11px; color: #fff; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                            <input type="radio" name="import-mode" value="replace" checked>
                            <span><strong>Substituir</strong> Ficha Oficial (Limpa anteriores)</span>
                        </label>
                        <label style="font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; cursor: pointer;">
                            <input type="radio" name="import-mode" value="merge">
                            <span>Adicionar aos nomes já cadastrados</span>
                        </label>
                    </div>

                    <div style="display: flex; gap: 8px;">
                        <button id="btn-cancel-extraction" class="btn-secondary" style="font-size: 11px; height: 32px; padding: 0 14px; border: 1px solid var(--border-glass); color: #fff; cursor: pointer; border-radius: 4px;">
                            Cancelar
                        </button>
                        <button id="btn-confirm-import-credits" class="btn-primary" ${count === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} style="font-size: 11px; font-weight: 700; height: 32px; padding: 0 18px; border: none; background: var(--color-cyan); color: #000; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-file-import"></i> Importar para a Ficha Técnica
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindExtractionModalEvents();
    }

    bindExtractionModalEvents() {
        if (!this.extractionModalEl) return;

        const btnClose = this.extractionModalEl.querySelector("#btn-close-extraction-modal");
        if (btnClose) btnClose.onclick = () => this.closeExtractionModal();

        const btnCancel = this.extractionModalEl.querySelector("#btn-cancel-extraction");
        if (btnCancel) btnCancel.onclick = () => this.closeExtractionModal();

        const textarea = this.extractionModalEl.querySelector("#ai-extract-textarea");
        const btnRun = this.extractionModalEl.querySelector("#btn-run-ai-extract");

        if (btnRun && textarea) {
            btnRun.onclick = () => {
                const text = textarea.value.trim();
                if (!text) {
                    if (typeof window !== "undefined" && typeof window.showToast === "function") {
                        window.showToast("Cole o texto antes de executar a análise.", "warning");
                    }
                    return;
                }
                this.extractedReviewItems = this.extractCreditsFromText(text);
                this.renderExtractionModal(text);
            };
        }

        const chkSelectAll = this.extractionModalEl.querySelector("#chk-extract-select-all");
        if (chkSelectAll) {
            chkSelectAll.onchange = (e) => {
                const val = e.target.checked;
                this.extractedReviewItems.forEach(it => it.selected = val);
                this.renderExtractionModal(textarea ? textarea.value : "");
            };
        }

        this.extractionModalEl.querySelectorAll(".extract-item-chk").forEach(chk => {
            chk.onchange = (e) => {
                const idx = parseInt(chk.dataset.idx, 10);
                if (this.extractedReviewItems[idx]) {
                    this.extractedReviewItems[idx].selected = e.target.checked;
                    this.renderExtractionModal(textarea ? textarea.value : "");
                }
            };
        });

        this.extractionModalEl.querySelectorAll(".extract-edit-name").forEach(inp => {
            inp.onchange = (e) => {
                const idx = parseInt(inp.dataset.idx, 10);
                if (this.extractedReviewItems[idx]) {
                    this.extractedReviewItems[idx].name = toTitleCaseName(e.target.value.trim());
                    this.extractedReviewItems[idx].variations = [this.extractedReviewItems[idx].name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
                }
            };
        });

        this.extractionModalEl.querySelectorAll(".extract-edit-role").forEach(inp => {
            inp.onchange = (e) => {
                const idx = parseInt(inp.dataset.idx, 10);
                if (this.extractedReviewItems[idx]) {
                    this.extractedReviewItems[idx].role = formatRoleName(e.target.value.trim());
                }
            };
        });

        this.extractionModalEl.querySelectorAll(".btn-remove-extract-item").forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.idx, 10);
                this.extractedReviewItems.splice(idx, 1);
                this.renderExtractionModal(textarea ? textarea.value : "");
            };
        });

        const btnImport = this.extractionModalEl.querySelector("#btn-confirm-import-credits");
        if (btnImport) {
            btnImport.onclick = () => {
                const selectedItems = this.extractedReviewItems.filter(it => it.selected && it.name);
                if (selectedItems.length === 0) {
                    if (typeof window !== "undefined" && typeof window.showToast === "function") {
                        window.showToast("Selecione pelo menos um nome para importar.", "warning");
                    }
                    return;
                }

                const modeRadio = this.extractionModalEl.querySelector("input[name='import-mode']:checked");
                const mode = modeRadio ? modeRadio.value : "replace";

                let finalCredits = [];
                if (mode === "merge") {
                    const current = this.getOfficialCredits();
                    finalCredits = [...current];
                    selectedItems.forEach(item => {
                        const existingIdx = finalCredits.findIndex(c => c.name.toLowerCase() === item.name.toLowerCase());
                        if (existingIdx === -1) {
                            finalCredits.push(item);
                        } else {
                            if (item.role && !finalCredits[existingIdx].role) {
                                finalCredits[existingIdx].role = item.role;
                            }
                        }
                    });
                } else {
                    finalCredits = selectedItems;
                }

                this.saveOfficialCredits(finalCredits);
                this.closeExtractionModal();
                this.render();

                if (typeof window !== "undefined" && typeof window.showToast === "function") {
                    window.showToast(`${selectedItems.length} nome(s) padronizados e salvos na Ficha Técnica Oficial!`, "success");
                }
            };
        }
    }

    render() {
        if (!this.modalEl) {
            this.modalEl = document.createElement("div");
            this.modalEl.id = "credits-normalizer-modal";
            this.modalEl.className = "nle-modal-overlay";
            this.modalEl.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.78); backdrop-filter: blur(8px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px;";
            document.body.appendChild(this.modalEl);
        }

        const credits = this.getOfficialCredits();
        const filtered = credits.filter(c => !this.searchQuery || c.name.toLowerCase().includes(this.searchQuery.toLowerCase()) || (c.role && c.role.toLowerCase().includes(this.searchQuery.toLowerCase())));

        this.modalEl.innerHTML = `
            <div class="nle-modal-container" style="background: var(--bg-glass-active, #181524); border: 1px solid var(--border-glass); border-radius: 8px; width: 920px; max-width: 95vw; height: 680px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: var(--shadow-premium); overflow: hidden;">
                <!-- Header -->
                <div style="padding: 14px 18px; border-bottom: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fa-solid fa-address-book" style="color: #f59e0b; font-size: 16px;"></i>
                        <h2 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0;">Central de Ficha Técnica & Normalização de Nomes</h2>
                    </div>
                    <button id="btn-close-credits-modal" class="btn-flat-action" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px 8px; font-size: 14px;"><i class="fa-solid fa-xmark"></i></button>
                </div>

                <!-- Info e Ações de Entrada -->
                <div style="padding: 12px 18px; border-bottom: 1px solid var(--border-glass); display: flex; flex-direction: column; gap: 10px; background: rgba(0,0,0,0.12);">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                        <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.4;">
                            A lista oficial de créditos é utilizada pela Inteligência Artificial para identificar entrevistados na agulha e padronizar nomes e cargos em Lower Thirds (GCs).
                        </div>
                        <button id="btn-download-credits-template" class="btn-secondary" style="font-size: 10.5px; height: 28px; padding: 0 10px; display: flex; align-items: center; gap: 6px; white-space: nowrap; border: 1px solid var(--border-glass); color: var(--color-cyan); cursor: pointer; border-radius: 4px;">
                            <i class="fa-solid fa-download"></i> Baixar Modelo TXT
                        </button>
                    </div>

                    <!-- Botões de Ingestão -->
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div class="search-area glassmorphism" style="flex: 1; display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px;">
                            <i class="fa-solid fa-magnifying-glass" style="color: var(--text-muted); font-size: 11px;"></i>
                            <input type="text" id="credits-search-input" placeholder="Buscar por nome ou cargo oficial..." value="${this.searchQuery}" style="flex: 1; background: transparent; border: none; outline: none; font-size: 11px; color: #fff;">
                        </div>

                        <button id="btn-paste-credits-text" class="btn-primary" style="font-size: 11px; height: 30px; padding: 0 12px; display: flex; align-items: center; gap: 6px; background: rgba(245,158,11,0.15); border: 1px solid rgba(245,158,11,0.4); color: #f59e0b; cursor: pointer; border-radius: 4px;">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Colar e Extrair com IA
                        </button>

                        <button id="btn-add-single-credit" class="btn-secondary" style="font-size: 11px; height: 30px; padding: 0 12px; display: flex; align-items: center; gap: 6px; border: 1px solid var(--border-glass); color: #fff; cursor: pointer; border-radius: 4px;">
                            <i class="fa-solid fa-plus"></i> Novo Nome
                        </button>

                        <button id="btn-clear-all-credits" class="btn-secondary" title="Limpar todos os nomes da ficha oficial" style="font-size: 11px; height: 30px; padding: 0 10px; border: 1px solid rgba(244,63,94,0.3); background: rgba(244,63,94,0.06); color: var(--color-rose); cursor: pointer; border-radius: 4px;">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>

                <!-- Tabela de Nomes & Cargos -->
                <div style="flex: 1; overflow-y: auto; padding: 14px 18px;">
                    ${filtered.length === 0 ? `
                        <div style="text-align: center; padding: 50px 20px; color: var(--text-muted); font-size: 12px; display: flex; flex-direction: column; align-items: center; gap: 10px;">
                            <i class="fa-solid fa-address-book" style="font-size: 32px; opacity: 0.3;"></i>
                            <div>Nenhum nome cadastrado na Ficha Técnica Oficial deste projeto.</div>
                            <div style="font-size: 11px; color: var(--text-secondary);">Clique em <strong>"Colar e Extrair com IA"</strong> para analisar seu documento ou rolo de créditos automaticamente.</div>
                        </div>
                    ` : `
                        <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; text-align: left;">
                            <thead>
                                <tr style="border-bottom: 1px solid var(--border-glass); color: var(--text-muted); font-size: 10px; text-transform: uppercase;">
                                    <th style="padding: 8px 10px; width: 35%;">Nome Completo Oficial</th>
                                    <th style="padding: 8px 10px; width: 35%;">Cargo / Função / Identificação</th>
                                    <th style="padding: 8px 10px; width: 20%;">Variações Fonéticas</th>
                                    <th style="padding: 8px 10px; width: 10%; text-align: center;">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filtered.map(item => `
                                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                                        <td style="padding: 8px 10px; font-weight: 600; color: #fff;">
                                            <input type="text" class="nle-input-flat edit-credit-name" data-id="${item.id}" value="${item.name}" style="width: 100%; background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 2px 4px; font-size: 11.5px; color: #fff; outline: none;">
                                        </td>
                                        <td style="padding: 8px 10px; color: var(--color-cyan);">
                                            <input type="text" class="nle-input-flat edit-credit-role" data-id="${item.id}" value="${item.role || ''}" placeholder="Ex: Entrevistado / Diretor" style="width: 100%; background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 2px 4px; font-size: 11px; color: var(--color-cyan); outline: none;">
                                        </td>
                                        <td style="padding: 8px 10px; color: var(--text-muted); font-size: 10px;">
                                            ${(item.variations || []).join(', ') || '--'}
                                        </td>
                                        <td style="padding: 8px 10px; text-align: center;">
                                            <button class="btn-delete-credit" data-id="${item.id}" title="Excluir da ficha oficial" style="background: none; border: none; color: var(--color-rose); cursor: pointer; padding: 2px 6px; font-size: 11px;">
                                                <i class="fa-solid fa-trash-can"></i>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `}
                </div>

                <!-- Footer com Ações Globais -->
                <div style="padding: 12px 18px; border-top: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2);">
                    <span style="font-size: 11px; color: var(--text-muted);">
                        ${credits.length} pessoa(s) e cargo(s) cadastrados oficialmente
                    </span>
                    <div style="display: flex; gap: 8px;">
                        <button id="btn-normalize-all-gcs" class="btn-secondary" style="font-size: 11px; height: 32px; padding: 0 14px; border: 1px solid rgba(245,158,11,0.4); background: rgba(245,158,11,0.08); color: #f59e0b; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Validar e Corrigir Todos os GCs da Timeline
                        </button>
                        <button id="btn-save-credits-done" class="btn-primary" style="font-size: 11px; font-weight: 700; height: 32px; padding: 0 18px; border: none; background: var(--color-cyan); color: #000; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-check"></i> Concluir
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        if (!this.modalEl) return;

        // Fechar
        const btnClose = this.modalEl.querySelector("#btn-close-credits-modal");
        if (btnClose) btnClose.onclick = () => this.closeModal();

        const btnDone = this.modalEl.querySelector("#btn-save-credits-done");
        if (btnDone) btnDone.onclick = () => this.closeModal();

        // Download template
        const btnTpl = this.modalEl.querySelector("#btn-download-credits-template");
        if (btnTpl) btnTpl.onclick = () => this.downloadCreditTemplate();

        // Busca
        const searchInput = this.modalEl.querySelector("#credits-search-input");
        if (searchInput) {
            searchInput.oninput = (e) => {
                this.searchQuery = e.target.value;
                this.render();
                const fresh = this.modalEl.querySelector("#credits-search-input");
                if (fresh) {
                    fresh.focus();
                    fresh.selectionStart = fresh.selectionEnd = fresh.value.length;
                }
            };
        }

        // Colar documento com IA (Abre Modal Dedicada de Extração)
        const btnPaste = this.modalEl.querySelector("#btn-paste-credits-text");
        if (btnPaste) {
            btnPaste.onclick = () => this.openExtractionModal();
        }

        // Limpar toda a ficha
        const btnClear = this.modalEl.querySelector("#btn-clear-all-credits");
        if (btnClear) {
            btnClear.onclick = () => {
                if (confirm("Tem certeza que deseja limpar todos os nomes da Ficha Técnica Oficial?")) {
                    this.saveOfficialCredits([]);
                    this.render();
                    if (typeof window !== "undefined" && typeof window.showToast === "function") {
                        window.showToast("Ficha Técnica esvaziada.", "info");
                    }
                }
            };
        }

        // Adicionar único nome manual
        const btnAdd = this.modalEl.querySelector("#btn-add-single-credit");
        if (btnAdd) {
            btnAdd.onclick = () => {
                const name = prompt("Nome completo da pessoa:");
                if (name && name.trim()) {
                    const role = prompt("Cargo / Função / Identificação:", "Personagem / Entrevistado(a)");
                    const cleanName = toTitleCaseName(name.trim());
                    const current = this.getOfficialCredits();
                    current.push({
                        id: `cred_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        name: cleanName,
                        role: formatRoleName(role || "Personagem / Entrevistado(a)"),
                        variations: [cleanName.normalize("NFD").replace(/[\u0300-\u036f]/g, "")],
                        notes: "Adicionado manualmente"
                    });
                    this.saveOfficialCredits(current);
                    this.render();
                }
            };
        }

        // Edição inline de nome
        this.modalEl.querySelectorAll(".edit-credit-name").forEach(inp => {
            inp.onchange = () => {
                const id = inp.dataset.id;
                const current = this.getOfficialCredits();
                const item = current.find(c => c.id === id);
                if (item) {
                    item.name = toTitleCaseName(inp.value.trim());
                    item.variations = [item.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
                    this.saveOfficialCredits(current);
                }
            };
        });

        // Edição inline de cargo
        this.modalEl.querySelectorAll(".edit-credit-role").forEach(inp => {
            inp.onchange = () => {
                const id = inp.dataset.id;
                const current = this.getOfficialCredits();
                const item = current.find(c => c.id === id);
                if (item) {
                    item.role = formatRoleName(inp.value.trim());
                    this.saveOfficialCredits(current);
                }
            };
        });

        // Excluir crédito
        this.modalEl.querySelectorAll(".btn-delete-credit").forEach(btn => {
            btn.onclick = () => {
                const id = btn.dataset.id;
                const current = this.getOfficialCredits().filter(c => c.id !== id);
                this.saveOfficialCredits(current);
                this.render();
            };
        });

        // Normalizar todos os GCs da Timeline
        const btnNormAll = this.modalEl.querySelector("#btn-normalize-all-gcs");
        if (btnNormAll) {
            btnNormAll.onclick = () => {
                TIMELINE_HISTORY.begin();
                const cuts = [...STATE.activeTimelineCuts];
                let correctedCount = 0;

                cuts.forEach(clip => {
                    if (clip.type === "text") {
                        const match = this.findMatchingCredit(clip.text);
                        if (match) {
                            if (clip.text !== match.name || (match.role && clip.subtext !== match.role)) {
                                clip.text = match.name;
                                if (match.role && (!clip.subtext || clip.textCategory === "lower_third")) {
                                    clip.subtext = match.role;
                                }
                                correctedCount++;
                            }
                        }
                    }
                });

                STATE.activeTimelineCuts = cuts;
                TIMELINE_HISTORY.commit();
                STATE.emit("timelineCutsUpdated", cuts);

                if (typeof window !== "undefined" && typeof window.showToast === "function") {
                    window.showToast(`${correctedCount} Lower Third(s) corrigidos e padronizados com a Ficha Oficial!`, "success");
                }
            };
        }
    }
}

export const CREDITS_NORMALIZER = new CreditsNormalizer();

