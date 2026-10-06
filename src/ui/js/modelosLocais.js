// Modelos locais opcionais (Configurações > Modelos locais).
// Nada baixa sozinho: a lista mostra o que existe, quanto pesa e para que serve;
// o usuário escolhe baixar. Backend: src/services/modelos_locais.py, /api/modelos.

const ESTADO = {
    baixado: { classe: "origin-project", texto: "baixado" },
    nao: { classe: "origin-default", texto: "não baixado" },
    baixando: { classe: "origin-unsaved", texto: "baixando…" },
    falhou: { classe: "origin-unsaved", texto: "falhou" },
    pacote: { classe: "origin-unsaved", texto: "falta pacote" },
};

const ROTULO_CONFIG = {
    "transcription.engine": "Motor de transcrição",
    "diarization.engine": "Motor de diarização",
    "object.detector_engine": "Detector de objetos",
    "triage.system1_enabled": "Triagem local",
};

function tamanho(mb) {
    return mb >= 1000 ? `${(mb / 1000).toFixed(1).replace(".", ",")} GB` : `${mb} MB`;
}

function situacao(m) {
    if (m.download && m.download.status === "baixando") return "baixando";
    if (m.download && m.download.status === "falhou" && !m.baixado) return "falhou";
    if (!m.pacotes_ok) return "pacote";
    return m.baixado ? "baixado" : "nao";
}

function textoConfiguracao(par) {
    const [chave, valor] = par.split("=");
    return `${ROTULO_CONFIG[chave] || chave}: ${valor === "true" ? "ligado" : valor}`;
}

export const ModelosLocais = {
    cache: [],

    async carregar() {
        const r = await fetch("/api/modelos");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        this.cache = (await r.json()).modelos || [];
        return this.cache;
    },

    /** Modelo que a configuração chave=valor usa (null se nenhum). */
    modeloPara(chave, valor) {
        const alvo = `${chave}=${valor === true ? "true" : valor}`;
        return this.cache.find(m => (m.configuracao || []).includes(alvo)) || null;
    },

    /** Aviso curto para a linha da configuração, ou null quando dá para usar. */
    aviso(chave, valor) {
        const m = this.modeloPara(chave, valor);
        if (!m) return null;
        if (!m.pacotes_ok) return `${m.nome}: falta instalar ${m.pacotes_faltando.join(", ")}.`;
        if (!m.baixado) return `${m.nome} não está baixado (${tamanho(m.tamanho_mb)}). Até baixar, o programa usa a alternativa e avisa.`;
        return null;
    },

    render(container) {
        const lista = document.createElement("div");
        container.appendChild(lista);

        const desenhar = () => {
            lista.innerHTML = "";
            const intro = document.createElement("p");
            intro.className = "settings-scope-hint";
            intro.textContent = "Modelos que rodam no seu computador. Nenhum baixa sozinho: escolha os que vai usar. " +
                "Sem o modelo, o programa usa a alternativa (em geral, nuvem) e avisa.";
            lista.appendChild(intro);
            if (!this.cache.length) {
                const vazio = document.createElement("div");
                vazio.className = "settings-empty-hint";
                vazio.textContent = "Não foi possível ler a lista de modelos.";
                lista.appendChild(vazio);
            }
            this.cache.forEach(m => lista.appendChild(this.cartao(m, baixar)));
        };

        let timer = null;
        const acompanhar = () => {
            clearInterval(timer);
            if (!this.cache.some(m => situacao(m) === "baixando")) return;
            timer = setInterval(async () => {
                if (!lista.isConnected) { clearInterval(timer); return; }
                try { await this.carregar(); desenhar(); } catch (e) { /* tenta de novo no próximo ciclo */ }
                if (!this.cache.some(m => situacao(m) === "baixando")) clearInterval(timer);
            }, 3000);
        };

        const baixar = async (m) => {
            if (!confirm(`Baixar ${m.nome} (${tamanho(m.tamanho_mb)})?\n\n${m.uso}` +
                (m.termos_url ? `\n\nEste modelo exige aceitar os termos em:\n${m.termos_url}` : ""))) return;
            try {
                const r = await fetch(`/api/modelos/${encodeURIComponent(m.id)}/baixar`, { method: "POST" });
                const corpo = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(corpo.detail || `HTTP ${r.status}`);
                await this.carregar();
                desenhar();
                acompanhar();
            } catch (err) {
                alert(`Não foi possível baixar ${m.nome}: ${err.message}`);
            }
        };

        desenhar();
        acompanhar();
    },

    cartao(m, baixar) {
        const est = ESTADO[situacao(m)];
        const grupo = document.createElement("div");
        grupo.className = "prompt-group";
        grupo.dataset.modelo = m.id;

        const cabeca = document.createElement("div");
        cabeca.className = "prompt-header";
        const titulo = document.createElement("div");
        titulo.className = "prompt-title";
        titulo.textContent = m.nome;
        cabeca.appendChild(titulo);
        const selo = document.createElement("span");
        selo.className = `origin-badge ${est.classe}`;
        selo.textContent = est.texto;
        cabeca.appendChild(selo);
        grupo.appendChild(cabeca);

        const linhas = [
            m.uso,
            `${tamanho(m.tamanho_mb)} · ${m.ambiente === "nemo" ? "ambiente separado .venv-nemo" : "ambiente principal"}`,
            `Usado por: ${(m.configuracao || []).map(textoConfiguracao).join("; ")}`,
        ];
        if (m.idiomas) linhas.push(`Só nestes idiomas: ${m.idiomas.join(", ")}`);
        if (m.obs) linhas.push(m.obs);
        if (!m.pacotes_ok) linhas.push(`Falta instalar: ${m.pacotes_faltando.join(", ")} ` +
            (m.ambiente === "nemo" ? "(ver requirements-nemo.txt)" : "(ver requirements.txt)"));
        if (m.download && m.download.status === "falhou" && m.download.erro) linhas.push(`Erro: ${m.download.erro}`);
        linhas.forEach(t => {
            const p = document.createElement("div");
            p.className = "setting-help";
            p.textContent = t;
            grupo.appendChild(p);
        });

        if (m.termos_url) {
            const termos = document.createElement("a");
            termos.className = "setting-help";
            termos.href = m.termos_url;
            termos.target = "_blank";
            termos.rel = "noopener";
            termos.textContent = "Termos do modelo (aceite com sua conta do Hugging Face)";
            grupo.appendChild(termos);
        }

        if (!m.baixado && m.pacotes_ok && situacao(m) !== "baixando") {
            const acoes = document.createElement("div");
            acoes.className = "prompt-actions";
            const botao = document.createElement("button");
            botao.className = "prompt-btn";
            botao.innerHTML = `<i class="fa-solid fa-download"></i> Baixar (${tamanho(m.tamanho_mb)})`;
            botao.addEventListener("click", () => baixar(m));
            acoes.appendChild(botao);
            grupo.appendChild(acoes);
        }
        return grupo;
    },
};
