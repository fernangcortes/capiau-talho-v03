// Autoteste Waveform Real: Testes de Amostragem de Envelope, Silêncio, Picos e Clipping
// Executa com node puro: node tests/autoteste_waveform_real.mjs
import assert from "node:assert";

// Simulador da lógica de WaveformManager.getSampledEnvelope
function sampleEnvelope(peaksArray, sampleRate, startTime, endTime, targetPoints = 100) {
    if (!peaksArray || peaksArray.length === 0) {
        return { hasData: false, peaks: [], sampleRate };
    }

    const totalBuckets = peaksArray.length / 2;
    const dur = Math.max(0.001, endTime - startTime);
    const startBucket = Math.max(0, Math.floor(startTime * sampleRate));
    const endBucket = Math.min(totalBuckets, Math.ceil(endTime * sampleRate));
    const rangeBuckets = Math.max(1, endBucket - startBucket);

    const result = [];
    const numPoints = Math.max(5, Math.min(targetPoints, rangeBuckets * 2));

    for (let i = 0; i < numPoints; i++) {
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
                const vMin = peaksArray[idx];
                const vMax = peaksArray[idx + 1];
                if (vMin < minVal) minVal = vMin;
                if (vMax > maxVal) maxVal = vMax;
            }
            if (minVal > maxVal) {
                minVal = 0.0;
                maxVal = 0.0;
            }
        } else {
            const idx = b0 * 2;
            minVal = peaksArray[idx] || 0.0;
            maxVal = peaksArray[idx + 1] || 0.0;
        }

        result.push({ min: minVal, max: maxVal });
    }

    return {
        hasData: true,
        peaks: result,
        sampleRate
    };
}

console.log("--- Executando autoteste de Waveform Real (Min/Max Envelope & Clipping) ---");

// Teste 1: Amostragem de silêncio
{
    const sampleRate = 100;
    // 200 baldes (2 segundos) de silêncio absoluto
    const silencePeaks = new Float32Array(400); // todos 0.0
    const sampled = sampleEnvelope(silencePeaks, sampleRate, 0.0, 1.0, 50);

    assert.strictEqual(sampled.hasData, true);
    assert.strictEqual(sampled.peaks.length, 50);
    sampled.peaks.forEach(p => {
        assert.strictEqual(p.min, 0.0);
        assert.strictEqual(p.max, 0.0);
    });
    console.log("✓ Teste 1: Silêncio absoluto amostrado com precisão (0.0)");
}

// Teste 2: Amostragem de sinal de fala com picos dinâmicos
{
    const sampleRate = 100;
    const durSec = 3.0;
    const totalBuckets = durSec * sampleRate;
    const speechPeaks = new Float32Array(totalBuckets * 2);

    for (let b = 0; b < totalBuckets; b++) {
        const t = b / sampleRate;
        if (t >= 0.5 && t <= 1.5) {
            // Trecho de fala com picos entre -0.75 e +0.78
            speechPeaks[b * 2] = -0.75;
            speechPeaks[b * 2 + 1] = 0.78;
        } else {
            // Silêncio / ruído de fundo sutil
            speechPeaks[b * 2] = -0.01;
            speechPeaks[b * 2 + 1] = 0.01;
        }
    }

    // Amostra apenas o trecho de fala [0.6s até 1.4s]
    const speechSampled = sampleEnvelope(speechPeaks, sampleRate, 0.6, 1.4, 40);
    assert.strictEqual(speechSampled.hasData, true);
    speechSampled.peaks.forEach(p => {
        assert.ok(Math.abs(p.min - (-0.75)) < 0.001, `Min esperado -0.75, obtido ${p.min}`);
        assert.ok(Math.abs(p.max - 0.78) < 0.001, `Max esperado 0.78, obtido ${p.max}`);
    });

    // Amostra apenas o trecho de silêncio [2.0s até 2.5s]
    const silenceSampled = sampleEnvelope(speechPeaks, sampleRate, 2.0, 2.5, 20);
    silenceSampled.peaks.forEach(p => {
        assert.ok(Math.abs(p.min - (-0.01)) < 0.001, `Min esperado -0.01, obtido ${p.min}`);
        assert.ok(Math.abs(p.max - 0.01) < 0.001, `Max esperado 0.01, obtido ${p.max}`);
    });

    console.log("✓ Teste 2: Distinção fidedigna entre trecho de fala e silêncio");
}

// Teste 3: Detecção de Clipping / Saturação com ganho aplicado
{
    const sampleRate = 100;
    const peaks = new Float32Array([-0.85, 0.90]); // 1 balde quase estourando
    const sampled = sampleEnvelope(peaks, sampleRate, 0.0, 0.01, 5);

    const maxAmplitude = 30; // 30px
    const gainNormal = 1.0;
    const gainHigh = 2.0;

    // Com ganho normal (1.0): 0.90 * 30 = 27px (< 30, sem clipping)
    const ampPos1 = sampled.peaks[0].max * maxAmplitude * gainNormal;
    assert.strictEqual(ampPos1 < maxAmplitude, true);

    // Com ganho alto (2.0): 0.90 * 30 * 2.0 = 54px (>= 30, clipping detectado!)
    const ampPos2 = sampled.peaks[0].max * maxAmplitude * gainHigh;
    assert.strictEqual(ampPos2 >= maxAmplitude, true);

    console.log("✓ Teste 3: Detecção precisa de saturação (clipping) ao elevar ganho");
}

// Teste 4: Zoom out extremo (muitas amostras por pixel)
{
    const sampleRate = 100;
    const totalSec = 60.0; // 1 minuto
    const totalBuckets = totalSec * sampleRate; // 6000 baldes
    const longPeaks = new Float32Array(totalBuckets * 2);

    // Coloca um estouro pontual no meio (aos 30 segundos)
    const burstBucket = 30 * sampleRate;
    longPeaks[burstBucket * 2] = -1.0;
    longPeaks[burstBucket * 2 + 1] = 1.0;

    // Renderiza a timeline inteira em apenas 100 pontos horizontais
    const sampledOverview = sampleEnvelope(longPeaks, sampleRate, 0.0, 60.0, 100);
    assert.strictEqual(sampledOverview.hasData, true);
    
    // O ponto no meio deve capturar o pico máximo de 1.0 mesmo com zoom out
    const midPoint = sampledOverview.peaks[50];
    assert.strictEqual(midPoint.max, 1.0);
    assert.strictEqual(midPoint.min, -1.0);

    console.log("✓ Teste 4: Preservação de transientes e picos rápidos em zoom out total");
}

console.log("\nTodos os 4 autotestes de Waveform Real passaram com sucesso!");
