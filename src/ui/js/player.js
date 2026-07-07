// Gerenciador do Player de Vídeo Duplo (Source/Program), atalhos JKL e workspaces multi-monitores.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { FaceManager } from "./faces.js";
import { TIMELINE_STATE } from "./timelineState.js";
import { getActiveElement } from "./workspaceManager.js";

// Foco global do teclado para players: "source" ou "program"
window.activeFocusedPlayer = "source";

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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. SOURCE PLAYER - MONITOR DE ORIGEM (ESQUERDA)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class SourcePlayer {
    constructor() {
        this.speedsForward = [1.0, 1.5, 2.0, 4.0, 8.0];
        this.speedsReverse = [-1.0, -2.0, -4.0, -8.0];
        this.jklState = 'K';
        this.jklIndex = 0;
        this.reverseInterval = null;
        
        this.videoFaces = [];
        this.overlayContainer = null;
        
        this.init();
    }

    // Atalho para resolver o elemento do DOM de forma dinâmica (suporta pop-out)
    el(id) {
        return getActiveElement(id);
    }

    init() {
        // Observa mudanças globais na biblioteca
        STATE.on("activeVideoChanged", (video) => {
            window.activeFocusedPlayer = "source";
            this.loadVideo(video);
        });
        STATE.on("activePhotoChanged", (photo) => {
            window.activeFocusedPlayer = "source";
            this.loadPhoto(photo);
        });
        STATE.on("markerInChanged", () => this.updateMarkersUI());
        STATE.on("markerOutChanged", () => this.updateMarkersUI());

        STATE.on("videoFacesUpdated", (videoId) => {
            if (STATE.activeVideo && STATE.activeVideo.id === videoId) {
                CapIAuAPI.fetchVideoFaces(videoId)
                    .then(faces => {
                        this.videoFaces = faces || [];
                        const video = this.el("source-video");
                        if (video && video.paused) {
                            this.updateFacesOverlay();
                        }
                    })
                    .catch(err => console.error("Erro ao recarregar faces:", err));
            }
        });

        // Eventos do Elemento de Vídeo
        const video = this.el("source-video");
        if (video) {
            video.addEventListener("timeupdate", () => this.onTimeUpdate());
            video.addEventListener("loadedmetadata", () => this.onLoadedMetadata());
            video.addEventListener("play", () => this.onPlayStateChange(true));
            video.addEventListener("pause", () => this.onPlayStateChange(false));
            video.addEventListener("seeked", () => {
                const vid = this.el("source-video");
                if (vid && vid.paused) this.updateFacesOverlay();
            });

            this.resizeObserver = new ResizeObserver(() => {
                const vid = this.el("source-video");
                if (vid && vid.paused) this.updateOverlaySize();
            });
            this.resizeObserver.observe(video);
        }

        // Botoes de Controle
        const btnPlay = this.el("btn-source-play");
        if (btnPlay) btnPlay.addEventListener("click", () => this.togglePlay());

        const btnPrev = this.el("btn-source-prev-frame");
        if (btnPrev) {
            btnPrev.addEventListener("click", () => {
                const vid = this.el("source-video");
                if (vid) this.seek(vid.currentTime - 0.04);
            });
        }

        const btnNext = this.el("btn-source-next-frame");
        if (btnNext) {
            btnNext.addEventListener("click", () => {
                const vid = this.el("source-video");
                if (vid) this.seek(vid.currentTime + 0.04);
            });
        }

        const scrubber = this.el("source-scrubber-progress-bar");
        if (scrubber) {
            scrubber.addEventListener("click", (e) => this.seekScrubber(e));
            scrubber.addEventListener("mousedown", (e) => this.startScrubberDrag(e));
        }

        // Marcadores
        const btnIn = this.el("btn-mark-in");
        if (btnIn) btnIn.addEventListener("click", () => this.markIn());

        const btnOut = this.el("btn-mark-out");
        if (btnOut) btnOut.addEventListener("click", () => this.markOut());

        const btnAppend = this.el("btn-append-timeline");
        if (btnAppend) btnAppend.addEventListener("click", () => this.appendToTimeline());

        // Vincula foco visual
        const panel = document.getElementById("source-player-panel");
        if (panel) {
            panel.addEventListener("click", () => {
                window.activeFocusedPlayer = "source";
                console.log("[Player] Foco do teclado definido para SOURCE");
            });
        }
    }

    loadVideo(video) {
        const vid = this.el("source-video");
        if (!vid) return;

        if (!video) {
            if (!STATE.activePhoto) {
                this.hidePhoto();
                vid.src = "";
                vid.removeAttribute("data-loaded-src");
                const title = this.el("source-player-title");
                if (title) title.textContent = "Nenhum clipe carregado";
                STATE.markerIn = null;
                STATE.markerOut = null;
                this.videoFaces = [];
                this.clearFacesOverlay();
            }
            return;
        }

        this.hidePhoto();

        let videoSrc = video.filepath || "";
        videoSrc = videoSrc.replace(/\\/g, "/");
        const isRemote = videoSrc.startsWith("http") || videoSrc.startsWith("/proxies/") || videoSrc.startsWith("/");
        
        if (video.proxy_path) {
            videoSrc = video.proxy_path.replace(/\\/g, "/");
        } else if (!isRemote) {
            videoSrc = `/originals/${video.filename}`;
        }
        
        vid.style.zIndex = "1";
        if (vid.dataset.loadedSrc !== videoSrc) {
            vid.src = videoSrc;
            vid.dataset.loadedSrc = videoSrc;
            vid.load();
        }
        
        const title = this.el("source-player-title");
        if (title) title.textContent = video.filename;

        STATE.markerIn = null;
        STATE.markerOut = null;
        this.setSpeed(1.0);
        this.jklState = 'K';

        this.videoFaces = [];
        this.clearFacesOverlay();

        CapIAuAPI.fetchVideoFaces(video.id)
            .then(faces => {
                this.videoFaces = faces || [];
                const innerVid = this.el("source-video");
                if (innerVid && innerVid.paused) {
                    this.updateFacesOverlay();
                }
            })
            .catch(err => {
                console.error("Erro ao carregar faces:", err);
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
        const vid = this.el("source-video");
        if (vid) {
            vid.pause();
            vid.style.display = "none";
        }
        
        const imgEl = this.el("source-player-photo");
        if (!imgEl) return;
        
        const src = photo.proxy_path || (photo.filepath && (photo.filepath.startsWith('http') || photo.filepath.startsWith('/')) ? photo.filepath : `/originals/${photo.filename}`);
        imgEl.src = src;
        imgEl.style.display = "block";
        
        const title = this.el("source-player-title");
        if (title) title.textContent = photo.filename;
        
        STATE.markerIn = null;
        STATE.markerOut = null;
        
        const curTime = this.el("source-current-time");
        if (curTime) curTime.textContent = "00:00:00:00";
        
        const durTime = this.el("source-duration-time");
        if (durTime) durTime.textContent = "00:00:00:00";

        const fill = this.el("source-scrubber-progress-fill");
        if (fill) fill.style.width = "0%";

        const handle = this.el("source-scrubber-progress-handle");
        if (handle) handle.style.left = "0%";
        
        this.videoFaces = [];
        this.clearFacesOverlay();
    }

    hidePhoto() {
        const imgEl = this.el("source-player-photo");
        if (imgEl) {
            imgEl.style.display = "none";
            imgEl.src = "";
        }
        const vid = this.el("source-video");
        if (vid) {
            vid.style.display = "block";
        }
    }

    onTimeUpdate() {
        const vid = this.el("source-video");
        if (!vid) return;

        const cur = vid.currentTime;
        const dur = vid.duration || 0;

        const curTime = this.el("source-current-time");
        if (curTime) curTime.textContent = formatTimecode(cur);
        
        if (dur > 0) {
            const pct = (cur / dur) * 100;
            const fill = this.el("source-scrubber-progress-fill");
            if (fill) fill.style.width = `${pct}%`;
            const handle = this.el("source-scrubber-progress-handle");
            if (handle) handle.style.left = `${pct}%`;
        }

        if (vid.paused) {
            this.updateFacesOverlay();
        }
    }

    onLoadedMetadata() {
        const vid = this.el("source-video");
        if (!vid) return;
        const durTime = this.el("source-duration-time");
        if (durTime) durTime.textContent = formatTimecode(vid.duration);
        this.onTimeUpdate();
    }

    onPlayStateChange(isPlaying) {
        const btnPlay = this.el("btn-source-play");
        if (btnPlay) {
            btnPlay.innerHTML = isPlaying 
                ? `<i class="fa-solid fa-pause"></i>`
                : `<i class="fa-solid fa-play"></i>`;
        }
        this.updateFacesOverlay();
    }

    togglePlay() {
        const vid = this.el("source-video");
        if (!vid || !vid.src) return;
        
        this.stopReverse();
        if (vid.paused) {
            vid.play();
            this.jklState = 'L';
            this.jklIndex = 0;
        } else {
            vid.pause();
            this.jklState = 'K';
        }
    }

    seek(seconds) {
        const vid = this.el("source-video");
        if (!vid) return;
        vid.currentTime = Math.max(0, Math.min(seconds, vid.duration || 0));
    }

    seekScrubber(e) {
        const vid = this.el("source-video");
        const bar = this.el("source-scrubber-progress-bar");
        if (!vid || !vid.duration || !bar) return;
        
        const rect = bar.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        this.seek(pct * vid.duration);
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
        const vid = this.el("source-video");
        if (!vid) return;
        this.stopReverse();
        
        STATE.playbackSpeed = speed;
        vid.playbackRate = Math.abs(speed);
    }

    startReverse(rate) {
        this.stopReverse();
        const vid = this.el("source-video");
        if (!vid) return;

        vid.pause();
        const step = 0.04 * Math.abs(rate);
        this.reverseInterval = setInterval(() => {
            if (vid.currentTime <= 0) {
                this.stopReverse();
                this.jklState = 'K';
            } else {
                vid.currentTime -= step;
            }
        }, 40);
    }

    stopReverse() {
        if (this.reverseInterval) {
            clearInterval(this.reverseInterval);
            this.reverseInterval = null;
        }
    }

    markIn() {
        const vid = this.el("source-video");
        if (!vid || !vid.src) return;
        STATE.markerIn = vid.currentTime;
    }

    markOut() {
        const vid = this.el("source-video");
        if (!vid || !vid.src) return;
        STATE.markerOut = vid.currentTime;
    }

    updateMarkersUI() {
        const markerInBar = this.el("source-marker-in-pos");
        const markerOutBar = this.el("source-marker-out-pos");
        const vid = this.el("source-video");

        if (vid && vid.duration > 0) {
            if (STATE.markerIn !== null) {
                const pctIn = (STATE.markerIn / vid.duration) * 100;
                if (markerInBar) {
                    markerInBar.style.left = `${pctIn}%`;
                    markerInBar.style.display = "block";
                }
            } else if (markerInBar) {
                markerInBar.style.display = "none";
            }

            if (STATE.markerOut !== null) {
                const pctOut = (STATE.markerOut / vid.duration) * 100;
                if (markerOutBar) {
                    markerOutBar.style.left = `${pctOut}%`;
                    markerOutBar.style.display = "block";
                }
            } else if (markerOutBar) {
                markerOutBar.style.display = "none";
            }
        }
    }

    appendToTimeline() {
        if (!STATE.activeVideo) return;
        const vid = this.el("source-video");
        const inTime = STATE.markerIn !== null ? STATE.markerIn : 0.0;
        const outTime = STATE.markerOut !== null ? STATE.markerOut : (vid ? vid.duration : 0.0);
        
        if (inTime >= outTime) {
            alert("Ponto In deve ser menor que o ponto Out.");
            return;
        }

        // Usa o TIMELINE_STATE para rotear o clipe à pista correta
        // (entrevistas → pista magnética de falas; b-rolls → pista livre)
        TIMELINE_STATE.addCut(STATE.activeVideo.id, inTime, outTime, null);

        STATE.markerIn = null;
        STATE.markerOut = null;
    }

    createOverlayContainer() {
        if (this.overlayContainer) return;
        const wrapper = this.el("source-video-wrapper");
        const vid = this.el("source-video");
        if (!wrapper || !vid) return;

        this.overlayContainer = document.createElement("div");
        this.overlayContainer.id = "source-video-face-overlay-container";
        this.overlayContainer.style.position = "absolute";
        this.overlayContainer.style.zIndex = "2";
        this.overlayContainer.style.pointerEvents = "auto";
        this.overlayContainer.style.boxSizing = "border-box";
        this.overlayContainer.style.overflow = "hidden";
        
        this.overlayContainer.addEventListener("mousedown", (e) => this.onMouseDown(e));
        wrapper.appendChild(this.overlayContainer);
    }

    updateOverlaySize() {
        const vid = this.el("source-video");
        if (!vid || !vid.videoWidth || !this.overlayContainer) return;

        const wWidth = vid.videoWidth;
        const wHeight = vid.videoHeight;
        const eWidth = vid.clientWidth;
        const eHeight = vid.clientHeight;

        const videoRatio = wWidth / wHeight;
        const elementRatio = eWidth / eHeight;

        let actualWidth, actualHeight, contentLeft, contentTop;

        if (elementRatio > videoRatio) {
            actualHeight = eHeight;
            actualWidth = actualHeight * videoRatio;
            contentLeft = (eWidth - actualWidth) / 2;
            contentTop = 0;
        } else {
            actualWidth = eWidth;
            actualHeight = actualWidth / videoRatio;
            contentLeft = 0;
            contentTop = (eHeight - actualHeight) / 2;
        }

        const videoRect = vid.getBoundingClientRect();
        const containerRect = vid.parentElement.getBoundingClientRect();

        const overlayLeft = videoRect.left - containerRect.left + contentLeft;
        const overlayTop = videoRect.top - containerRect.top + contentTop;

        this.overlayContainer.style.left = `${overlayLeft}px`;
        this.overlayContainer.style.top = `${overlayTop}px`;
        this.overlayContainer.style.width = `${actualWidth}px`;
        this.overlayContainer.style.height = `${actualHeight}px`;
    }

    updateFacesOverlay() {
        const vid = this.el("source-video");
        if (!vid || !vid.src) {
            this.clearFacesOverlay();
            return;
        }

        if (vid.paused) {
            if (!this.overlayContainer) {
                this.createOverlayContainer();
            }
            if (this.overlayContainer) {
                this.overlayContainer.style.display = "block";
                this.updateOverlaySize();

                const currentTime = vid.currentTime;
                const tolerance = 5.0;

                if (!this.videoFaces || this.videoFaces.length === 0) {
                    this.renderFaces([]);
                    return;
                }

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
                    const frameFaces = this.videoFaces.filter(face => Math.abs(face.timestamp - bestTimestamp) < 0.1);
                    this.renderFaces(frameFaces);
                } else {
                    this.renderFaces([]);
                }
            }
        } else {
            this.clearFacesOverlay();
        }
    }

    renderFaces(frameFaces) {
        if (!this.overlayContainer) return;
        
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
                    console.warn("Erro ao carregar speakers:", err);
                }

                const name = await showAnnotationModal(speakers, face.name || "");
                if (name) {
                    const trimmedName = name.trim();
                    const res = await CapIAuAPI.labelFace(face.id, trimmedName);
                    
                    await FaceManager.handleLabelResponse(res, face.id, async () => {
                        if (STATE.activeVideo) {
                            const faces = await CapIAuAPI.fetchVideoFaces(STATE.activeVideo.id);
                            this.videoFaces = faces || [];
                            this.updateFacesOverlay();
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

        if (finalWidth < 15 || finalHeight < 15) return;

        const x = finalLeft / rect.width;
        const y = finalTop / rect.height;
        const w = finalWidth / rect.width;
        const h = finalHeight / rect.height;

        let speakers = [];
        try {
            speakers = await CapIAuAPI.fetchProjectSpeakers(STATE.currentProjectId);
        } catch (err) {
            console.warn("Erro ao buscar speakers:", err);
        }

        const name = await showAnnotationModal(speakers, "");
        if (name && STATE.activeVideo) {
            const trimmedName = name.trim();
            if (trimmedName) {
                try {
                    const vid = this.el("source-video");
                    const payload = {
                        project_id: STATE.currentProjectId,
                        video_id: STATE.activeVideo.id,
                        timestamp: vid ? vid.currentTime : 0,
                        bounding_box: [x, y, w, h],
                        name: trimmedName
                    };

                    const res = await CapIAuAPI.addManualFace(payload);
                    if (res && res.status === "success") {
                        const faces = await CapIAuAPI.fetchVideoFaces(STATE.activeVideo.id);
                        this.videoFaces = faces || [];
                        this.updateFacesOverlay();
                    }
                } catch (err) {
                    console.error("Erro ao salvar:", err);
                }
            }
        }
    }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. PROGRAM PLAYER - MONITOR DE PROGRAMA / TIMELINE (DIREITA)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class ProgramPlayer {
    constructor() {
        this.isPlaying = false;
        this.playRequest = null;
        this.init();
    }

    el(id) {
        return getActiveElement(id);
    }

    init() {
        // Redesenha e sincroniza o player sempre que a timeline muda
        STATE.on("timelineCutsUpdated", () => this.syncVideoToPlayhead());
        
        // Escuta mudanças manuais da agulha (scrubbing)
        STATE.on("timelinePlayheadChanged", () => this.syncVideoToPlayhead());

        // Botão Play Program
        const btnPlay = this.el("btn-program-play");
        if (btnPlay) btnPlay.addEventListener("click", () => this.togglePlay());

        // Navegação de frames
        const btnPrev = this.el("btn-program-prev-frame");
        if (btnPrev) {
            btnPrev.addEventListener("click", () => {
                TIMELINE_STATE.setPlayheadFrame(Math.max(0, TIMELINE_STATE.playheadFrame - 1));
            });
        }

        const btnNext = this.el("btn-program-next-frame");
        if (btnNext) {
            btnNext.addEventListener("click", () => {
                const maxDur = this.getDurationFrames();
                TIMELINE_STATE.setPlayheadFrame(Math.min(maxDur, TIMELINE_STATE.playheadFrame + 1));
            });
        }

        // Scrubber
        const scrubber = this.el("program-scrubber-progress-bar");
        if (scrubber) {
            scrubber.addEventListener("click", (e) => this.seekScrubber(e));
            scrubber.addEventListener("mousedown", (e) => this.startScrubberDrag(e));
        }

        // Foco visual do teclado
        const panel = document.getElementById("program-player-panel");
        if (panel) {
            panel.addEventListener("click", () => {
                window.activeFocusedPlayer = "program";
                console.log("[Player] Foco do teclado definido para PROGRAM");
            });
        }
    }

    getDurationFrames() {
        const cuts = STATE.activeTimelineCuts;
        let maxFrame = 0;
        cuts.forEach(cut => {
            const end = cut.timelineStartFrame + (cut.outFrame - cut.inFrame);
            if (end > maxFrame) maxFrame = end;
        });
        return maxFrame;
    }

    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;

        const btnPlay = this.el("btn-program-play");
        if (btnPlay) btnPlay.innerHTML = `<i class="fa-solid fa-pause"></i>`;

        let lastTime = performance.now();
        const step = () => {
            if (!this.isPlaying) return;
            const now = performance.now();
            const elapsedSecs = (now - lastTime) / 1000;
            lastTime = now;

            const maxDur = this.getDurationFrames();
            if (TIMELINE_STATE.playheadFrame >= maxDur && maxDur > 0) {
                this.pause();
                TIMELINE_STATE.setPlayheadFrame(0);
                return;
            }

            const elapsedFrames = elapsedSecs * 24; // assume 24 FPS
            TIMELINE_STATE.setPlayheadFrame(TIMELINE_STATE.playheadFrame + elapsedFrames);

            this.playRequest = requestAnimationFrame(step);
        };
        this.playRequest = requestAnimationFrame(step);
    }

    pause() {
        this.isPlaying = false;
        if (this.playRequest) {
            cancelAnimationFrame(this.playRequest);
            this.playRequest = null;
        }

        const btnPlay = this.el("btn-program-play");
        if (btnPlay) btnPlay.innerHTML = `<i class="fa-solid fa-play"></i>`;

        const videoA = this.el("program-video-a");
        const videoB = this.el("program-video-b");
        if (videoA) videoA.pause();
        if (videoB) videoB.pause();
    }

    syncVideoToPlayhead() {
        const currentFrame = TIMELINE_STATE.playheadFrame;
        const durationFrames = this.getDurationFrames();

        // Atualiza tempos de scrubber
        const curTimeEl = this.el("program-current-time");
        if (curTimeEl) curTimeEl.textContent = formatTimecode(currentFrame / 24);

        const durTimeEl = this.el("program-duration-time");
        if (durTimeEl) durTimeEl.textContent = formatTimecode(durationFrames / 24);

        const fill = this.el("program-scrubber-progress-fill");
        const handle = this.el("program-scrubber-progress-handle");

        if (durationFrames > 0) {
            const pct = (currentFrame / durationFrames) * 100;
            if (fill) fill.style.width = `${pct}%`;
            if (handle) handle.style.left = `${pct}%`;
        } else {
            if (fill) fill.style.width = "0%";
            if (handle) handle.style.left = "0%";
        }

        const cuts = STATE.activeTimelineCuts;

        // ────────── COMPOSIÇÃO MULTIPISTA ──────────
        // Base (videoA) = clipe da pista de vídeo MAIS BAIXA no playhead (geralmente falas).
        // Sobreposição (videoB) = clipe da pista de vídeo MAIS ALTA acima da base (cobertura b-roll).
        const videoTracks = TIMELINE_STATE.getVideoTracks(); // ordem visual: topo → base
        const clipAtPlayhead = (trackId) => cuts.find(c =>
            c.track === trackId &&
            currentFrame >= c.timelineStartFrame &&
            currentFrame < (c.timelineStartFrame + (c.outFrame - c.inFrame))
        );

        let baseCut = null, baseTrack = null;
        for (let i = videoTracks.length - 1; i >= 0; i--) { // de baixo para cima
            const hit = clipAtPlayhead(videoTracks[i].id);
            if (hit) {
                baseCut = hit;
                baseTrack = videoTracks[i];
                break;
            }
        }

        let overlayCut = null, overlayTrack = null;
        for (let i = 0; i < videoTracks.length; i++) { // de cima para baixo
            const hit = clipAtPlayhead(videoTracks[i].id);
            if (hit && (!baseCut || hit.id !== baseCut.id)) {
                overlayCut = hit;
                overlayTrack = videoTracks[i];
                break;
            }
        }

        const applyCutToElement = (el, cut, track, zIndex) => {
            if (!el) return;
            if (!cut) {
                if (!el.paused) el.pause();
                if (el.style.display !== "none") el.style.display = "none";
                el.dataset.activeClipId = "";
                return;
            }
            const videoData = STATE.allVideos.find(v => v.id === cut.video_id);
            if (!videoData) {
                if (!el.paused) el.pause();
                el.style.display = "none";
                el.dataset.activeClipId = "";
                return;
            }
            const rawSrc = videoData.proxy_path || videoData.filepath || `/originals/${videoData.filename}`;
            const videoSrc = rawSrc.replace(/\\/g, "/");
            const srcChanged = el.dataset.loadedSrc !== videoSrc;
            if (srcChanged) {
                el.src = videoSrc;
                el.dataset.loadedSrc = videoSrc;
                el.load();
            }

            // Calcula o tempo correspondente no arquivo
            const offsetFrames = currentFrame - cut.timelineStartFrame;
            const targetSeconds = cut.in + (offsetFrames / 24);

            const clipChanged = el.dataset.activeClipId !== String(cut.id);
            if (clipChanged) el.dataset.activeClipId = String(cut.id);

            const drift = el.currentTime - targetSeconds;

            // SINCRONIA SEM SEEK-LOOP:
            // Seek "duro" num vídeo em reprodução trava o decoder (~100-300ms), o que
            // aumenta a deriva e dispara o próximo seek — loop infinito de pisca-trava,
            // garantido com 2 vídeos sobrepostos decodificando juntos.
            // Em reprodução, corrigimos a deriva suavemente via playbackRate (como NLEs);
            // seek duro só em descontinuidade real (troca de clipe, scrub, deriva > 1s).
            if (srcChanged || clipChanged) {
                el.currentTime = targetSeconds;
                el.playbackRate = 1.0;
            } else if (this.isPlaying) {
                if (Math.abs(drift) > 1.0) {
                    el.currentTime = targetSeconds;
                    el.playbackRate = 1.0;
                } else if (drift > 0.08) {
                    el.playbackRate = 0.92; // vídeo adiantado: segura levemente
                } else if (drift < -0.08) {
                    el.playbackRate = 1.08; // vídeo atrasado: acelera levemente
                } else if (el.playbackRate !== 1.0) {
                    el.playbackRate = 1.0;
                }
            } else {
                // Pausado (scrub manual): seek preciso é o comportamento esperado
                if (Math.abs(drift) > 0.06) {
                    el.currentTime = targetSeconds;
                }
                if (el.playbackRate !== 1.0) el.playbackRate = 1.0;
            }

            // Controla áudio (volume/mute por pista) e play status
            el.volume = (track && track.muted) ? 0 : (track ? track.volume : 1.0);
            if (this.isPlaying && el.paused) {
                el.play().catch(() => {});
            } else if (!this.isPlaying && !el.paused) {
                el.pause();
            }
            if (el.style.display !== "block") el.style.display = "block";
            el.style.zIndex = String(zIndex);
        };

        const videoA = this.el("program-video-a");
        const videoB = this.el("program-video-b");

        // ESTABILIDADE DE PAPÉIS: se um clipe já está tocando num elemento, mantém nele.
        // Sem isso, quando o clipe de baixo termina, o de cima "migraria" do elemento B
        // para o A (recarga de src no meio da reprodução = flash preto).
        let baseEl = videoA, overlayEl = videoB;
        if (baseCut && !overlayCut && videoB && videoB.dataset.activeClipId === String(baseCut.id)) {
            baseEl = videoB;
            overlayEl = videoA;
        } else if (baseCut && overlayCut && videoA && videoB &&
                   videoA.dataset.activeClipId === String(overlayCut.id) &&
                   videoB.dataset.activeClipId === String(baseCut.id)) {
            baseEl = videoB;
            overlayEl = videoA;
        }

        applyCutToElement(baseEl, baseCut, baseTrack, 1);
        applyCutToElement(overlayEl, overlayCut, overlayTrack, 10);
    }

    seekScrubber(e) {
        const bar = this.el("program-scrubber-progress-bar");
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        const durFrames = this.getDurationFrames();
        TIMELINE_STATE.setPlayheadFrame(Math.round(pct * durFrames));
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
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 3. WRAPPER COMPATÍVEL - VIDEO PLAYER (EXPOSTO PARA MAIN.JS)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class VideoPlayer {
    constructor() {
        this.sourcePlayer = new SourcePlayer();
        this.programPlayer = new ProgramPlayer();

        // Escuta atalhos globais de teclado redirecionando para o player focado
        document.addEventListener("keydown", (e) => this.handleGlobalKeyboard(e));
    }

    // Atalhos de teclado compartilhados
    handleGlobalKeyboard(e) {
        const activeTag = document.activeElement.tagName.toLowerCase();
        if (activeTag === "input" || activeTag === "textarea") return;

        const code = e.code;
        const activePlayer = window.activeFocusedPlayer === "source" ? this.sourcePlayer : this.programPlayer;

        if (code === "Space" || code === "KeyK") {
            e.preventDefault();
            activePlayer.togglePlay();
        } 
        else if (code === "KeyL") {
            e.preventDefault();
            if (window.activeFocusedPlayer === "source") {
                if (this.sourcePlayer.jklState === 'L') {
                    this.sourcePlayer.jklIndex = Math.min(this.sourcePlayer.jklIndex + 1, this.sourcePlayer.speedsForward.length - 1);
                } else {
                    this.sourcePlayer.jklState = 'L';
                    this.sourcePlayer.jklIndex = 0;
                }
                const speed = this.sourcePlayer.speedsForward[this.sourcePlayer.jklIndex];
                this.sourcePlayer.setSpeed(speed);
                const vid = this.sourcePlayer.el("source-video");
                if (vid) vid.play();
            } else {
                this.programPlayer.play();
            }
        } 
        else if (code === "KeyJ") {
            e.preventDefault();
            if (window.activeFocusedPlayer === "source") {
                if (this.sourcePlayer.jklState === 'J') {
                    this.sourcePlayer.jklIndex = Math.min(this.sourcePlayer.jklIndex + 1, this.sourcePlayer.speedsReverse.length - 1);
                } else {
                    this.sourcePlayer.jklState = 'J';
                    this.sourcePlayer.jklIndex = 0;
                }
                const speed = this.sourcePlayer.speedsReverse[this.sourcePlayer.jklIndex];
                this.sourcePlayer.startReverse(speed);
            } else {
                // Apenas pausa a reprodução da timeline se tentar voltar atrás (simplificado)
                this.programPlayer.pause();
                TIMELINE_STATE.setPlayheadFrame(Math.max(0, TIMELINE_STATE.playheadFrame - 24));
            }
        } 
        else if (code === "KeyI") {
            this.sourcePlayer.markIn();
        } 
        else if (code === "KeyO") {
            this.sourcePlayer.markOut();
        } 
        else if (code === "KeyE") {
            this.sourcePlayer.appendToTimeline();
        } 
        else if (code === "ArrowLeft") {
            e.preventDefault();
            if (window.activeFocusedPlayer === "source") {
                const vid = this.sourcePlayer.el("source-video");
                if (vid) this.sourcePlayer.seek(vid.currentTime - 0.04);
            } else {
                TIMELINE_STATE.setPlayheadFrame(Math.max(0, TIMELINE_STATE.playheadFrame - 1));
            }
        } 
        else if (code === "ArrowRight") {
            e.preventDefault();
            if (window.activeFocusedPlayer === "source") {
                const vid = this.sourcePlayer.el("source-video");
                if (vid) this.sourcePlayer.seek(vid.currentTime + 0.04);
            } else {
                const maxDur = this.programPlayer.getDurationFrames();
                TIMELINE_STATE.setPlayheadFrame(Math.min(maxDur, TIMELINE_STATE.playheadFrame + 1));
            }
        }
    }

    // Métodos delegados para manter compatibilidade com a Biblioteca/ASR
    loadVideo(video) {
        this.sourcePlayer.loadVideo(video);
    }

    loadPhoto(photo) {
        this.sourcePlayer.loadPhoto(photo);
    }
}

export function showAnnotationModal(speakers, initialValue = "") {
    return new Promise((resolve) => {
        const oldModal = document.getElementById("annotation-modal");
        if (oldModal) oldModal.remove();

        const overlay = document.createElement("div");
        overlay.className = "modal-overlay active";
        overlay.id = "annotation-modal";
        overlay.style.zIndex = "10005";

        const content = document.createElement("div");
        content.className = "modal-content glassmorphism";
        content.style.maxWidth = "400px";
        content.style.width = "95%";
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
        footer.style.justifyContent = "flex-end";
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
