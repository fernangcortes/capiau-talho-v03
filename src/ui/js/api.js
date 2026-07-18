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
        return this.request(`/api/faces/face/${faceId}/label`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name })
        });
    }

    static rejectFace(faceId, name = "") {
        return this.request(`/api/faces/face/${faceId}/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name })
        });
    }

    static addManualFace(payload) {
        return this.request("/api/faces/face", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    }

    static fetchVideoFaces(videoId) {
        return this.request(`/api/faces/video/${videoId}/faces`);
    }

    static fetchPhotoFaces(photoId) {
        return this.request(`/api/faces/photo/${photoId}/faces`);
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

    static analyzeVideoVision(videoId, beatEmbedder = null) {
        const qs = beatEmbedder ? `?beat_embedder=${beatEmbedder}` : "";
        return this.request(`/api/video/${videoId}/analyze-vision${qs}`, { method: "POST" });
    }

    static analyzePhotoVision(photoId) {
        return this.request(`/api/photo/${photoId}/analyze-vision`, { method: "POST" });
    }

    static analyzeAllVision(projectId, force = false) {
        return this.request(`/api/project/${projectId}/analyze-all-vision?force=${force}`, { method: "POST" });
    }

    static fetchConversions() {
        // Timeout obrigatório: sem ele, um servidor engasgado deixa o pedido pendurado
        // para sempre e o laço da tela de Tarefas empilha conexões até estourar o limite
        // do navegador (6 por origem) — aí nem F5 recupera a página.
        return this.request("/api/conversions", { signal: AbortSignal.timeout(10000) });
    }

    static cancelConversion(videoId) {
        return this.request(`/api/video/${videoId}/cancel-conversion`, { method: "POST" });
    }

    static pauseThumbnails(videoId) {
        return this.request(`/api/video/${videoId}/pause-thumbnails`, { method: "POST" });
    }

    static resumeThumbnails(videoId) {
        return this.request(`/api/video/${videoId}/resume-thumbnails`, { method: "POST" });
    }

    static cancelThumbnails(videoId) {
        return this.request(`/api/video/${videoId}/cancel-thumbnails`, { method: "POST" });
    }

    static dismissTask(taskKey) {
        return this.request(`/api/task/${taskKey}`, { method: "DELETE" });
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

    static search(query, projectId, mediaType = "", limit = 30, offset = 0) {
        let url = `/api/search?query=${encodeURIComponent(query)}&project_id=${projectId}&limit=${limit}&offset=${offset}`;
        if (mediaType) {
            url += `&media_type=${mediaType}`;
        }
        return this.request(url);
    }

    static categorizeSearchResults(query, results) {
        return this.request("/api/search/categorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, results })
        });
    }

    static saveTimeline(projectId, name, description, cuts, tracks = null, fps = 24, width = 1920, height = 1080) {
        return this.request("/api/timeline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projectId, name, description, cuts, tracks, fps, width, height })
        });
    }

    static fetchTimelines(projectId) {
        return this.request(`/api/timeline?project_id=${projectId}`);
    }

    static fetchTimelineDetail(timelineId) {
        return this.request(`/api/timeline/${timelineId}`);
    }

    static aiSuggestTimeline(payload) {
        return this.request("/api/timeline/ai-suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    }

    static fetchThemeSegments(themeId) {
        return this.request(`/api/theme/${themeId}/segments`);
    }

    static fetchEntities(projectId) {
        return this.request(`/api/entities/project/${projectId}`);
    }

    static enrichProject(projectId) {
        return this.request(`/api/entities/project/${projectId}/enrich`, { method: "POST" });
    }

    static splitTranscript(videoId, startTime, newSpeakerId) {
        return this.request(`/api/video/${videoId}/split-transcript`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start_time: startTime, new_speaker_id: newSpeakerId })
        });
    }

    static renameSpeaker(videoId, oldSpeakerId, newSpeakerId, globalRename = false, startTime = null, endTime = null) {
        return this.request(`/api/video/${videoId}/rename-speaker`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                old_speaker_id: oldSpeakerId,
                new_speaker_id: newSpeakerId,
                global_rename: globalRename,
                start_time: startTime,
                end_time: endTime
            })
        });
    }

    static editDialogueSegment(videoId, startTime, endTime, newText, speakerId) {
        return this.request(`/api/video/${videoId}/edit-dialogue`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                start_time: startTime,
                end_time: endTime,
                new_text: newText,
                speaker_id: speakerId
            })
        });
    }

    static addThemeSegmentManual(themeId, projectId, videoId, startTime, endTime, speakerId, textExcerpt) {
        return this.request(`/api/theme/segment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                theme_id: themeId,
                project_id: projectId,
                video_id: videoId,
                start_time: startTime,
                end_time: endTime,
                speaker_id: speakerId,
                text_excerpt: textExcerpt
            })
        });
    }

    static deleteThemeSegment(segmentId) {
        return this.request(`/api/theme/segment/${segmentId}`, {
            method: "DELETE"
        });
    }

    static fetchDiarizationClues(videoId, silenceThreshold = 1.2, enableSilence = true, enableQuestions = true, enableFaces = true) {
        return this.request(`/api/video/${videoId}/diarization-clues?silence_threshold=${silenceThreshold}&enable_silence=${enableSilence}&enable_questions=${enableQuestions}&enable_faces=${enableFaces}`);
    }


    static chat(projectId, message, history, clips = null, tracks = null, fps = 24.0, agentModel = null, customApiKey = null) {
        const bodyData = { message, history };
        if (clips !== null) {
            const safeFps = Number(fps) || 24.0;
            bodyData.clips = clips.map(c => ({
                id: c.id,
                video_id: Number(c.video_id),
                in_s: Number(c.in),
                out_s: Number(c.out),
                // Clipes do frontend guardam a posição em frames (timelineStartFrame);
                // timeline_start (segundos) só existe em payloads vindos do backend
                timeline_start_s: (c.timelineStartFrame !== undefined && c.timelineStartFrame !== null)
                    ? c.timelineStartFrame / safeFps
                    : (Number(c.timeline_start) || 0),
                track: c.track || "V1",
                link_id: c.link_id || null,
                origin: c.origin || "user",
                alternatives: c.alternatives || [],
                effects: c.effects || []
            }));
            bodyData.tracks = tracks || [];
            bodyData.fps = Number(fps) || 24.0;
            if (agentModel) bodyData.agent_model = agentModel;
            if (customApiKey) bodyData.custom_api_key = customApiKey;
        }
        return this.request(`/api/project/${projectId}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyData)
        });
    }

    static fetchAgentModels() {
        return this.request("/api/agent/models");
    }

    static fetchFaceClusters(projectId) {
        return this.request(`/api/faces/project/${projectId}/face-clusters`);
    }

    static clusterFaces(projectId, eps = 0.38, minSamples = 3) {
        return this.request(`/api/faces/project/${projectId}/faces/cluster?eps=${eps}&min_samples=${minSamples}`, {
            method: "POST"
        });
    }

    static mergeClusters(projectId, srcClusterId, destClusterId, name) {
        return this.request(`/api/faces/project/${projectId}/faces/merge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ src_cluster_id: srcClusterId, dest_cluster_id: destClusterId, name })
        });
    }

    static reassignFaces(projectId, faceIds, targetClusterId, targetName) {
        return this.request(`/api/faces/project/${projectId}/faces/reassign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ face_ids: faceIds, target_cluster_id: targetClusterId, target_name: targetName })
        });
    }

    static renameProjectName(projectId, oldName, newName) {
        return this.request(`/api/faces/project/${projectId}/names/rename`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ old_name: oldName, new_name: newName })
        });
    }

    static deleteProjectName(projectId, name) {
        return this.request(`/api/faces/project/${projectId}/names/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name })
        });
    }

    static mergeProjectNames(projectId, srcName, destName) {
        return this.request(`/api/faces/project/${projectId}/names/merge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ src_name: srcName, dest_name: destName })
        });
    }

    static dissociateFaces(projectId, faceIds) {
        return this.request(`/api/faces/project/${projectId}/faces/dissociate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ face_ids: faceIds })
        });
    }

    static fetchClusterFaces(projectId, clusterId, name = null) {
        let url = `/api/faces/project/${projectId}/face-clusters/${clusterId}/faces`;
        if (name !== null && name !== undefined) {
            url += `?name=${encodeURIComponent(name)}`;
        }
        return this.request(url);
    }

    static fetchUnlabeledFaces(projectId) {
        return this.request(`/api/faces/project/${projectId}/unlabeled-faces`);
    }

    static fetchS3Status() {
        return this.request("/api/faces/pipeline/s3/status");
    }

    static backupDatabase() {
        return this.request("/api/project/backup-db", { method: "POST" });
    }

    // -- Painel de Configurações da IA
    static fetchSettingsRegistry() {
        return this.request("/api/settings/registry");
    }

    static fetchSettings(projectId = null) {
        const qs = projectId ? `?project_id=${projectId}` : "";
        return this.request(`/api/settings${qs}`);
    }

    static updateGlobalSettings(values) {
        return this.request("/api/settings/global", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values })
        });
    }

    static updateProjectSettings(projectId, values) {
        return this.request(`/api/settings/project/${projectId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values })
        });
    }

    static resetSettings(scope, projectId = null, keys = null) {
        const url = scope === "project"
            ? `/api/settings/project/${projectId}/reset`
            : "/api/settings/global/reset";
        return this.request(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keys })
        });
    }

    static applySettingsPreset(presetId, scope = "global", projectId = null) {
        return this.request("/api/settings/preset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preset_id: presetId, scope, project_id: projectId })
        });
    }

    static fetchPrompts(projectId = null) {
        const qs = projectId ? `?project_id=${projectId}` : "";
        return this.request(`/api/settings/prompts${qs}`);
    }

    static updatePrompt(promptId, template, scope = "global", projectId = null) {
        return this.request(`/api/settings/prompts/${encodeURIComponent(promptId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template, scope, project_id: projectId })
        });
    }

    static deletePromptOverride(promptId, scope = "global", projectId = null) {
        const qs = scope === "project" ? `?scope=project&project_id=${projectId}` : "?scope=global";
        return this.request(`/api/settings/prompts/${encodeURIComponent(promptId)}${qs}`, { method: "DELETE" });
    }
}

