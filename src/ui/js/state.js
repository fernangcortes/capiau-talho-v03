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
        this._activeTranscript = [];
        this._activeTranscriptWords = [];
        this._activeScissorsMode = false;
        this._activeVisionFrames = [];
        this._currentRightTab = "transcript";
        this._activeTimelineCuts = [];
        this._markerIn = null;
        this._markerOut = null;
        
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
        this._activeVideo = val;
        this.emit("activeVideoChanged", val);
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

    get activeTimelineCuts() { return this._activeTimelineCuts; }
    set activeTimelineCuts(val) {
        this._activeTimelineCuts = val;
        this.emit("timelineCutsUpdated", val);
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
