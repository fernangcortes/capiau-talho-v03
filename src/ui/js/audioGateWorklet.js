// Gate de áudio AO VIVO (Etapa 2, Tipo A) - processador de AudioWorklet.
// Carregado pelo player via audioWorklet.addModule("js/audioGateWorklet.js").
//
// Comportamento (contrato E1/E2): abaixo do limiar em dBFS ATENUA o sinal;
// acima dele, deixa passar. O detector usa o pico absoluto do bloco (referência
// do canal 0) e o ganho é suavizado por amostra (one-pole) para não estalar.
//
// CONSTANTES ESCOLHIDAS (documentação do comportamento):
//   ataque    = 0.005 s (5 ms)  - abre rápido o suficiente para não cortar o
//                                 início de palavra; o ganho também nasce aberto
//                                 (1.0) na criação do nó, então o primeiro som
//                                 nunca é cortado.
//   liberação = 0.080 s (80 ms) - fecha devagar para não "respirar" nem picotar
//                                 caudas curtas entre palavras.
// Ambos são AudioParam k-rate e podem ser afinados sem recarregar o módulo.

class CapIAuGateProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: "threshold", defaultValue: -45, minValue: -90, maxValue: 0, automationRate: "k-rate" },
            { name: "attack", defaultValue: 0.005, minValue: 0.0005, maxValue: 0.05, automationRate: "k-rate" },
            { name: "release", defaultValue: 0.08, minValue: 0.005, maxValue: 0.5, automationRate: "k-rate" }
        ];
    }

    constructor() {
        super();
        this._ganho = 1.0; // começa aberto: nunca corta o começo do primeiro som
    }

    process(inputs, outputs, params) {
        const output = outputs[0];
        const saida0 = output && output[0];
        if (!saida0) return true;

        const n = saida0.length;
        const entrada = inputs[0];

        // Detector: pico absoluto do bloco no canal 0.
        let pico = 0;
        if (entrada && entrada.length && entrada[0]) {
            const ent0 = entrada[0];
            for (let i = 0; i < n; i++) {
                const a = ent0[i] < 0 ? -ent0[i] : ent0[i];
                if (a > pico) pico = a;
            }
        }

        // Limiar em dBFS -> linear. Acima do limiar o alvo é 1 (passa); abaixo, 0 (atenua).
        const thLin = Math.pow(10, params.threshold[0] / 20);
        const alvo = pico >= thLin ? 1 : 0;

        // Coeficientes one-pole por amostra a partir das constantes de tempo.
        const coefAbre = Math.exp(-1 / (Math.max(0.0005, params.attack[0]) * sampleRate));
        const coefFecha = Math.exp(-1 / (Math.max(0.005, params.release[0]) * sampleRate));
        const coef = alvo > this._ganho ? coefAbre : coefFecha;

        let g = this._ganho;
        for (let i = 0; i < n; i++) {
            g = alvo + (g - alvo) * coef;
            for (let ch = 0; ch < output.length; ch++) {
                const entCh = entrada && entrada[ch];
                output[ch][i] = (entCh && entCh[i] ? entCh[i] : 0) * g;
            }
        }
        this._ganho = g;
        return true; // mantém o processador vivo mesmo durante silêncio
    }
}

registerProcessor("capiau-audio-gate", CapIAuGateProcessor);
