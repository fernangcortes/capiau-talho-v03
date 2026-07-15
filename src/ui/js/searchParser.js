/**
 * Motor de Busca Avançada com Lógica Booleana e Agregador de Tags Dinâmicas
 * Projetado especificamente para a interface clássica NLE do CapIAu.
 */

export function parseQuery(queryStr) {
    if (!queryStr || !queryStr.trim()) return null;
    
    // Tokenização
    const tokens = [];
    // Captura operadores booleanos, parênteses, filtros chave-valor e termos simples
    // A expressão chave-valor permite aspas no valor: ex chave:"valor com espaco"
    const regex = /\s*(?:(&&|\|\||AND|OR|NOT|!|-|\(|\))|("[^"]*")|(\b\w+[:><=](?:"[^"]*"|\S+))|([^\s()]+))\s*/gi;
    let match;
    
    while ((match = regex.exec(queryStr)) !== null) {
        if (match[1]) {
            let val = match[1].toUpperCase();
            if (val === "&&") val = "AND";
            if (val === "||") val = "OR";
            if (val === "!" || val === "-") val = "NOT";
            if (val === "(") val = "LPAREN";
            if (val === ")") val = "RPAREN";
            tokens.push({ type: val, value: val });
        } else if (match[2]) {
            // Termo com aspas (frase exata)
            tokens.push({ type: "TERM", value: match[2].slice(1, -1) });
        } else if (match[3]) {
            // Filtro (chave:valor, chave>valor, chave<valor)
            tokens.push({ type: "FILTER", value: match[3] });
        } else if (match[4]) {
            const val = match[4];
            const valUpper = val.toUpperCase();
            if (valUpper === "AND" || valUpper === "OR" || valUpper === "NOT") {
                tokens.push({ type: valUpper, value: valUpper });
            } else {
                tokens.push({ type: "TERM", value: val });
            }
        }
    }
    
    let index = 0;
    const peek = () => tokens[index];
    const consume = () => tokens[index++];
    
    function parseExpression() {
        return parseOr();
    }
    
    function parseOr() {
        let left = parseAnd();
        while (peek() && peek().type === "OR") {
            consume();
            const right = parseAnd();
            left = { type: "OR", left, right };
        }
        return left;
    }
    
    function parseAnd() {
        let left = parsePrimary();
        while (peek() && (peek().type === "AND" || (peek().type !== "OR" && peek().type !== "RPAREN"))) {
            if (peek().type === "AND") consume();
            const right = parsePrimary();
            left = { type: "AND", left, right };
        }
        return left;
    }
    
    function parsePrimary() {
        const token = peek();
        if (!token) return { type: "EMPTY" };
        
        if (token.type === "NOT") {
            consume();
            const expr = parsePrimary();
            return { type: "NOT", expr };
        }
        if (token.type === "LPAREN") {
            consume();
            const expr = parseExpression();
            if (peek() && peek().type === "RPAREN") consume();
            return expr;
        }
        
        consume();
        if (token.type === "FILTER") {
            const filterStr = token.value;
            let key = "";
            let op = "=";
            let val = "";
            
            const colonIndex = filterStr.indexOf(":");
            const gtIndex = filterStr.indexOf(">");
            const ltIndex = filterStr.indexOf("<");
            
            if (colonIndex !== -1) {
                key = filterStr.slice(0, colonIndex).toLowerCase();
                val = filterStr.slice(colonIndex + 1);
            } else if (gtIndex !== -1) {
                key = filterStr.slice(0, gtIndex).toLowerCase();
                op = ">";
                val = filterStr.slice(gtIndex + 1);
            } else if (ltIndex !== -1) {
                key = filterStr.slice(0, ltIndex).toLowerCase();
                op = "<";
                val = filterStr.slice(ltIndex + 1);
            }
            
            // Remove quotes in value if any
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1);
            }
            
            return { type: "FILTER", key, op, value: val };
        }
        
        return { type: "TERM", value: token.value };
    }
    
    try {
        return parseExpression();
    } catch (e) {
        console.error("[SearchParser] Erro de análise:", e);
        return null;
    }
}

