import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";

class LogManager {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.originalConsole = {
            log: console.log,
            warn: console.warn,
            error: console.error
        };
        
        // Elementos da interface
        this.logsOutput = null;
        this.filterSelect = null;
        this.btnClear = null;
        this.btnCopy = null;
        this.btnHumanReport = null;
        this.btnTechnicalAnalysis = null;
        this.aiOutput = null;
        this.aiContainer = null;
        
        this.init();
    }

    init() {
        // Sobrescreve métodos do console de forma segura
        this.wrapConsole();
        
        // Escuta ações globais da aplicação para registrar logs
        this.hookSystemEvents();
        
        // Liga o logManager ao escopo global para que outros módulos possam usar
        window.logManager = this;
        
        // Inicializa controles de UI quando o DOM estiver pronto
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => this.bindUI());
        } else {
            this.bindUI();
        }
    }

    log(source, message, level = "INFO") {
        const timestamp = new Date().toISOString();
        const logEntry = { timestamp, source, message, level };
        
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        // Renderiza em tempo real se o painel estiver visível/iniciado
        this.appendLogToUI(logEntry);
    }

    wrapConsole() {
        const self = this;
        
        console.log = function(...args) {
            self.originalConsole.log.apply(console, args);
            const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(" ");
            
            // Filtra logs relevantes para não poluir
            if (msg.includes("[Autosave]") || msg.includes("[Timeline]") || msg.includes("[API]") || msg.includes("Player")) {
                let source = "System";
                if (msg.includes("[Autosave]")) source = "Autosave";
                else if (msg.includes("[Timeline]")) source = "Timeline";
                else if (msg.includes("[API]")) source = "API";
                else if (msg.includes("Player")) source = "Player";
                
                self.log(source, msg.replace(/^\[.*?\]\s*/, ""), "INFO");
            }
        };

        console.warn = function(...args) {
            self.originalConsole.warn.apply(console, args);
            const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(" ");
            self.log("Console", msg, "WARNING");
        };

        console.error = function(...args) {
            self.originalConsole.error.apply(console, args);
            const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(" ");
            self.log("Console", msg, "ERROR");
        };

        // Captura erros globais não tratados (uncaught exceptions)
        window.addEventListener("error", (event) => {
            self.log("UncaughtException", `${event.message} em ${event.filename}:${event.lineno}`, "ERROR");
        });
    }

    hookSystemEvents() {
        // Log de mudanças de projeto
        STATE.on("projectChanged", (projectId) => {
            this.log("Project", `Projeto ativo alterado para ID: ${projectId}`, "ACTION");
        });

        // Log de alterações na timeline
        STATE.on("timelineCutsUpdated", (cuts) => {
            this.log("Timeline", `Cortes atualizados. Total: ${cuts.length} clipes na timeline.`, "ACTION");
        });

        STATE.on("timelineTracksChanged", (tracks) => {
            this.log("Timeline", `Configuração de pistas atualizada. Total: ${tracks.length} pistas.`, "ACTION");
        });

        STATE.on("timelineGhostUpdated", (ghosts) => {
            this.log("IA", `Sugestões fantasmas atualizadas. Total: ${ghosts.length} clipes.`, "INFO");
        });
    }

    bindUI() {
        this.logsOutput = document.getElementById("logs-output");
        this.filterSelect = document.getElementById("logs-filter-select");
        this.btnClear = document.getElementById("btn-clear-logs");
        this.btnCopy = document.getElementById("btn-copy-logs");
        
        this.btnHumanReport = document.getElementById("btn-log-human-report");
        this.btnTechnicalAnalysis = document.getElementById("btn-log-technical-analysis");
        this.aiOutput = document.getElementById("logs-ai-output");
        this.aiContainer = document.getElementById("logs-ai-container");

        if (this.filterSelect) {
            this.filterSelect.addEventListener("change", () => this.refreshUI());
        }

        if (this.btnClear) {
            this.btnClear.addEventListener("click", () => {
                this.logs = [];
                if (this.logsOutput) this.logsOutput.innerHTML = "";
                if (this.aiOutput) this.aiOutput.innerHTML = "";
                if (this.aiContainer) this.aiContainer.style.display = "none";
                this.log("System", "Histórico de logs limpo pelo usuário.", "INFO");
            });
        }

        if (this.btnCopy) {
            this.btnCopy.addEventListener("click", () => this.copyLogsToClipboard());
        }

        if (this.btnHumanReport) {
            this.btnHumanReport.addEventListener("click", () => this.generateAiAnalysis("human"));
        }

        if (this.btnTechnicalAnalysis) {
            this.btnTechnicalAnalysis.addEventListener("click", () => this.generateAiAnalysis("technical"));
        }

        // Renderiza logs retroativos acumulados antes do bind
        this.refreshUI();
    }

    refreshUI() {
        if (!this.logsOutput) return;
        this.logsOutput.innerHTML = "";
        
        const filter = this.filterSelect ? this.filterSelect.value : "all";
        
        this.logs.forEach(log => {
            if (this.matchesFilter(log, filter)) {
                this.appendLogToUI(log);
            }
        });
    }

    matchesFilter(log, filter) {
        if (filter === "all") return true;
        if (filter === "actions") return log.level === "ACTION";
        if (filter === "warnings") return log.level === "WARNING";
        if (filter === "errors") return log.level === "ERROR";
        if (filter === "info") return log.level === "INFO";
        return true;
    }

    appendLogToUI(log) {
        if (!this.logsOutput) return;
        
        // Se houver filtro ativo e este log não passar, ignora
        const filter = this.filterSelect ? this.filterSelect.value : "all";
        if (!this.matchesFilter(log, filter)) return;

        const entry = document.createElement("div");
        entry.className = `log-entry level-${log.level.toLowerCase()}`;
        entry.style.fontFamily = "Consolas, Monaco, monospace";
        entry.style.fontSize = "11px";
        entry.style.lineHeight = "1.4";
        entry.style.marginBottom = "4px";
        entry.style.borderBottom = "1px solid rgba(255,255,255,0.02)";
        entry.style.paddingBottom = "2px";
        
        // Cores premium para cada nível de log
        let color = "#e0e0e0";
        if (log.level === "WARNING") color = "#f59e0b"; // amber
        else if (log.level === "ERROR") color = "#ef4444"; // red
        else if (log.level === "ACTION") color = "#06b6d4"; // cyan
        else if (log.level === "INFO") color = "#10b981"; // emerald

        const timeStr = log.timestamp.split("T")[1].substring(0, 8);
        
        entry.innerHTML = `
            <span style="color: #888;">[${timeStr}]</span>
            <span style="color: var(--text-muted); font-weight:600;">[${log.source}]</span>
            <span style="color: ${color};">[${log.level}]</span>
            <span style="color: #d1d5db; word-break: break-all;">${this.escapeHTML(log.message)}</span>
        `;
        
        this.logsOutput.appendChild(entry);
        
        // Scroll automático se estiver no final
        this.logsOutput.scrollTop = this.logsOutput.scrollHeight;
    }

    escapeHTML(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    formatLogsText() {
        return this.logs.map(log => {
            return `[${log.timestamp}] [${log.source}] [${log.level}] ${log.message}`;
        }).join("\n");
    }

    copyLogsToClipboard() {
        const text = this.formatLogsText();
        if (!text) {
            alert("Nenhum log para copiar.");
            return;
        }
        
        navigator.clipboard.writeText(text)
            .then(() => {
                alert("Logs copiados para a área de transferência com sucesso!");
                this.log("System", "Logs copiados para o clipboard pelo usuário.", "INFO");
            })
            .catch(err => {
                alert("Falha ao copiar logs: " + err);
            });
    }

    async generateAiAnalysis(type) {
        if (!this.aiOutput || !this.aiContainer) return;
        
        const logsText = this.formatLogsText();
        if (!logsText) {
            alert("Nenhum log disponível para análise.");
            return;
        }

        this.aiContainer.style.display = "flex";
        this.aiOutput.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px; color:var(--color-cyan); font-size:12px;">
                <i class="fa-solid fa-spinner fa-spin"></i> Processando análise de logs com a IA...
            </div>
        `;
        
        const modelSelect = document.getElementById("agent-model-select");
        const apiKeyInput = document.getElementById("agent-api-key-input");
        const activeModel = modelSelect ? modelSelect.value : null;
        const customApiKey = apiKeyInput ? apiKeyInput.value : null;

        let prompt = "";
        if (type === "human") {
            prompt = `Aqui estão os logs de desenvolvimento e edição do usuário da ferramenta de edição de vídeo CapIAu-Talho.
Por favor, analise esses logs e forneça um resumo não-técnico para humanos (em português) explicando exatamente o que o usuário andou fazendo nesta sessão de edição de vídeo (quais alterações na timeline, mídias adicionadas, etc.), e se ocorreu algum erro perceptível para ele. Use listas e um tom direto.

LOGS:
\`\`\`
${logsText}
\`\`\`
`;
        } else {
            prompt = `Você é um engenheiro de software sênior analisando logs de uma aplicação web de edição de vídeo (CapIAu-Talho).
Analise tecnicamente (em português) os logs abaixo. Identifique potenciais bugs, problemas de performance, erros de rede/API, ou anomalias no auto-salvamento e histórico de desfazer (Undo/Redo). Dê recomendações diretas de refatoração ou correção de bugs de forma estruturada.

LOGS:
\`\`\`
${logsText}
\`\`\`
`;
        }

        try {
            // Reutiliza o endpoint de chat do CapIAu para disparar a chamada de IA
            // Passa histórico vazio para focar inteiramente na instrução do log
            const res = await CapIAuAPI.chat(
                STATE.currentProjectId,
                prompt,
                [], // history
                STATE.activeTimelineCuts,
                window.TIMELINE_STATE ? window.TIMELINE_STATE.serializeTracks() : null,
                window.TIMELINE_STATE ? window.TIMELINE_STATE.fps : 24,
                activeModel,
                customApiKey
            );
            
            if (res && res.response) {
                this.aiOutput.innerHTML = this.renderMarkdown(res.response);
            } else {
                throw new Error("Resposta inválida da IA.");
            }
        } catch (e) {
            console.error("[Logs IA] Erro ao analisar logs:", e);
            this.aiOutput.innerHTML = `
                <div style="color:var(--color-rose); font-size:11px; padding:8px; background:rgba(244,63,94,0.1); border-radius:4px; border:1px solid rgba(244,63,94,0.25);">
                    <i class="fa-solid fa-circle-exclamation"></i> Falha na chamada da IA: ${e.message || e}. Verifique se sua chave API está correta ou se o servidor backend está online.
                </div>
            `;
        }
    }

    renderMarkdown(text) {
        if (!text) return "";
        
        // Escapa HTML básico para segurança e depois substitui a marcação
        let parsed = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
            
        // Renderização simples e leve de Markdown
        parsed = parsed.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        parsed = parsed.replace(/\*(.*?)\*/g, "<em>$1</em>");
        parsed = parsed.replace(/`(.*?)`/g, "<code>$1</code>");
        
        // Listas
        parsed = parsed.replace(/^- (.*?)$/gm, "<li>$1</li>");
        parsed = parsed.replace(/(<li>.*?<\/li>)/gs, "<ul>$1</ul>");
        // Corrige listas aninhadas causadas por substituição global simples
        parsed = parsed.replace(/<\/ul>\s*<ul>/g, "");

        // Quebras de linha
        parsed = parsed.replace(/\n\n/g, "<br><br>");
        parsed = parsed.replace(/\n/g, "<br>");
        
        return parsed;
    }
}

// Auto-inicializa o gerenciador
export const LOG_MANAGER = new LogManager();
