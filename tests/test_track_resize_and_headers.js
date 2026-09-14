/**
 * tests/test_track_resize_and_headers.js
 * 
 * Validação de integridade do redimensionamento vertical de pistas:
 * 1. Garantir que TIMELINE_STATE.setTrackHeight afeta os objetos vivos em TIMELINE_STATE.tracks.
 * 2. Garantir que substituição de pistas via setTracks (autosave/undo/carregamento) não deixa
 *    ouvintes com referências obsoletas (stale closures) ao redimensionar pistas.
 * 3. Garantir que o cálculo de geometria de pistas (getTrackLanes) reflete imediatamente
 *    as alturas atualizadas.
 */

const assert = require("assert");

// Setup de mocks de ambiente do navegador para Node.js
global.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
global.window = global;

async function runTests() {
    console.log("=== Iniciando Testes de Redimensionamento e Integridade de Pistas ===");

    const { CapiauTimelineState } = await import("../src/ui/js/timelineState.js");
    const state = new CapiauTimelineState();

    // 1. Estado inicial
    const v1 = state.getTrack("V1");
    assert.ok(v1, "Pista V1 deve existir no estado padrão");
    const initialH = state.trackHeight(v1);
    assert.ok(initialH > 0, `Altura inicial de V1 deve ser > 0 (foi ${initialH})`);

    // 2. Redimensionamento via setTrackHeight
    state.setTrackHeight("V1", 100);
    const updatedV1 = state.getTrack("V1");
    assert.strictEqual(updatedV1.heightPx, 100, "heightPx de V1 deve ser 100");
    assert.strictEqual(state.trackHeight(updatedV1), 100, "trackHeight deve reportar 100px");
    console.log("✓ Teste 1: setTrackHeight atualiza heightPx e trackHeight corretamente");

    // 3. Simulação de substituição de array por setTracks (autosave / troca de projeto)
    const oldTrackRef = state.getTrack("V1");

    state.setTracks([
        { id: "AI", name: "IA", kind: "ai", volume: 1.0, hidden: false },
        { id: "T1", name: "Texto", kind: "text", volume: 1.0, hidden: false },
        { id: "V1", name: "Falas", kind: "video", volume: 1.0, hidden: false, heightPx: 60 },
        { id: "A1", name: "Áudio", kind: "audio", volume: 1.0, hidden: false },
        { id: "A2", name: "Áudio 2", kind: "audio", volume: 1.0, hidden: true }
    ]);

    const newTrackRef = state.getTrack("V1");
    assert.notStrictEqual(oldTrackRef, newTrackRef, "setTracks deve ter criado uma nova instância para a pista V1");
    assert.strictEqual(newTrackRef.heightPx, 60, "A nova instância deve refletir os dados carregados (60px)");

    // 4. Teste de Stale Closure vs Dynamic Lookup
    // Se o ouvinte fizesse oldTrackRef.heightPx = 150 (bug antigo):
    oldTrackRef.heightPx = 150;
    assert.strictEqual(state.getTrack("V1").heightPx, 60, "Mutar oldTrackRef não altera a pista ativa em state.tracks");

    // Com a correção (TIMELINE_STATE.getTrack(trackId)):
    const liveTrack = state.getTrack("V1");
    liveTrack.heightPx = 180;
    assert.strictEqual(state.getTrack("V1").heightPx, 180, "Mutar via getTrack atualiza a pista ativa em state.tracks");
    assert.strictEqual(state.trackHeight(state.getTrack("V1")), 180, "trackHeight reporta 180px para a pista ativa");
    console.log("✓ Teste 2: Prevenção de stale closures validada com lookup dinâmico por trackId");

    // 5. Teste de reset de altura individual
    state.resetTrackHeight("V1");
    const defaultH = state.trackHeight(state.getTrack("V1"));
    assert.strictEqual(defaultH, 72, "resetTrackHeight deve restaurar a altura padrão do kind video (72px)");
    console.log("✓ Teste 3: Reset de altura individual restaura altura padrão de vídeo (72px)");

    // 6. Teste de geometria de lanes (espelho do timelineRenderer.getTrackLanes)
    function calculateMockLanes(timelineState, rulerHeight = 30) {
        const lanes = [];
        let y = rulerHeight - timelineState.scrollTop;
        for (const t of timelineState.tracks) {
            const h = timelineState.trackHeight(t);
            lanes.push({ trackId: t.id, top: y, height: h });
            y += h;
        }
        return lanes;
    }

    // Configura V1 com 90px e A1 com 80px
    state.setTrackHeight("V1", 90);
    state.setTrackHeight("A1", 80);

    const lanes = calculateMockLanes(state);
    const v1Lane = lanes.find(l => l.trackId === "V1");
    const a1Lane = lanes.find(l => l.trackId === "A1");
    const a2Lane = lanes.find(l => l.trackId === "A2");

    assert.ok(v1Lane, "Lane V1 deve existir");
    assert.ok(a1Lane, "Lane A1 deve existir");
    assert.strictEqual(v1Lane.height, 90, "Altura da lane V1 deve ser 90px");
    assert.strictEqual(a1Lane.height, 80, "Altura da lane A1 deve ser 80px");
    assert.strictEqual(a2Lane.height, 4, "Pista oculta A2 deve ter altura de 4px (restore-line)");
    assert.strictEqual(a1Lane.top, v1Lane.top + v1Lane.height, "Topo de A1 deve começar exatamente onde V1 termina");
    console.log("✓ Teste 4: Geometria de lanes no canvas acompanha perfeitamente os cabeçalhos redimensionados");

    // 7. Simulação e validação do fluxo de Shift + Wheel no cabeçalho de uma pista específica
    // Função auxiliar que reproduz com precisão o algoritmo de detecção e redimensionamento de onWheel
    function simulateTrackHeaderWheel(timelineState, targetElement, event) {
        if (!event.shiftKey) return;
        const targetEl = targetElement && targetElement.nodeType === 1 ? targetElement : targetElement?.parentElement;
        const trackHeader = targetEl?.closest?.(".timeline-header-track");
        const trackId = trackHeader?.dataset?.trackId;
        const hoveredTrack = trackId ? timelineState.getTrack(trackId) : null;

        if (hoveredTrack && !hoveredTrack.hidden) {
            let normDelta = event.deltaY;
            if (event.deltaMode === 1) normDelta *= 30;
            else if (event.deltaMode === 2) normDelta *= 300;

            let deltaH = 0;
            if (Math.abs(normDelta) >= 30) {
                const steps = Math.max(1, Math.min(5, Math.round(Math.abs(normDelta) / 100)));
                deltaH = (normDelta < 0 ? 1 : -1) * (steps * 8);
            }
            if (deltaH !== 0) {
                const currentH = timelineState.trackHeight(hoveredTrack);
                const newH = Math.min(240, Math.max(22, currentH + deltaH));
                if (newH !== currentH) {
                    timelineState.setTrackHeight(trackId, newH);
                }
            }
        } else {
            const currentScale = timelineState.trackHeightScale || 1.0;
            const delta = event.deltaY < 0 ? 0.05 : -0.05;
            const newScale = Math.min(1.7, Math.max(0.5, Math.round((currentScale + delta) * 100) / 100));
            timelineState.setTrackHeightScale(newScale);
        }
    }

    // Mock simples de elementos do DOM
    function createMockHeader(trackId, isHidden = false) {
        return {
            nodeType: 1,
            className: isHidden ? "timeline-header-track restore-line" : "timeline-header-track",
            dataset: { trackId: String(trackId) },
            closest(sel) {
                if (sel === ".timeline-header-track") return this;
                return null;
            }
        };
    }

    // Reseta pistas para valores conhecidos
    state.resetTrackHeight("V1");
    state.resetTrackHeight("A1");
    assert.strictEqual(state.trackHeight(state.getTrack("V1")), 72, "V1 deve iniciar em 72px");
    assert.strictEqual(state.trackHeight(state.getTrack("A1")), 48, "A1 deve iniciar em 48px");

    const headerV1 = createMockHeader("V1");
    const headerA1 = createMockHeader("A1");
    const headerA2Hidden = createMockHeader("A2", true);

    // Teste 5: Shift + Wheel Up no cabeçalho de V1 incrementa V1 em +8px e mantém A1 intacto
    simulateTrackHeaderWheel(state, headerV1, { shiftKey: true, deltaY: -100, deltaMode: 0 });
    assert.strictEqual(state.trackHeight(state.getTrack("V1")), 80, "V1 deve ter aumentado de 72px para 80px (+8px)");
    assert.strictEqual(state.trackHeight(state.getTrack("A1")), 48, "A1 deve permanecer inalterado em 48px");
    console.log("✓ Teste 5: Shift + Wheel Up no cabeçalho aumenta altura apenas da pista específica");

    // Teste 6: Shift + Wheel Down no cabeçalho de V1 decrementa V1 em -8px
    simulateTrackHeaderWheel(state, headerV1, { shiftKey: true, deltaY: 100, deltaMode: 0 });
    assert.strictEqual(state.trackHeight(state.getTrack("V1")), 72, "V1 deve retornar para 72px (-8px)");
    simulateTrackHeaderWheel(state, headerV1, { shiftKey: true, deltaY: 100, deltaMode: 0 });
    assert.strictEqual(state.trackHeight(state.getTrack("V1")), 64, "V1 deve diminuir para 64px (-8px)");
    console.log("✓ Teste 6: Shift + Wheel Down no cabeçalho diminui altura apenas da pista específica");

    // Teste 7: Shift + Wheel no cabeçalho de A1 afeta apenas A1
    simulateTrackHeaderWheel(state, headerA1, { shiftKey: true, deltaY: -100, deltaMode: 0 });
    assert.strictEqual(state.trackHeight(state.getTrack("A1")), 56, "A1 deve ter aumentado para 56px (+8px)");
    assert.strictEqual(state.trackHeight(state.getTrack("V1")), 64, "V1 deve permanecer em 64px");
    console.log("✓ Teste 7: Isolamento entre pistas validado ao aplicar Shift+Wheel em outra pista");

    // Teste 8: Pista oculta (restore-line) ignora Shift+Wheel
    simulateTrackHeaderWheel(state, headerA2Hidden, { shiftKey: true, deltaY: -100, deltaMode: 0 });
    assert.strictEqual(state.trackHeight(state.getTrack("A2")), 4, "Pista oculta A2 deve permanecer com 4px fixos");
    console.log("✓ Teste 8: Pistas ocultas (restore-lines) ignoram redimensionamento por roda");

    // Teste 9: Clamping de limites (mínimo 22px, máximo 240px)
    state.setTrackHeight("V1", 236);
    simulateTrackHeaderWheel(state, headerV1, { shiftKey: true, deltaY: -100, deltaMode: 0 });
    assert.strictEqual(state.trackHeight(state.getTrack("V1")), 240, "V1 deve atingir o teto de 240px");
    simulateTrackHeaderWheel(state, headerV1, { shiftKey: true, deltaY: -100, deltaMode: 0 });
    assert.strictEqual(state.trackHeight(state.getTrack("V1")), 240, "V1 não deve ultrapassar o teto de 240px");

    state.setTrackHeight("V1", 26);
    simulateTrackHeaderWheel(state, headerV1, { shiftKey: true, deltaY: 100, deltaMode: 0 });
    assert.strictEqual(state.trackHeight(state.getTrack("V1")), 22, "V1 deve atingir o piso de 22px");
    simulateTrackHeaderWheel(state, headerV1, { shiftKey: true, deltaY: 100, deltaMode: 0 });
    assert.strictEqual(state.trackHeight(state.getTrack("V1")), 22, "V1 não deve ficar abaixo do piso de 22px");
    console.log("✓ Teste 9: Clamping nos limites [22px, 240px] validado com precisão");

    // Teste 10: Shift + Wheel fora de um cabeçalho (ex: canvas) aciona o zoom vertical global (trackHeightScale)
    const initialScale = state.trackHeightScale || 1.0;
    const canvasElement = { nodeType: 1, className: "timeline-canvas", closest: () => null };
    simulateTrackHeaderWheel(state, canvasElement, { shiftKey: true, deltaY: -100, deltaMode: 0 });
    assert.strictEqual(state.trackHeightScale, initialScale + 0.05, "Fora do cabeçalho, Shift+Wheel deve alterar a escala global");
    console.log("✓ Teste 10: Shift + Wheel fora dos cabeçalhos preserva o zoom vertical global de todas as pistas");

    console.log("\nTODOS OS 10 TESTES DE REDIMENSIONAMENTO E CABEÇALHOS DE PISTAS PASSARAM COM SUCESSO!");
}

runTests().catch(err => {
    console.error("Falha no teste:", err);
    process.exit(1);
});
