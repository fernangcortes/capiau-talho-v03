// Gerenciador do Player de Vídeo, atalhos de teclado JKL e marcação de pontos In/Out.
import { STATE } from "./state.js";

export function formatTimecode(secs) {
    if (isNaN(secs) || secs === null) return "00:00:00:00";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const f = Math.floor((secs % 1) * 24); // Assume 24fps
    return [
        h.toString().padStart(2, '0'),
        m.toString().padStart(2, '0'),
        s.toString().padStart(2, '0'),
        f.toString().padStart(2, '0')
    ].join(':');
}

export class VideoPlayer {
    constructor() {
        this.video = document.getElementById("main-video");
        this.btnPlay = document.getElementById("btn-play");
        this.currentTimeEl = document.getElementById("current-time");
        this.durationTimeEl = document.getElementById("duration-time");
        this.scrubberFill = document.getElementById("scrubber-progress-fill");
        this.scrubberHandle = document.getElementById("scrubber-progress-handle");
        this.scrubberBar = document.getElementById("scrubber-progress-bar");
        this.titleEl = document.getElementById("player-title");
        this.badgeType = document.getElementById("badge-type");
        this.badgeResolution = document.getElementById("badge-resolution");
        
        this.selectSpeed = document.getElementById("select-speed");
        this.selectResolution = document.getElementById("select-resolution");
        this.speedOverlay = document.getElementById("speed-overlay");
        this.jklOverlay = document.getElementById("jkl-overlay");
        
        this.btnMarkIn = document.getElementById("btn-mark-in");
        this.btnMarkOut = document.getElementById("btn-mark-out");
        this.btnAppend = document.getElementById("btn-append-timeline");
        this.markerInPos = document.getElementById("marker-in-pos");
        this.markerOutPos = document.getElementById("marker-out-pos");

        this.speedsForward = [1.0, 1.5, 2.0, 4.0, 8.0];
        this.speedsReverse = [-1.0, -2.0, -4.0, -8.0];
        this.jklState = 'K';
        this.jklIndex = 0;
        this.reverseInterval = null;

        this.init();
    }

    init() {
        // Observa mudanças do vídeo ativo
        STATE.on("activeVideoChanged", (video) => this.loadVideo(video));
        STATE.on("markerInChanged", (val) => this.updateMarkersUI());
        STATE.on("markerOutChanged", (val) => this.updateMarkersUI());

        // Eventos nativos do elemento video
        if (this.video) {
            this.video.addEventListener("timeupdate", () => this.onTimeUpdate());
            this.video.addEventListener("loadedmetadata", () => this.onLoadedMetadata());
            this.video.addEventListener("play", () => this.onPlayStateChange(true));
            this.video.addEventListener("pause", () => this.onPlayStateChange(false));
        }

        // Eventos DOM
        if (this.btnPlay) this.btnPlay.addEventListener("click", () => this.togglePlay());
        if (this.scrubberBar) {
            this.scrubberBar.addEventListener("click", (e) => this.seekScrubber(e));
            this.scrubberBar.addEventListener("mousedown", (e) => this.startScrubberDrag(e));
        }
        
        if (this.selectSpeed) {
            this.selectSpeed.addEventListener("change", (e) => {
                const spd = parseFloat(e.target.value);
                this.setSpeed(spd);
            });
        }

        // Marcadores
        if (this.btnMarkIn) this.btnMarkIn.addEventListener("click", () => this.markIn());
        if (this.btnMarkOut) this.btnMarkOut.addEventListener("click", () => this.markOut());
        if (this.btnAppend) this.btnAppend.addEventListener("click", () => this.appendToTimeline());

        // Atalhos de teclado globais
        document.addEventListener("keydown", (e) => this.handleKeyboard(e));
    }

    loadVideo(video) {
        if (!video) {
            this.video.src = "";
            this.titleEl.textContent = "Nenhuma mídia selecionada";
            this.badgeType.className = "badge badge-hidden";
            this.badgeResolution.className = "badge badge-hidden";
            STATE.markerIn = null;
            STATE.markerOut = null;
            return;
        }

        let videoSrc = video.filepath;
        const isRemote = videoSrc.startsWith("http") || videoSrc.startsWith("/proxies/") || videoSrc.startsWith("/");
        
        if (video.proxy_path) {
            videoSrc = video.proxy_path;
        } else if (!isRemote) {
            // Se não tem proxy e não é remoto, tenta originals
            videoSrc = `/originals/${video.filename}`;
        }
        this.video.src = videoSrc;
        this.video.load();
        
        this.titleEl.textContent = video.filename;
        this.badgeType.textContent = video.video_type === "interview" ? "DEPOIMENTO" : "B-ROLL";
        this.badgeType.className = `badge badge-${video.video_type}`;
        this.badgeResolution.textContent = video.resolution || "1080p";
        this.badgeResolution.className = "badge badge-gray";

        STATE.markerIn = null;
        STATE.markerOut = null;
        this.setSpeed(1.0);
        this.jklState = 'K';
    }

    onTimeUpdate() {
        if (!this.video) return;
        const cur = this.video.currentTime;
        const dur = this.video.duration || 0;
        this.currentTimeEl.textContent = formatTimecode(cur);
        
        if (dur > 0) {
            const pct = (cur / dur) * 100;
            this.scrubberFill.style.width = `${pct}%`;
            this.scrubberHandle.style.left = `${pct}%`;
        }
    }