// Verifica se um termo simples bate com o item
function matchTerm(item, tabId, term) {
    if (!item) return false;
    
    if (tabId === "tab-videos") {
        const title = (item.title || "").toLowerCase();
        const filename = (item.filename || "").toLowerCase();
        const filepath = (item.filepath || "").toLowerCase();
        const description = (item.description || "").toLowerCase();
        const summary = (item.summary || "").toLowerCase();
        const cat = (item.category || "").toLowerCase();
        return title.includes(term) || filename.includes(term) || filepath.includes(term) || description.includes(term) || summary.includes(term) || cat.includes(term);
    }
    
    if (tabId === "tab-photos") {
        const title = (item.title || "").toLowerCase();
        const filename = (item.filename || "").toLowerCase();
        const description = (item.description || "").toLowerCase();
        const cat = (item.category || "").toLowerCase();
        return title.includes(term) || filename.includes(term) || description.includes(term) || cat.includes(term);
    }
    
    if (tabId === "tab-themes") {
        const title = (item.title || "").toLowerCase();
        const description = (item.description || "").toLowerCase();
        return title.includes(term) || description.includes(term);
    }
    
    if (tabId === "tab-docs") {
        const filename = (item.filename || "").toLowerCase();
        const content = (item.content || "").toLowerCase();
        const type = (item.doc_type || "").toLowerCase();
        return filename.includes(term) || content.includes(term) || type.includes(term);
    }
    
    if (tabId === "tab-faces") {
        const name = (item.name || "").toLowerCase();
        const groupText = `grupo ${item.cluster_id + 1}`;
        return name.includes(term) || groupText.includes(term);
    }
    
    return false;
}

