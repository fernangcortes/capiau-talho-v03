// Gerenciador do Player de Vídeo Duplo (Source/Program), atalhos JKL e workspaces multi-monitores.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { FaceManager } from "./faces.js";
import { TIMELINE_STATE, TIMELINE_HISTORY } from "./timelineState.js";
import { getActiveElement } from "./workspaceManager.js";

// Foco global do teclado para players: "source" ou "program"
window.activeFocusedPlayer = "source";

export function formatTimecode(secs, fps = null) {
    if (isNaN(secs) || secs === null) return "00:00:00:00";
    const currentFps = fps || TIMELINE_STATE?.fps || 24;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const f = Math.floor((secs % 1) * currentFps);
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
        
        const src = photo.proxy_path || (photo.filepath && (photo.filepath.startsWith('http') || photo.filepath.startsWith('/')) ? photo.filepath : `/originals/${photo.filename}`);
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

export function syncProgramViewport() {
    const wrapper = getActiveElement("program-video-wrapper");
    const viewport = getActiveElement("program-player-viewport");
    if (!wrapper || !viewport) return;

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

    const tw = TIMELINE_STATE.width || 1920;
    const th = TIMELINE_STATE.height || 1080;
    const PAD = 16;

    const availW = Math.max(0, wrapper.clientWidth - PAD * 2);
    const availH = Math.max(0, wrapper.clientHeight - PAD * 2);
    const fitScale = Math.min(availW / tw, availH / th);

    const zoom = TIMELINE_STATE.previewZoom || "fit";
    const scale = (zoom === "fit") ? fitScale : zoom;

    viewport.style.width = `${Math.round(tw * scale)}px`;
    viewport.style.height = `${Math.round(th * scale)}px`;
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

            if (wasOnAir || this._bufferHasFrame(el, cut, currentFrame)) {
                this._layerShown[layerKey] = el;
                return el;
            }

            // Buffer ainda abrindo/posicionando (scrub longo, timeline recém-carregada):
            // segura o último quadro no ar e revela quando houver imagem — nunca preto.
            this._awaitBuffer(el);
            const prev = this._layerShown[layerKey];
            return (prev && prev !== el) ? prev : null;
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
    }

    /**
     * Pool de buffers <video> do Program: 2 camadas no ar (base + sobreposição) e 2 buffers
     * livres para o pré-carregamento do próximo clipe de cada camada. Os buffers extras são
     * criados sob demanda caso o HTML não os traga.
     */
    _videoPool() {
        const ids = ["program-video-a", "program-video-b", "program-video-c", "program-video-d"];
        const viewport = this.el("program-player-viewport");
        const pool = [];

        ids.forEach(id => {
            let el = this.el(id);
            if (!el && viewport) {
                el = viewport.ownerDocument.createElement("video");
                el.id = id;
                el.preload = "auto";
                el.muted = true;
                el.playsInline = true;
                el.style.cssText = "position:absolute; inset:0; width:100%; height:100%; display:none;";
                viewport.appendChild(el);
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
        const raw = videoData.proxy_path || videoData.filepath || `/originals/${videoData.filename}`;
        return String(raw).replace(/\\/g, "/");
    }

    /** Instante do arquivo (em segundos) correspondente a um frame da timeline. */
    _targetSecondsFor(cut, frame) {
        const fps = TIMELINE_STATE?.fps || 24;
        return cut.in + ((frame - cut.timelineStartFrame) / fps);
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
        const rawSrc = photo.proxy_path || photo.filepath || `/originals/${photo.filename}`;
        const src = String(rawSrc).replace(/\\/g, "/");
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
        const tIn = (currentFrame - cut.timelineStartFrame) / fps;                       // s desde o início
        const tOut = (cut.timelineStartFrame + durFrames - currentFrame) / fps;          // s até o fim
        effects.filter(e => e.type === "crossfade").forEach(cf => {
            if (cf.disabled) return;
            const d = Math.max(0.05, cf.duration_s || 0.5);
            if (cf.side === "in" && tIn < d) fadeOpacity = Math.min(fadeOpacity, Math.max(0, tIn / d));
            if (cf.side === "out" && tOut < d) fadeOpacity = Math.min(fadeOpacity, Math.max(0, tOut / d));
        });
        
        el.style.opacity = String(baseOpacity * fadeOpacity);

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

            const rawSrc = videoData.proxy_path || videoData.filepath || `/originals/${videoData.filename}`;
            const audioSrc = rawSrc.replace(/\\/g, "/");
            const srcChanged = el.dataset.loadedSrc !== audioSrc;
            if (srcChanged) {
                el.src = audioSrc;
                el.dataset.loadedSrc = audioSrc;
                el.load();
            }

            const offsetFrames = currentFrame - cut.timelineStartFrame;
            const targetSeconds = cut.in + (offsetFrames / (TIMELINE_STATE?.fps || 24));
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

            // Volume do clipe individual
            const clipVolEff = (cut.effects || []).find(e => e.type === "volume");
            const clipVol = (clipVolEff && !clipVolEff.disabled) ? clipVolEff.level : 1.0;

            // Audio Fade-in / Fade-out duration
            let fadeVol = 1.0;
            const fpsVal = TIMELINE_STATE?.fps || 24;
            const tIn = (currentFrame - cut.timelineStartFrame) / fpsVal; // s desde o início
            const tOut = (cut.timelineStartFrame + (cut.outFrame - cut.inFrame) - currentFrame) / fpsVal; // s até o fim
            const effects = cut.effects || [];
            effects.filter(e => e.type === "crossfade").forEach(cf => {
                if (cf.disabled) return;
                const d = Math.max(0.05, cf.duration_s || 0.5);
                if (cf.side === "in" && tIn < d) fadeVol = Math.min(fadeVol, Math.max(0, tIn / d));
                if (cf.side === "out" && tOut < d) fadeVol = Math.min(fadeVol, Math.max(0, tOut / d));
            });

            const vol = track.volume !== undefined ? track.volume : 1.0;
            el.volume = (track.muted || isHighSpeedOrReverse) ? 0 : Math.max(0, Math.min(1.0, vol * clipVol * fadeVol));
            if (this.isPlaying && this.playbackSpeed > 0 && !isHighSpeedOrReverse && el.paused) {
                el.play().catch(() => {});
            } else if ((!this.isPlaying || isHighSpeedOrReverse) && !el.paused) {
                el.pause();
            }
        });

        if (this.audioPool) {
            Object.keys(this.audioPool).forEach(tid => {
                if (!seen.has(tid)) {
                    const el = this.audioPool[tid];
                    el.pause();
                    el.src = "";
                    el.remove();
                    delete this.audioPool[tid];
                }
            });
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
            e.preventDefault();
            e.stopPropagation();
        };
        overlay.addEventListener("click", onClick);
        cleanups.push(() => overlay.removeEventListener("click", onClick));

        const onMouseDown = (e) => {
            const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
            if (!clip) return;

            e.preventDefault();
            e.stopPropagation();

            const target = e.target;
            const handleType = target.dataset.handle; // "tl", "tc", "tr", "ml", "mr", "bl", "bc", "br", "rot" ou undefined (corpo)

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

                if (!handleType) {
                    // ARRASHAR O CLIPE (TRADUÇÃO X, Y)
                    const pctX = (deltaX / vW) * 100;
                    const pctY = (deltaY / vH) * 100;
                    localTf.x = initialX + pctX;
                    localTf.y = initialY + pctY;
                } else if (handleType === "rot") {
                    // ROTAÇÃO
                    const rect = viewport.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    const startAngle = Math.atan2(startY - centerY, startX - centerX) * 180 / Math.PI;
                    const currentAngle = Math.atan2(moveEv.clientY - centerY, moveEv.clientX - centerX) * 180 / Math.PI;
                    let newRot = initialRot + (currentAngle - startAngle);
                    localTf.rotation = Math.round(newRot);
                } else {
                    // ESCALA
                    const rect = viewport.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;

                    const startDist = Math.hypot(startX - centerX, startY - centerY);
                    const currentDist = Math.hypot(moveEv.clientX - centerX, moveEv.clientY - centerY);
                    if (startDist > 0) {
                        const ratio = currentDist / startDist;
                        localTf.scale = Math.max(0.1, Math.min(10.0, parseFloat((initialScale * ratio).toFixed(3))));
                    }
                }

                STATE.activeTimelineCuts = cuts;
                this.syncVideoToPlayhead();

                if (window.workspaceManager && window.workspaceManager.timelinePanel && window.workspaceManager.timelinePanel.timelineInteraction) {
                    window.workspaceManager.timelinePanel.timelineInteraction.refreshClipInspector();
                }
            };

            const onMouseUp = () => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                TIMELINE_HISTORY.commit();

                // Se clicou rápido no corpo sem arrastar, alterna play/pause
                if (!moved && !handleType) {
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
        const activeTag = document.activeElement.tagName.toLowerCase();
        if (activeTag === "input" || activeTag === "textarea" || document.activeElement.isContentEditable) return;

        // Se o modal de entrevista estiver aberto, ignora atalhos do player principal
        const interviewModal = document.getElementById("interview-modal");
        if (interviewModal && interviewModal.style.display === "flex") {
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
