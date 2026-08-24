// Gerenciador Central de Waveforms de Áudio Reais (CapIAu-Talho NLE)
// Gerencia cache em memória, carregamento assíncrono e extração de trechos para Timeline & Inspetor.

import { CapIAuAPI } from "./api.js";
import { STATE } from "./state.js";

class WaveformManagerClass {
    constructor() {
        // Cache em memória: videoId -> { sampleRate, duration, peaks: Float32Array }
        this.cache = new Map();
        // Promessas em voo para evitar requisições duplicadas para o mesmo vídeo
        this.inFlight = new Map();
        // Callbacks registrados para avisar componentes quando uma nova waveform chega
        this.listeners = new Set();
    }

    /**
     * Registra ouvinte para notificações de carregamento de waveform.
     * @param {Function} callback - Chamado com (videoId, data)
     */
    addListener(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    _notify(videoId, data) {
        this.listeners.forEach(fn => {
            try { fn(videoId, data); } catch (e) { console.error("[WaveformManager] Listener error:", e); }
        });
        // Dispara evento global no STATE se disponível
        if (STATE && typeof STATE.emit === "function") {
            STATE.emit("waveformLoaded", { videoId, data });
        }
    }

    /**
     * Retorna os dados de waveform se já estiverem em cache (síncrono), ou null se ainda não carregou.
     * @param {number|string} videoId 
     * @returns {{ sampleRate: number, duration: number, peaks: Float32Array } | null}
     */
    getCached(videoId) {
        if (!videoId) return null;
        const id = Number(videoId);
        return this.cache.get(id) || null;
    }

    /**
     * Indica se a waveform deste vídeo está atualmente sendo gerada/carregada em background.
     * @param {number|string} videoId 
     * @returns {boolean}
     */
    isLoading(videoId) {
        if (!videoId) return false;
        const id = Number(videoId);
        return this.inFlight.has(id);
    }

    /**
     * Indica se existe qualquer waveform sendo extraída no momento.
     * @returns {boolean}
     */
    hasInFlight() {
        return this.inFlight.size > 0;
    }

    /**
     * Limpa o cache em memória (geral ou de um vídeo específico).
     * @param {number|string|null} videoId 
     */
    clearCache(videoId = null) {
        if (videoId) {
            const id = Number(videoId);
            this.cache.delete(id);
            this.inFlight.delete(id);
        } else {
            this.cache.clear();
            this.inFlight.clear();
        }
    }

    /**
     * Obtém a waveform do vídeo. Se não estiver em cache, dispara a requisição e retorna uma Promise.
     * @param {number|string} videoId 
     * @param {boolean} force 
     * @returns {Promise<{ sampleRate: number, duration: number, peaks: Float32Array, failed?: boolean } | null>}
     */
    async getWaveform(videoId, force = false) {
        if (!videoId) return null;
        const id = Number(videoId);

        if (!force && this.cache.has(id)) {
            return this.cache.get(id);
        }

        if (!force && this.inFlight.has(id)) {
            return this.inFlight.get(id);
        }

        const promise = (async () => {
            try {
                const res = await CapIAuAPI.fetchVideoWaveform(id, force);
                if (res && Array.isArray(res.peaks) && res.peaks.length > 0) {
                    const waveformData = {
                        videoId: id,
                        sampleRate: res.sample_rate || 100,
                        duration: res.duration || 0.0,
                        peaks: new Float32Array(res.peaks),
                        failed: false
                    };
                    this.cache.set(id, waveformData);
                    this._notify(id, waveformData);
                    return waveformData;
                } else {
                    // Armazena estado de falha para não refazer requisição infinitamente
                    const failedData = {
                        videoId: id,
                        sampleRate: 100,
                        duration: 0.0,
                        peaks: new Float32Array(0),
                        failed: true,
                        error: res?.error || "Waveform sem dados"
                    };
                    this.cache.set(id, failedData);
                    this._notify(id, failedData);
                    return failedData;
                }
            } catch (err) {
                console.warn(`[WaveformManager] Falha ao carregar waveform do vídeo ${id}:`, err);
                const failedData = {
                    videoId: id,
                    sampleRate: 100,
                    duration: 0.0,
                    peaks: new Float32Array(0),
                    failed: true,
                    error: err.message
                };
                this.cache.set(id, failedData);
                this._notify(id, failedData);
                return failedData;
            } finally {
                this.inFlight.delete(id);
            }
        })();

        this.inFlight.set(id, promise);
        return promise;
    }

    /**
     * Pré-carrega waveforms para uma lista de clipes/cortes da timeline.
     * @param {Array<Object>} cuts 
     */
    preloadForClips(cuts) {
        if (!cuts || !Array.isArray(cuts)) return;
        const videoIds = new Set();
        cuts.forEach(c => {
            if (c && c.video_id) videoIds.add(Number(c.video_id));
        });

        videoIds.forEach(id => {
            if (!this.cache.has(id) && !this.inFlight.has(id)) {
                this.getWaveform(id);
            }
        });
    }

    /**
     * Extrai os picos Min/Max para um intervalo de tempo [startTime, endTime].
     * @param {number|string} videoId 
     * @param {number} startTime - Em segundos
     * @param {number} endTime - Em segundos
     * @param {number} targetPoints - Quantidade aproximada de pontos horizontais desejada
     * @returns {{ hasData: boolean, failed?: boolean, peaks: Array<{ min: number, max: number }>, sampleRate: number }}
     */
    getSampledEnvelope(videoId, startTime, endTime, targetPoints = 100) {
        const cached = this.getCached(videoId);
        if (!cached) {
            // Dispara carregamento em background uma única vez
            this.getWaveform(videoId);
            return { hasData: false, failed: false, peaks: [], sampleRate: 100 };
        }

        if (cached.failed || !cached.peaks || cached.peaks.length === 0) {
            return { hasData: false, failed: true, peaks: [], sampleRate: 100 };
        }

        const sampleRate = cached.sampleRate || 100;
        const peaks = cached.peaks; // Float32Array [min0, max0, min1, max1, ...]
        const totalBuckets = peaks.length / 2;

        const dur = Math.max(0.001, endTime - startTime);
        const startBucket = Math.max(0, Math.floor(startTime * sampleRate));
        const endBucket = Math.min(totalBuckets, Math.ceil(endTime * sampleRate));
        const rangeBuckets = Math.max(1, endBucket - startBucket);

        const result = [];
        const numPoints = Math.max(5, Math.min(targetPoints, rangeBuckets * 2));

        for (let i = 0; i < numPoints; i++) {
            // Mapeia o ponto i para a fração correspondente no intervalo
            const fStart = i / numPoints;
            const fEnd = (i + 1) / numPoints;

            const b0 = Math.min(totalBuckets - 1, Math.max(0, Math.floor(startBucket + fStart * rangeBuckets)));
            const b1 = Math.min(totalBuckets - 1, Math.max(0, Math.ceil(startBucket + fEnd * rangeBuckets)));

            let minVal = 0.0;
            let maxVal = 0.0;

            if (b0 <= b1) {
                minVal = 1.0;
                maxVal = -1.0;
                for (let b = b0; b <= b1; b++) {
                    const idx = b * 2;
                    const vMin = peaks[idx];
                    const vMax = peaks[idx + 1];
                    if (vMin < minVal) minVal = vMin;
                    if (vMax > maxVal) maxVal = vMax;
                }
                if (minVal > maxVal) {
                    minVal = 0.0;
                    maxVal = 0.0;
                }
            } else {
                const idx = b0 * 2;
                minVal = peaks[idx] || 0.0;
                maxVal = peaks[idx + 1] || 0.0;
            }

            result.push({ min: minVal, max: maxVal });
        }

        return {
            hasData: true,
            peaks: result,
            sampleRate
        };
    }
}

export const WaveformManager = new WaveformManagerClass();
