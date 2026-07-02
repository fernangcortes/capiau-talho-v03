// Gerenciador do Player de Vídeo, atalhos de teclado JKL e marcação de pontos In/Out.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { FaceManager } from "./faces.js";

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
        this.btnPrevFrame = document.getElementById("btn-prev-frame");
        this.btnNextFrame = document.getElementById("btn-next-frame");
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
        this.btnMaximize = document.getElementById("btn-maximize");

        this.speedsForward = [1.0, 1.5, 2.0, 4.0, 8.0];
        this.speedsReverse = [-1.0, -2.0, -4.0, -8.0];
        this.jklState = 'K';
        this.jklIndex = 0;
        this.reverseInterval = null;
        
        this.videoFaces = [];
        this.overlayContainer = null;

        this.init();
    }

    init() {
        // Observa mudanças do vídeo ativo
        STATE.on("activeVideoChanged", (video) => this.loadVideo(video));
        STATE.on("activePhotoChanged", (photo) => this.loadPhoto(photo));
        STATE.on("markerInChanged", (val) => this.updateMarkersUI());
        STATE.on("markerOutChanged", (val) => this.updateMarkersUI());
        STATE.on("videoFacesUpdated", (videoId) => {
            if (STATE.activeVideo && STATE.activeVideo.id === videoId) {
                CapIAuAPI.fetchVideoFaces(videoId)
                    .then(faces => {
                        this.videoFaces = faces || [];
                        if (this.video.paused) {
                            this.updateFacesOverlay();
                        }
                    })
                    .catch(err => console.error("Erro ao recarregar faces:", err));
            }
        });

        // Eventos nativos do elemento video
        if (this.video) {
            this.video.addEventListener("timeupdate", () => this.onTimeUpdate());
            this.video.addEventListener("loadedmetadata", () => this.onLoadedMetadata());
            this.video.addEventListener("play", () => this.onPlayStateChange(true));
            this.video.addEventListener("pause", () => this.onPlayStateChange(false));
            this.video.addEventListener("seeked", () => {
                if (this.video.paused) this.updateFacesOverlay();
            });

            this.resizeObserver = new ResizeObserver(() => {
                if (this.video.paused) this.updateOverlaySize();
            });
            this.resizeObserver.observe(this.video);
        }

        // Eventos DOM
        if (this.btnPlay) this.btnPlay.addEventListener("click", () => this.togglePlay());
        if (this.btnPrevFrame) {
            this.btnPrevFrame.addEventListener("click", () => {
                this.seek(this.video.currentTime - 0.04);
            });
        }
        if (this.btnNextFrame) {
            this.btnNextFrame.addEventListener("click", () => {
                this.seek(this.video.currentTime + 0.04);
            });
        }
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

        if (this.btnMaximize) {
            this.btnMaximize.addEventListener("click", () => this.toggleFullscreen());
        }
        document.addEventListener("fullscreenchange", () => this.onFullscreenChange());
        document.addEventListener("webkitfullscreenchange", () => this.onFullscreenChange());
        document.addEventListener("mozfullscreenchange", () => this.onFullscreenChange());
        document.addEventListener("MSFullscreenChange", () => this.onFullscreenChange());

        // Atalhos de teclado globais
        document.addEventListener("keydown", (e) => this.handleKeyboard(e));
    }

    loadVideo(video) {
        if (!video) {
            if (!STATE.activePhoto) {
                this.hidePhoto();
                this.video.src = "";
                this.titleEl.textContent = "Nenhuma mídia selecionada";
                this.badgeType.className = "badge badge-hidden";
                this.badgeResolution.className = "badge badge-hidden";
                STATE.markerIn = null;
                STATE.markerOut = null;
                this.videoFaces = [];
                this.clearFacesOverlay();
            }
            return;
        }

        this.hidePhoto();

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

        this.videoFaces = [];
        this.clearFacesOverlay();
        CapIAuAPI.fetchVideoFaces(video.id)
            .then(faces => {
                this.videoFaces = faces || [];
                if (this.video.paused) {
                    this.updateFacesOverlay();
                }
            })
            .catch(err => {
                console.error("Erro ao carregar faces do vídeo:", err);
                this.videoFaces = [];
            });
    }

    loadPhoto(photo) {
        if (!photo) {
            if (!STATE.activeVideo) {
                this.hidePhoto();
            }
            return;
        }
        
        if (this.video) {
            this.video.pause();
            this.video.style.display = "none";
        }
        
        let imgEl = document.getElementById("player-photo");
        if (!imgEl) {
            imgEl = document.createElement("img");
            imgEl.id = "player-photo";
            const videoWrapper = document.getElementById("video-wrapper");
            if (videoWrapper) {
                videoWrapper.appendChild(imgEl);
            }
        }
        
        const src = photo.proxy_path || (photo.filepath && (photo.filepath.startsWith('http') || photo.filepath.startsWith('/')) ? photo.filepath : `/originals/${photo.filename}`);
        imgEl.src = src;
        imgEl.style.display = "block";
        
        if (this.titleEl) this.titleEl.textContent = photo.filename;
        if (this.badgeType) {
            this.badgeType.textContent = "FOTO DE SET";
            this.badgeType.className = "badge badge-photo";
        }
        if (this.badgeResolution) {
            this.badgeResolution.textContent = photo.resolution || "Proxy";
            this.badgeResolution.className = "badge badge-gray";
        }
        
        STATE.markerIn = null;
        STATE.markerOut = null;
        if (this.currentTimeEl) this.currentTimeEl.textContent = "00:00:00:00";
        if (this.durationTimeEl) this.durationTimeEl.textContent = "00:00:00:00";
        if (this.scrubberFill) this.scrubberFill.style.width = "0%";
        if (this.scrubberHandle) this.scrubberHandle.style.left = "0%";
        
        this.videoFaces = [];
        this.clearFacesOverlay();
    }
    
    hidePhoto() {
        const imgEl = document.getElementById("player-photo");
        if (imgEl) {
            imgEl.style.display = "none";
            imgEl.src = "";
        }
        if (this.video) {
            this.video.style.display = "block";
        }
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

        if (this.video.paused) {
            this.updateFacesOverlay();
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
        
        this.updateFacesOverlay();
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

    toggleFullscreen() {
        const container = document.getElementById("video-wrapper");
        if (!container) return;

        if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.mozFullScreenElement && !document.msFullscreenElement) {
            if (container.requestFullscreen) {
                container.requestFullscreen();
            } else if (container.webkitRequestFullscreen) {
                container.webkitRequestFullscreen();
            } else if (container.mozRequestFullScreen) {
                container.mozRequestFullScreen();
            } else if (container.msRequestFullscreen) {
                container.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    }

    onFullscreenChange() {
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
        if (this.btnMaximize) {
            if (isFullscreen) {
                this.btnMaximize.innerHTML = `<i class="fa-solid fa-compress"></i>`;
                this.btnMaximize.title = "Sair da Tela Cheia";
            } else {
                this.btnMaximize.innerHTML = `<i class="fa-solid fa-expand"></i>`;
                this.btnMaximize.title = "Tela Cheia";
            }
        }
        // Recalcula o overlay com delay curto para dar tempo de renderização do layout
        setTimeout(() => {
            this.updateOverlaySize();
        }, 100);
    }

    createOverlayContainer() {
        if (this.overlayContainer) return;
        
        this.overlayContainer = document.createElement("div");
        this.overlayContainer.id = "video-face-overlay-container";
        this.overlayContainer.style.position = "absolute";
        this.overlayContainer.style.zIndex = "8";
        this.overlayContainer.style.pointerEvents = "auto";
        this.overlayContainer.style.boxSizing = "border-box";
        this.overlayContainer.style.overflow = "hidden";
        
        // Eventos de drag-and-draw para marcar manualmente novas áreas
        this.overlayContainer.addEventListener("mousedown", (e) => this.onMouseDown(e));
        
        this.video.parentElement.appendChild(this.overlayContainer);
    }

    updateOverlaySize() {
        if (!this.video || !this.video.videoWidth || !this.video.videoHeight || !this.overlayContainer) return;

        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;
        const elementWidth = this.video.clientWidth;
        const elementHeight = this.video.clientHeight;

        const videoRatio = videoWidth / videoHeight;
        const elementRatio = elementWidth / elementHeight;

        let actualWidth, actualHeight, contentLeft, contentTop;

        if (elementRatio > videoRatio) {
            // Letterbox nas laterais esquerda/direita
            actualHeight = elementHeight;
            actualWidth = actualHeight * videoRatio;
            contentLeft = (elementWidth - actualWidth) / 2;
            contentTop = 0;
        } else {
            // Letterbox acima/abaixo
            actualWidth = elementWidth;
            actualHeight = actualWidth / videoRatio;
            contentLeft = 0;
            contentTop = (elementHeight - actualHeight) / 2;
        }

        const videoRect = this.video.getBoundingClientRect();
        const containerRect = this.video.parentElement.getBoundingClientRect();

        const overlayLeft = videoRect.left - containerRect.left + contentLeft;
        const overlayTop = videoRect.top - containerRect.top + contentTop;

        this.overlayContainer.style.left = `${overlayLeft}px`;
        this.overlayContainer.style.top = `${overlayTop}px`;
        this.overlayContainer.style.width = `${actualWidth}px`;
        this.overlayContainer.style.height = `${actualHeight}px`;
    }

    updateFacesOverlay() {
        if (!this.video || !this.video.src) {
            this.clearFacesOverlay();
            return;
        }

        if (this.video.paused) {
            if (!this.overlayContainer) {
                this.createOverlayContainer();
            }
            this.overlayContainer.style.display = "block";
            this.updateOverlaySize();

            const currentTime = this.video.currentTime;
            const tolerance = 5.0; // tolerância de 5 segundos

            if (!this.videoFaces || this.videoFaces.length === 0) {
                this.renderFaces([]);
                return;
            }

            // Encontra o timestamp mais próximo
            let bestTimestamp = null;
            let minDiff = Infinity;
            for (const face of this.videoFaces) {
                const diff = Math.abs(face.timestamp - currentTime);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestTimestamp = face.timestamp;
                }
            }

            if (bestTimestamp !== null && minDiff <= tolerance) {
                // Filtra todas as detecções que possuem esse mesmo timestamp aproximado (dentro de 0.1s)
                const frameFaces = this.videoFaces.filter(face => Math.abs(face.timestamp - bestTimestamp) < 0.1);
                this.renderFaces(frameFaces);
            } else {
                this.renderFaces([]);
            }
        } else {
            this.clearFacesOverlay();
        }
    }

    renderFaces(frameFaces) {
        if (!this.overlayContainer) return;
        
        // Remove as caixas de rostos antigas
        const oldBoxes = this.overlayContainer.querySelectorAll(".face-box");
        oldBoxes.forEach(box => box.remove());

        frameFaces.forEach(face => {
            const box = face.bounding_box;
            if (!box || box.length !== 4) return;

            const [x, y, w, h] = box;

            const faceDiv = document.createElement("div");
            faceDiv.className = "face-box";
            faceDiv.style.left = `${x * 100}%`;
            faceDiv.style.top = `${y * 100}%`;
            faceDiv.style.width = `${w * 100}%`;
            faceDiv.style.height = `${h * 100}%`;

            const label = face.name || "Quem é?";
            faceDiv.title = label;

            const nameTag = document.createElement("span");
            nameTag.className = "face-name-tag";
            nameTag.textContent = label;
            faceDiv.appendChild(nameTag);

            faceDiv.style.pointerEvents = "auto";
            faceDiv.addEventListener("click", async (e) => {
                e.stopPropagation();

                let speakers = [];
                try {
                    speakers = await CapIAuAPI.fetchProjectSpeakers(STATE.currentProjectId);
                } catch (err) {
                    console.warn("Erro ao carregar pessoas/objetos existentes:", err);
                }

                const name = await showAnnotationModal(speakers, face.name || "");
                if (name) {
                    const trimmedName = name.trim();
                    const res = await CapIAuAPI.labelFace(face.id, trimmedName);
                    
                    await FaceManager.handleLabelResponse(res, face.id, async () => {
                        // Recarrega as faces e atualiza
                        const faces = await CapIAuAPI.fetchVideoFaces(STATE.activeVideo.id);
                        this.videoFaces = faces || [];
                        this.updateFacesOverlay();
                        
                        // Atualiza dinamicamente o texto do painel Visão IA
                        try {
                            const visionData = await CapIAuAPI.fetchVideoVision(STATE.activeVideo.id, STATE.currentProjectId);
                            STATE.activeVisionFrames = visionData.frames || [];
                        } catch (err2) {
                            console.warn("Erro ao atualizar Visão IA:", err2);
                        }
                    });
                }
            });

            this.overlayContainer.appendChild(faceDiv);
        });
    }

    clearFacesOverlay() {
        if (this.overlayContainer) {
            this.overlayContainer.style.display = "none";
            const oldBoxes = this.overlayContainer.querySelectorAll(".face-box");
            oldBoxes.forEach(box => box.remove());
        }
    }

    onMouseDown(e) {
        // Se clicou em uma caixa já existente, não faz nada
        if (e.target.closest(".face-box")) return;

        e.preventDefault();
        e.stopPropagation();

        const rect = this.overlayContainer.getBoundingClientRect();
        this.startX = e.clientX - rect.left;
        this.startY = e.clientY - rect.top;
        this.isDrawing = true;

        this.drawingBox = document.createElement("div");
        this.drawingBox.className = "face-box overlap-bubble";
        this.drawingBox.style.border = "2px dashed var(--color-cyan)";
        this.drawingBox.style.background = "rgba(6, 182, 212, 0.1)";
        this.drawingBox.style.left = `${this.startX}px`;
        this.drawingBox.style.top = `${this.startY}px`;
        this.drawingBox.style.width = "0px";
        this.drawingBox.style.height = "0px";
        this.overlayContainer.appendChild(this.drawingBox);

        this.mouseMoveHandler = (ev) => this.onMouseMove(ev);
        this.mouseUpHandler = (ev) => this.onMouseUp(ev);

        document.addEventListener("mousemove", this.mouseMoveHandler);
        document.addEventListener("mouseup", this.mouseUpHandler);
    }

    onMouseMove(e) {
        if (!this.isDrawing || !this.drawingBox) return;

        const rect = this.overlayContainer.getBoundingClientRect();
        const currentX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

        const left = Math.min(this.startX, currentX);
        const top = Math.min(this.startY, currentY);
        const width = Math.abs(this.startX - currentX);
        const height = Math.abs(this.startY - currentY);

        this.drawingBox.style.left = `${left}px`;
        this.drawingBox.style.top = `${top}px`;
        this.drawingBox.style.width = `${width}px`;
        this.drawingBox.style.height = `${height}px`;
    }

    async onMouseUp(e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        document.removeEventListener("mousemove", this.mouseMoveHandler);
        document.removeEventListener("mouseup", this.mouseUpHandler);

        if (!this.drawingBox) return;

        const rect = this.overlayContainer.getBoundingClientRect();
        const finalWidth = parseFloat(this.drawingBox.style.width);
        const finalHeight = parseFloat(this.drawingBox.style.height);
        const finalLeft = parseFloat(this.drawingBox.style.left);
        const finalTop = parseFloat(this.drawingBox.style.top);

        this.drawingBox.remove();
        this.drawingBox = null;

        // Limiar de segurança para cliques acidentais
        if (finalWidth < 15 || finalHeight < 15) return;

        // Normalização das coordenadas
        const x = finalLeft / rect.width;
        const y = finalTop / rect.height;
        const w = finalWidth / rect.width;
        const h = finalHeight / rect.height;

        let speakers = [];
        try {
            speakers = await CapIAuAPI.fetchProjectSpeakers(STATE.currentProjectId);
        } catch (err) {
            console.warn("Erro ao buscar pessoas/falantes existentes:", err);
        }

        const name = await showAnnotationModal(speakers, "");
        if (name) {
            const trimmedName = name.trim();
            if (trimmedName) {
                try {
                    const payload = {
                        project_id: STATE.currentProjectId,
                        video_id: STATE.activeVideo.id,
                        timestamp: this.video.currentTime,
                        bounding_box: [x, y, w, h],
                        name: trimmedName
                    };

                    const res = await CapIAuAPI.addManualFace(payload);
                    if (res && res.status === "success") {
                        // Recarrega as faces
                        const faces = await CapIAuAPI.fetchVideoFaces(STATE.activeVideo.id);
                        this.videoFaces = faces || [];
                        this.updateFacesOverlay();

                        // Atualiza dinamicamente o texto do painel Visão IA
                        try {
                            const visionData = await CapIAuAPI.fetchVideoVision(STATE.activeVideo.id, STATE.currentProjectId);
                            STATE.activeVisionFrames = visionData.frames || [];
                        } catch (err2) {
                            console.warn("Erro ao recarregar Visão IA:", err2);
                        }
                    }
                } catch (err) {
                    console.error("Erro ao salvar marcação manual:", err);
                    alert("Erro ao salvar marcação manual.");
                }
            }
        }
    }
}

export function showAnnotationModal(speakers, initialValue = "") {
    return new Promise((resolve) => {
        // Remove existing modal if any
        const oldModal = document.getElementById("annotation-modal");
        if (oldModal) oldModal.remove();

        const overlay = document.createElement("div");
        overlay.className = "modal-overlay active";
        overlay.id = "annotation-modal";
        overlay.style.zIndex = "10005";

        const content = document.createElement("div");
        content.className = "modal-content glassmorphism";
        content.style.maxWidth = "400px";
        content.style.width = "90%";
        content.style.padding = "20px";
        content.style.display = "flex";
        content.style.flexDirection = "column";
        content.style.gap = "15px";

        const header = document.createElement("div");
        header.className = "modal-header";
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.justifyContent = "space-between";
        header.style.borderBottom = "1px solid var(--border-glass)";
        header.style.paddingBottom = "10px";
        header.innerHTML = `
            <h2 style="margin:0; font-size:16px; color:#fff; display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-tags" style="color:var(--color-cyan);"></i> Identificar Elemento
            </h2>
            <button class="btn-close-modal" style="font-size:24px; color:var(--text-secondary); background:transparent; border:none; cursor:pointer;">&times;</button>
        `;

        const body = document.createElement("div");
        body.className = "modal-body";
        body.style.display = "flex";
        body.style.flexDirection = "column";
        body.style.gap = "10px";

        const inputLabel = document.createElement("label");
        inputLabel.textContent = "Nome da Pessoa ou Objeto:";
        inputLabel.style.fontSize = "11px";
        inputLabel.style.color = "var(--text-secondary)";

        const input = document.createElement("input");
        input.type = "text";
        input.value = initialValue;
        input.placeholder = "Digite o nome...";
        input.style.width = "100%";
        input.style.padding = "8px 12px";
        input.style.borderRadius = "8px";
        input.style.border = "1px solid var(--border-glass)";
        input.style.background = "rgba(255, 255, 255, 0.05)";
        input.style.color = "#fff";
        input.style.fontSize = "13px";
        input.style.outline = "none";
        input.style.boxSizing = "border-box";

        body.appendChild(inputLabel);
        body.appendChild(input);

        if (speakers && speakers.length > 0) {
            const suggestionsLabel = document.createElement("label");
            suggestionsLabel.textContent = "Selecionar existente:";
            suggestionsLabel.style.fontSize = "11px";
            suggestionsLabel.style.color = "var(--text-secondary)";
            suggestionsLabel.style.marginTop = "5px";
            body.appendChild(suggestionsLabel);

            const suggestionsContainer = document.createElement("div");
            suggestionsContainer.style.display = "flex";
            suggestionsContainer.style.flexWrap = "wrap";
            suggestionsContainer.style.gap = "6px";
            suggestionsContainer.style.maxHeight = "120px";
            suggestionsContainer.style.overflowY = "auto";
            suggestionsContainer.style.padding = "6px";
            suggestionsContainer.style.border = "1px solid rgba(255, 255, 255, 0.05)";
            suggestionsContainer.style.borderRadius = "8px";
            suggestionsContainer.style.background = "rgba(0, 0, 0, 0.2)";

            speakers.forEach(speaker => {
                const btn = document.createElement("button");
                btn.textContent = speaker;
                btn.style.background = "rgba(6, 182, 212, 0.1)";
                btn.style.border = "1px solid rgba(6, 182, 212, 0.3)";
                btn.style.color = "var(--color-cyan)";
                btn.style.padding = "3px 8px";
                btn.style.borderRadius = "15px";
                btn.style.fontSize = "10px";
                btn.style.cursor = "pointer";
                btn.style.transition = "all 0.15s";

                btn.addEventListener("mouseover", () => {
                    btn.style.background = "rgba(6, 182, 212, 0.3)";
                    btn.style.color = "#fff";
                });
                btn.addEventListener("mouseout", () => {
                    btn.style.background = "rgba(6, 182, 212, 0.1)";
                    btn.style.color = "var(--color-cyan)";
                });
                btn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    closeModal(speaker);
                });

                suggestionsContainer.appendChild(btn);
            });
            body.appendChild(suggestionsContainer);
        }

        const footer = document.createElement("div");
        footer.className = "modal-footer";
        footer.style.display = "flex";
        footer.style.justify = "flex-end";
        footer.style.gap = "10px";

        const btnCancel = document.createElement("button");
        btnCancel.textContent = "Cancelar";
        btnCancel.style.padding = "6px 12px";
        btnCancel.style.borderRadius = "6px";
        btnCancel.style.border = "1px solid var(--border-glass)";
        btnCancel.style.background = "transparent";
        btnCancel.style.color = "var(--text-secondary)";
        btnCancel.style.cursor = "pointer";
        btnCancel.style.fontSize = "12px";

        const btnConfirm = document.createElement("button");
        btnConfirm.textContent = "Confirmar";
        btnConfirm.style.padding = "6px 12px";
        btnConfirm.style.borderRadius = "6px";
        btnConfirm.style.border = "none";
        btnConfirm.style.background = "var(--color-cyan)";
        btnConfirm.style.color = "#000";
        btnConfirm.style.fontWeight = "600";
        btnConfirm.style.cursor = "pointer";
        btnConfirm.style.fontSize = "12px";

        footer.appendChild(btnCancel);
        footer.appendChild(btnConfirm);

        content.appendChild(header);
        content.appendChild(body);
        content.appendChild(footer);
        overlay.appendChild(content);
        document.body.appendChild(overlay);

        setTimeout(() => input.focus(), 50);

        function closeModal(value) {
            overlay.remove();
            resolve(value);
        }

        btnCancel.addEventListener("click", () => closeModal(null));
        header.querySelector(".btn-close-modal").addEventListener("click", () => closeModal(null));
        btnConfirm.addEventListener("click", () => {
            const val = input.value.trim();
            closeModal(val || null);
        });
        input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
                const val = input.value.trim();
                closeModal(val || null);
            } else if (ev.key === "Escape") {
                closeModal(null);
            }
        });
    });
}