// Verifica se um filtro chave-valor bate com o item
function matchFilter(item, tabId, key, op, val) {
    const valLower = val.toLowerCase();
    
    if (tabId === "tab-videos") {
        if (key === "tipo" || key === "type") {
            const t = (item.video_type || "").toLowerCase();
            if (valLower === "fala" || valLower === "entrevista" || valLower === "interview") {
                return t === "interview";
            }
            if (valLower === "bastidores" || valLower === "broll") {
                return t === "broll";
            }
            return t === valLower;
        }
        
        if (key === "status") {
            const s = (item.status || "").toLowerCase();
            if (valLower === "pendente" || valLower === "pending") return s === "pending";
            if (valLower === "asr" || valLower === "transcrito" || valLower === "transcribed") return s === "transcribed";
            if (valLower === "visao" || valLower === "analisado" || valLower === "analyzed") return s === "analyzed";
            if (valLower === "erro" || valLower === "error") return s === "error";
            return s === valLower;
        }
        
        if (key === "categoria" || key === "cat") {
            return (item.category || "").toLowerCase() === valLower;
        }
        
        if (key === "duracao" || key === "dur" || key === "duration") {
            const d = parseFloat(item.duration) || 0;
            const target = parseFloat(val) || 0;
            if (op === ">") return d > target;
            if (op === "<") return d < target;
            return Math.abs(d - target) < 1; // tolerância de 1s
        }
        
        if (key === "tag" || key === "tags") {
            try {
                const tags = typeof item.tags === "string" ? JSON.parse(item.tags) : item.tags;
                if (Array.isArray(tags)) {
                    return tags.some(t => t.toLowerCase().includes(valLower));
                }
            } catch(e) {}
            return false;
        }
        
        if (key === "fps") {
            const fps = parseFloat(item.fps) || 0;
            const target = parseFloat(val) || 0;
            if (op === ">") return fps > target;
            if (op === "<") return fps < target;
            return Math.abs(fps - target) < 0.1;
        }
        
        if (key === "res" || key === "resolution") {
            return (item.resolution || "").toLowerCase().includes(valLower);
        }
    }
    
    if (tabId === "tab-photos") {
        if (key === "status") {
            const s = (item.status || "").toLowerCase();
            if (valLower === "pendente" || valLower === "pending") return s === "pending";
            if (valLower === "processado" || valLower === "analisado" || valLower === "analyzed") return s === "analyzed" || s === "ingested";
            if (valLower === "erro" || valLower === "error") return s === "error";
            return s === valLower;
        }
        if (key === "tag" || key === "tags") {
            try {
                const tags = typeof item.tags === "string" ? JSON.parse(item.tags) : item.tags;
                if (Array.isArray(tags)) {
                    return tags.some(t => t.toLowerCase().includes(valLower));
                }
            } catch(e) {}
            return false;
        }
        if (key === "formato" || key === "format" || key === "ext") {
            const ext = (item.filename || "").split(".").pop().toLowerCase();
            if (valLower === "raw") {
                return ["arw","cr2","nef","dng","pef","raf","orf","rw2","raw"].includes(ext);
            }
            return ext === valLower;
        }
    }
    
    if (tabId === "tab-themes") {
        if (key === "trechos" || key === "segmentos" || key === "segments") {
            const count = parseInt(item.segments_count) || 0;
            const target = parseInt(val) || 0;
            if (op === ">") return count > target;
            if (op === "<") return count < target;
            return count === target;
        }
    }
    
    if (tabId === "tab-docs") {
        if (key === "tipo" || key === "type") {
            const t = (item.doc_type || "").toLowerCase();
            if (valLower === "roteiro" || valLower === "script") return t === "script";
            if (valLower === "pauta" || valLower === "outline") return t === "outline";
            if (valLower === "outros" || valLower === "other") return t === "other" || t === "notes";
            return t === valLower;
        }
    }
    
    if (tabId === "tab-faces") {
        if (key === "nome" || key === "name") {
            return (item.name || "").toLowerCase().includes(valLower);
        }
        if (key === "aparicoes" || key === "occurrences" || key === "count") {
            const count = parseInt(item.occurrences) || 0;
            const target = parseInt(val) || 0;
            if (op === ">") return count > target;
            if (op === "<") return count < target;
            return count === target;
        }
        if (key === "grupo" || key === "cluster") {
            return String(item.cluster_id) === val || String(item.cluster_id + 1) === val;
        }
    }
    
    return false;
}

// Avaliação recursiva do AST
export function evaluateAST(ast, item, tabId) {
    if (!ast) return true;
    if (ast.type === "EMPTY") return true;
    
    if (ast.type === "AND") {
        return evaluateAST(ast.left, item, tabId) && evaluateAST(ast.right, item, tabId);
    }
    if (ast.type === "OR") {
        return evaluateAST(ast.left, item, tabId) || evaluateAST(ast.right, item, tabId);
    }
    if (ast.type === "NOT") {
        return !evaluateAST(ast.expr, item, tabId);
    }
    
    if (ast.type === "TERM") {
        return matchTerm(item, tabId, ast.value.toLowerCase());
    }
    
    if (ast.type === "FILTER") {
        return matchFilter(item, tabId, ast.key, ast.op, ast.value);
    }
    
    return true;
}

// Filtra uma lista de itens com base no termo de busca avançada
export function filterItems(items, queryStr, tabId) {
    if (!items || items.length === 0) return [];
    if (!queryStr || !queryStr.trim()) return items;
    
    const ast = parseQuery(queryStr);
    if (!ast) return items;
    
    return items.filter(item => evaluateAST(ast, item, tabId));
}

