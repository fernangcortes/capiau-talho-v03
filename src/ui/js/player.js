// Gerenciador do Player de Vídeo Duplo (Source/Program), atalhos JKL e workspaces multi-monitores.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { FaceManager } from "./faces.js";
import { TIMELINE_STATE, TIMELINE_HISTORY, evaluateFadeCurve } from "./timelineState.js";
import { getActiveElement } from "./workspaceManager.js";

// Foco global do teclado para players: "source" ou "program"
window.activeFocusedPlayer = "source";

export function formatTimecode(secs, fps = null) {
    if (isNaN(secs) || secs === null || secs < 0) return "00:00:00:00";
    const currentFps = Number(fps || TIMELINE_STATE?.fps) > 0 ? Number(fps || TIMELINE_STATE?.fps) : 24;
    const totalIntFrames = Math.max(0, Math.round(Number(secs) * currentFps));
    const totalSeconds = Math.floor(totalIntFrames / currentFps);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const f = Math.min(Math.floor(currentFps) - 1, Math.max(0, Math.floor(totalIntFrames % currentFps)));

    const pad = (n) => String(Math.floor(Math.abs(Number(n) || 0))).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. SOURCE PLAYER - MONITOR DE ORIGEM (ESQUERDA)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class SourcePlayer {
    constructor() {
        this.speedsForward = [1.0, 2.0, 4.0, 8.0];
        this.speedsReverse = [-1.0, -2.0, -4.0, -8.0];
        this.jklState = 'K';
        this.jklIndex = 0;
        this.isReversing = false;
        this.reverseRate = 1.0;
        this.reverseRafId = null;
        this.reverseInterval = null;
        this._osdTimeout = null;
        
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

        STATE.on("playerPlayed", (sender) => {
            if (sender !== "source") {
                this.pause();
            }
        });

        STATE.on("videoFacesUpdated", (videoId) => {
            if (STATE.activeVideo && STATE.activeVideo.id === videoId) {
                CapIAuAPI.fetchVideoFaces(videoId)
                    .then(faces => {
                        this.videoFaces = faces || [];
                        const video = this.el("source-video");
                        if (video && video.paused && !this.isReversing) {
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
            video.addEventListener("play", () => {
                this.onPlayStateChange(true);
                STATE.emit("playerPlayed", "source");
            });
            video.addEventListener("pause", () => {
                if (!this.isReversing) {
                    this.jklState = 'K';
                    this.jklIndex = 0;
                    this.onPlayStateChange(false);
                }
            });
            video.addEventListener("ended", () => {
                this.pause();
            });
            video.addEventListener("seeked", () => {
                const vid = this.el("source-video");
                if (vid && vid.paused && !this.isReversing) this.updateFacesOverlay();
            });

            this.resizeObserver = new ResizeObserver(() => {
                const vid = this.el("source-video");
                if (vid && vid.paused && !this.isReversing) this.updateOverlaySize();
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

        const btnSetThumb = this.el("btn-source-set-thumbnail");
        if (btnSetThumb) {
            btnSetThumb.addEventListener("click", async (e) => {
                if (!STATE.activeVideo) {
                    if (window.showToast) window.showToast("Nenhum vídeo ativo para definir miniatura.", "error");
                    else alert("Nenhum vídeo ativo para definir miniatura.");
                    return;
                }
                const vid = this.el("source-video");
                if (!vid) return;
                
                await window.setVideoThumbnail(STATE.activeVideo.id, vid.currentTime, e.currentTarget);
            });
        }

        const btnInterviewSetThumb = this.el("btn-interview-modal-set-thumb");
        if (btnInterviewSetThumb) {
            btnInterviewSetThumb.addEventListener("click", async (e) => {
                if (!STATE.activeVideo) {
                    if (window.showToast) window.showToast("Nenhum vídeo ativo para definir miniatura.", "error");
                    else alert("Nenhum vídeo ativo para definir miniatura.");
                    return;
                }
                const vid = this.el("interview-modal-video");
                if (!vid) return;

                await window.setVideoThumbnail(STATE.activeVideo.id, vid.currentTime, e.currentTarget);
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
            const setSourceFocus = () => {
                if (window.activeFocusedPlayer !== "source") {
                    window.activeFocusedPlayer = "source";
                    console.log("[Player] Foco do teclado definido para SOURCE");
                }
            };
            panel.addEventListener("click", setSourceFocus, true);
            panel.addEventListener("mousedown", setSourceFocus, true);
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

        let videoSrc = "";
        if (video.proxy_path && (video.proxy_path.startsWith("/") || video.proxy_path.startsWith("http"))) {
            videoSrc = video.proxy_path;
        } else {
            videoSrc = `/api/video/${video.id}/stream`;
        }
        
        vid.style.zIndex = "1";
        if (vid.dataset.loadedSrc !== videoSrc) {
            vid.src = videoSrc;
            vid.dataset.loadedSrc = videoSrc;
            vid.load();
        }
        
        const title = this.el("source-player-title");
        if (title) {
            title.textContent = video.title || video.filename;
            title.title = video.filename;
        }

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
        
        const src = (photo.proxy_path && (photo.proxy_path.startsWith("/") || photo.proxy_path.startsWith("http")))
            ? photo.proxy_path 
            : `/api/photo/${photo.id}/file`;
        imgEl.src = src;
        imgEl.style.display = "block";
        
        const title = this.el("source-player-title");
        if (title) {
            title.textContent = photo.title || photo.filename;
            title.title = photo.filename;
        }
        
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
            btnPlay.innerHTML = (isPlaying || this.isReversing) 
                ? `<i class="fa-solid fa-pause"></i>`
                : `<i class="fa-solid fa-play"></i>`;
        }
        this.updateFacesOverlay();
    }

    play(speed = 1.0) {
        const vid = this.el("source-video");
        if (!vid || !vid.src) return;
        this.stopReverse();
        this.setSpeed(speed);
        this.jklState = 'L';
        vid.play().catch(() => {});
        this.onPlayStateChange(true);
    }

    pause() {
        this.stopReverse();
        const vid = this.el("source-video");
        if (vid && !vid.paused) {
            vid.pause();
        }
        this.jklState = 'K';
        this.jklIndex = 0;
        this.onPlayStateChange(false);
    }

    togglePlay() {
        const vid = this.el("source-video");
        if (!vid || !vid.src) return;
        
        if (this.isReversing || (vid && !vid.paused)) {
            this.pause();
        } else {
            this.play(1.0);
        }
    }

    seek(seconds) {
        const vid = this.el("source-video");
        if (!vid) return;
        this.stopReverse();
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

    startReverse(rate = -1.0) {
        this.stopReverse();
        const vid = this.el("source-video");
        if (!vid || !vid.src) return;

        this.isReversing = true;
        this.reverseRate = Math.abs(rate);
        this.jklState = 'J';
        vid.pause();
        STATE.emit("playerPlayed", "source");
        this.onPlayStateChange(true);

        let lastTime = performance.now();
        const step = () => {
            if (!this.isReversing) return;
            const now = performance.now();
            const elapsedSecs = (now - lastTime) / 1000;
            lastTime = now;

            if (vid.currentTime <= 0.001) {
                vid.currentTime = 0;
                this.pause();
                return;
            }

            if (!vid.seeking) {
                const stepSecs = elapsedSecs * this.reverseRate;
                vid.currentTime = Math.max(0, vid.currentTime - stepSecs);
            }
            this.reverseRafId = requestAnimationFrame(step);
        };
        this.reverseRafId = requestAnimationFrame(step);
    }

    stopReverse() {
        this.isReversing = false;
        if (this.reverseRafId) {
            cancelAnimationFrame(this.reverseRafId);
            this.reverseRafId = null;
        }
        if (this.reverseInterval) {
            clearInterval(this.reverseInterval);
            this.reverseInterval = null;
        }
    }

    shuttleForward() {
        const vid = this.el("source-video");
        if (!vid || !vid.src) return;
        if (this.jklState === 'K' || (!this.isReversing && vid.paused)) {
            this.jklState = 'L';
            this.jklIndex = 0;
            this.play(this.speedsForward[0]);
        } else if (this.jklState === 'L') {
            this.jklIndex = Math.min(this.jklIndex + 1, this.speedsForward.length - 1);
            this.play(this.speedsForward[this.jklIndex]);
        } else if (this.jklState === 'J') {
            if (this.jklIndex > 0) {
                this.jklIndex--;
                this.startReverse(this.speedsReverse[this.jklIndex]);
            } else {
                this.jklState = 'L';
                this.jklIndex = 0;
                this.play(this.speedsForward[0]);
            }
        }
        this.showShuttleOsd(this.jklState === 'L' ? `${this.speedsForward[this.jklIndex]}x` : `${this.speedsReverse[this.jklIndex]}x`);
    }

    shuttleReverse() {
        const vid = this.el("source-video");
        if (!vid || !vid.src) return;
        if (this.jklState === 'K' || (!this.isReversing && vid.paused)) {
            this.jklState = 'J';
            this.jklIndex = 0;
            this.startReverse(this.speedsReverse[0]);
        } else if (this.jklState === 'J') {
            this.jklIndex = Math.min(this.jklIndex + 1, this.speedsReverse.length - 1);
            this.startReverse(this.speedsReverse[this.jklIndex]);
        } else if (this.jklState === 'L') {
            if (this.jklIndex > 0) {
                this.jklIndex--;
                this.play(this.speedsForward[this.jklIndex]);
            } else {
                this.jklState = 'J';
                this.jklIndex = 0;
                this.startReverse(this.speedsReverse[0]);
            }
        }
        this.showShuttleOsd(this.jklState === 'J' ? `${this.speedsReverse[this.jklIndex]}x` : `${this.speedsForward[this.jklIndex]}x`);
    }

    shuttleStop() {
        this.pause();
        this.showShuttleOsd("Pausado");
    }

    showShuttleOsd(text) {
        const panel = this.el("source-player-panel");
        if (!panel) return;
        let osd = panel.querySelector(".player-shuttle-osd");
        if (!osd) {
            osd = document.createElement("div");
            osd.className = "player-shuttle-osd";
            osd.style.cssText = "position:absolute; top:45px; left:50%; transform:translateX(-50%); background:rgba(18,18,24,0.85); color:var(--color-cyan); padding:4px 12px; border-radius:12px; font-size:11px; font-weight:700; font-family:'Outfit',sans-serif; letter-spacing:0.5px; border:1px solid rgba(6,182,212,0.4); backdrop-filter:blur(8px); box-shadow:0 4px 12px rgba(0,0,0,0.5); pointer-events:none; z-index:99; transition:opacity 0.2s ease; opacity:0;";
            panel.appendChild(osd);
        }
        osd.textContent = text;
        osd.style.opacity = "1";
        if (this._osdTimeout) clearTimeout(this._osdTimeout);
        this._osdTimeout = setTimeout(() => {
            if (osd) osd.style.opacity = "0";
        }, 1200);
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
        // Foto ativa (still): insere com a duração padrão (ajustável depois no trim)
        if (!STATE.activeVideo && STATE.activePhoto) {
            TIMELINE_STATE.addPhotoCut(STATE.activePhoto.id, {});
            return;
        }
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
        window.activeFocusedPlayer = "source";
        console.log("[Player] Foco do teclado definido para SOURCE via overlay mousedown");
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

        if (finalWidth < 15 || finalHeight < 15) {
            window.activeFocusedPlayer = "source";
            console.log("[Player] Foco do teclado definido para SOURCE via overlay click");
            
            const now = Date.now();
            const lastClick = this.lastOverlayClick || 0;
            this.lastOverlayClick = now;
            
            if (now - lastClick < 300) {
                if (this.clickTimeout) {
                    clearTimeout(this.clickTimeout);
                    this.clickTimeout = null;
                }
                const btnExpand = document.getElementById("btn-expand-source");
                if (btnExpand) btnExpand.click();
            } else {
                this.clickTimeout = setTimeout(() => {
                    this.clickTimeout = null;
                    const vid = this.el("source-video");
                    if (vid && vid.src) {
                        if (vid.paused) vid.play(); else vid.pause();
                        const btnPlay = this.el("btn-source-play");
                        if (btnPlay) {
                            btnPlay.innerHTML = vid.paused
                                ? `<i class="fa-solid fa-play"></i>`
                                : `<i class="fa-solid fa-pause"></i>`;
                        }
                    }
                }, 220);
            }
            return;
        }

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

let _observedWrapper = null;
let _viewportResizeObserver = null;
let _scrollbarFadeTimeout = null;

export function showProgramScrollbarsTemporarily() {
    const scrollbarV = getActiveElement("program-scrollbar-v");
    const scrollbarH = getActiveElement("program-scrollbar-h");
    if (scrollbarV) scrollbarV.classList.add("visible");
    if (scrollbarH) scrollbarH.classList.add("visible");

    if (_scrollbarFadeTimeout) clearTimeout(_scrollbarFadeTimeout);
    _scrollbarFadeTimeout = setTimeout(() => {
        if (scrollbarV) scrollbarV.classList.remove("visible");
        if (scrollbarH) scrollbarH.classList.remove("visible");
    }, 1200);
}

export function updateProgramScrollbars() {
    const wrapper = getActiveElement("program-video-wrapper");
    const scrollbarV = getActiveElement("program-scrollbar-v");
    const scrollbarH = getActiveElement("program-scrollbar-h");
    const thumbV = getActiveElement("program-scrollbar-v-thumb");
    const thumbH = getActiveElement("program-scrollbar-h-thumb");
    if (!wrapper || !scrollbarV || !scrollbarH || !thumbV || !thumbH) return;

    const tw = TIMELINE_STATE?.width || 1920;
    const th = TIMELINE_STATE?.height || 1080;
    const PAD = 16;

    const availW = Math.max(0, wrapper.clientWidth - PAD * 2);
    const availH = Math.max(0, wrapper.clientHeight - PAD * 2);
    const fitScale = (availW > 0 && availH > 0) ? Math.min(availW / tw, availH / th) : 0.5;

    const zoom = TIMELINE_STATE?.previewZoom || "fit";
    const scale = (zoom === "fit") ? fitScale : Number(zoom);

    const vW = Math.round(tw * scale);
    const vH = Math.round(th * scale);
    const wW = wrapper.clientWidth;
    const wH = wrapper.clientHeight;

    const overflowX = vW > wW + 2;
    const overflowY = vH > wH + 2;

    scrollbarV.style.display = overflowY ? "block" : "none";
    scrollbarH.style.display = overflowX ? "block" : "none";

    scrollbarV.classList.toggle("active", overflowY);
    scrollbarH.classList.toggle("active", overflowX);

    const panX = TIMELINE_STATE?.previewPanX || 0;
    const panY = TIMELINE_STATE?.previewPanY || 0;

    if (overflowY) {
        const maxPanY = (vH - wH) / 2;
        const normY = maxPanY > 0 ? (panY + maxPanY) / (2 * maxPanY) : 0.5;
        const thumbFracH = Math.max(0.15, Math.min(1, wH / vH));
        const trackH = scrollbarV.clientHeight || wH;
        const thumbH_px = Math.max(16, Math.round(trackH * thumbFracH));
        const top_px = Math.round((1 - normY) * (trackH - thumbH_px));
        thumbV.style.height = `${thumbH_px}px`;
        thumbV.style.transform = `translateY(${top_px}px)`;
    }

    if (overflowX) {
        const maxPanX = (vW - wW) / 2;
        const normX = maxPanX > 0 ? (panX + maxPanX) / (2 * maxPanX) : 0.5;
        const thumbFracW = Math.max(0.15, Math.min(1, wW / vW));
        const trackW = scrollbarH.clientWidth || wW;
        const thumbW_px = Math.max(16, Math.round(trackW * thumbFracW));
        const left_px = Math.round((1 - normX) * (trackW - thumbW_px));
        thumbH.style.width = `${thumbW_px}px`;
        thumbH.style.transform = `translateX(${left_px}px)`;
    }
}

export function updateProgramMinimap() {
    const wrapper = getActiveElement("program-video-wrapper");
    const minimap = getActiveElement("program-player-minimap");
    const canvas = getActiveElement("program-minimap-canvas");
    const rectEl = getActiveElement("program-minimap-rect");
    if (!wrapper || !minimap || !canvas || !rectEl) return;

    const tw = TIMELINE_STATE?.width || 1920;
    const th = TIMELINE_STATE?.height || 1080;
    const PAD = 16;

    const availW = Math.max(0, wrapper.clientWidth - PAD * 2);
    const availH = Math.max(0, wrapper.clientHeight - PAD * 2);
    const fitScale = (availW > 0 && availH > 0) ? Math.min(availW / tw, availH / th) : 0.5;

    const zoom = TIMELINE_STATE?.previewZoom || "fit";
    const scale = (zoom === "fit") ? fitScale : Number(zoom);

    const vW = Math.round(tw * scale);
    const vH = Math.round(th * scale);
    const wW = wrapper.clientWidth;
    const wH = wrapper.clientHeight;

    const hasOverflow = (vW > wW + 2) || (vH > wH + 2);

    if (!hasOverflow) {
        minimap.style.display = "none";
        return;
    }

    minimap.style.display = "block";

    // Renderiza quadro no canvas do minimapa
    const ctx = canvas.getContext ? canvas.getContext("2d") : null;
    if (ctx) {
        const mw = canvas.width;
        const mh = canvas.height;
        ctx.fillStyle = "#0a080e";
        ctx.fillRect(0, 0, mw, mh);

        const aspect = tw / th;
        const mAspect = mw / mh;
        let dw, dh, dx, dy;
        if (aspect > mAspect) {
            dw = mw;
            dh = mw / aspect;
            dx = 0;
            dy = (mh - dh) / 2;
        } else {
            dh = mh;
            dw = mh * aspect;
            dx = (mw - dw) / 2;
            dy = 0;
        }

        let frameDrawn = false;
        const photoA = getActiveElement("program-player-photo");
        const photoB = getActiveElement("program-player-photo-b");
        const activePhoto = (photoA && photoA.style.display !== "none" && photoA.complete && photoA.naturalWidth > 0) ? photoA :
                           ((photoB && photoB.style.display !== "none" && photoB.complete && photoB.naturalWidth > 0) ? photoB : null);

        if (activePhoto) {
            try {
                ctx.drawImage(activePhoto, dx, dy, dw, dh);
                frameDrawn = true;
            } catch (_) {}
        }

        if (!frameDrawn) {
            const vids = ["program-video-a", "program-video-b", "program-video-c", "program-video-d"]
                .map(id => getActiveElement(id))
                .filter(v => v && v.style.display !== "none" && v.readyState >= 2);

            const activeVid = vids[0];
            if (activeVid) {
                try {
                    ctx.drawImage(activeVid, dx, dy, dw, dh);
                    frameDrawn = true;
                } catch (_) {}
            }
        }

        if (!frameDrawn) {
            ctx.fillStyle = "#16121f";
            ctx.fillRect(dx, dy, dw, dh);
            ctx.strokeStyle = "rgba(168, 85, 247, 0.4)";
            ctx.lineWidth = 1;
            ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
        }

        // Posiciona e dimensiona o retângulo indicador de enquadramento
        const panX = TIMELINE_STATE?.previewPanX || 0;
        const panY = TIMELINE_STATE?.previewPanY || 0;

        const visFracW = Math.min(1, wW / vW);
        const visFracH = Math.min(1, wH / vH);

        const rectW = Math.max(6, Math.min(dw, visFracW * dw));
        const rectH = Math.max(6, Math.min(dh, visFracH * dh));

        const normCenterX = 0.5 - (panX / (tw * scale));
        const normCenterY = 0.5 - (panY / (th * scale));

        let rectLeft = dx + (normCenterX * dw) - (rectW / 2);
        let rectTop = dy + (normCenterY * dh) - (rectH / 2);

        rectLeft = Math.max(dx, Math.min(dx + dw - rectW, rectLeft));
        rectTop = Math.max(dy, Math.min(dy + dh - rectH, rectTop));

        rectEl.style.left = `${Math.round(rectLeft)}px`;
        rectEl.style.top = `${Math.round(rectTop)}px`;
        rectEl.style.width = `${Math.round(rectW)}px`;
        rectEl.style.height = `${Math.round(rectH)}px`;
    }
}

export function syncProgramViewport() {
    const wrapper = getActiveElement("program-video-wrapper");
    const viewport = getActiveElement("program-player-viewport");
    if (!wrapper || !viewport) return;

    if (typeof ResizeObserver !== "undefined") {
        if (_observedWrapper !== wrapper) {
            if (_viewportResizeObserver) {
                _viewportResizeObserver.disconnect();
            }
            _observedWrapper = wrapper;
            _viewportResizeObserver = new ResizeObserver(() => {
                syncProgramViewport();
            });
            _viewportResizeObserver.observe(wrapper);
        }
    }

    const tw = TIMELINE_STATE?.width || 1920;
    const th = TIMELINE_STATE?.height || 1080;
    const PAD = 16;

    const availW = Math.max(0, wrapper.clientWidth - PAD * 2);
    const availH = Math.max(0, wrapper.clientHeight - PAD * 2);
    const fitScale = (availW > 0 && availH > 0) ? Math.min(availW / tw, availH / th) : 0.5;

    const zoom = TIMELINE_STATE?.previewZoom || "fit";
    const scale = (zoom === "fit") ? fitScale : Number(zoom);

    const vW = Math.round(tw * scale);
    const vH = Math.round(th * scale);

    viewport.style.width = `${vW}px`;
    viewport.style.height = `${vH}px`;

    // Limites e translação de pan
    const wW = wrapper.clientWidth;
    const wH = wrapper.clientHeight;
    const maxPanX = Math.max(0, (vW - wW) / 2);
    const maxPanY = Math.max(0, (vH - wH) / 2);

    let panX = TIMELINE_STATE?.previewPanX || 0;
    let panY = TIMELINE_STATE?.previewPanY || 0;

    if (vW <= wW) panX = 0; else panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
    if (vH <= wH) panY = 0; else panY = Math.max(-maxPanY, Math.min(maxPanY, panY));

    if (TIMELINE_STATE) {
        TIMELINE_STATE.previewPanX = panX;
        TIMELINE_STATE.previewPanY = panY;
    }

    viewport.style.transform = `translate(-50%, -50%) translate3d(${panX}px, ${panY}px, 0px)`;

    updateProgramMinimap();
    updateProgramScrollbars();
}

// Tolerância (s) para considerar que um buffer já está no ponto certo da mídia e portanto
// pode emendar no clipe seguinte sem seek. Precisa ser maior que a banda da correção de
// deriva (0.08 s), senão toda emenda de razor cut viraria um seek e travaria o decoder.
const BUFFER_CONTINUITY_TOLERANCE = 0.1;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. PROGRAM PLAYER - MONITOR DE PROGRAMA / TIMELINE (DIREITA)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class ProgramPlayer {
    constructor() {
        this.isPlaying = false;
        this.playRequest = null;
        this.speedsForward = [1.0, 2.0, 4.0, 8.0];
        this.speedsReverse = [-1.0, -2.0, -4.0, -8.0];
        this.jklState = 'K';
        this.jklIndex = 0;
        this.playbackSpeed = 1.0;
        this._osdTimeout = null;
        this.init();
    }

    el(id) {
        return getActiveElement(id);
    }

    init() {
        // Redesenha e sincroniza o player sempre que a timeline muda
        STATE.on("timelineCutsUpdated", () => this.syncVideoToPlayhead());
        STATE.on("timelineRestored", () => this.syncVideoToPlayhead());

        // Escuta mudanças manuais da agulha (scrubbing)
        STATE.on("timelinePlayheadChanged", () => this.syncVideoToPlayhead());

        // Fotos podem carregar depois da timeline: recompõe quando a lista chega
        STATE.on("photosUpdated", () => this.syncVideoToPlayhead());

        // Sincroniza o viewport caso as propriedades ou zoom de preview mudem
        STATE.on("timelinePropertiesChanged", () => syncProgramViewport());
        STATE.on("previewZoomChanged", () => syncProgramViewport());

        // Atualiza o overlay de transformações quando a seleção muda
        STATE.on("timelineSelectionChanged", () => this.syncVideoToPlayhead());

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
            const setProgramFocus = () => {
                if (window.activeFocusedPlayer !== "program") {
                    window.activeFocusedPlayer = "program";
                    console.log("[Player] Foco do teclado definido para PROGRAM");
                }
            };
            panel.addEventListener("click", setProgramFocus, true);
            panel.addEventListener("mousedown", setProgramFocus, true);
        }

        STATE.on("playerPlayed", (sender) => {
            if (sender !== "program") {
                this.pause();
            }
        });

        // Inicializa controle de zoom livre, pan/scroll e minimapa
        this.initProgramZoomAndPan();
    }

    initProgramZoomAndPan() {
        const wrapper = this.el("program-video-wrapper");
        const minimap = this.el("program-player-minimap");
        if (!wrapper) return;

        let isSpacePressed = false;
        let isPanning = false;
        let panStartX = 0;
        let panStartY = 0;
        let initialPanX = 0;
        let initialPanY = 0;

        // 1. Zoom livre com Shift + Wheel e Pan/Scroll com Wheel comum
        wrapper.addEventListener("wheel", (e) => {
            const tw = TIMELINE_STATE?.width || 1920;
            const th = TIMELINE_STATE?.height || 1080;
            const PAD = 16;
            const availW = Math.max(0, wrapper.clientWidth - PAD * 2);
            const availH = Math.max(0, wrapper.clientHeight - PAD * 2);
            const fitScale = (availW > 0 && availH > 0) ? Math.min(availW / tw, availH / th) : 0.5;
            const zoom = TIMELINE_STATE?.previewZoom || "fit";
            let scale = (zoom === "fit") ? fitScale : Number(zoom);
            if (isNaN(scale) || scale <= 0) scale = fitScale;

            if (e.shiftKey) {
                // ZOOM LIVRE (Focalizado na posição do cursor)
                e.preventDefault();
                e.stopPropagation();

                const delta = -e.deltaY;
                const factor = delta > 0 ? 1.15 : (1 / 1.15);
                let targetScale = scale * factor;

                // Limita zoom entre 10% (0.10) e 1000% (10.0)
                targetScale = Math.max(0.10, Math.min(10.0, targetScale));

                const rect = wrapper.getBoundingClientRect();
                const mouseOffsetX = e.clientX - (rect.left + rect.width / 2);
                const mouseOffsetY = e.clientY - (rect.top + rect.height / 2);

                const curPanX = TIMELINE_STATE?.previewPanX || 0;
                const curPanY = TIMELINE_STATE?.previewPanY || 0;

                // Ponto na imagem antes do zoom
                const pointX = (mouseOffsetX - curPanX) / scale;
                const pointY = (mouseOffsetY - curPanY) / scale;

                // Novo pan para manter o mesmo ponto sob o cursor
                let newPanX = mouseOffsetX - pointX * targetScale;
                let newPanY = mouseOffsetY - pointY * targetScale;

                const newVW = Math.round(tw * targetScale);
                const newVH = Math.round(th * targetScale);
                const maxPanX = Math.max(0, (newVW - wrapper.clientWidth) / 2);
                const maxPanY = Math.max(0, (newVH - wrapper.clientHeight) / 2);

                newPanX = Math.max(-maxPanX, Math.min(maxPanX, newPanX));
                newPanY = Math.max(-maxPanY, Math.min(maxPanY, newPanY));

                if (newVW <= wrapper.clientWidth) newPanX = 0;
                if (newVH <= wrapper.clientHeight) newPanY = 0;

                if (TIMELINE_STATE) {
                    TIMELINE_STATE.previewZoom = parseFloat(targetScale.toFixed(3));
                    TIMELINE_STATE.previewPanX = newPanX;
                    TIMELINE_STATE.previewPanY = newPanY;
                }

                STATE.emit("previewZoomChanged", TIMELINE_STATE.previewZoom);
                syncProgramViewport();
                showProgramScrollbarsTemporarily();
                if (window.triggerAutosave) window.triggerAutosave();
            } else {
                // PAN / SCROLL COM WHEEL COMUM
                const vW = Math.round(tw * scale);
                const vH = Math.round(th * scale);
                const wW = wrapper.clientWidth;
                const wH = wrapper.clientHeight;

                const overflowX = vW > wW + 2;
                const overflowY = vH > wH + 2;

                if (overflowX || overflowY) {
                    e.preventDefault();
                    e.stopPropagation();

                    let curPanX = TIMELINE_STATE?.previewPanX || 0;
                    let curPanY = TIMELINE_STATE?.previewPanY || 0;

                    const maxPanX = overflowX ? Math.max(0, (vW - wW) / 2) : 0;
                    const maxPanY = overflowY ? Math.max(0, (vH - wH) / 2) : 0;

                    if (e.altKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                        // Rolagem Horizontal
                        const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
                        curPanX -= dx * 0.8;
                    } else {
                        // Rolagem Vertical
                        if (overflowY) {
                            curPanY -= e.deltaY * 0.8;
                        } else if (overflowX) {
                            // Se só houver transbordo horizontal, roda vertical rola em X
                            curPanX -= e.deltaY * 0.8;
                        }
                    }

                    curPanX = Math.max(-maxPanX, Math.min(maxPanX, curPanX));
                    curPanY = Math.max(-maxPanY, Math.min(maxPanY, curPanY));

                    if (TIMELINE_STATE) {
                        TIMELINE_STATE.previewPanX = curPanX;
                        TIMELINE_STATE.previewPanY = curPanY;
                    }

                    syncProgramViewport();
                    showProgramScrollbarsTemporarily();
                }
            }
        }, { passive: false });

        // 2. Pan por Arraste (Botão do meio, Espaço+Drag, ou Drag quando ampliado)
        wrapper.addEventListener("mousedown", (e) => {
            if (e.target.closest("#program-player-minimap")) return;
            if (e.target.closest(".transform-handle") || e.target.closest(".transform-handle-rot")) {
                if (!isSpacePressed && e.button !== 1) return;
            }

            const isMiddle = e.button === 1;
            const isLeft = e.button === 0;

            const tw = TIMELINE_STATE?.width || 1920;
            const th = TIMELINE_STATE?.height || 1080;
            const PAD = 16;
            const availW = Math.max(0, wrapper.clientWidth - PAD * 2);
            const availH = Math.max(0, wrapper.clientHeight - PAD * 2);
            const fitScale = (availW > 0 && availH > 0) ? Math.min(availW / tw, availH / th) : 0.5;
            const zoom = TIMELINE_STATE?.previewZoom || "fit";
            const scale = (zoom === "fit") ? fitScale : Number(zoom);
            const vW = Math.round(tw * scale);
            const vH = Math.round(th * scale);
            const hasOverflow = (vW > wrapper.clientWidth || vH > wrapper.clientHeight);
            const isHandle = e.target.closest(".transform-handle") || e.target.closest(".transform-handle-rot");
            if (isMiddle || (isLeft && (isSpacePressed || (hasOverflow && !isHandle)))) {
                isPanning = true;
                panStartX = e.clientX;
                panStartY = e.clientY;
                initialPanX = TIMELINE_STATE?.previewPanX || 0;
                initialPanY = TIMELINE_STATE?.previewPanY || 0;
                wrapper.classList.add("is-panning");
                showProgramScrollbarsTemporarily();
                e.preventDefault();
                e.stopPropagation();
            }
        });

        if (typeof window !== "undefined") {
            window.addEventListener("mousemove", (e) => {
                if (!isPanning) return;
                const tw = TIMELINE_STATE?.width || 1920;
                const th = TIMELINE_STATE?.height || 1080;
                const PAD = 16;
                const availW = Math.max(0, wrapper.clientWidth - PAD * 2);
                const availH = Math.max(0, wrapper.clientHeight - PAD * 2);
                const fitScale = (availW > 0 && availH > 0) ? Math.min(availW / tw, availH / th) : 0.5;
                const zoom = TIMELINE_STATE?.previewZoom || "fit";
                const scale = (zoom === "fit") ? fitScale : Number(zoom);
                const vW = Math.round(tw * scale);
                const vH = Math.round(th * scale);

                const maxPanX = Math.max(0, (vW - wrapper.clientWidth) / 2);
                const maxPanY = Math.max(0, (vH - wrapper.clientHeight) / 2);

                const dx = e.clientX - panStartX;
                const dy = e.clientY - panStartY;

                let newPanX = initialPanX + dx;
                let newPanY = initialPanY + dy;

                newPanX = Math.max(-maxPanX, Math.min(maxPanX, newPanX));
                newPanY = Math.max(-maxPanY, Math.min(maxPanY, newPanY));

                if (TIMELINE_STATE) {
                    TIMELINE_STATE.previewPanX = newPanX;
                    TIMELINE_STATE.previewPanY = newPanY;
                }

                syncProgramViewport();
                showProgramScrollbarsTemporarily();
            });

            window.addEventListener("mouseup", () => {
                if (isPanning) {
                    isPanning = false;
                    wrapper.classList.remove("is-panning");
                    if (window.triggerAutosave) window.triggerAutosave();
                }
            });

            // 3. Teclado: Espaço para Pan
            window.addEventListener("keydown", (e) => {
                if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
                if (e.code === "Space" && !isSpacePressed && !e.repeat) {
                    if (window.activeFocusedPlayer === "program" || wrapper.matches(":hover")) {
                        isSpacePressed = true;
                        wrapper.classList.add("space-mode");
                    }
                }
            });

            window.addEventListener("keyup", (e) => {
                if (e.code === "Space") {
                    isSpacePressed = false;
                    wrapper.classList.remove("space-mode");
                }
            });
        }

        // 4. Interatividade do Minimapa (Clique e Arraste)
        if (minimap) {
            let isMinimapDragging = false;

            const handleMinimapNavigation = (e) => {
                const canvas = getActiveElement("program-minimap-canvas");
                if (!canvas) return;

                const mmRect = minimap.getBoundingClientRect();
                const clickX = e.clientX - mmRect.left;
                const clickY = e.clientY - mmRect.top;

                const tw = TIMELINE_STATE?.width || 1920;
                const th = TIMELINE_STATE?.height || 1080;
                const PAD = 16;
                const availW = Math.max(0, wrapper.clientWidth - PAD * 2);
                const availH = Math.max(0, wrapper.clientHeight - PAD * 2);
                const fitScale = (availW > 0 && availH > 0) ? Math.min(availW / tw, availH / th) : 0.5;
                const zoom = TIMELINE_STATE?.previewZoom || "fit";
                const scale = (zoom === "fit") ? fitScale : Number(zoom);

                const mw = canvas.width;
                const mh = canvas.height;
                const aspect = tw / th;
                const mAspect = mw / mh;
                let dw, dh, dx, dy;
                if (aspect > mAspect) {
                    dw = mw;
                    dh = mw / aspect;
                    dx = 0;
                    dy = (mh - dh) / 2;
                } else {
                    dh = mh;
                    dw = mh * aspect;
                    dx = (mw - dw) / 2;
                    dy = 0;
                }

                // Normalizado de 0 a 1 dentro do enquadramento no minimapa
                const normX = Math.max(0, Math.min(1, (clickX - dx) / dw));
                const normY = Math.max(0, Math.min(1, (clickY - dy) / dh));

                // Alvo no pan
                const vW = Math.round(tw * scale);
                const vH = Math.round(th * scale);
                const maxPanX = Math.max(0, (vW - wrapper.clientWidth) / 2);
                const maxPanY = Math.max(0, (vH - wrapper.clientHeight) / 2);

                let targetPanX = -(normX - 0.5) * tw * scale;
                let targetPanY = -(normY - 0.5) * th * scale;

                targetPanX = Math.max(-maxPanX, Math.min(maxPanX, targetPanX));
                targetPanY = Math.max(-maxPanY, Math.min(maxPanY, targetPanY));

                if (TIMELINE_STATE) {
                    TIMELINE_STATE.previewPanX = targetPanX;
                    TIMELINE_STATE.previewPanY = targetPanY;
                }

                syncProgramViewport();
                showProgramScrollbarsTemporarily();
            };

            minimap.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                isMinimapDragging = true;
                handleMinimapNavigation(e);
            });

            minimap.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });

            minimap.addEventListener("mouseup", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });

            minimap.addEventListener("dblclick", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });

            if (typeof window !== "undefined") {
                window.addEventListener("mousemove", (e) => {
                    if (isMinimapDragging) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleMinimapNavigation(e);
                    }
                });

                window.addEventListener("mouseup", (e) => {
                    if (isMinimapDragging) {
                        e.preventDefault();
                        e.stopPropagation();
                        isMinimapDragging = false;
                        if (window.triggerAutosave) window.triggerAutosave();
                    }
                }, true);
            }
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
            this.play(1.0);
        }
    }

    play(speed = 1.0) {
        this.playbackSpeed = speed;
        this.jklState = speed >= 0 ? 'L' : 'J';
        this.isPlaying = true;

        STATE.emit("playerPlayed", "program");

        const btnPlay = this.el("btn-program-play");
        if (btnPlay) btnPlay.innerHTML = `<i class="fa-solid fa-pause"></i>`;

        if (this.playRequest) {
            cancelAnimationFrame(this.playRequest);
            this.playRequest = null;
        }

        let lastTime = performance.now();
        const step = () => {
            if (!this.isPlaying) return;
            const now = performance.now();
            const elapsedSecs = (now - lastTime) / 1000;
            lastTime = now;

            const maxDur = this.getDurationFrames();
            const fpsVal = TIMELINE_STATE?.fps || 24;

            if (this.playbackSpeed > 0) {
                if (TIMELINE_STATE.playheadFrame >= maxDur && maxDur > 0) {
                    this.pause();
                    TIMELINE_STATE.setPlayheadFrame(maxDur);
                    return;
                }
                const elapsedFrames = elapsedSecs * fpsVal * this.playbackSpeed;
                TIMELINE_STATE.setPlayheadFrame(Math.min(maxDur, TIMELINE_STATE.playheadFrame + elapsedFrames));
            } else if (this.playbackSpeed < 0) {
                if (TIMELINE_STATE.playheadFrame <= 0) {
                    this.pause();
                    TIMELINE_STATE.setPlayheadFrame(0);
                    return;
                }
                const elapsedFrames = elapsedSecs * fpsVal * Math.abs(this.playbackSpeed);
                TIMELINE_STATE.setPlayheadFrame(Math.max(0, TIMELINE_STATE.playheadFrame - elapsedFrames));
            }

            // Heartbeat de atividade do editor para o backend
            if (!this.lastHeartbeatTime || now - this.lastHeartbeatTime > 2000) {
                this.lastHeartbeatTime = now;
                fetch("/api/editor/heartbeat", { method: "POST" }).catch(() => {});
            }

            this.playRequest = requestAnimationFrame(step);
        };
        this.playRequest = requestAnimationFrame(step);
    }

    pause() {
        this.isPlaying = false;
        this.playbackSpeed = 1.0;
        this.jklState = 'K';
        this.jklIndex = 0;
        if (this.playRequest) {
            cancelAnimationFrame(this.playRequest);
            this.playRequest = null;
        }

        const btnPlay = this.el("btn-program-play");
        if (btnPlay) btnPlay.innerHTML = `<i class="fa-solid fa-play"></i>`;

        this._videoPool().forEach(el => { if (!el.paused) el.pause(); });        // Pausa também as pistas de áudio dedicadas
        if (this.audioPool) {
            Object.values(this.audioPool).forEach(el => {
                if (!el.paused) el.pause();
            });
        }
    }

    shuttleForward() {
        if (!this.isPlaying || this.jklState === 'K') {
            this.jklState = 'L';
            this.jklIndex = 0;
            this.play(this.speedsForward[0]);
        } else if (this.jklState === 'L') {
            this.jklIndex = Math.min(this.jklIndex + 1, this.speedsForward.length - 1);
            this.play(this.speedsForward[this.jklIndex]);
        } else if (this.jklState === 'J') {
            if (this.jklIndex > 0) {
                this.jklIndex--;
                this.play(this.speedsReverse[this.jklIndex]);
            } else {
                this.jklState = 'L';
                this.jklIndex = 0;
                this.play(this.speedsForward[0]);
            }
        }
        this.showShuttleOsd(this.jklState === 'L' ? `${this.speedsForward[this.jklIndex]}x` : `${this.speedsReverse[this.jklIndex]}x`);
    }

    shuttleReverse() {
        if (!this.isPlaying || this.jklState === 'K') {
            this.jklState = 'J';
            this.jklIndex = 0;
            this.play(this.speedsReverse[0]);
        } else if (this.jklState === 'J') {
            this.jklIndex = Math.min(this.jklIndex + 1, this.speedsReverse.length - 1);
            this.play(this.speedsReverse[this.jklIndex]);
        } else if (this.jklState === 'L') {
            if (this.jklIndex > 0) {
                this.jklIndex--;
                this.play(this.speedsForward[this.jklIndex]);
            } else {
                this.jklState = 'J';
                this.jklIndex = 0;
                this.play(this.speedsReverse[0]);
            }
        }
        this.showShuttleOsd(this.jklState === 'J' ? `${this.speedsReverse[this.jklIndex]}x` : `${this.speedsForward[this.jklIndex]}x`);
    }

    shuttleStop() {
        this.pause();
        this.showShuttleOsd("Pausado");
    }

    showShuttleOsd(text) {
        const panel = this.el("program-player-panel");
        if (!panel) return;
        let osd = panel.querySelector(".player-shuttle-osd");
        if (!osd) {
            osd = document.createElement("div");
            osd.className = "player-shuttle-osd";
            osd.style.cssText = "position:absolute; top:45px; left:50%; transform:translateX(-50%); background:rgba(18,18,24,0.85); color:#a855f7; padding:4px 12px; border-radius:12px; font-size:11px; font-weight:700; font-family:'Outfit',sans-serif; letter-spacing:0.5px; border:1px solid rgba(168,85,247,0.4); backdrop-filter:blur(8px); box-shadow:0 4px 12px rgba(0,0,0,0.5); pointer-events:none; z-index:99; transition:opacity 0.2s ease; opacity:0;";
            panel.appendChild(osd);
        }
        osd.textContent = text;
        osd.style.opacity = "1";
        if (this._osdTimeout) clearTimeout(this._osdTimeout);
        this._osdTimeout = setTimeout(() => {
            if (osd) osd.style.opacity = "0";
        }, 1200);
    }

    syncVideoToPlayhead() {
        try {
            syncProgramViewport();

        const currentFrame = TIMELINE_STATE.playheadFrame;
        const durationFrames = this.getDurationFrames();

        // Atualiza tempos de scrubber
        const curTimeEl = this.el("program-current-time");
        const fpsVal = TIMELINE_STATE?.fps || 24;
        if (curTimeEl) curTimeEl.textContent = formatTimecode(currentFrame / fpsVal, fpsVal);

        const durTimeEl = this.el("program-duration-time");
        if (durTimeEl) durTimeEl.textContent = formatTimecode(durationFrames / fpsVal, fpsVal);

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
        // Camada base = clipe da pista de vídeo MAIS BAIXA no playhead (geralmente falas).
        // Camada de sobreposição = clipe da pista MAIS ALTA acima da base (cobertura b-roll).
        const videoTracks = TIMELINE_STATE.getVideoTracks().filter(t => !TIMELINE_STATE.muteHiddenTracksPlayback || !t.hidden); // ordem visual: topo → base
        const clipAtPlayhead = (trackId) => cuts.find(c =>
            c.track === trackId &&
            currentFrame >= c.timelineStartFrame &&
            currentFrame < (c.timelineStartFrame + (c.outFrame - c.inFrame))
        );

        let baseCut = null;
        for (let i = videoTracks.length - 1; i >= 0; i--) { // de baixo para cima
            const hit = clipAtPlayhead(videoTracks[i].id);
            if (hit) {
                baseCut = hit;
                break;
            }
        }

        let overlayCut = null;
        for (let i = 0; i < videoTracks.length; i++) { // de cima para baixo
            const hit = clipAtPlayhead(videoTracks[i].id);
            if (hit && (!baseCut || hit.id !== baseCut.id)) {
                overlayCut = hit;
                break;
            }
        }

        // ────────── COMPOSIÇÃO EM BUFFERS (VIRADA DE CLIPE SEM PISCA) ──────────
        // Cada camada (base / sobreposição) é servida por um buffer <video> do pool.
        // Virar de clipe = revelar OUTRO buffer, que já está com o arquivo aberto e parado
        // no primeiro frame do clipe. Dar src/load() no elemento que está no ar zera o
        // decoder e o <video> pinta preto até o arquivo novo abrir — era essa a piscada.
        const pool = this._videoPool();
        const claimed = new Set();
        const liveEls = new Set();
        if (!this._layerShown) this._layerShown = { base: null, overlay: null };

        // Escolhe o buffer que vai exibir um clipe, nesta ordem:
        // 1) o buffer que já contém o clipe (pré-carregado ou já no ar) — troca instantânea;
        // 2) o buffer no ar da camada, quando o corte é contíguo no mesmo arquivo
        //    (razor cut): continua rodando sem seek, emenda perfeita;
        // 3) um buffer ocioso — preferindo um que já tenha o mesmo arquivo carregado.
        const claimBuffer = (cut, layerKey) => {
            const held = pool.find(e => e.dataset.activeClipId === String(cut.id));
            if (held && !claimed.has(held)) { claimed.add(held); return held; }

            const src = this._videoSrcForCut(cut);
            const target = this._targetSecondsFor(cut, currentFrame);

            // O buffer no ar já está com a imagem certa: emendar nele é sempre melhor que
            // abrir o arquivo de novo.
            const shown = this._layerShown[layerKey];
            if (shown && !claimed.has(shown) && shown.getAttribute("src") &&
                shown.dataset.loadedSrc === src &&
                Math.abs(shown.currentTime - target) < BUFFER_CONTINUITY_TOLERANCE) {
                claimed.add(shown);
                return shown;
            }

            const otherShown = layerKey === "base" ? this._layerShown.overlay : this._layerShown.base;
            const busy = new Set([this._layerShown.base, this._layerShown.overlay].filter(Boolean));
            const idle = pool.filter(e => !claimed.has(e) && !busy.has(e));
            const el = idle.find(e => e.dataset.loadedSrc === src)
                || idle.find(e => !e.dataset.activeClipId)
                || idle[0]
                || pool.find(e => !claimed.has(e) && e !== otherShown)
                || null;
            if (el) claimed.add(el);
            return el;
        };

        // Prepara a camada e devolve o elemento que deve estar visível AGORA.
        // Clipes de foto (still) não usam <video>: a imagem é composta nas camadas <img>.
        const applyLayer = (cut, layerKey, zIndex) => {
            if (!cut || !this._videoSrcForCut(cut)) {
                this._layerShown[layerKey] = null;
                return null;
            }

            const el = claimBuffer(cut, layerKey);
            if (!el) { this._layerShown[layerKey] = null; return null; }
            liveEls.add(el);

            // Buffer que já está no ar nesta camada não sai por "ainda não está pronto":
            // no pior caso ele segura o quadro anterior por um instante, o que é sempre
            // melhor que apagar a imagem. Só cai fora se o elemento realmente zerou.
            const wasOnAir = this._layerShown[layerKey] === el && el.readyState > 0;
            this._prepareBuffer(el, cut, currentFrame, true);
            el.style.zIndex = String(zIndex);
            this.applyMediaEffects(el, cut, currentFrame);

            const prev = this._layerShown[layerKey];
            if (wasOnAir || this._bufferHasFrame(el, cut, currentFrame) || !prev || el.readyState >= 1) {
                this._layerShown[layerKey] = el;
                return el;
            }

            // Buffer ainda abrindo/posicionando (scrub longo, timeline recém-carregada):
            // segura o último quadro no ar e revela quando houver imagem — nunca preto.
            this._awaitBuffer(el);
            return (prev && prev !== el) ? prev : el;
        };

        const visibleBase = applyLayer(baseCut, "base", 1);
        const visibleOverlay = applyLayer(overlayCut, "overlay", 10);

        // Pré-carrega os próximos clipes nos buffers ociosos: quando o playhead chegar no
        // corte, o arquivo já está aberto e parado no primeiro frame do clipe.
        this._preloadUpcoming(cuts, currentFrame, videoTracks, pool, claimed);

        pool.forEach(el => {
            if (el === visibleBase || el === visibleOverlay) {
                // No ar: z-index, opacidade e play/pause já vieram de applyLayer.
                if (el.style.display !== "block") el.style.display = "block";
                return;
            }
            if (claimed.has(el)) {
                // Buffer reservado (pré-carga, ou camada ainda decodificando): segue
                // renderizado e invisível para o compositor já ter o frame no corte.
                if (el.style.display !== "block") el.style.display = "block";
                el.style.opacity = "0";
                el.style.zIndex = "0";
                if (!liveEls.has(el) && !el.paused) el.pause();
            } else {
                if (el.style.display !== "none") el.style.display = "none";
                if (!el.paused) el.pause();
                el.dataset.activeClipId = "";
            }
        });

        // ────────── CAMADAS DE FOTO (STILL) ──────────
        // imgA = slot base (z-index 2, acima do vídeo base); imgB = slot overlay (z-index 11).
        const imgA = this.el("program-player-photo");
        const imgB = this.el("program-player-photo-b");
        this.applyPhotoSlot(imgA, (baseCut && baseCut.type === "photo") ? baseCut : null, currentFrame, 2);
        this.applyPhotoSlot(imgB, (overlayCut && overlayCut.type === "photo") ? overlayCut : null, currentFrame, 11);

        // Cada pista de áudio tem seu próprio elemento <audio> tocando o clipe sob o playhead
        this.syncAudioTracks(cuts, currentFrame);

        // Atualiza overlay de transformação (Fase 4)
        this.syncTransformOverlay();
        } catch (err) {
            console.warn("[ProgramPlayer] Erro durante syncVideoToPlayhead:", err);
        }
    }

    /**
     * Pool de buffers <video> do Program: 2 camadas no ar (base + sobreposição) e 2 buffers
     * livres para o pré-carregamento do próximo clipe de cada camada. Os buffers extras são
     * criados sob demanda caso o HTML não os traga.
     */
    _videoPool() {
        const ids = ["program-video-a", "program-video-b", "program-video-c", "program-video-d"];
        const mediaContainer = this.el("program-media-viewport") || this.el("program-player-viewport");
        const pool = [];

        ids.forEach(id => {
            let el = this.el(id);
            if (!el && mediaContainer) {
                el = mediaContainer.ownerDocument.createElement("video");
                el.id = id;
                el.preload = "auto";
                el.muted = true;
                el.playsInline = true;
                el.style.cssText = "position:absolute; inset:0; width:100%; height:100%; display:none;";
                mediaContainer.appendChild(el);
            }
            if (!el) return;
            // Ao restaurar um pop-out o workspace limpa o src de todos os <video> do painel:
            // sem zerar o dataset o buffer ficaria "carregado" com um arquivo que saiu.
            if (!el.getAttribute("src") && el.dataset.loadedSrc) {
                el.dataset.loadedSrc = "";
                el.dataset.activeClipId = "";
            }
            pool.push(el);
        });

        // Se um buffer que estava no ar saiu do DOM (pop-out/restauração), esquece a referência.
        if (this._layerShown) {
            ["base", "overlay"].forEach(k => {
                if (this._layerShown[k] && !pool.includes(this._layerShown[k])) this._layerShown[k] = null;
            });
        }
        return pool;
    }

    /** Caminho do arquivo de vídeo de um clipe (null para fotos ou mídia ausente). */
    _videoSrcForCut(cut) {
        if (!cut || cut.type === "photo") return null;
        const videoData = STATE.allVideos.find(v => String(v.id) === String(cut.video_id));
        if (!videoData) return null;
        if (videoData.proxy_path && (videoData.proxy_path.startsWith("/") || videoData.proxy_path.startsWith("http"))) {
            return videoData.proxy_path;
        }
        return `/api/video/${videoData.id}/stream`;
    }

    /** Instante do arquivo (em segundos) correspondente a um frame da timeline. */
    _targetSecondsFor(cut, frame) {
        const fps = TIMELINE_STATE?.fps || 24;
        const inSec = (cut && typeof cut.in === "number" && !isNaN(cut.in)) ? cut.in : 0;
        const startFrame = (cut && typeof cut.timelineStartFrame === "number" && !isNaN(cut.timelineStartFrame)) ? cut.timelineStartFrame : 0;
        const curFrame = (typeof frame === "number" && !isNaN(frame)) ? frame : 0;
        return inSec + ((curFrame - startFrame) / fps);
    }

    /** true quando o buffer já tem o quadro certo decodificado e pode ir ao ar sem piscar. */
    _bufferHasFrame(el, cut, frame) {
        if (!el || !cut) return false;
        if (el.dataset.activeClipId !== String(cut.id)) return false;
        if (el.readyState < 2 /* HAVE_CURRENT_DATA */ || el.seeking) return false;
        return Math.abs(el.currentTime - this._targetSecondsFor(cut, frame)) < 0.5;
    }

    /**
     * Recompõe assim que o buffer terminar de abrir/posicionar. Necessário com o player
     * pausado (frame a frame / scrub), onde não há laço de animação para tentar de novo.
     */
    _awaitBuffer(el) {
        if (!el || el._capiauAwaiting) return;
        el._capiauAwaiting = true;
        const onReady = () => {
            el.removeEventListener("seeked", onReady);
            el.removeEventListener("loadeddata", onReady);
            el.removeEventListener("canplay", onReady);
            el._capiauAwaiting = false;
            this.syncVideoToPlayhead();
        };
        el.addEventListener("seeked", onReady);
        el.addEventListener("loadeddata", onReady);
        el.addEventListener("canplay", onReady);
    }

    /**
     * Deixa um buffer com o arquivo certo, no instante certo.
     * live=false ⇒ pré-carga: abre o arquivo, posiciona no primeiro frame do clipe e fica parado.
     *
     * SINCRONIA SEM SEEK-LOOP: seek "duro" num vídeo em reprodução trava o decoder
     * (~100-300ms), o que aumenta a deriva e dispara o próximo seek. Em reprodução a deriva
     * é corrigida via playbackRate (como nas NLEs); seek duro só em descontinuidade real.
     */
    _prepareBuffer(el, cut, frame, live) {
        const src = this._videoSrcForCut(cut);
        if (!el || !src) return;

        const srcChanged = el.dataset.loadedSrc !== src || !el.getAttribute("src");
        if (srcChanged) {
            el.preload = "auto";
            el.src = src;
            el.dataset.loadedSrc = src;
            el.load();
        }

        const target = this._targetSecondsFor(cut, frame);
        const clipChanged = el.dataset.activeClipId !== String(cut.id);
        if (clipChanged) el.dataset.activeClipId = String(cut.id);

        const drift = el.currentTime - target;

        // SINCRONIA COM VELOCIDADE (shuttle JKL) SEM SEEK-LOOP:
        // Em reprodução, a deriva é corrigida suavemente via playbackRate em torno da
        // velocidade corrente (baseRate); seek duro só em descontinuidade real.
        // Em reverso, o buffer fica pausado e o currentTime acompanha a agulha.
        const baseRate = (this.isPlaying && this.playbackSpeed > 0)
            ? Math.min(4.0, this.playbackSpeed) : 1.0;

        if (srcChanged || (clipChanged && Math.abs(drift) > BUFFER_CONTINUITY_TOLERANCE)) {
            // Buffer entrando num clipe novo: posiciona antes de ir ao ar (está escondido).
            el.currentTime = Math.max(0, target);
            el.playbackRate = baseRate;
        } else if (live && this.isPlaying && this.playbackSpeed > 0) {
            if (Math.abs(drift) > 1.0) {
                el.currentTime = Math.max(0, target);
                el.playbackRate = baseRate;
            } else if (drift > 0.08) {
                el.playbackRate = baseRate * 0.92; // vídeo adiantado: segura levemente
            } else if (drift < -0.08) {
                el.playbackRate = baseRate * 1.08; // vídeo atrasado: acelera levemente
            } else if (el.playbackRate !== baseRate) {
                el.playbackRate = baseRate;
            }
        } else if (live && this.isPlaying && this.playbackSpeed < 0) {
            // Reverse: mantenha o vídeo pausado e atualize currentTime suavemente
            if (!el.seeking && Math.abs(drift) > 0.03) {
                el.currentTime = Math.max(0, target);
            }
        } else if (live) {
            // Pausado (scrub manual): seek preciso é o comportamento esperado
            if (Math.abs(drift) > 0.06) el.currentTime = Math.max(0, target);
            if (el.playbackRate !== 1.0) el.playbackRate = 1.0;
        }

        // Pistas de vídeo são só imagem: o áudio vem das pistas de áudio dedicadas
        el.muted = true;
        if (live && this.isPlaying && this.playbackSpeed > 0) {
            if (el.paused) el.play().catch(() => {});
        } else if (!el.paused) {
            el.pause();
        }
    }

    /**
     * true quando o clipe começa exatamente onde termina, no mesmo arquivo e sem salto de
     * mídia, o clipe que já está no ar — caso em que a virada é só trocar o id do clipe.
     */
    _continuesOnAir(cut, cuts) {
        if (!this._layerShown) return false;
        const onAir = [this._layerShown.base, this._layerShown.overlay]
            .filter(Boolean)
            .map(e => e.dataset.activeClipId);
        if (!onAir.length) return false;

        const prev = cuts.find(c => c.track === cut.track &&
            (c.timelineStartFrame + (c.outFrame - c.inFrame)) === cut.timelineStartFrame);
        if (!prev || !onAir.includes(String(prev.id))) return false;

        const src = this._videoSrcForCut(cut);
        if (!src || this._videoSrcForCut(prev) !== src) return false;

        const fps = TIMELINE_STATE?.fps || 24;
        const prevOutSeconds = prev.in + ((prev.outFrame - prev.inFrame) / fps);
        return Math.abs(prevOutSeconds - cut.in) <= 0.02;
    }

    /**
     * Aquece os buffers ociosos com os próximos clipes das pistas de vídeo, dentro de uma
     * janela de antecedência. É isso que faz o clipe seguinte aparecer já no primeiro frame:
     * no instante do corte não há mais nada a carregar, só revelar o buffer.
     */
    _preloadUpcoming(cuts, currentFrame, videoTracks, pool, claimed) {
        if (!this._layerShown) this._layerShown = { base: null, overlay: null };
        const fps = TIMELINE_STATE?.fps || 24;
        const lookaheadFrames = fps * 3; // ~3 s de antecedência para abrir e posicionar
        const trackIds = new Set(videoTracks.map(t => t.id));
        const busy = new Set([this._layerShown.base, this._layerShown.overlay].filter(Boolean));

        const upcoming = cuts
            .filter(c => trackIds.has(c.track) &&
                         c.timelineStartFrame > currentFrame &&
                         (c.timelineStartFrame - currentFrame) <= lookaheadFrames &&
                         this._videoSrcForCut(c))
            .sort((a, b) => a.timelineStartFrame - b.timelineStartFrame);

        for (const cut of upcoming) {
            // Já aquecido: reserva o buffer, senão a varredura final o daria como ocioso
            // e o descartaria — os clipes ficariam se revezando no mesmo buffer.
            const held = pool.find(e => e.dataset.activeClipId === String(cut.id));
            if (held) { claimed.add(held); continue; }

            // Emenda perfeita (razor cut): o clipe que está no ar é do mesmo arquivo e acaba
            // exatamente onde este começa ⇒ o buffer no ar apenas continua rolando. Aquecer
            // outro buffer só gastaria um decoder e cortaria a reprodução contínua da mídia.
            if (this._continuesOnAir(cut, cuts)) continue;

            const idle = pool.filter(e => !claimed.has(e) && !busy.has(e));
            if (!idle.length) return;

            const src = this._videoSrcForCut(cut);
            const el = idle.find(e => e.dataset.loadedSrc === src)
                || idle.find(e => !e.dataset.activeClipId)
                || idle[0];
            claimed.add(el);
            this._prepareBuffer(el, cut, cut.timelineStartFrame, false);
        }
    }

    /**
     * Compõe uma camada de foto (still) num elemento <img>.
     * cut null ⇒ oculta a camada. Aplica enquadramento/movimento via applyPhotoEffects.
     */
    applyPhotoSlot(imgEl, cut, currentFrame, zIndex) {
        if (!imgEl) return;
        if (!cut) {
            if (imgEl.style.display !== "none") imgEl.style.display = "none";
            imgEl.dataset.activeClipId = "";
            return;
        }
        const photo = STATE.allPhotos.find(p => String(p.id) === String(cut.photo_id));
        if (!photo) {
            if (imgEl.style.display !== "none") imgEl.style.display = "none";
            imgEl.dataset.activeClipId = "";
            return;
        }
        const src = (photo.proxy_path && (photo.proxy_path.startsWith('/') || photo.proxy_path.startsWith('http')))
            ? photo.proxy_path 
            : `/api/photo/${photo.id}/file`;
        if (imgEl.dataset.loadedSrc !== src) {
            imgEl.src = src;
            imgEl.dataset.loadedSrc = src;
        }
        imgEl.dataset.activeClipId = String(cut.id);
        imgEl.style.zIndex = String(zIndex);
        if (imgEl.style.display !== "block") imgEl.style.display = "block";
        this.applyMediaEffects(imgEl, cut, currentFrame);
    }

    /**
     * Aplica enquadramento (fit/fill), transformações geométricas (posição, escala, rotação, opacidade),
     * crop/movimento (Ken Burns) e filtros de cor (brilho, contraste, saturação, matiz, sépia, grayscale, blur)
     * e fades à foto ou vídeo, derivando o progresso a partir do frame atual.
     */
    applyMediaEffects(el, cut, currentFrame) {
        if (!el || !cut) return;
        const effects = cut.effects || [];
        const fps = TIMELINE_STATE.fps || 24;
        const durFrames = Math.max(1, cut.outFrame - cut.inFrame);
        const p = Math.min(1, Math.max(0, (currentFrame - cut.timelineStartFrame) / durFrames));

        // 1. Enquadramento (fit/fill)
        const fit = effects.find(e => e.type === "fit");
        const fitMode = fit ? fit.mode : "fill";
        el.style.objectFit = (fitMode === "fit") ? "contain" : "cover";
        el.style.transformOrigin = "center center";

        // 2. Transformações Geométricas e Movimento (Ken Burns)
        const kb = effects.find(e => e.type === "ken_burns");
        const tf = effects.find(e => e.type === "transform") || {};

        let scale = 1.0;
        let tx = 0;
        let ty = 0;
        let rotation = 0;
        let baseOpacity = 1.0;

        if (!tf.disabled) {
            scale = tf.scale !== undefined ? tf.scale : 1.0;
            tx = tf.x !== undefined ? tf.x : 0;
            ty = tf.y !== undefined ? tf.y : 0;
            rotation = tf.rotation !== undefined ? tf.rotation : 0;
            baseOpacity = tf.opacity !== undefined ? tf.opacity : 1.0;
        }

        if (kb && !kb.disabled && cut.type === "photo") {
            const ease = kb.easing === "easeInOut"
                ? (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)
                : p;
            const from = kb.from || {}, to = kb.to || {};
            const fs = from.scale ?? 1, ts = to.scale ?? 1;
            const fx = from.x ?? 0, txx = to.x ?? 0;
            const fy = from.y ?? 0, tyy = to.y ?? 0;
            scale = fs + (ts - fs) * ease;
            tx = fx + (txx - fx) * ease;
            ty = fy + (tyy - fy) * ease;
        }

        el.style.transform = `translate(${tx}%, ${ty}%) scale(${scale}) rotate(${rotation}deg)`;

        // 3. Filtros de Cor
        const col = effects.find(e => e.type === "color") || {};
        let brightness = 0, contrast = 0, saturation = 100, hue = 0, sepia = 0, grayscale = 0, blur = 0;
        
        if (!col.disabled) {
            brightness = col.brightness !== undefined ? col.brightness : 0;
            contrast = col.contrast !== undefined ? col.contrast : 0;
            saturation = col.saturation !== undefined ? col.saturation : 100;
            hue = col.hue !== undefined ? col.hue : 0;
            sepia = col.sepia !== undefined ? col.sepia : 0;
            grayscale = col.grayscale !== undefined ? col.grayscale : 0;
            blur = col.blur !== undefined ? col.blur : 0;
        }

        const cssFilter = `
            brightness(${1.0 + brightness / 100})
            contrast(${1.0 + contrast / 100})
            saturate(${saturation / 100})
            hue-rotate(${hue}deg)
            sepia(${sepia}%)
            grayscale(${grayscale}%)
            blur(${blur}px)
        `.trim().replace(/\s+/g, ' ');
        el.style.filter = cssFilter;

        // 4. Fades (dissolve) de entrada/saída por opacidade
        let fadeOpacity = 1.0;
        const tIn = (currentFrame - (cut.timelineStartFrame || 0)) / fps;                       // s desde o início
        const tOut = ((cut.timelineStartFrame || 0) + durFrames - currentFrame) / fps;          // s até o fim
        effects.filter(e => e && e.type === "crossfade").forEach(cf => {
            if (cf.disabled) return;
            const d = Math.max(0.05, cf.duration_s || 0.5);
            if (cf.side === "in" && tIn < d) {
                const p = Math.max(0, Math.min(1, tIn / d));
                const factor = evaluateFadeCurve(p, cf.curve || "linear", cf.tension || 0);
                if (typeof factor === "number" && Number.isFinite(factor)) fadeOpacity = Math.min(fadeOpacity, factor);
            }
            if (cf.side === "out" && tOut < d) {
                const p = Math.max(0, Math.min(1, tOut / d));
                const factor = evaluateFadeCurve(p, cf.curve || "linear", cf.tension || 0);
                if (typeof factor === "number" && Number.isFinite(factor)) fadeOpacity = Math.min(fadeOpacity, factor);
            }
        });
        
        const rawFinalOpacity = baseOpacity * fadeOpacity;
        el.style.opacity = String((typeof rawFinalOpacity === "number" && Number.isFinite(rawFinalOpacity)) ? Math.max(0, Math.min(1, rawFinalOpacity)) : 1.0);

        // 5. Recorte Dinâmico (Crop)
        const cropEffect = effects.find(e => e.type === "crop") || {};
        let cropTop = 0, cropRight = 0, cropBottom = 0, cropLeft = 0;

        if (!cropEffect.disabled) {
            cropTop = cropEffect.top !== undefined ? cropEffect.top : 0;
            cropRight = cropEffect.right !== undefined ? cropEffect.right : 0;
            cropBottom = cropEffect.bottom !== undefined ? cropEffect.bottom : 0;
            cropLeft = cropEffect.left !== undefined ? cropEffect.left : 0;
        }

        if (cropTop > 0 || cropRight > 0 || cropBottom > 0 || cropLeft > 0) {
            el.style.clipPath = `inset(${cropTop}% ${cropRight}% ${cropBottom}% ${cropLeft}%)`;
        } else {
            el.style.clipPath = "";
        }
    }

    /** Elemento <audio> dedicado de uma pista (criado sob demanda, fora do DOM visível). */
    getAudioElement(trackId) {
        if (!this.audioPool) this.audioPool = {};
        if (!this.audioPool[trackId]) {
            const el = document.createElement("audio");
            el.preload = "auto";
            el.dataset.trackId = trackId;
            document.body.appendChild(el);
            // F4: WAV tratado que falhe (404, arquivo apagado, rede) precisa ser visivel
            // e devolver o clipe ao original - nunca silencio.
            el.addEventListener("error", () => this._aoErroElementoAudio(el));
            this.audioPool[trackId] = el;
        }
        return this.audioPool[trackId];
    }

    syncAudioTracks(cuts, currentFrame) {
        const audioTracks = TIMELINE_STATE.tracks.filter(t => t.kind === "audio");
        const seen = new Set();

        audioTracks.forEach(track => {
            seen.add(track.id);
            const el = this.getAudioElement(track.id);

            // Se a pista de áudio estiver oculta e o mute de reprodução estiver ativo
            if (track.hidden && TIMELINE_STATE.muteHiddenTracksPlayback) {
                if (!el.paused) el.pause();
                el.dataset.activeClipId = "";
                return;
            }

            const cut = cuts.find(c =>
                c.track === track.id &&
                currentFrame >= c.timelineStartFrame &&
                currentFrame < (c.timelineStartFrame + (c.outFrame - c.inFrame))
            );

            if (!cut) {
                if (!el.paused) el.pause();
                el.dataset.activeClipId = "";
                return;
            }

            const videoData = STATE.allVideos.find(v => String(v.id) === String(cut.video_id));
            if (!videoData) {
                if (!el.paused) el.pause();
                return;
            }

            // F4 - A/B do contrato: WAV tratado quando registrado para o clipe, original caso
            // contrario. Com nenhum registro, src e fluxo são EXATAMENTE os de antes.
            const alvo = this._fonteAudioEfetiva(cut, videoData);
            const audioSrc = alvo.src;

            // Troca suave que deixou de corresponder ao pedido atual (A/B reverteu,
            // clipe mudou): aborta; uma nova é agendada abaixo se ainda houver troca.
            const pendente = this._trocaAudioPendente(track.id);
            if (pendente && (pendente.destino !== audioSrc || pendente.clipId !== String(cut.id))) {
                this._cancelarTrocaAudio(track.id);
            }

            const srcChanged = el.dataset.loadedSrc !== audioSrc;
            if (srcChanged) {
                if (this._podeTrocarSuave(el)) {
                    // Em reprodução NUNCA dar src/load() no elemento que está no ar (zera o
                    // decoder e emudece): prepara o elemento par e corta quando estiver no
                    // ponto certo — mesmo mecanismo dos buffers de vídeo (_awaitBuffer).
                    this._iniciarTrocaSuave(track.id, el, alvo, cut);
                } else {
                    el.dataset.audioTratado = alvo.tratado ? "1" : "";
                    el.src = audioSrc;
                    el.dataset.loadedSrc = audioSrc;
                    el.load();
                }
            }

            const offsetFrames = currentFrame - cut.timelineStartFrame;
            // Base temporal da fonte EM USO: o WAV derivado cobre exatamente o trecho
            // [in, out] da mesma fonte, então seu tempo 0 é o In do clipe (base 0); o
            // arquivo original é a mídia completa (base = cut.in). Mapa direto, sem salto.
            const baseFonte = el.dataset.audioTratado === "1" ? 0 : cut.in;
            const targetSeconds = baseFonte + (offsetFrames / (TIMELINE_STATE?.fps || 24));
            const clipChanged = el.dataset.activeClipId !== String(cut.id);
            if (clipChanged) el.dataset.activeClipId = String(cut.id);

            const drift = el.currentTime - targetSeconds;

            // Deriva no áudio: nudge de rate suave (3% não altera o pitch de forma audível)
            // e seek duro apenas em descontinuidade real — seeks frequentes geram clicks.
            const isHighSpeedOrReverse = this.playbackSpeed > 2.0 || this.playbackSpeed < 0;
            if (srcChanged || clipChanged || Math.abs(drift) > 0.5) {
                el.currentTime = Math.max(0, targetSeconds);
                el.playbackRate = 1.0;
            } else if (this.isPlaying && this.playbackSpeed > 0 && !isHighSpeedOrReverse) {
                const targetRate = Math.min(2.0, this.playbackSpeed);
                if (drift > 0.06) el.playbackRate = targetRate * 0.97;
                else if (drift < -0.06) el.playbackRate = targetRate * 1.03;
                else if (el.playbackRate !== targetRate) el.playbackRate = targetRate;
            } else {
                if (Math.abs(drift) > 0.06) el.currentTime = Math.max(0, targetSeconds);
                if (el.playbackRate !== 1.0) el.playbackRate = 1.0;
            }

            // Volume do clipe individual (suporta level ou gain, garantindo número finito)
            const clipVolEff = (cut.effects || []).find(e => e && e.type === "volume");
            let clipVol = 1.0;
            if (clipVolEff && !clipVolEff.disabled) {
                const rawVol = clipVolEff.level !== undefined ? clipVolEff.level : (clipVolEff.gain !== undefined ? clipVolEff.gain : 1.0);
                clipVol = (typeof rawVol === "number" && Number.isFinite(rawVol)) ? rawVol : 1.0;
            }

            // Audio Fade-in / Fade-out duration
            let fadeVol = 1.0;
            const fpsVal = TIMELINE_STATE?.fps || 24;
            const durCut = Math.max(1, ((cut.outFrame || 0) - (cut.inFrame || 0)) || (Math.round(((cut.out || 0) - (cut.in || 0)) * fpsVal)));
            const tIn = (currentFrame - (cut.timelineStartFrame || 0)) / fpsVal; // s desde o início
            const tOut = ((cut.timelineStartFrame || 0) + durCut - currentFrame) / fpsVal; // s até o fim
            const effects = cut.effects || [];
            effects.filter(e => e && e.type === "crossfade").forEach(cf => {
                if (cf.disabled) return;
                const d = Math.max(0.05, cf.duration_s || 0.5);
                if (cf.side === "in" && tIn < d) {
                    const p = Math.max(0, Math.min(1, tIn / d));
                    const factor = evaluateFadeCurve(p, cf.curve || "linear", cf.tension || 0);
                    if (typeof factor === "number" && Number.isFinite(factor)) fadeVol = Math.min(fadeVol, factor);
                }
                if (cf.side === "out" && tOut < d) {
                    const p = Math.max(0, Math.min(1, tOut / d));
                    const factor = evaluateFadeCurve(p, cf.curve || "linear", cf.tension || 0);
                    if (typeof factor === "number" && Number.isFinite(factor)) fadeVol = Math.min(fadeVol, factor);
                }
            });

            const vol = (track.volume !== undefined && typeof track.volume === "number" && Number.isFinite(track.volume)) ? track.volume : 1.0;
            const rawFinalVol = vol * clipVol * fadeVol;
            const finalVol = (typeof rawFinalVol === "number" && Number.isFinite(rawFinalVol)) ? Math.max(0, Math.min(1.0, rawFinalVol)) : 1.0;
            el.volume = (track.muted || isHighSpeedOrReverse) ? 0 : finalVol;
            if (this.isPlaying && this.playbackSpeed > 0 && !isHighSpeedOrReverse && el.paused) {
                this._retomarContextoAudioAoVivo(); // AudioContext acorda no mesmo caminho do play
                el.play().catch(() => {});
            } else if ((!this.isPlaying || isHighSpeedOrReverse) && !el.paused) {
                el.pause();
            }

            // Ajustes de áudio AO VIVO (Etapa 2): só roteia o elemento pelo grafo quando o
            // clipe tem audio_eq ou audio_dynamics ATIVO; sem efeito, segue no caminho normal.
            // O volume/fade/mute acima não muda: el.volume atua ANTES do grafo e não é duplicado.
            if (this._efeitosAudioAoVivo(effects)) this.aplicarAudioAoVivo(el, effects);
            else this.liberarAudioAoVivo(el);

            // F4: conduz a troca tratado/original pendente — prepara o par e corta só
            // quando ele está carregado e posicionado (sem salto de posição nem silêncio).
            this._dirigirTrocaSuave(track.id, cut, currentFrame);
        });

        if (this.audioPool) {
            Object.keys(this.audioPool).forEach(tid => {
                if (!seen.has(tid)) {
                    const el = this.audioPool[tid];
                    el.pause();
                    this.liberarAudioAoVivo(el); // solta o grafo antes de descartar o elemento
                    el.src = "";
                    el.remove();
                    delete this.audioPool[tid];
                    // F4: descarta também o par de troca e qualquer troca pendente da pista.
                    const par = this._paresAudio ? this._paresAudio[tid] : null;
                    if (par) {
                        [par.a, par.b].forEach(x => {
                            if (x && x !== el) {
                                x.pause();
                                this.liberarAudioAoVivo(x);
                                x.src = "";
                                x.remove();
                            }
                        });
                        delete this._paresAudio[tid];
                    }
                    if (this._trocasAudio) delete this._trocasAudio[tid];
                }
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // ÁUDIO AO VIVO (Etapa 2, Tipo A) - contrato E2.
    // Grafo por elemento, criado UMA vez e reusado (WeakMap):
    //   fonte -> HPF -> low shelf -> mid peaking -> high shelf -> gate (worklet)
    //        -> compressor -> ganho de makeup -> destination.
    // REGRA INEGOCIÁVEL: nenhum caminho de código pode terminar em silêncio. Se o
    // AudioContext não existir, estiver suspenso, o worklet não carregar ou qualquer
    // nó falhar ANTES de rotear, o elemento continua tocando pelo caminho normal do
    // navegador - prefere-se não aplicar efeito a emudecer o material do usuário.
    // Limitação da plataforma: depois do createMediaElementSource o som do elemento
    // sai SÓ pelo grafo; "liberar" reconecta a fonte direto ao destino (passagem
    // plana, sem processamento), que é auditivamente o caminho normal.
    // Frequências fixas dos filtros (decisão própria, default eq_mid_hz do E4):
    // low shelf 250 Hz, mid peaking 1000 Hz (Q 1.0), high shelf 3000 Hz.
    // ─────────────────────────────────────────────────────────────────────────────
    /* C1-INICIO */
    /** false quando o navegador não suporta WebAudio; a UI avisa (contrato E2). */
    audioAoVivoDisponivel() {
        return typeof window !== "undefined" &&
            (typeof window.AudioContext === "function" || typeof window.webkitAudioContext === "function");
    }

    /** true só quando o módulo do gate carregou; addModule falhou => sempre false (nunca finge que aplicou). */
    gateAoVivoDisponivel() {
        return !!this._estadoAudioAoVivo().gatePronto;
    }

    /** Estado preguiçoso do áudio ao vivo (nada é criado até o primeiro efeito real). */
    _estadoAudioAoVivo() {
        if (!this._audioAoVivo) {
            this._audioAoVivo = {
                ctx: null,
                grafos: new WeakMap(),  // el -> grafo; a fonte NUNCA é criada duas vezes
                ativos: new Set(),      // grafos roteados (para religar o gate quando o módulo chegar)
                gatePronto: false,
                gateFalhou: false,
                gatePromessa: null,
                retomadas: 0
            };
        }
        return this._audioAoVivo;
    }

    _ctxAudioAoVivo() {
        const est = this._estadoAudioAoVivo();
        if (est.ctx) return est.ctx;
        if (!this.audioAoVivoDisponivel()) return null;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            est.ctx = new AC({ latencyHint: "interactive" });
        } catch (err) {
            console.warn("[player] AudioContext indisponível; áudio ao vivo desligado:", err);
            return null;
        }
        return est.ctx;
    }

    /** Retoma o contexto suspenso no mesmo caminho em que o player começa a tocar. */
    _retomarContextoAudioAoVivo() {
        const ctx = this._estadoAudioAoVivo().ctx;
        if (ctx && ctx.state === "suspended") {
            ctx.resume().catch(err => console.warn("[player] resume do AudioContext falhou:", err));
        }
    }

    /** Carrega o worklet do gate uma única vez; falha fica registrada e visível. */
    _carregarGateAoVivo(ctx) {
        const est = this._estadoAudioAoVivo();
        if (est.gatePronto || est.gateFalhou || !ctx.audioWorklet) {
            return est.gatePromessa || Promise.resolve(false);
        }
        if (!est.gatePromessa) {
            est.gatePromessa = ctx.audioWorklet.addModule("js/audioGateWorklet.js").then(() => {
                est.gatePronto = true;
                // O gate chegou depois de alguns grafos: religa os que pedavam por ele.
                est.ativos.forEach(g => this._religarGrafo(g, g.p));
                return true;
            }).catch(err => {
                est.gateFalhou = true; // consultável via gateAoVivoDisponivel()
                console.warn("[player] AudioWorklet do gate não carregou; cadeia segue sem gate:", err);
                return false;
            });
        }
        return est.gatePromessa;
    }

    /**
     * Normaliza clip.effects para os parâmetros do grafo. Retorna null quando não há
     * efeito de áudio ativo (ausente ou "disabled": true): nesse caso nada é roteado.
     * Efeito desligado = bloco fora da cadeia (bypass), nunca mudo.
     */
    _efeitosAudioAoVivo(efeitos) {
        const lista = Array.isArray(efeitos) ? efeitos : [];
        const num = (v, def) => (typeof v === "number" && isFinite(v)) ? v : def;
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const eq = lista.find(e => e && e.type === "audio_eq") || null;
        const dyn = lista.find(e => e && e.type === "audio_dynamics") || null;
        const eqOn = !!(eq && !eq.disabled);
        const dynOn = !!(dyn && !dyn.disabled);
        if (!eqOn && !dynOn) return null;
        return {
            eqOn,
            dynOn,
            hpfHz: eqOn ? clamp(num(eq.hpf, 0), 0, 20000) : 0,
            lowDb: eqOn ? clamp(num(eq.low, 0), -12, 12) : 0,
            midDb: eqOn ? clamp(num(eq.mid, 0), -12, 12) : 0,
            highDb: eqOn ? clamp(num(eq.high, 0), -12, 12) : 0,
            gateDb: dynOn ? clamp(num(dyn.gate_db, -45), -90, 0) : -90,
            compRatio: dynOn ? clamp(num(dyn.comp_ratio, 2.0), 1, 20) : 1,
            compThreshDb: dynOn ? clamp(num(dyn.comp_thresh_db, -18), -60, 0) : 0,
            makeupDb: dynOn ? clamp(num(dyn.makeup_db, 0), -12, 12) : 0
        };
    }

    /**
     * Cria o grafo do elemento UMA vez (createMediaElementSource duas vezes no mesmo
     * elemento lança exceção). Os nós comuns são criados ANTES da fonte: se qualquer um
     * falhar, o elemento ainda não foi roteado e segue no caminho normal.
     */
    _obterGrafo(el, ctx) {
        const est = this._estadoAudioAoVivo();
        let g = est.grafos.get(el);
        if (g) return g;
        const nos = {};
        try {
            nos.hpf = ctx.createBiquadFilter();
            nos.hpf.type = "highpass";
            nos.low = ctx.createBiquadFilter();
            nos.low.type = "lowshelf";
            nos.low.frequency.value = 250;
            nos.mid = ctx.createBiquadFilter();
            nos.mid.type = "peaking";
            nos.mid.frequency.value = 1000;
            nos.mid.Q.value = 1.0;
            nos.high = ctx.createBiquadFilter();
            nos.high.type = "highshelf";
            nos.high.frequency.value = 3000;
            nos.comp = ctx.createDynamicsCompressor();
            nos.makeup = ctx.createGain();
        } catch (err) {
            console.warn("[player] nós de áudio ao vivo não criados; elemento segue no caminho normal:", err);
            return null;
        }
        try {
            nos.fonte = ctx.createMediaElementSource(el); // única chamada por elemento
        } catch (err) {
            console.warn("[player] createMediaElementSource falhou; elemento segue no caminho normal:", err);
            return null;
        }
        g = { el, ctx, nos, gate: null, topologia: "", p: null };
        est.grafos.set(el, g);
        return g;
    }

    _desconectarInterno(g) {
        const nos = [g.nos.fonte, g.nos.hpf, g.nos.low, g.nos.mid, g.nos.high, g.gate, g.nos.comp, g.nos.makeup];
        nos.forEach(n => { try { if (n) n.disconnect(); } catch (_) { /* já estava solto */ } });
    }

    _aplicarParams(g, p) {
        try {
            if (p.eqOn && p.hpfHz > 0) g.nos.hpf.frequency.value = p.hpfHz;
            if (p.eqOn) {
                g.nos.low.gain.value = p.lowDb;
                g.nos.mid.gain.value = p.midDb;
                g.nos.high.gain.value = p.highDb;
            }
            if (g.gate) g.gate.parameters.get("threshold").value = p.gateDb;
            if (p.dynOn && p.compRatio > 1) {
                g.nos.comp.threshold.value = p.compThreshDb;
                g.nos.comp.ratio.value = p.compRatio;
            }
            g.nos.makeup.gain.value = Math.pow(10, p.makeupDb / 20);
        } catch (err) {
            console.warn("[player] falha ao ajustar parâmetro de áudio ao vivo (som continua):", err);
        }
    }

    /** Ordem fechada do contrato E2; blocos desligados simplesmente saem da lista. */
    _topologiaAudioAoVivo(p, comGate) {
        const t = ["fonte"];
        if (p.eqOn && p.hpfHz > 0) t.push("hpf");       // hpf 0 = desligado
        if (p.eqOn) t.push("low", "mid", "high");
        if (comGate) t.push("gate");                    // gate_db -90 = desligado
        if (p.dynOn && p.compRatio > 1) t.push("comp"); // ratio 1 = compressor transparente
        t.push("makeup", "destino");
        return t.join(">");
    }

    /**
     * (Re)conecta o grafo conforme a topologia pedida. Se a reconexão falhar no meio,
     * cai para fonte->destino direto: o som NUNCA morre por culpa do grafo.
     */
    _religarGrafo(g, p) {
        if (!g || !p) return;
        g.p = p;
        // Gate sob demanda: só existe após o módulo carregar; sem ele a cadeia segue.
        if (p.dynOn && p.gateDb > -90 && !g.gate &&
            this._estadoAudioAoVivo().gatePronto && typeof AudioWorkletNode === "function") {
            try {
                g.gate = new AudioWorkletNode(g.ctx, "capiau-audio-gate");
            } catch (err) {
                g.gate = null;
                console.warn("[player] nó do gate não criou; cadeia segue sem gate:", err);
            }
        }
        const topo = this._topologiaAudioAoVivo(p, !!g.gate);
        if (topo === g.topologia) {
            this._aplicarParams(g, p); // só valores mudaram: barato, sem rewiring
            return;
        }
        try {
            this._desconectarInterno(g);
            const mapa = { hpf: g.nos.hpf, low: g.nos.low, mid: g.nos.mid, high: g.nos.high,
                           gate: g.gate, comp: g.nos.comp, makeup: g.nos.makeup };
            const nomes = topo.split(">"); // nomes[0] é sempre "fonte"
            let atual = g.nos.fonte;
            for (let i = 1; i < nomes.length; i++) {
                const prox = nomes[i] === "destino" ? g.ctx.destination : mapa[nomes[i]];
                atual.connect(prox);
                atual = prox;
            }
            g.topologia = topo;
            this._estadoAudioAoVivo().ativos.add(g);
        } catch (err) {
            console.error("[player] falha na religação do grafo; caindo para passagem direta:", err);
            try {
                this._desconectarInterno(g);
                g.nos.fonte.connect(g.ctx.destination);
                g.topologia = "fonte>destino";
            } catch (err2) {
                console.error("[player] passagem direta também falhou; áudio pode ter sumido:", err2);
            }
        }
        this._aplicarParams(g, p);
    }

    /**
     * API pública E2: aplica os efeitos de áudio AO VIVO sobre o elemento.
     * Cria/reusa o grafo e devolve true quando o elemento está roteado.
     * Qualquer falha deixa o elemento tocando pelo caminho normal (retorno false).
     */
    aplicarAudioAoVivo(el, efeitos) {
        const p = this._efeitosAudioAoVivo(efeitos);
        if (!p || !el || typeof el !== "object") {
            if (!p) this.liberarAudioAoVivo(el);
            return false;
        }
        if (!this.audioAoVivoDisponivel()) return false;
        const ctx = this._ctxAudioAoVivo();
        if (!ctx) return false;
        if (ctx.state !== "running") {
            // Contexto suspenso NÃO pode ser roteado (o som sairia só pelo grafo mudo).
            // Tenta acordar e reaplica quando rodar; enquanto isso o caminho é o normal.
            const est = this._estadoAudioAoVivo();
            if (est.retomadas > 5) {
                console.warn("[player] AudioContext continua suspenso; áudio ao vivo adiado.");
                return false;
            }
            est.retomadas++;
            ctx.resume().then(() => {
                est.retomadas = 0;
                this.aplicarAudioAoVivo(el, efeitos);
            }).catch(err => console.warn("[player] AudioContext suspenso; áudio ao vivo adiado:", err));
            return false;
        }
        this._estadoAudioAoVivo().retomadas = 0;
        if (p.dynOn && p.gateDb > -90) this._carregarGateAoVivo(ctx);
        const g = this._obterGrafo(el, ctx);
        if (!g) return false; // falhou criar: elemento intocado, som pelo caminho normal
        this._religarGrafo(g, p);
        return true;
    }

    /**
     * API pública E2: devolve o elemento ao caminho "normal". Como a fonte WebAudio é
     * permanente depois de criada, isso significa desconectar todos os blocos e ligar
     * fonte->destino direto (passagem plana). Elemento nunca roteado = no-op.
     */
    liberarAudioAoVivo(el) {
        const g = (el && typeof el === "object") ? this._estadoAudioAoVivo().grafos.get(el) : null;
        if (!g) return;
        this._estadoAudioAoVivo().ativos.delete(g);
        try {
            this._desconectarInterno(g);
            g.nos.fonte.connect(g.ctx.destination);
            g.topologia = "fonte>destino";
            g.p = null;
        } catch (err) {
            console.error("[player] falha ao liberar grafo de áudio:", err);
        }
    }
    /* C1-FIM */

    // ─────────────────────────────────────────────────────────────────────────────
    // FONTE DE ÁUDIO TRATADA (Etapa 3, Tipo B) - contrato F4.
    // A/B por clipe: registrar uma URL manda o clipe tocar o WAV derivado
    // (GET /api/audio/tratado/{video_id}/{chain_hash}.wav); registrar null volta ao
    // original. Default SEM registro = comportamento atual (original).
    // SINCRONIA: cada pista já tem seu <audio> dedicado e persistente; trocar de
    // fonte NÃO dá src/load() no elemento no ar. Um elemento PAR do pool é preparado
    // com o arquivo novo, posicionado no mesmo instante da timeline (o WAV cobre o
    // MESMO trecho [in,out]: tempo 0 do WAV = In do clipe) e a virada é atômica —
    // copia volume/mute/rate, preserva play/pause, pausa o antigo depois. É o mesmo
    // mecanismo dos buffers de vídeo (_awaitBuffer): nunca fica sem som à espera.
    // GRAFO (Etapa 2): os grafos WebAudio continuam POR ELEMENTO no WeakMap; cada
    // elemento recebe createMediaElementSource UMA vez, e quem sai do ar é apenas
    // religado em passagem plana — nenhum grafo ou ganho é duplicado na troca.
    // FALHA: 404/arquivo apagado/rede registram a falha (consultável pela UI via
    // erroFonteAudioTratada + evento "fonteAudioTratadaIndisponivel") e devolvem o
    // clipe ao original automaticamente.
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * API pública F4: define a fonte tratada de um clipe. urlOuNull = URL servível,
     * ref do efeito ("data/audio_tratado/<vid>/<hash>.wav"), hash puro, ou true para
     * usar o ref do efeito audio_render "ready" do próprio clipe. null volta ao original.
     */
    definirFonteAudioTratada(clipId, urlOuNull) {
        if (clipId === undefined || clipId === null) return;
        if (!this._fontesAudioTratadas) this._fontesAudioTratadas = new Map();
        const chave = String(clipId);
        if (urlOuNull === null || urlOuNull === undefined || urlOuNull === "") {
            this._fontesAudioTratadas.delete(chave);
        } else {
            this._fontesAudioTratadas.set(chave, urlOuNull);
        }
        // Pausado não há laço de playhead recompondo: aplica a troca agora.
        if (this.audioPool && typeof TIMELINE_STATE !== "undefined" &&
            Array.isArray(STATE.activeTimelineCuts)) {
            this.syncAudioTracks(STATE.activeTimelineCuts, TIMELINE_STATE.playheadFrame);
        }
    }

    /** API pública F4: URL servível atualmente registrada para o clipe, ou null. */
    fonteAudioTratadaAtual(clipId) {
        if (!this._fontesAudioTratadas || clipId === undefined || clipId === null) return null;
        const bruto = this._fontesAudioTratadas.get(String(clipId));
        if (bruto === undefined || bruto === null || bruto === "") return null;
        const cuts = Array.isArray(STATE.activeTimelineCuts) ? STATE.activeTimelineCuts : [];
        const cut = cuts.find(c => String(c.id) === String(clipId)) || null;
        const videoId = cut && cut.video_id !== undefined ? cut.video_id : null;
        return this._resolverUrlTratado(bruto, videoId, cut);
    }

    /** Consultável pela UI: último registro de falha da fonte tratada do clipe (ou null). */
    erroFonteAudioTratada(clipId) {
        if (!this._falhasFonteTratada || clipId === undefined || clipId === null) return null;
        const chave = String(clipId);
        let maisRecente = null;
        this._falhasFonteTratada.forEach(registro => {
            if (String(registro.clipId) === chave &&
                (!maisRecente || registro.quando > maisRecente.quando)) {
                maisRecente = registro;
            }
        });
        return maisRecente;
    }

    /**
     * Fonte efetiva do clipe: { src, tratado }. Sem registro (ou com a URL marcada como
     * falha) devolve o caminho original — exatamente como antes deste bloco existir.
     */
    _fonteAudioEfetiva(cut, videoData) {
        const rawSrc = videoData.proxy_path || videoData.filepath || `/originals/${videoData.filename}`;
        const originalSrc = String(rawSrc).replace(/\\/g, "/");
        if (!cut) return { src: originalSrc, tratado: false };
        const bruto = this._fontesAudioTratadas
            ? this._fontesAudioTratadas.get(String(cut.id)) : undefined;
        if (bruto === undefined || bruto === null || bruto === "") {
            return { src: originalSrc, tratado: false };
        }
        const url = this._resolverUrlTratado(bruto, videoData.id, cut);
        if (!url || (this._falhasFonteTratada && this._falhasFonteTratada.has(url))) {
            return { src: originalSrc, tratado: false }; // falhou antes: original, visivelmente
        }
        return { src: url, tratado: true };
    }

    /** Converte registro do A/B em URL servível; null quando não dá para servir. */
    _resolverUrlTratado(valor, videoId, cut) {
        if (valor === true) {
            const ar = cut ? (cut.effects || []).find(e =>
                e && e.type === "audio_render" && e.status === "ready" && e.ref) : null;
            if (!ar) return null;
            valor = ar.ref;
        }
        if (typeof valor !== "string" || !valor.trim()) return null;
        const caminho = valor.trim().replace(/\\/g, "/");
        if (/^https?:/i.test(caminho)) return caminho;
        if (caminho.startsWith("/api/audio/tratado/")) return caminho;
        const m = caminho.match(/data\/audio_tratado\/([^\/]+)\/([^\/]+\.wav)$/i);
        if (m) return `/api/audio/tratado/${m[1]}/${m[2]}`;
        if (/^[a-f0-9]{8,64}$/i.test(caminho) && videoId !== null && videoId !== undefined) {
            const nome = caminho.toLowerCase().endsWith(".wav") ? caminho : `${caminho}.wav`;
            return `/api/audio/tratado/${videoId}/${nome}`;
        }
        return null;
    }

    /** Registra falha de fonte tratada e reaplica (volta ao original) imediatamente. */
    _registrarFalhaFonte(clipId, url, motivo) {
        if (!url) return;
        if (!this._falhasFonteTratada) this._falhasFonteTratada = new Map();
        const registro = {
            clipId: clipId || null,
            url,
            motivo: motivo || "falha ao carregar",
            quando: new Date().toISOString()
        };
        this._falhasFonteTratada.set(url, registro);
        console.warn("[Player] F4: fonte tratada indisponível; voltando ao original:",
            registro.motivo, url);
        if (typeof STATE !== "undefined" && typeof STATE.emit === "function") {
            STATE.emit("fonteAudioTratadaIndisponivel", { ...registro });
        }
        if (this.audioPool && typeof TIMELINE_STATE !== "undefined" &&
            Array.isArray(STATE.activeTimelineCuts)) {
            this.syncAudioTracks(STATE.activeTimelineCuts, TIMELINE_STATE.playheadFrame);
        }
    }

    /** Erro de mídia num elemento carregando/tocando WAV tratado (404, rede, decode). */
    _aoErroElementoAudio(el) {
        if (!el || el.dataset.audioTratado !== "1" || !el.error) return;
        const codigos = {
            1: "carregamento interrompido",
            2: "erro de rede",
            3: "falha de decodificação",
            4: "fonte não encontrada ou formato não suportado"
        };
        this._registrarFalhaFonte(
            el.dataset.activeClipId || null,
            el.dataset.loadedSrc || el.currentSrc || "",
            codigos[el.error.code] || ("erro " + el.error.code)
        );
    }

    /** Troca suave só faz sentido com som no ar em velocidade normal; senão, troca dura. */
    _podeTrocarSuave(el) {
        return !!(el && this.isPlaying && !el.paused &&
            this.playbackSpeed > 0 && this.playbackSpeed <= 2.0 &&
            typeof document !== "undefined" && document.body);
    }

    _trocaAudioPendente(trackId) {
        return this._trocasAudio ? (this._trocasAudio[trackId] || null) : null;
    }

    _cancelarTrocaAudio(trackId) {
        if (this._trocasAudio) delete this._trocasAudio[trackId];
    }

    /** Elemento par da pista (criado sob demanda) usado como reserva da troca suave. */
    _parReservaAudio(trackId, principal) {
        if (!this._paresAudio) this._paresAudio = {};
        let par = this._paresAudio[trackId];
        if (!par || (par.a !== principal && par.b !== principal)) {
            const novo = document.createElement("audio");
            novo.preload = "auto";
            novo.dataset.trackId = trackId;
            document.body.appendChild(novo);
            novo.addEventListener("error", () => this._aoErroElementoAudio(novo));
            par = { a: principal, b: novo };
            this._paresAudio[trackId] = par;
        }
        return par.a === principal ? par.b : par.a;
    }

    /**
     * Agenda a virada para outro arquivo SEM tocar no elemento que está no ar.
     * Devolve false quando não há reserva disponível (o chamador então faz a troca dura).
     */
    _iniciarTrocaSuave(trackId, principal, alvo, cut) {
        const clipId = String(cut.id);
        const emCurso = this._trocaAudioPendente(trackId);
        if (emCurso && emCurso.destino === alvo.src && emCurso.clipId === clipId) return true;
        const reserva = this._parReservaAudio(trackId, principal);
        if (!reserva) return false;
        if (!this._trocasAudio) this._trocasAudio = {};
        this._trocasAudio[trackId] = {
            clipId,
            destino: alvo.src,
            destinoTratado: !!alvo.tratado,
            de: principal,
            para: reserva,
            // Ancora no agendamento: quando a reserva já tem o arquivo certo (reuso,
            // ex. voltar ao original) nenhum reload ocorre e este é o único marco.
            iniciadoEm: performance.now()
        };
        console.log("[Player] F4: troca de fonte de áudio agendada para o clipe", clipId,
            alvo.tratado ? "(original -> tratado)" : "(tratado -> original)");
        return true;
    }

    /**
     * Prepara o elemento par (arquivo certo, instante certo, volume/mute acompanhando)
     * e, quando ele está pronto e posicionado, executa a VIRADA ATÔMICA: pausa o que
     * está no ar, promove o par, copia rate e estado de reprodução, roteia o grafo da
     * Etapa 2 ANTES de tocar. Até lá o elemento atual segue tocando — zero silêncio.
     */
    _dirigirTrocaSuave(trackId, cut, currentFrame) {
        const troca = this._trocasAudio ? this._trocasAudio[trackId] : null;
        if (!troca) return;
        const principal = this.audioPool ? this.audioPool[trackId] : null;
        if (!principal || principal !== troca.de) { this._cancelarTrocaAudio(trackId); return; }
        const reserva = troca.para;

        if (reserva.dataset.loadedSrc !== troca.destino ||
            (reserva.dataset.audioTratado === "1") !== troca.destinoTratado) {
            reserva.dataset.audioTratado = troca.destinoTratado ? "1" : "";
            reserva.dataset.loadedSrc = troca.destino;
            reserva.dataset.activeClipId = String(cut.id);
            reserva.src = troca.destino;
            reserva.load();
            troca.iniciadoEm = performance.now();
        }

        const fps = TIMELINE_STATE?.fps || 24;
        const offsetSegundos = (currentFrame - cut.timelineStartFrame) / fps;
        const alvoSegundos = Math.max(0, (troca.destinoTratado ? 0 : cut.in) + offsetSegundos);

        // O par acompanha mute/volume do que está no ar enquanto prepara.
        reserva.muted = principal.muted;
        reserva.volume = principal.volume;

        if (!reserva.seeking) {
            const deriva = reserva.currentTime - alvoSegundos;
            if (reserva.readyState < 2 || deriva > 0.06 || deriva < -0.06) {
                reserva.currentTime = alvoSegundos;
            }
        }

        // Rede/servidor preso não pode deixar o A/B eternamente pendente: registra a
        // falha e volta ao original (consultável pela UI).
        if (troca.iniciadoEm && performance.now() - troca.iniciadoEm > 12000) {
            this._registrarFalhaFonte(troca.clipId, troca.destino,
                "tempo esgotado carregando o WAV tratado");
            this._cancelarTrocaAudio(trackId);
            return;
        }

        const pronto = reserva.readyState >= 2 && !reserva.seeking &&
            Math.abs(reserva.currentTime - alvoSegundos) <= 0.08 &&
            !!troca.iniciadoEm && performance.now() - troca.iniciadoEm >= 50;
        if (!pronto) return;

        // VIRADA ATÔMICA: mesmo instante da timeline, mesmo estado de reprodução.
        const estavaTocando = !principal.paused;
        const rate = principal.playbackRate;
        if (!principal.paused) principal.pause();
        this.liberarAudioAoVivo(principal); // ex-principal volta à passagem plana, parado
        this.audioPool[trackId] = reserva;
        principal.dataset.activeClipId = "";
        reserva.dataset.activeClipId = String(cut.id);
        reserva.playbackRate = rate;
        const effects = cut.effects || [];
        if (this._efeitosAudioAoVivo(effects)) this.aplicarAudioAoVivo(reserva, effects);
        else this.liberarAudioAoVivo(reserva);
        this._cancelarTrocaAudio(trackId);
        if (estavaTocando) {
            this._retomarContextoAudioAoVivo();
            reserva.play().catch(() => {});
        }
    }

    syncTransformOverlay() {
        const selectedId = TIMELINE_STATE.selectedClipId;
        const overlay = this.el("program-transform-overlay");
        if (!overlay) return;

        if (!selectedId) {
            overlay.style.display = "none";
            overlay.innerHTML = "";
            overlay.dataset.clipId = "";
            return;
        }

        const currentFrame = TIMELINE_STATE.playheadFrame;
        const cuts = STATE.activeTimelineCuts;
        const activeClip = cuts.find(c =>
            String(c.id) === String(selectedId) &&
            currentFrame >= c.timelineStartFrame &&
            currentFrame < (c.timelineStartFrame + (c.outFrame - c.inFrame))
        );

        if (!activeClip) {
            overlay.style.display = "none";
            overlay.innerHTML = "";
            overlay.dataset.clipId = "";
            return;
        }

        const effects = activeClip.effects || [];
        const tf = effects.find(e => e.type === "transform") || {};

        if (tf.disabled) {
            overlay.style.display = "none";
            overlay.innerHTML = "";
            overlay.dataset.clipId = "";
            return;
        }

        const scale = tf.scale !== undefined ? tf.scale : 1.0;
        const tx = tf.x !== undefined ? tf.x : 0;
        const ty = tf.y !== undefined ? tf.y : 0;
        const rotation = tf.rotation !== undefined ? tf.rotation : 0;

        // Aplica o mesmo transform CSS da imagem
        overlay.style.transform = `translate(${tx}%, ${ty}%) scale(${scale}) rotate(${rotation}deg)`;
        overlay.style.transformOrigin = "center center";
        overlay.style.display = "block";

        // Aplica o mesmo clip-path para o Crop (Fase 5)
        const cropEffect = effects.find(e => e.type === "crop") || {};
        let cropTop = 0, cropRight = 0, cropBottom = 0, cropLeft = 0;

        if (!cropEffect.disabled) {
            cropTop = cropEffect.top !== undefined ? cropEffect.top : 0;
            cropRight = cropEffect.right !== undefined ? cropEffect.right : 0;
            cropBottom = cropEffect.bottom !== undefined ? cropEffect.bottom : 0;
            cropLeft = cropEffect.left !== undefined ? cropEffect.left : 0;
        }

        if (cropTop > 0 || cropRight > 0 || cropBottom > 0 || cropLeft > 0) {
            overlay.style.clipPath = `inset(${cropTop}% ${cropRight}% ${cropBottom}% ${cropLeft}%)`;
        } else {
            overlay.style.clipPath = "";
        }

        if (overlay.dataset.clipId !== String(activeClip.id)) {
            overlay.dataset.clipId = String(activeClip.id);
            overlay.innerHTML = `
                <!-- Centro (Âncora) -->
                <div class="transform-anchor"></div>

                <!-- Linha e alça de Rotação -->
                <div class="transform-rot-line"></div>
                <div class="transform-handle-rot" data-handle="rot"></div>

                <!-- 8 Alças de Redimensionamento -->
                <div class="transform-handle tl" data-handle="tl"></div>
                <div class="transform-handle tc" data-handle="tc"></div>
                <div class="transform-handle tr" data-handle="tr"></div>
                <div class="transform-handle ml" data-handle="ml"></div>
                <div class="transform-handle mr" data-handle="mr"></div>
                <div class="transform-handle bl" data-handle="bl"></div>
                <div class="transform-handle bc" data-handle="bc"></div>
                <div class="transform-handle br" data-handle="br"></div>
            `;
            this.attachOverlayDragListeners(overlay, activeClip.id);
        }

        // Contra-escala e contra-rotação nas alças
        const invScale = 1 / scale;
        const invRot = -rotation;
        overlay.querySelectorAll(".transform-handle, .transform-handle-rot").forEach(handle => {
            handle.style.transform = `scale(${invScale}) rotate(${invRot}deg)`;
        });
        const anchor = overlay.querySelector(".transform-anchor");
        if (anchor) {
            anchor.style.transform = `scale(${invScale}) rotate(${invRot}deg)`;
        }
    }

    /**
     * Calcula o magnetismo/encaixe (snapping) da posição X/Y e Escala do clipe em relação às bordas
     * e centro do quadro do Program.
     * Retorna { x, y, guides: string[] }
     */
    calculateTransformSnap(rawX, rawY, scale = 1.0, cropEffect = null, vW = 1920, vH = 1080) {
        let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
        if (cropEffect && !cropEffect.disabled) {
            cropLeft = (cropEffect.left || 0);
            cropRight = (cropEffect.right || 0);
            cropTop = (cropEffect.top || 0);
            cropBottom = (cropEffect.bottom || 0);
        }

        const activeGuides = [];
        let snappedX = rawX;
        let snappedY = rawY;

        // Tolerância em porcentagem baseada em pixels do viewport (~8-10px)
        const tolPx = 9;
        const tolX = Math.max(1.2, Math.min(2.5, vW ? (tolPx / vW) * 100 : 1.5));
        const tolY = Math.max(1.2, Math.min(2.5, vH ? (tolPx / vH) * 100 : 1.5));

        // ── PONTOS DE ENCAIXE HORIZONTAIS (X) ──
        const snapTargetsX = [
            {
                guide: "center-x",
                target: -(cropLeft - cropRight) * (scale / 2)
            },
            {
                guide: "left",
                target: 50 * (scale - 1) - (cropLeft * scale)
            },
            {
                guide: "right",
                target: 50 * (1 - scale) + (cropRight * scale)
            }
        ];

        let bestDistX = Infinity;
        let bestTargetX = null;
        for (const st of snapTargetsX) {
            const dist = Math.abs(rawX - st.target);
            if (dist <= tolX && dist < bestDistX) {
                bestDistX = dist;
                bestTargetX = st;
            }
        }

        if (bestTargetX) {
            snappedX = Math.round(bestTargetX.target * 10) / 10;
            if (Object.is(snappedX, -0) || snappedX === 0) snappedX = 0;
            activeGuides.push(bestTargetX.guide);
            if (Math.abs(scale - 1.0) < 0.01 && Math.abs(snappedX) < 0.1 && cropLeft === 0 && cropRight === 0) {
                if (!activeGuides.includes("left")) activeGuides.push("left");
                if (!activeGuides.includes("right")) activeGuides.push("right");
            }
        }

        // ── PONTOS DE ENCAIXE VERTICAIS (Y) ──
        const snapTargetsY = [
            {
                guide: "center-y",
                target: -(cropTop - cropBottom) * (scale / 2)
            },
            {
                guide: "top",
                target: 50 * (scale - 1) - (cropTop * scale)
            },
            {
                guide: "bottom",
                target: 50 * (1 - scale) + (cropBottom * scale)
            }
        ];

        let bestDistY = Infinity;
        let bestTargetY = null;
        for (const st of snapTargetsY) {
            const dist = Math.abs(rawY - st.target);
            if (dist <= tolY && dist < bestDistY) {
                bestDistY = dist;
                bestTargetY = st;
            }
        }

        if (bestTargetY) {
            snappedY = Math.round(bestTargetY.target * 10) / 10;
            if (Object.is(snappedY, -0) || snappedY === 0) snappedY = 0;
            activeGuides.push(bestTargetY.guide);
            if (Math.abs(scale - 1.0) < 0.01 && Math.abs(snappedY) < 0.1 && cropTop === 0 && cropBottom === 0) {
                if (!activeGuides.includes("top")) activeGuides.push("top");
                if (!activeGuides.includes("bottom")) activeGuides.push("bottom");
            }
        }

        return {
            x: snappedX,
            y: snappedY,
            guides: activeGuides
        };
    }

    /**
     * Exibe e anima de forma sutil e breve as linhas magnéticas de encaixe no Program.
     * @param {string[]} guides - Array com identificadores como 'left', 'right', 'top', 'bottom', 'center-x', 'center-y'
     */
    showSnapGuides(guides = []) {
        const container = this.el("program-snap-guides");
        if (!container) return;

        const allLines = container.querySelectorAll(".snap-guide-line");
        allLines.forEach(line => {
            const g = line.dataset.guide;
            if (guides && guides.includes(g)) {
                if (!line.classList.contains("snap-active")) {
                    line.classList.remove("snap-active");
                    void line.offsetWidth;
                    line.classList.add("snap-active");
                }
            } else {
                line.classList.remove("snap-active");
            }
        });
    }

    /**
     * Oculta todas as guias de encaixe magnético.
     */
    hideSnapGuides() {
        const container = this.el("program-snap-guides");
        if (!container) return;
        container.querySelectorAll(".snap-guide-line").forEach(line => {
            line.classList.remove("snap-active");
        });
    }

    attachOverlayDragListeners(overlay, clipId) {
        if (overlay._dragCleanups) {
            overlay._dragCleanups();
        }

        const cleanups = [];
        overlay._dragCleanups = () => {
            cleanups.forEach(fn => fn());
            overlay._dragCleanups = null;
        };

        const onClick = (e) => {
            const target = e.target;
            const handleType = target?.dataset?.handle;
            const wrapper = this.el("program-video-wrapper");
            const tw = TIMELINE_STATE?.width || 1920;
            const th = TIMELINE_STATE?.height || 1080;
            const PAD = 16;
            const availW = wrapper ? Math.max(0, wrapper.clientWidth - PAD * 2) : 0;
            const availH = wrapper ? Math.max(0, wrapper.clientHeight - PAD * 2) : 0;
            const fitScale = (availW > 0 && availH > 0) ? Math.min(availW / tw, availH / th) : 0.5;
            const zoom = TIMELINE_STATE?.previewZoom || "fit";
            const scale = (zoom === "fit") ? fitScale : Number(zoom);
            const vW = Math.round(tw * scale);
            const vH = Math.round(th * scale);
            const hasOverflow = wrapper ? ((vW > wrapper.clientWidth + 2) || (vH > wrapper.clientHeight + 2)) : false;

            if (!handleType && hasOverflow) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        };
        overlay.addEventListener("click", onClick);
        cleanups.push(() => overlay.removeEventListener("click", onClick));

        const onMouseDown = (e) => {
            const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
            if (!clip) return;

            const target = e.target;
            const handleType = target?.dataset?.handle; // "tl", "tc", "tr", "ml", "mr", "bl", "bc", "br", "rot" ou undefined (corpo)

            const wrapper = this.el("program-video-wrapper");
            const tw = TIMELINE_STATE?.width || 1920;
            const th = TIMELINE_STATE?.height || 1080;
            const PAD = 16;
            const availW = wrapper ? Math.max(0, wrapper.clientWidth - PAD * 2) : 0;
            const availH = wrapper ? Math.max(0, wrapper.clientHeight - PAD * 2) : 0;
            const fitScale = (availW > 0 && availH > 0) ? Math.min(availW / tw, availH / th) : 0.5;
            const zoom = TIMELINE_STATE?.previewZoom || "fit";
            const scale = (zoom === "fit") ? fitScale : Number(zoom);
            const scaledVW = Math.round(tw * scale);
            const scaledVH = Math.round(th * scale);
            const hasOverflow = wrapper ? ((scaledVW > wrapper.clientWidth + 2) || (scaledVH > wrapper.clientHeight + 2)) : false;

            // Se for clique no corpo do overlay durante visualização com zoom (overflow) ou botão do meio:
            // NÃO intercepta como drag de clipe: deixa o evento subir para o wrapper para realizar o pan do viewport!
            if (!handleType && (hasOverflow || e.button === 1)) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startY = e.clientY;

            const effects = clip.effects || [];
            let tf = effects.find(e => e.type === "transform");
            if (!tf) {
                tf = { type: "transform", scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 };
            }

            const initialX = tf.x !== undefined ? tf.x : 0;
            const initialY = tf.y !== undefined ? tf.y : 0;
            const initialScale = tf.scale !== undefined ? tf.scale : 1.0;
            const initialRot = tf.rotation !== undefined ? tf.rotation : 0;

            TIMELINE_HISTORY.begin();

            const viewport = this.el("program-player-viewport");
            const vW = viewport.clientWidth || 1920;
            const vH = viewport.clientHeight || 1080;

            let moved = false;

            const onMouseMove = (moveEv) => {
                const deltaX = moveEv.clientX - startX;
                const deltaY = moveEv.clientY - startY;

                if (Math.hypot(deltaX, deltaY) > 3) {
                    moved = true;
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === clipId);
                if (!targetClip) return;

                targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                let localTf = targetClip.effects.find(e => e.type === "transform");
                if (!localTf) {
                    localTf = { type: "transform", scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 };
                    targetClip.effects.push(localTf);
                }

                const cropEffect = targetClip.effects.find(e => e.type === "crop") || {};

                if (!handleType) {
                    // ARRASTAR O CLIPE (TRADUÇÃO X, Y) COM MAGNETISMO
                    const pctX = (deltaX / vW) * 100;
                    const pctY = (deltaY / vH) * 100;
                    const rawX = initialX + pctX;
                    const rawY = initialY + pctY;

                    const snap = this.calculateTransformSnap(rawX, rawY, localTf.scale || 1.0, cropEffect, vW, vH);
                    localTf.x = snap.x;
                    localTf.y = snap.y;
                    this.showSnapGuides(snap.guides);
                } else if (handleType === "rot") {
                    // ROTAÇÃO
                    const rect = viewport.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    const startAngle = Math.atan2(startY - centerY, startX - centerX) * 180 / Math.PI;
                    const currentAngle = Math.atan2(moveEv.clientY - centerY, moveEv.clientX - centerX) * 180 / Math.PI;
                    let newRot = initialRot + (currentAngle - startAngle);
                    let roundedRot = Math.round(newRot);
                    const snapAngles = [0, 90, 180, 270, -90, -180, -270, 360, -360];
                    const snapAngle = snapAngles.find(a => Math.abs(roundedRot - a) <= 3);
                    if (snapAngle !== undefined) {
                        roundedRot = snapAngle;
                        this.showSnapGuides(["center-x", "center-y"]);
                    } else {
                        this.showSnapGuides([]);
                    }
                    localTf.rotation = roundedRot;
                } else {
                    // ESCALA
                    const rect = viewport.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;

                    const startDist = Math.hypot(startX - centerX, startY - centerY);
                    const currentDist = Math.hypot(moveEv.clientX - centerX, moveEv.clientY - centerY);
                    if (startDist > 0) {
                        const ratio = currentDist / startDist;
                        let rawScale = initialScale * ratio;
                        // Magnetismo de escala em 100% (1.0)
                        if (Math.abs(rawScale - 1.0) <= 0.025) {
                            rawScale = 1.0;
                            this.showSnapGuides(["left", "right", "top", "bottom"]);
                        } else {
                            this.showSnapGuides([]);
                        }
                        localTf.scale = Math.max(0.1, Math.min(10.0, parseFloat(rawScale.toFixed(3))));
                    }
                }

                STATE.activeTimelineCuts = cuts;
                this.syncVideoToPlayhead();

                const interaction = window.timelineInteraction || window.panelsManager?.timelineInteraction;
                if (interaction) {
                    interaction.refreshClipInspector();
                }
            };

            const onMouseUp = (upEv) => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                this.hideSnapGuides();
                TIMELINE_HISTORY.commit();

                const isMinimap = upEv && upEv.target && upEv.target.closest && upEv.target.closest("#program-player-minimap");
                // Se clicou rápido no corpo sem arrastar (e não foi no minimapa), alterna play/pause
                if (!moved && !handleType && !isMinimap) {
                    this.togglePlay();
                }
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        };

        overlay.addEventListener("mousedown", onMouseDown);
        cleanups.push(() => overlay.removeEventListener("mousedown", onMouseDown));
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
        this.isKeyKDown = false;

        // Escuta atalhos globais de teclado redirecionando para o player focado
        document.addEventListener("keydown", (e) => this.handleGlobalKeyboard(e));
        document.addEventListener("keyup", (e) => {
            if (e.code === "KeyK") {
                this.isKeyKDown = false;
            }
        });
        window.addEventListener("blur", () => {
            this.isKeyKDown = false;
        });
    }

    stepFrame(delta) {
        const fps = TIMELINE_STATE?.fps || 24;
        if (window.activeFocusedPlayer === "source") {
            const vid = this.sourcePlayer.el("source-video");
            if (vid) {
                this.sourcePlayer.stopReverse();
                this.sourcePlayer.seek(vid.currentTime + (delta / fps));
            }
        } else {
            this.programPlayer.pause();
            const maxDur = this.programPlayer.getDurationFrames();
            const newFrame = delta > 0
                ? Math.min(maxDur, TIMELINE_STATE.playheadFrame + delta)
                : Math.max(0, TIMELINE_STATE.playheadFrame + delta);
            TIMELINE_STATE.setPlayheadFrame(newFrame);
        }
    }

    // Atalhos de teclado compartilhados
    handleGlobalKeyboard(e) {
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        if (activeTag === "input" || activeTag === "textarea" || activeTag === "select" || document.activeElement?.isContentEditable) return;

        // Se houver qualquer modal aberto, ignora atalhos globais do player principal
        if (window.isAnyModalOpen && window.isAnyModalOpen()) {
            return;
        }

        const code = e.code;
        const activePlayer = window.activeFocusedPlayer === "source" ? this.sourcePlayer : this.programPlayer;

        if (code === "KeyK") {
            e.preventDefault();
            this.isKeyKDown = true;
            activePlayer.shuttleStop();
        } 
        else if (code === "Space") {
            e.preventDefault();
            activePlayer.togglePlay();
        }
        else if (code === "KeyL") {
            e.preventDefault();
            if (this.isKeyKDown) {
                // Combo K + L: Avança 1 frame
                this.stepFrame(1);
            } else {
                activePlayer.shuttleForward();
            }
        } 
        else if (code === "KeyJ") {
            e.preventDefault();
            if (this.isKeyKDown) {
                // Combo K + J: Recua 1 frame
                this.stepFrame(-1);
            } else {
                activePlayer.shuttleReverse();
            }
        } 
        else if (code === "KeyI") {
            if (window.activeFocusedPlayer === "source") {
                this.sourcePlayer.markIn();
            }
        } 
        else if (code === "KeyO") {
            if (window.activeFocusedPlayer === "source") {
                this.sourcePlayer.markOut();
            }
        } 
        else if (code === "KeyE") {
            if (window.activeFocusedPlayer === "source") {
                this.sourcePlayer.appendToTimeline();
            }
        } 
        else if (code === "ArrowLeft") {
            e.preventDefault();
            if (window.activeFocusedPlayer === "source") {
                const vid = this.sourcePlayer.el("source-video");
                if (vid) this.sourcePlayer.seek(vid.currentTime - (1 / (TIMELINE_STATE?.fps || 24)));
            } else {
                if (!TIMELINE_STATE.selectedClipId) {
                    this.stepFrame(-1);
                }
            }
        } 
        else if (code === "ArrowRight") {
            e.preventDefault();
            if (window.activeFocusedPlayer === "source") {
                const vid = this.sourcePlayer.el("source-video");
                if (vid) this.sourcePlayer.seek(vid.currentTime + (1 / (TIMELINE_STATE?.fps || 24)));
            } else {
                if (!TIMELINE_STATE.selectedClipId) {
                    this.stepFrame(1);
                }
            }
        }
        else if (code === "ArrowUp") {
            e.preventDefault();
            if (window.activeFocusedPlayer === "source") {
                const vid = this.sourcePlayer.el("source-video");
                if (vid) {
                    const inPoint = STATE.markerIn;
                    if (inPoint !== null && vid.currentTime > inPoint + 0.05) {
                        this.sourcePlayer.seek(inPoint);
                    } else {
                        this.sourcePlayer.seek(0);
                    }
                }
            } else {
                this.programPlayer.pause();
                const targetFrame = TIMELINE_STATE.moveToPrevEditPoint();
                if (window.timelineInteraction && typeof window.timelineInteraction.ensureFrameVisible === "function") {
                    window.timelineInteraction.ensureFrameVisible(targetFrame);
                }
            }
        }
        else if (code === "ArrowDown") {
            e.preventDefault();
            if (window.activeFocusedPlayer === "source") {
                const vid = this.sourcePlayer.el("source-video");
                if (vid) {
                    const outPoint = STATE.markerOut;
                    if (outPoint !== null && vid.currentTime < outPoint - 0.05) {
                        this.sourcePlayer.seek(outPoint);
                    } else if (vid.duration) {
                        this.sourcePlayer.seek(vid.duration);
                    }
                }
            } else {
                this.programPlayer.pause();
                const targetFrame = TIMELINE_STATE.moveToNextEditPoint();
                if (window.timelineInteraction && typeof window.timelineInteraction.ensureFrameVisible === "function") {
                    window.timelineInteraction.ensureFrameVisible(targetFrame);
                }
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