    onLoadedMetadata() {
        if (!this.video) return;
        this.durationTimeEl.textContent = formatTimecode(this.video.duration);
        this.onTimeUpdate();
    }

    onPlayStateChange(isPlaying) {
        this.btnPlay.innerHTML = isPlaying 
            ? `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
            : `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    }

    togglePlay() {
        if (!this.video || !this.video.src) return;
        this.stopReverse();
        if (this.video.paused) {
            this.video.play();
            this.jklState = 'L';
            this.jklIndex = 0;
        } else {
            this.video.pause();
            this.jklState = 'K';
        }
    }

    seek(seconds) {
        if (!this.video) return;
        this.video.currentTime = Math.max(0, Math.min(seconds, this.video.duration || 0));
    }

    seekScrubber(e) {
        if (!this.video || !this.video.duration) return;
        const rect = this.scrubberBar.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        this.seek(pct * this.video.duration);
    }

    startScrubberDrag(e) {
        const onMouseMove = (moveEvent) => this.seekScrubber(moveEvent);
        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    setSpeed(speed) {
        if (!this.video) return;
        this.stopReverse();
        STATE.playbackSpeed = speed;
        this.video.playbackRate = Math.abs(speed);
        
        if (this.selectSpeed) this.selectSpeed.value = speed;
        
        if (speed !== 1.0) {
            this.showOverlay(this.speedOverlay, `${speed}x`);
        }
    }

    startReverse(rate) {
        this.stopReverse();
        if (!this.video) return;
        this.video.pause();
        this.video.playbackRate = 0; // Pausa o player nativo para não conflitar
        
        const step = 0.04 * Math.abs(rate); // 40ms por frame aproximado
        this.reverseInterval = setInterval(() => {
            if (this.video.currentTime <= 0) {
                this.stopReverse();
                this.jklState = 'K';
            } else {
                this.video.currentTime -= step;
            }
        }, 40);
        this.showOverlay(this.jklOverlay, `<< RETROCESSO ${Math.abs(rate)}x`);
    }

    stopReverse() {
        if (this.reverseInterval) {
            clearInterval(this.reverseInterval);
            this.reverseInterval = null;
        }
    }

    markIn() {
        if (!this.video || !this.video.src) return;
        STATE.markerIn = this.video.currentTime;
    }

    markOut() {
        if (!this.video || !this.video.src) return;
        STATE.markerOut = this.video.currentTime;
    }

    updateMarkersUI() {
        this.markerInPos.textContent = STATE.markerIn !== null ? formatTimecode(STATE.markerIn) : "--:--:--:--";
        this.markerOutPos.textContent = STATE.markerOut !== null ? formatTimecode(STATE.markerOut) : "--:--:--:--";
    }

    appendToTimeline() {
        if (!STATE.activeVideo) return;
        const inTime = STATE.markerIn !== null ? STATE.markerIn : 0.0;
        const outTime = STATE.markerOut !== null ? STATE.markerOut : (this.video.duration || 0.0);
        
        if (inTime >= outTime) {
            alert("Ponto de entrada (In) deve ser menor que o ponto de saída (Out).");
            return;
        }

        const newCut = {
            video_id: STATE.activeVideo.id,
            in: inTime,
            out: outTime,
            track: STATE.activeVideo.video_type === "interview" ? "V1" : "V2"
        };

        const updatedCuts = [...STATE.activeTimelineCuts, newCut];
        STATE.activeTimelineCuts = updatedCuts;
        
        // Limpa marcadores
        STATE.markerIn = null;
        STATE.markerOut = null;
    }

    showOverlay(el, text) {
        if (!el) return;
        el.textContent = text;
        el.style.opacity = "1";
        setTimeout(() => {
            el.style.opacity = "0";
        }, 1200);
    }

    handleKeyboard(e) {
        // Evita disparar atalhos ao escrever no Chat ou nos campos de Busca
        const activeTag = document.activeElement.tagName.toLowerCase();
        if (activeTag === "input" || activeTag === "textarea") return;

        const code = e.code;
        if (code === "Space" || code === "KeyK") {
            e.preventDefault();
            this.togglePlay();
        } else if (code === "KeyL") {
            // L: Avançar / Acelerar
            if (this.jklState === 'L') {
                this.jklIndex = Math.min(this.jklIndex + 1, this.speedsForward.length - 1);
            } else {
                this.jklState = 'L';
                this.jklIndex = 0;
            }
            const speed = this.speedsForward[this.jklIndex];
            this.setSpeed(speed);
            this.video.play();
            this.showOverlay(this.jklOverlay, `>> AVANÇO ${speed}x`);
        } else if (code === "KeyJ") {
            // J: Retroceder / Acelerar reverso
            if (this.jklState === 'J') {
                this.jklIndex = Math.min(this.jklIndex + 1, this.speedsReverse.length - 1);
            } else {
                this.jklState = 'J';
                this.jklIndex = 0;
            }
            const revSpeed = this.speedsReverse[this.jklIndex];
            this.startReverse(revSpeed);
        } else if (code === "KeyI") {
            this.markIn();
        } else if (code === "KeyO") {
            this.markOut();
        } else if (code === "KeyE") {
            this.appendToTimeline();
        } else if (code === "ArrowLeft") {
            // Frame anterior (1 frame = ~40ms em 24fps)
            this.seek(this.video.currentTime - 0.04);
        } else if (code === "ArrowRight") {
            // Próximo frame
            this.seek(this.video.currentTime + 0.04);
        }
    }
}