// Analisa a lista de itens ativa e agrupa todas as tags e metadados comuns para sugestões
export function getAvailableSuggestions(items, tabId) {
    const suggestions = [];
    if (!items || items.length === 0) return suggestions;
    
    // Cada entrada: { displayLabel, insertValue, value (filtro interno), count, category }
    const groups = {};  // key -> { displayLabel, insertValue, value, count, category }
    
    const addEntry = (key, displayLabel, insertValue, category) => {
        if (!groups[key]) {
            groups[key] = { displayLabel, insertValue, value: key, count: 0, category };
        }
        groups[key].count++;
    };
    
    if (tabId === "tab-videos") {
        items.forEach(v => {
            // Tipo
            if (v.video_type === "interview") {
                addEntry("tipo:fala", "Fala", "tipo:fala", "Tipo");
            } else {
                addEntry("tipo:bastidores", "Bastidores", "tipo:bastidores", "Tipo");
            }
            
            // Categoria
            if (v.category) {
                addEntry(`cat:${v.category}`, v.category, `cat:${v.category}`, "Categorias");
            }
            
            // Status
            if (v.status) {
                if (v.status === "pending") addEntry("status:pendente", "Pendente", "status:pendente", "Status");
                else if (v.status === "transcribed") addEntry("status:asr", "ASR", "status:asr", "Status");
                else if (v.status === "analyzed") addEntry("status:visao", "Visão", "status:visao", "Status");
                else if (v.status === "error") addEntry("status:erro", "Erro", "status:erro", "Status");
            }
            
            // Tags
            if (v.tags) {
                try {
                    const parsed = typeof v.tags === "string" ? JSON.parse(v.tags) : v.tags;
                    if (Array.isArray(parsed)) {
                        parsed.forEach(t => {
                            addEntry(`tag:${t}`, t, `"${t}"`, "Tags");
                        });
                    }
                } catch(e) {}
            }
        });
    } else if (tabId === "tab-photos") {
        items.forEach(p => {
            // Status
            if (p.status) {
                if (p.status === "pending") addEntry("status:pendente", "Pendente", "status:pendente", "Status");
                else if (p.status === "analyzed" || p.status === "ingested") addEntry("status:processado", "Processado", "status:processado", "Status");
                else if (p.status === "error") addEntry("status:erro", "Erro", "status:erro", "Status");
            }
            
            // Formato/Extensão
            const ext = (p.filename || "").split(".").pop().toLowerCase();
            const isRaw = ["arw","cr2","nef","dng","pef","raf","orf","rw2","raw"].includes(ext);
            if (isRaw) {
                addEntry("formato:raw", "RAW", "formato:raw", "Formatos");
            } else if (ext) {
                addEntry(`formato:${ext}`, ext.toUpperCase(), `formato:${ext}`, "Formatos");
            }
            
            // Tags
            if (p.tags) {
                try {
                    const parsed = typeof p.tags === "string" ? JSON.parse(p.tags) : p.tags;
                    if (Array.isArray(parsed)) {
                        parsed.forEach(t => {
                            addEntry(`tag:${t}`, t, `"${t}"`, "Tags");
                        });
                    }
                } catch(e) {}
            }
        });
    } else if (tabId === "tab-docs") {
        items.forEach(doc => {
            if (doc.doc_type) {
                if (doc.doc_type === "script") addEntry("tipo:roteiro", "Roteiro", "tipo:roteiro", "Tipo");
                else if (doc.doc_type === "outline") addEntry("tipo:pauta", "Pauta", "tipo:pauta", "Tipo");
                else addEntry("tipo:outros", "Outros", "tipo:outros", "Tipo");
            }
        });
    } else if (tabId === "tab-faces") {
        items.forEach(c => {
            if (c.name && !c.name.startsWith("Pessoa Desconhecida")) {
                const insertVal = c.name.includes(" ") ? `"${c.name}"` : c.name;
                addEntry(`nome:${c.name}`, c.name, insertVal, "Pessoas");
            }
        });
    }
    
    return Object.values(groups).sort((a, b) => b.count - a.count);
}
