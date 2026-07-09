// Gerenciador de Estado reativo unificado da interface (EventEmitter).

class EventEmitter {
    constructor() {
        this.listeners = {};
    }

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
    }
}

class AppState extends EventEmitter {
    constructor() {
        super();
        this._currentProjectId = 1;
        this._allProjects = [];
        this._activeVideo = null;
        this._activePhoto = null;
        this._openPhotosInPlayer = false;
        this._activeTranscript = [];
        this._activeTranscriptWords = [];
        this._activeScissorsMode = false;
        this._activeVisionFrames = [];
        this._currentRightTab = "transcript";
        this._activeTimelineCuts = [];
        this._markerIn = null;
        this._markerOut = null;
        this._projectFps = 24;
        
        this._allVideos = [];
        this._allPhotos = [];
        this._activeConversions = {};
        this._chatHistory = [];
        
        // Atributos de visualização
        this._playbackSpeed = 1.0;
        this._openFolders = new Set();
        this._currentPhotoList = [];
        this._currentPhotoIndex = -1;
    }

    // -- Getters e Setters com Emissão de Eventos de mudança
    get currentProjectId() { return this._currentProjectId; }
    set currentProjectId(val) {
        if (this._currentProjectId !== val) {
            this._currentProjectId = Number(val);
            this.emit("projectChanged", this._currentProjectId);
        }
    }

    get allProjects() { return this._allProjects; }
    set allProjects(val) {
        this._allProjects = val;
        this.emit("projectsListUpdated", val);
    }

    get activeVideo() { return this._activeVideo; }
    set activeVideo(val) {
        if (val) {
            this._activePhoto = null;
        }
        this._activeVideo = val;
        this.emit("activeVideoChanged", val);
        if (val) {
            this.emit("activePhotoChanged", null);
        }
    }

    get activePhoto() { return this._activePhoto; }
    set activePhoto(val) {
        if (val) {
            this._activeVideo = null;
        }
        this._activePhoto = val;
        this.emit("activePhotoChanged", val);
        if (val) {
            this.emit("activeVideoChanged", null);
        }
    }

    get openPhotosInPlayer() { return this._openPhotosInPlayer; }
    set openPhotosInPlayer(val) {
        this._openPhotosInPlayer = !!val;
        this.emit("openPhotosInPlayerChanged", this._openPhotosInPlayer);
    }

    get activeTranscript() { return this._activeTranscript; }
    set activeTranscript(val) {
        this._activeTranscript = val;
        this.emit("transcriptUpdated", val);
    }

    get activeTranscriptWords() { return this._activeTranscriptWords; }
    set activeTranscriptWords(val) {
        this._activeTranscriptWords = val;
        this.emit("transcriptWordsUpdated", val);
    }

    get activeScissorsMode() { return this._activeScissorsMode; }
    set activeScissorsMode(val) {
        this._activeScissorsMode = val;
        this.emit("scissorsModeChanged", val);
    }

    get activeVisionFrames() { return this._activeVisionFrames; }
    set activeVisionFrames(val) {
        this._activeVisionFrames = val;
        this.emit("visionFramesUpdated", val);
    }

    get currentRightTab() { return this._currentRightTab; }
    set currentRightTab(val) {
        this._currentRightTab = val;
        this.emit("rightTabChanged", val);
    }

    get projectFps() { return this._projectFps; }
    set projectFps(val) {
        this._projectFps = Number(val) || 24;
        this.emit("projectFpsChanged", this._projectFps);
    }

