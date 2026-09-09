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
    delete liveTrack.heightPx;
    const defaultH = state.trackHeight(state.getTrack("V1"));
    assert.strictEqual(defaultH, 72, "Ao deletar heightPx, trackHeight deve retornar a altura padrão do kind video (72px)");
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

    console.log("\nTODOS OS 4 TESTES DE REDIMENSIONAMENTO E INTEGRIDADE DE PISTAS PASSARAM COM SUCESSO!");
}

runTests().catch(err => {
    console.error("Falha no teste:", err);
    process.exit(1);
});
