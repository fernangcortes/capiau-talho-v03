// Cliente unificado de comunicação com a API REST backend.

export class CapIAuAPI {
    static async request(endpoint, options = {}) {
        try {
            const response = await fetch(endpoint, options);
            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || `HTTP error! Status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`[API Error] Request failed for ${endpoint}:`, error);
            throw error;
        }
    }

    // -- Projetos & Documentos
    static fetchProjects() {
        return this.request("/api/projects");
    }

    static createProject(name, description) {
        return this.request("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description })
        });
    }

    static deleteProject(projectId) {
        return this.request(`/api/projects/${projectId}`, { method: "DELETE" });
    }

    static updateDriveLink(projectId, driveLink) {
        return this.request(`/api/project/${projectId}/drive-link`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ drive_link: driveLink })
        });
    }

    static fetchDocuments(projectId) {
        return this.request(`/api/project/${projectId}/docs`);
    }

    static deleteDocument(docId, projectId = 1) {
        return this.request(`/api/docs/${docId}?project_id=${projectId}`, { method: "DELETE" });
    }

    // -- Mídias (Vídeo, Foto, Rostos)
    static fetchVideos(projectId) {
        return this.request(`/api/videos?project_id=${projectId}`);
    }

    static fetchPhotos(projectId) {
        return this.request(`/api/photos?project_id=${projectId}`);
    }

    static deleteVideo(videoId) {
        return this.request(`/api/video/${videoId}`, { method: "DELETE" });
    }

    static deletePhoto(photoId) {
        return this.request(`/api/photo/${photoId}`, { method: "DELETE" });
    }

    static retryVideoProxy(videoId) {
        return this.request(`/api/video/${videoId}/retry`, { method: "POST" });
    }

    static retryPhotoProxy(photoId) {
        return this.request(`/api/photo/${photoId}/retry`, { method: "POST" });
    }

    static labelFace(faceId, name) {
        return this.request(`/api/face/${faceId}/label`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name })
        });
    }

    static fetchVideoFaces(videoId) {
        return this.request(`/api/video/${videoId}/faces`);
    }

    static fetchPhotoFaces(photoId) {
        return this.request(`/api/photo/${photoId}/faces`);
    }

    static fetchProjectSpeakers(projectId) {
        return this.request(`/api/project/${projectId}/speakers`);
    }

    // -- Ingestão e Processamento
    static selectFolder() {
        return this.request("/api/ingest/select-folder", { method: "POST" });
    }

    static triggerExternalIngest(path, projectId) {
        return this.request("/api/ingest/external", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path, project_id: projectId })
        });
    }

    static transcribeVideo(videoId) {
        return this.request(`/api/video/${videoId}/transcribe`, { method: "POST" });
    }

    static transcribeAll(projectId) {
        return this.request(`/api/project/${projectId}/transcribe-all`, { method: "POST" });
    }

    static analyzeVideoVision(videoId) {
        return this.request(`/api/video/${videoId}/analyze-vision`, { method: "POST" });
    }

    static analyzePhotoVision(photoId) {
        return this.request(`/api/photo/${photoId}/analyze-vision`, { method: "POST" });
    }

    static analyzeAllVision(projectId) {
        return this.request(`/api/project/${projectId}/analyze-all-vision`, { method: "POST" });
    }

    static fetchConversions() {
        return this.request("/api/conversions");
    }

    static cancelConversion(videoId) {
        return this.request(`/api/video/${videoId}/cancel-conversion`, { method: "POST" });
    }

    static deleteVideoProxy(videoId) {
        return this.request(`/api/video/${videoId}/proxy`, { method: "DELETE" });
    }

    static retryFailedConversions(projectId) {
        return this.request(`/api/project/${projectId}/retry-failed`, { method: "POST" });
    }

    static openProxiesFolder() {
        return this.request("/api/project/open-proxies-folder", { method: "POST" });
    }

    // -- Transcrições, Timelines, Clustering, Search & Chat
    static fetchTranscript(videoId) {
        return this.request(`/api/video/${videoId}/transcript`);
    }

    static fetchVideoVision(videoId, projectId = 1) {
        return this.request(`/api/video/${videoId}/vision?project_id=${projectId}`);
    }

    static clusterThemes(projectId) {
        return this.request(`/api/project/cluster-themes?project_id=${projectId}`, { method: "POST" });
    }

    static fetchThemes(projectId) {
        return this.request(`/api/themes?project_id=${projectId}`);
    }

    static search(query, projectId, mediaType = "") {
        let url = `/api/search?query=${encodeURIComponent(query)}&project_id=${projectId}`;
        if (mediaType) {
            url += `&media_type=${mediaType}`;
        }
        return this.request(url);
    }

    static saveTimeline(projectId, name, description, cuts) {
        return this.request("/api/timeline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projectId, name, description, cuts })
        });
    }

    static fetchTimelines(projectId) {
        return this.request(`/api/timeline?project_id=${projectId}`);
    }

    static splitTranscript(videoId, startTime, newSpeakerId) {
        return this.request(`/api/video/${videoId}/split-transcript`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start_time: startTime, new_speaker_id: newSpeakerId })
        });
    }

    static chat(projectId, message, history) {
        return this.request(`/api/project/${projectId}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, history })
        });
    }
}