    get activeTimelineCuts() { return this._activeTimelineCuts; }
    set activeTimelineCuts(val) {
        const fps = this._projectFps || 24;

        // Configuração dinâmica de pistas (via global para evitar ciclo de import).
        // Pistas "magnéticas" (ripple) recalculam posições sequencialmente;
        // as demais preservam o posicionamento livre do usuário.
        const timelineState = window.TIMELINE_STATE || null;
        const isMagnetic = (trackId) => {
            if (timelineState) {
                const t = timelineState.getTrack(trackId);
                if (t) return !!t.magnetic;
            }
            return trackId === "V1"; // fallback: comportamento legado
        };
        const kindOf = (trackId) => {
            if (timelineState) {
                const t = timelineState.getTrack(trackId);
                if (t) return t.kind || "video";
            }
            return "video";
        };

        const trackCursors = {}; // posição corrente por pista (para layout sequencial/append)

        // Frames SEMPRE em fps da timeline (nunca do vídeo fonte) — ver conformCuts
        const timelineFps = (timelineState && timelineState.fps) ? timelineState.fps : fps;

        this._activeTimelineCuts = (val || []).map((cut, index) => {
            const inFrame = cut.inFrame !== undefined ? cut.inFrame : Math.round(cut.in * timelineFps);
            const outFrame = cut.outFrame !== undefined ? cut.outFrame : Math.round(cut.out * timelineFps);
            const duration = outFrame - inFrame;

            const track = cut.track || "V1";
            let timelineStartFrame = cut.timelineStartFrame;

            // Compat: payloads do backend/agente posicionam em segundos (timeline_start)
            if ((timelineStartFrame === undefined || timelineStartFrame === null) &&
                cut.timeline_start !== undefined && cut.timeline_start !== null) {
                timelineStartFrame = Math.round(cut.timeline_start * timelineFps);
            }

            if (trackCursors[track] === undefined) trackCursors[track] = 0;

            if (isMagnetic(track)) {
                // Layout sequencial: cada clipe gruda no anterior da mesma pista
                timelineStartFrame = trackCursors[track];
                trackCursors[track] += duration;
            } else {
                if (timelineStartFrame === undefined || timelineStartFrame === null) {
                    // Sem posição definida: entra após o último clipe da pista
                    timelineStartFrame = trackCursors[track];
                }
                trackCursors[track] = Math.max(trackCursors[track], timelineStartFrame + duration);
            }

            return {
                ...cut,
                id: cut.id || `cut_${index}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                type: cut.type || "video",
                video_id: cut.video_id ?? null,
                photo_id: cut.photo_id ?? null,
                inFrame: Math.round(inFrame),
                outFrame: Math.round(outFrame),
                in: cut.in !== undefined ? cut.in : inFrame / timelineFps,
                out: cut.out !== undefined ? cut.out : outFrame / timelineFps,
                track: track,
                timelineStartFrame: Math.round(timelineStartFrame),
                // Mantém a chave em segundos sincronizada (evita valor obsoleto após drags)
                timeline_start: Math.round(timelineStartFrame) / timelineFps,
                link_id: cut.link_id || null
            };
        });

        // ── Sincronia A/V: áudio vinculado é ancorado ao clipe de vídeo par ──
        // Invariante: (timelineStartFrame - inFrame) do áudio == o do vídeo.
        // Trims independentes do áudio produzem J/L-cuts sem perder o sync, e o
        // ripple da pista magnética arrasta o áudio junto do vídeo.
        const videoByLink = {};
        this._activeTimelineCuts.forEach(c => {
            if (c.link_id && kindOf(c.track) === "video") videoByLink[c.link_id] = c;
        });
        this._activeTimelineCuts.forEach(c => {
            if (!c.link_id || kindOf(c.track) !== "audio") return;
            const v = videoByLink[c.link_id];
            if (!v) return;
            let start = v.timelineStartFrame - v.inFrame + c.inFrame;
            if (start < 0) {
                // Não existe timeline antes do 0: encurta a extensão do áudio
                c.inFrame -= start;
                c.in = c.inFrame / timelineFps;
                start = 0;
            }
            c.timelineStartFrame = start;
            c.timeline_start = start / timelineFps;
        });

        this.emit("timelineCutsUpdated", this._activeTimelineCuts);
    }

    get markerIn() { return this._markerIn; }
    set markerIn(val) {
        this._markerIn = val;
        this.emit("markerInChanged", val);
    }

    get markerOut() { return this._markerOut; }
    set markerOut(val) {
        this._markerOut = val;
        this.emit("markerOutChanged", val);
    }

    get allVideos() { return this._allVideos; }
    set allVideos(val) {
        this._allVideos = val;
        this.emit("videosUpdated", val);
    }

    get allPhotos() { return this._allPhotos; }
    set allPhotos(val) {
        this._allPhotos = val;
        this.emit("photosUpdated", val);
    }

    get activeConversions() { return this._activeConversions; }
    set activeConversions(val) {
        this._activeConversions = val;
        this.emit("conversionsUpdated", val);
    }

    get chatHistory() { return this._chatHistory; }
    set chatHistory(val) {
        this._chatHistory = val;
        this.emit("chatHistoryUpdated", val);
    }

    get playbackSpeed() { return this._playbackSpeed; }
    set playbackSpeed(val) {
        this._playbackSpeed = val;
        this.emit("playbackSpeedChanged", val);
    }

    get openFolders() { return this._openFolders; }
    get currentPhotoList() { return this._currentPhotoList; }
    set currentPhotoList(val) { this._currentPhotoList = val; }
    get currentPhotoIndex() { return this._currentPhotoIndex; }
    set currentPhotoIndex(val) { this._currentPhotoIndex = val; }
}

export const STATE = new AppState();
window.STATE = STATE;
