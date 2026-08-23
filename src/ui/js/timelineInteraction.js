// Controlador de Interatividade, Cliques e Atalhos da Timeline (CapIAu-Talho)
import { STATE } from "./state.js";
import { TIMELINE_STATE, TIMELINE_HISTORY, secondsToFrames, framesToSeconds, framesToTimecode, evaluateFadeCurve, FADE_CURVE_PRESETS } from "./timelineState.js";
import { setTabVisibility } from "./tabsCustomization.js";

// Velocidades de render MEDIDAS nesta máquina (NÃO estimadas), do benchmark da
// casa com 22 min (= 1320 s) de áudio de entrevista:
//   - cadeia ffmpeg .... 31 a 44x tempo real (22 min de áudio → ~30 s de render)
//   - denoise por IA ... par medido 22 min de áudio → ~11 min de worker
// A IA é ordem de grandeza DEZENAS de vezes mais lenta que a cadeia ffmpeg
// (relatos pontuais de RTF variam — 0,7x/0,82 — mas nenhum se aproxima do
// ffmpeg; adotamos o par medido do benchmark, que é o que o usuário vê na
// parede). A estimativa usa o PISO da faixa ffmpeg para nunca prometer pressa.
// Espelho do custo documentado em PRESETS_CADEIA (src/media/audio_chain.py).
const VELOCIDADE_RENDER_FFMPEG_X_TEMPO_REAL = 31;    // medido: faixa 31–44x tempo real; piso conservador
// Medido em 23/08/2026 nesta máquina: 20,0 s de áudio processados em 13,6 s de
// worker, ou seja RTF 0,68 -> o áudio sai a 1/0,68 = 1,47x o tempo real.
// (Uma entrevista de 16 min leva ~11 min; uma de 22 min, ~15 min. O par
// "22 min -> 11 min" que circulou antes misturava duas entrevistas diferentes e
// subestimava a espera em cerca de 30%.)
const VELOCIDADE_RENDER_DENOISE_IA_X_TEMPO_REAL = 1.47;

export class CapiauTimelineInteraction {
    constructor(renderer) {
        this.renderer = renderer;
        this.canvas = renderer.canvas;
        
        // Estado local de interação
        this.dragState = null; // null, "scrub", "drag-clip", "trim-left", "trim-right", "pan", "fade-in-drag", "fade-out-drag", "fade-in-curve", "fade-out-curve"
        this.draggedClipId = null;
        this.dragStartMouseX = 0;
        this.dragStartMouseY = 0;
        this.dragStartClipFrame = 0;
        this.dragStartInFrame = 0;
        this.dragStartOutFrame = 0;
        this.dragStartFadeDur = 0;
        this.dragStartTension = 0;
        this.dragFadeSide = "in";

        // Cache de diagnósticos de áudio já buscados, chave "video_id|in|out" (somente leitura)
        this.audioDiagCache = {};

        // Estado do bloco "onde estourou" (lista clicável dentro do diagnóstico)
        this._audioDiagLastData = null;
        this._audioDiagMomentsExpanded = false;

        // Etapa 3 (contrato F2): chain_hash por clipe para o GET de acompanhamento do
        // render. O efeito no clipe segue o contrato F3 e NÃO carrega chain_hash, então
        // ele mora aqui, na sessão. Geração por clipe cancela loops de acompanhamento antigos.
        this._audioRenderHashes = {};
        this._audioRenderGeracoes = {};

        // H6: cota do Auphonic decidida pelo SERVIDOR (GET /api/audio/nuvem/cota), com
        // cache curto de sessão para não pingar o servidor a cada redesenho do painel;
        // tamanhos dos WAVs tratados quando a resposta do render os traz.
        this._cotaCacheDados = null;      // última resposta da rota de cota (ou null)
        this._cotaCacheQuando = 0;        // Date.now() da consulta
        this._cotaEmVoo = null;           // dedupe de consultas concorrentes
        this._audioRenderTamanhos = {};   // ref -> tamanho_bytes (quando a resposta trouxer)
        this._fetchCotaDuble = null;      // dublê de transporte para testes
        this._clipboardDuble = null;      // dublê da área de transferência para testes

        // L4: grade de campos ajustáveis da nuvem decidida pelo SERVIDOR
        // (GET /api/audio/nuvem/campos), com cache curto de sessão como a cota;
        // e o que o dono marcou como MANUAL por clipe — só isso sai em algorithms_override.
        this._camposNuvemCache = null;    // lista validada de campos da última boa resposta (ou null)
        this._camposNuvemQuando = 0;      // Date.now() da consulta
        this._camposNuvemEmVoo = null;    // dedupe de consultas concorrentes
        this._fetchCamposDuble = null;    // dublê de transporte para testes
        this._ajustesNuvemManuais = {};   // alvoClipId -> { campo: valor bruto escolhido }
        this._nuvemAjustesAberto = false; // área recolhível começa fechada

        // N2: glossário de áudio decidido pelo SERVIDOR (GET /api/audio/glossario) - a
        // MESMA fonte que alimenta o chat; nada de texto de explicação vivendo aqui.
        // Cache curto de sessão como a cota/campos; sem resposta boa, os ícones (i)
        // simplesmente não existem e o painel segue inteiro.
        this._glossarioCache = null;      // mapa chave -> entrada validada da última boa resposta
        this._glossarioQuando = 0;        // Date.now() da consulta
        this._glossarioEmVoo = null;      // dedupe de consultas concorrentes
        this._fetchGlossarioDuble = null; // dublê de transporte para testes
        this._explicaAberta = null;       // { chave, painel } do ÚNICO painel aberto (ou null)

        // F4: o player registra falha da fonte tratada; a UI devolve o A/B para Original.
        STATE.on("fonteAudioTratadaIndisponivel", (registro) => this._refletirFalhaFonteTratada(registro));
        
        // Posição do mouse
        this.mouseX = 0;
        this.mouseY = 0;

        // Rastreamento para temporizador do hover preview
        this.hoverTimer = null;
        this.hoverLastX = 0;
        this.hoverLastY = 0;
        this.hoverLastTime = 0;
        this.hoverLastClipId = null;

        // Guarda referências bound para permitir remoção
        this.boundMouseDown = (e) => this.onMouseDown(e);
        this.boundMouseMove = (e) => this.onMouseMove(e);
        this.boundMouseUp = (e) => this.onMouseUp(e);
        this.boundDblClick = (e) => this.onDblClick(e);
        this.boundContextMenu = (e) => this.onContextMenu(e);
        this.boundWheel = (e) => this.onWheel(e);
        this.boundMouseLeave = () => {
            this.hideMarkerTooltip();
            this.hideFadeTooltip();
            if (TIMELINE_STATE.hoveredMarkerId !== null) {
                TIMELINE_STATE.hoveredMarkerId = null;
                if (this.renderer) this.renderer.requestRedraw();
            }
            if (TIMELINE_STATE.hoveredFadeHandle !== null) {
                TIMELINE_STATE.hoveredFadeHandle = null;
                if (this.renderer) this.renderer.requestRedraw();
            }
            this.hideHoverPreview();
        };
        this.boundWindowMouseMove = (e) => {
            if (this.isMarkerTooltipActive && !this.dragState && this.canvas) {
                const rect = this.canvas.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                    this.hideMarkerTooltip();
                    if (TIMELINE_STATE.hoveredMarkerId !== null) {
                        TIMELINE_STATE.hoveredMarkerId = null;
                        if (this.renderer) this.renderer.requestRedraw();
                    }
                }
            }
        };
        this.boundKeyDown = (e) => this.onKeyDown(e);
        this.boundDragOver = (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; };
        this.boundDrop = (e) => this.onDrop(e);

        this.init();
    }

    init() {
        if (!this.canvas) return;
        const win = this.canvas.ownerDocument.defaultView || window;

        // Mouse Listeners
        this.canvas.addEventListener("mousedown", this.boundMouseDown);
        this.canvas.addEventListener("mousemove", this.boundMouseMove);
        this.canvas.addEventListener("dblclick", this.boundDblClick);
        this.canvas.addEventListener("contextmenu", this.boundContextMenu);
        this.canvas.addEventListener("mouseup", this.boundMouseUp);
        win.addEventListener("mouseup", this.boundMouseUp);
        window.addEventListener("mouseup", this.boundMouseUp);
        document.addEventListener("mouseup", this.boundMouseUp);
        win.addEventListener("mousemove", this.boundWindowMouseMove);
        this.canvas.addEventListener("wheel", this.boundWheel);
        const headersSidebar = this.canvas.ownerDocument.getElementById("timeline-headers-sidebar");
        if (headersSidebar) {
            headersSidebar.addEventListener("wheel", this.boundWheel);
        }
        this.canvas.addEventListener("mouseleave", this.boundMouseLeave);

        // Arrastar-e-soltar de mídias da biblioteca para a timeline
        this.canvas.addEventListener("dragover", this.boundDragOver);
        this.canvas.addEventListener("drop", this.boundDrop);

        // Keyboard Listener global
        win.addEventListener("keydown", this.boundKeyDown);

        // Ouvir mudança de abas no painel esquerdo para atualizar ajustes
        STATE.on("leftTabChanged", (tabId) => {
            if (tabId === "tab-adjustments") {
                this.refreshClipInspector();
            }
        });

        // Ouvir restauração do histórico (undo/redo) para sincronizar o painel
        STATE.on("timelineRestored", () => {
            this.refreshClipInspector();
            if (this.renderer) {
                this.renderer.requestRedraw();
            }
        });
    }

    removeListeners() {
        if (!this.canvas) return;
        const win = this.canvas.ownerDocument.defaultView || window;
        this.canvas.removeEventListener("mousedown", this.boundMouseDown);
        this.canvas.removeEventListener("mousemove", this.boundMouseMove);
        this.canvas.removeEventListener("dblclick", this.boundDblClick);
        this.canvas.removeEventListener("contextmenu", this.boundContextMenu);
        this.canvas.removeEventListener("mouseup", this.boundMouseUp);
        win.removeEventListener("mouseup", this.boundMouseUp);
        window.removeEventListener("mouseup", this.boundMouseUp);
        document.removeEventListener("mouseup", this.boundMouseUp);
        win.removeEventListener("mousemove", this.boundWindowMouseMove);
        this.canvas.removeEventListener("wheel", this.boundWheel);
        this.canvas.removeEventListener("mouseleave", this.boundMouseLeave);
        this.canvas.removeEventListener("dragover", this.boundDragOver);
        this.canvas.removeEventListener("drop", this.boundDrop);
        win.removeEventListener("keydown", this.boundKeyDown);
    }

    setCanvas(canvas) {
        if (!canvas) return;
        this.removeListeners();
        this.canvas = canvas;
        this.init();
    }

    /**
     * Mapeia coordenadas x/y relativas ao canvas para frame e track (dinâmico multipista).
     */
    getCoordinates(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const frame = Math.round(TIMELINE_STATE.scrollLeftFrame + (x / TIMELINE_STATE.zoom));

        const trackObj = this.renderer.getTrackAtY(y);
        const track = trackObj ? trackObj.id : null;

        return { x, y, frame, track, trackObj };
    }

    /**
     * Encontra qual clipe (comum ou ghost) está sob o mouse.
     */
    findClipAt(frame, track, y = null) {
        if (!track) return null;

        const trackObj = TIMELINE_STATE.getTrack(track);
        const cuts = STATE.activeTimelineCuts;

        // Pista de IA: hit-test somente nos ghost clips (INSERT/REPLACE)
        if (trackObj && trackObj.kind === "ai") {
            const ghost = TIMELINE_STATE.ghostTrack.find(g =>
                g.action !== "DELETE" &&
                frame >= g.timelineStartFrame &&
                frame <= g.timelineStartFrame + Math.max(g.outFrame - g.inFrame, Math.round(20 / TIMELINE_STATE.zoom))
            );
            if (ghost) return { type: "ghost", data: ghost };
            return null;
        }

        // Ghosts de DELETE são desenhados sobre o clipe alvo na pista original
        const deleteGhost = TIMELINE_STATE.ghostTrack.find(g => {
            if (g.action !== "DELETE" || !g.targetClipId) return false;
            const target = cuts.find(c => c.id === g.targetClipId);
            return target && target.track === track &&
                frame >= g.timelineStartFrame &&
                frame <= g.timelineStartFrame + (g.outFrame - g.inFrame);
        });
        if (deleteGhost) return { type: "ghost", data: deleteGhost };

        const clip = cuts.find(c => c.track === track && frame >= c.timelineStartFrame && frame <= c.timelineStartFrame + (c.outFrame - c.inFrame));
        if (clip) return { type: "clip", data: clip };

        return null;
    }

    /**
     * Verifica se o mouse está sobre a borda esquerda ou direita de um clipe para trim.
     */
    checkTrimZone(x, clip) {
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        
        const startX = (clip.timelineStartFrame - scrollLeft) * zoom;
        const endX = startX + (clip.outFrame - clip.inFrame) * zoom;
        
        const tolerance = 6; // tolerância em pixels nas bordas
        
        if (Math.abs(x - startX) <= tolerance) return "left";
        if (Math.abs(x - endX) <= tolerance) return "right";
        return null;
    }

    /**
     * Verifica se as coordenadas x e y relativas ao canvas coincidem com
     * manipuladores de Fade In / Fade Out (duração ou curva) ou área do fade.
     */
    checkFadeZone(x, y, clip, includeArea = false) {
        if (!clip) return null;
        const lane = this.renderer.getLane(clip.track);
        if (!lane) return null;

        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const fps = TIMELINE_STATE.fps || 24;

        const startX = (clip.timelineStartFrame - scrollLeft) * zoom;
        const durFrames = clip.outFrame - clip.inFrame;
        const width = durFrames * zoom;
        const clipDurS = durFrames / fps;
        const clipY = lane.top;
        const clipHeight = lane.height;

        // Se fora do bloco vertical do clipe
        if (y < clipY || y > clipY + clipHeight) return null;
        // Se fora horizontalmente com margem
        if (x < startX - 4 || x > startX + width + 4) return null;

        const effects = clip.effects || [];
        const fadeInEff = effects.find(e => e.type === "crossfade" && e.side === "in" && !e.disabled);
        const fadeOutEff = effects.find(e => e.type === "crossfade" && e.side === "out" && !e.disabled);

        const fadeInDur = fadeInEff ? Math.min(clipDurS, Math.max(0, fadeInEff.duration_s || 0)) : 0;
        const fadeOutDur = fadeOutEff ? Math.min(clipDurS - fadeInDur, Math.max(0, fadeOutEff.duration_s || 0)) : 0;

        const wIn = Math.min(width, fadeInDur * fps * zoom);
        const wOut = Math.min(width - wIn, fadeOutDur * fps * zoom);

        // 1. Ponto de tensão central (Curva Fade In)
        if (fadeInDur > 0 && wIn >= 16) {
            const factorMid = evaluateFadeCurve(0.5, fadeInEff.curve || "linear", fadeInEff.tension || 0);
            const pxMid = startX + 0.5 * wIn;
            const pyMid = clipY + (1 - factorMid) * (clipHeight - 4) + 2;
            const dist = Math.hypot(x - pxMid, y - pyMid);
            if (dist <= 8) {
                return { side: "in", type: "curve", clip, effect: fadeInEff };
            }
        }

        // 2. Ponto de tensão central (Curva Fade Out)
        if (fadeOutDur > 0 && wOut >= 16) {
            const factorMid = evaluateFadeCurve(0.5, fadeOutEff.curve || "linear", fadeOutEff.tension || 0);
            const pxMid = (startX + width - wOut) + 0.5 * wOut;
            const pyMid = clipY + (1 - factorMid) * (clipHeight - 4) + 2;
            const dist = Math.hypot(x - pxMid, y - pyMid);
            if (dist <= 8) {
                return { side: "out", type: "curve", clip, effect: fadeOutEff };
            }
        }

        // 3. Puxador de duração Fade In (ou affordance de canto no topo-esquerdo)
        if (y <= clipY + 12) {
            if (fadeInDur > 0) {
                const handleX = startX + wIn;
                if (Math.abs(x - handleX) <= 6) {
                    return { side: "in", type: "duration", clip, effect: fadeInEff };
                }
            } else {
                // Canto superior esquerdo inicial
                if (x >= startX - 2 && x <= startX + 10) {
                    return { side: "in", type: "duration", clip, effect: null };
                }
            }
        }

        // 4. Puxador de duração Fade Out (ou affordance de canto no topo-direito)
        if (y <= clipY + 12) {
            if (fadeOutDur > 0) {
                const handleX = startX + width - wOut;
                if (Math.abs(x - handleX) <= 6) {
                    return { side: "out", type: "duration", clip, effect: fadeOutEff };
                }
            } else {
                // Canto superior direito final
                if (x >= startX + width - 10 && x <= startX + width + 2) {
                    return { side: "out", type: "duration", clip, effect: null };
                }
            }
        }

        // 5. Área interna da rampa de fade (quando includeArea for true, ex: menu de contexto)
        if (includeArea) {
            if (fadeInDur > 0 && x >= startX && x <= startX + wIn) {
                return { side: "in", type: "area", clip, effect: fadeInEff };
            }
            if (fadeOutDur > 0 && x >= startX + width - wOut && x <= startX + width) {
                return { side: "out", type: "area", clip, effect: fadeOutEff };
            }
        }

        return null;
    }

    onMouseDown(e) {
        window.activeFocusedPlayer = "program";
        this.mouseDownX = e.clientX;
        this.mouseDownY = e.clientY;

        // Se o source estiver maximizado, mostra o program ao interagir com a timeline
        const sourcePanel = document.getElementById("source-player-panel");
        if (sourcePanel && sourcePanel.classList.contains("maximized")) {
            const btnExpandSource = document.getElementById("btn-expand-source");
            if (btnExpandSource) btnExpandSource.click();
            const programPanel = document.getElementById("program-player-panel");
            if (programPanel && !programPanel.classList.contains("maximized")) {
                const btnExpandProgram = document.getElementById("btn-expand-program");
                if (btnExpandProgram) btnExpandProgram.click();
            }
        }
        
        const { x, y, frame, track } = this.getCoordinates(e.clientX, e.clientY);
        this.hideHoverPreview();
        
        if (track) {
            const hit = this.findClipAt(frame, track, y);
            this.mouseDownClip = hit && hit.type === "clip" ? hit.data : null;
        } else {
            this.mouseDownClip = null;
        }
        
        // 1. Clique na régua de tempo ou clipe (Scrubbing / Drag de Marcador / Mover Playhead)
        if (y < this.renderer.rulerHeight) {
            const hitMarker = this.getMarkerAtX(x, 14, y);
            if (hitMarker) {
                TIMELINE_STATE.selectMarker(hitMarker.id, e.shiftKey || e.ctrlKey);
                this.dragState = "drag-marker";
                this.draggedMarkerId = hitMarker.id;
                TIMELINE_STATE.hoveredMarkerId = hitMarker.id;
                this.updatePlayhead(hitMarker.frame);
                this.hideMarkerTooltip();
                return;
            }
            if (!e.shiftKey && !e.ctrlKey) {
                TIMELINE_STATE.clearSelectedMarkers();
            }
            this.dragState = "scrub";
            this.updatePlayhead(frame);
            this.hideMarkerTooltip();
            return;
        } else {
            const hitClipMarker = this.getMarkerAtX(x, 14, y);
            if (hitClipMarker) {
                TIMELINE_STATE.selectMarker(hitClipMarker.id, e.shiftKey || e.ctrlKey);
                this.updatePlayhead(hitClipMarker.frame);
                this.hideMarkerTooltip();
                if (this.renderer) this.renderer.requestRedraw();
            }
        }

        // 2. Clique com botão do meio (Scroll/Pan) ou Barra de Espaço pressionada
        if (e.button === 1 || (e.button === 0 && e.spaceKey)) {
            this.dragState = "pan";
            this.dragStartMouseX = e.clientX;
            this.dragStartClipFrame = TIMELINE_STATE.scrollLeftFrame;
            this.canvas.style.cursor = "grabbing";
            return;
        }

        // 3. Clique nas trilhas
        if (track) {
            const hit = this.findClipAt(frame, track, y);

            if (hit) {
                if (hit.type === "clip") {
                    const clip = hit.data;
                    const clipTrack = TIMELINE_STATE.getTrack(clip.track);
                    if (clipTrack && clipTrack.locked) {
                        // Pista travada: apenas seleciona, sem permitir arrastes
                        TIMELINE_STATE.selectedClipId = clip.id;
                        TIMELINE_STATE.selectedTrack = track;
                        this.syncPlayerToClip(clip);
                        this.refreshClipInspector();
                        this.renderer.requestRedraw();
                        return;
                    }

                    // Checa se clicou em um puxador de Fade In / Fade Out ou Ponto de Curva
                    const fadeZone = this.checkFadeZone(x, y, clip, false);
                    if (fadeZone && e.button === 0) {
                        TIMELINE_STATE.selectedClipId = clip.id;
                        TIMELINE_STATE.selectedTrack = track;
                        TIMELINE_HISTORY.begin();

                        if (fadeZone.type === "duration") {
                            this.dragState = fadeZone.side === "in" ? "fade-in-drag" : "fade-out-drag";
                            this.draggedClipId = clip.id;
                            this.dragStartMouseX = e.clientX;
                            const currentEff = (clip.effects || []).find(ef => ef.type === "crossfade" && ef.side === fadeZone.side && !ef.disabled);
                            this.dragStartFadeDur = currentEff ? (currentEff.duration_s || 0) : 0;
                            this.dragFadeSide = fadeZone.side;
                        } else if (fadeZone.type === "curve") {
                            this.dragState = fadeZone.side === "in" ? "fade-in-curve" : "fade-out-curve";
                            this.draggedClipId = clip.id;
                            this.dragStartMouseY = e.clientY;
                            const currentEff = (clip.effects || []).find(ef => ef.type === "crossfade" && ef.side === fadeZone.side && !ef.disabled);
                            this.dragStartTension = currentEff ? (currentEff.tension || 0) : 0;
                            this.dragFadeSide = fadeZone.side;
                        }

                        this.refreshClipInspector();
                        this.renderer.requestRedraw();
                        return;
                    }

                    TIMELINE_STATE.selectedClipId = clip.id;
                    TIMELINE_STATE.selectedTrack = track;

                    // Abre a transação de histórico: o drag/trim vira 1 passo de undo
                    TIMELINE_HISTORY.begin();

                    const trimEdge = this.checkTrimZone(x, clip);

                    if (trimEdge === "left") {
                        this.dragState = "trim-left";
                        this.draggedClipId = clip.id;
                        this.dragStartMouseX = e.clientX;
                        this.dragStartClipFrame = clip.timelineStartFrame;
                        this.dragStartInFrame = clip.inFrame;
                    } else if (trimEdge === "right") {
                        this.dragState = "trim-right";
                        this.draggedClipId = clip.id;
                        this.dragStartMouseX = e.clientX;
                        this.dragStartOutFrame = clip.outFrame;
                    } else {
                        // Drag normal do clipe
                        this.dragState = "drag-clip";
                        this.draggedClipId = clip.id;
                        this.dragStartMouseX = e.clientX;
                        this.dragStartClipFrame = clip.timelineStartFrame;
                    }
                    
                    // Sincroniza player com o início do clipe
                    this.syncPlayerToClip(clip);
                } else if (hit.type === "ghost") {
                    const ghost = hit.data;
                    TIMELINE_STATE.selectedGhostClipId = ghost.id;
                    TIMELINE_STATE.selectedTrack = "Ghost";
                    
                    // Sincroniza player com o preview da sugestão
                    this.syncPlayerToClip(ghost);
                    
                    // Se clicou na sugestão, mostra opções contextuais (aceitar / recusar)
                    this.showGhostActionsPopup(e.clientX, e.clientY, ghost);
                }
            } else {
                // Deselecionar
                TIMELINE_STATE.selectedClipId = null;
                TIMELINE_STATE.selectedGhostClipId = null;
            }
            this.refreshClipInspector();
            this.renderer.requestRedraw();
        }
    }

    onMouseMove(e) {
        // Se houver um estado de arrasto ativo, mas o botão do mouse NÃO estiver pressionado (e.buttons === 0),
        // finaliza o arrasto imediatamente para impedir que fique preso ao cursor.
        if (this.dragState && e.buttons === 0) {
            this.onMouseUp(e);
            return;
        }

        const { x, y, frame, track } = this.getCoordinates(e.clientX, e.clientY);
        this.mouseX = x;
        this.mouseY = y;
        let isHoveringMarker = false;

        // Tooltip e Rótulo de hover (Marcadores de Régua ou de Clipe)
        if (!this.dragState) {
            const hoverMarker = this.getMarkerAtX(x, 14, y);
            if (hoverMarker) {
                isHoveringMarker = true;
                this.canvas.style.cursor = "pointer";
                this.canvas.removeAttribute("title");
                this.canvas.removeAttribute("data-tooltip");
                this.showMarkerTooltip(hoverMarker, e.clientX, e.clientY);
                this.hideHoverPreview(); // Esconde a miniatura/preview do clipe ao focar no marcador
                if (TIMELINE_STATE.hoveredMarkerId !== hoverMarker.id) {
                    TIMELINE_STATE.hoveredMarkerId = hoverMarker.id;
                    if (this.renderer) this.renderer.requestRedraw();
                }
            } else {
                this.canvas.style.cursor = "default";
                this.hideMarkerTooltip();
                if (TIMELINE_STATE.hoveredMarkerId !== null) {
                    TIMELINE_STATE.hoveredMarkerId = null;
                    if (this.renderer) this.renderer.requestRedraw();
                }
            }
        }

        if (!this.dragState && !isHoveringMarker) {
            this.updateHoverPreview(e.clientX, e.clientY, frame, track);
        } else if (isHoveringMarker) {
            this.hideHoverPreview();
            return;
        }

        // Atualiza cursores dinâmicos de trim, fades e tooltip com nome do arquivo
        if (!this.dragState && track) {
            this.hideMarkerTooltip();
            if (TIMELINE_STATE.hoveredMarkerId !== null) {
                TIMELINE_STATE.hoveredMarkerId = null;
                if (this.renderer) this.renderer.requestRedraw();
            }
            const hit = this.findClipAt(frame, track, y);
            if (hit && hit.type === "clip") {
                const fadeZone = this.checkFadeZone(x, y, hit.data, false);
                if (fadeZone) {
                    if (fadeZone.type === "duration") {
                        this.canvas.style.cursor = "ew-resize";
                    } else if (fadeZone.type === "curve") {
                        this.canvas.style.cursor = "ns-resize";
                    }
                    const newHandle = { clipId: hit.data.id, side: fadeZone.side, type: fadeZone.type };
                    if (!TIMELINE_STATE.hoveredFadeHandle || 
                        TIMELINE_STATE.hoveredFadeHandle.clipId !== newHandle.clipId ||
                        TIMELINE_STATE.hoveredFadeHandle.side !== newHandle.side ||
                        TIMELINE_STATE.hoveredFadeHandle.type !== newHandle.type) {
                        TIMELINE_STATE.hoveredFadeHandle = newHandle;
                        if (this.renderer) this.renderer.requestRedraw();
                    }
                    this.hideHoverPreview();
                    return;
                } else {
                    if (TIMELINE_STATE.hoveredFadeHandle !== null) {
                        TIMELINE_STATE.hoveredFadeHandle = null;
                        if (this.renderer) this.renderer.requestRedraw();
                    }
                }

                const edge = this.checkTrimZone(x, hit.data);
                this.canvas.style.cursor = edge ? "w-resize" : "grab";
            } else {
                if (TIMELINE_STATE.hoveredFadeHandle !== null) {
                    TIMELINE_STATE.hoveredFadeHandle = null;
                    if (this.renderer) this.renderer.requestRedraw();
                }
                this.canvas.style.cursor = "default";
                this.canvas.removeAttribute("title");
            }
        } else if (!this.dragState) {
            this.hideMarkerTooltip();
            if (TIMELINE_STATE.hoveredMarkerId !== null) {
                TIMELINE_STATE.hoveredMarkerId = null;
                if (this.renderer) this.renderer.requestRedraw();
            }
            if (TIMELINE_STATE.hoveredFadeHandle !== null) {
                TIMELINE_STATE.hoveredFadeHandle = null;
                if (this.renderer) this.renderer.requestRedraw();
            }
            this.canvas.removeAttribute("title");
        }

        if (!this.dragState) {
            return;
        }

        // Processar arrastes baseados no estado
        if (this.dragState === "scrub") {
            this.updatePlayhead(frame);
        } 
        else if (this.dragState === "drag-marker" && this.draggedMarkerId) {
            TIMELINE_STATE.hoveredMarkerId = this.draggedMarkerId;
            const snappedFrame = this.snapFrame(Math.max(0, Math.round(frame)));
            TIMELINE_STATE.updateMarker(this.draggedMarkerId, { frame: snappedFrame });
            this.updatePlayhead(snappedFrame);

            const activeMarker = TIMELINE_STATE.getMarker(this.draggedMarkerId);
            if (activeMarker) {
                this.showMarkerTooltip(activeMarker, e.clientX, e.clientY);
            }
        }
        else if (this.dragState === "pan") {
            const dx = e.clientX - this.dragStartMouseX;
            const deltaFrames = dx / TIMELINE_STATE.zoom;
            TIMELINE_STATE.setScrollLeftFrame(this.dragStartClipFrame - deltaFrames);
        }
        else if (this.dragState === "drag-clip" && this.draggedClipId) {
            const dx = e.clientX - this.dragStartMouseX;
            const deltaFrames = Math.round(dx / TIMELINE_STATE.zoom);
            const targetStart = Math.max(0, this.dragStartClipFrame + deltaFrames);

            // Trilha de destino: qualquer pista não travada sob o mouse
            let targetTrack = null;
            const trackObj = track ? TIMELINE_STATE.getTrack(track) : null;
            if (trackObj && trackObj.kind !== "ai" && !trackObj.locked) {
                targetTrack = track;
            }
            this.moveClip(this.draggedClipId, targetStart, targetTrack);
        }
        else if (this.dragState === "trim-left" && this.draggedClipId) {
            const dx = e.clientX - this.dragStartMouseX;
            const deltaFrames = Math.round(dx / TIMELINE_STATE.zoom);
            
            this.trimClipLeft(this.draggedClipId, deltaFrames);
        }
        else if (this.dragState === "trim-right" && this.draggedClipId) {
            const dx = e.clientX - this.dragStartMouseX;
            const deltaFrames = Math.round(dx / TIMELINE_STATE.zoom);
            
            this.trimClipRight(this.draggedClipId, deltaFrames);
        }
        else if ((this.dragState === "fade-in-drag" || this.dragState === "fade-out-drag") && this.draggedClipId) {
            const clip = STATE.activeTimelineCuts.find(c => c.id === this.draggedClipId);
            if (clip) {
                const fps = TIMELINE_STATE.fps || 24;
                const clipDurS = (clip.outFrame - clip.inFrame) / fps;
                const dx = e.clientX - this.dragStartMouseX;
                const deltaS = (this.dragState === "fade-in-drag" ? dx : -dx) / (TIMELINE_STATE.zoom * fps);
                const targetDur = Math.max(0, Math.min(clipDurS, Math.round((this.dragStartFadeDur + deltaS) * 20) / 20));
                
                const side = this.dragState === "fade-in-drag" ? "in" : "out";
                
                // Modifica diretamente no array de efeitos do clipe em memória durante o arrasto
                clip.effects = clip.effects ? clip.effects.map(ef => ({ ...ef })) : [];
                const existing = clip.effects.find(ef => ef.type === "crossfade" && ef.side === side);
                if (targetDur > 0) {
                    if (existing) {
                        existing.duration_s = targetDur;
                    } else {
                        clip.effects.push({
                            type: "crossfade",
                            side,
                            duration_s: targetDur,
                            curve: "linear",
                            tension: 0,
                            disabled: false
                        });
                    }
                } else {
                    clip.effects = clip.effects.filter(ef => !(ef.type === "crossfade" && ef.side === side));
                }

                const eff = clip.effects.find(ef => ef.type === "crossfade" && ef.side === side);
                const curveName = eff ? (FADE_CURVE_PRESETS[eff.curve]?.name || eff.curve || "Linear") : "Linear";
                this.showFadeTooltip(e.clientX, e.clientY, side === "in" ? "Fade In" : "Fade Out", `${targetDur.toFixed(2)}s (${curveName})`);
                
                // Atualiza valor do input no inspector se visível (sem recriar o DOM)
                const doc = this.canvas ? this.canvas.ownerDocument : document;
                const inp = doc.getElementById(side === "in" ? "adj-fadein" : "adj-fadeout");
                if (inp) {
                    inp.value = targetDur;
                    inp.setAttribute("data-tooltip", `${side === "in" ? "Fade In" : "Fade Out"}: ${targetDur}s`);
                }

                if (this.renderer) this.renderer.requestRedraw();
            }
        }
        else if ((this.dragState === "fade-in-curve" || this.dragState === "fade-out-curve") && this.draggedClipId) {
            const clip = STATE.activeTimelineCuts.find(c => c.id === this.draggedClipId);
            if (clip) {
                const side = this.dragState === "fade-in-curve" ? "in" : "out";
                const dy = e.clientY - this.dragStartMouseY;
                const deltaTension = -dy / 60; // 60px de arrasto vertical = 1.0 de tensão
                const targetTension = Math.max(-1.0, Math.min(1.0, Math.round((this.dragStartTension + deltaTension) * 100) / 100));

                clip.effects = clip.effects ? clip.effects.map(ef => ({ ...ef })) : [];
                const existing = clip.effects.find(ef => ef.type === "crossfade" && ef.side === side);
                if (existing) {
                    existing.curve = "custom";
                    existing.tension = targetTension;
                }

                const labelTension = targetTension === 0 ? "Linear" : (targetTension > 0 ? `Logarítmica (+${targetTension.toFixed(2)})` : `Exponencial (${targetTension.toFixed(2)})`);
                this.showFadeTooltip(e.clientX, e.clientY, `Curva Fade ${side === "in" ? "In" : "Out"}`, labelTension);
                
                const doc = this.canvas ? this.canvas.ownerDocument : document;
                const sel = doc.getElementById(side === "in" ? "adj-fadein-curve" : "adj-fadeout-curve");
                if (sel) sel.value = "custom";

                if (this.renderer) this.renderer.requestRedraw();
            }
        }
    }

    onMouseUp(e) {
        this.hideMarkerTooltip();
        this.hideFadeTooltip();
        if (this.dragState === "drag-marker") {
            this.dragState = null;
            this.draggedMarkerId = null;
            TIMELINE_STATE.hoveredMarkerId = null;
            if (this.canvas) this.canvas.style.cursor = "default";
            if (this.renderer) this.renderer.requestRedraw();
            return;
        }
        if (this.dragState && this.dragState.startsWith("fade-")) {
            TIMELINE_HISTORY.commit();
            STATE.emit("timelineCutsUpdated");
            this.dragState = null;
            this.draggedClipId = null;
            this.refreshClipInspector();
            if (this.canvas) this.canvas.style.cursor = "default";
            if (this.renderer) this.renderer.requestRedraw();
            return;
        }
        if (TIMELINE_STATE.hoveredMarkerId !== null) {
            TIMELINE_STATE.hoveredMarkerId = null;
            if (this.renderer) this.renderer.requestRedraw();
        }
        // Fecha a transação do drag/trim (no-op se nada mudou)
        TIMELINE_HISTORY.commit();
        this.dragState = null;
        this.draggedClipId = null;
        this.mouseDownClip = null;
        if (this.canvas) this.canvas.style.cursor = "default";
    }

    /**
     * Handler de clique com botão direito no canvas (menu de contexto de fades, etc.).
     */
    onContextMenu(e) {
        const { x, y, frame, track } = this.getCoordinates(e.clientX, e.clientY);
        if (!track) return;
        const hit = this.findClipAt(frame, track, y);
        if (hit && hit.type === "clip") {
            const fadeZone = this.checkFadeZone(x, y, hit.data, true);
            if (fadeZone) {
                e.preventDefault();
                e.stopPropagation();
                this.showFadeContextMenu(e.clientX, e.clientY, hit.data, fadeZone.side);
            }
        }
    }

    /**
     * Exibe o menu de contexto customizado para ajuste rápido de curvas e remoção de Fade.
     */
    showFadeContextMenu(clientX, clientY, clip, side) {
        const oldMenu = document.getElementById("custom-fade-context-menu");
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement("div");
        menu.id = "custom-fade-context-menu";
        menu.className = "custom-context-menu";
        menu.style.position = "fixed";
        menu.style.left = `${clientX}px`;
        menu.style.top = `${clientY}px`;
        menu.style.width = "190px";
        menu.style.zIndex = "100000";
        menu.style.padding = "6px 0";

        const title = document.createElement("div");
        title.style.padding = "6px 12px";
        title.style.fontSize = "10px";
        title.style.fontWeight = "bold";
        title.style.color = "var(--color-cyan)";
        title.style.borderBottom = "1px solid var(--border-glass)";
        title.style.marginBottom = "4px";
        title.style.display = "flex";
        title.style.alignItems = "center";
        title.style.gap = "6px";
        title.innerHTML = `<i class="fa-solid fa-circle-half-stroke"></i> FADE ${side === "in" ? "IN" : "OUT"} — CURVAS`;
        menu.appendChild(title);

        const currentEff = (clip.effects || []).find(e => e.type === "crossfade" && e.side === side && !e.disabled);
        const currentCurve = currentEff ? (currentEff.curve || "linear") : "linear";

        const presets = [
            { id: "linear", name: "Linear", icon: "fa-arrow-trend-up" },
            { id: "exponential", name: "Exponencial (Ease-In)", icon: "fa-chart-line" },
            { id: "logarithmic", name: "Logarítmica (Ease-Out)", icon: "fa-wave-square" },
            { id: "s_curve", name: "Curva em S (Suave)", icon: "fa-bezier-curve" }
        ];

        presets.forEach(p => {
            const item = document.createElement("div");
            item.className = "menu-item";
            item.style.display = "flex";
            item.style.alignItems = "center";
            item.style.justifyContent = "space-between";
            item.style.padding = "7px 12px";
            item.style.cursor = "pointer";
            item.style.fontSize = "11px";

            const isActive = currentCurve === p.id;
            item.innerHTML = `
                <span style="display:flex; align-items:center; gap:8px;">
                    <i class="fa-solid ${p.icon}" style="width:14px; color:${isActive ? 'var(--color-cyan)' : 'var(--text-muted)'};"></i>
                    <span style="color:${isActive ? '#ffffff' : 'var(--text-secondary)'}; font-weight:${isActive ? '600' : 'normal'};">${p.name}</span>
                </span>
                ${isActive ? '<i class="fa-solid fa-check" style="color:var(--color-cyan); font-size:10px;"></i>' : ''}
            `;

            item.onclick = () => {
                TIMELINE_HISTORY.begin();
                const fps = TIMELINE_STATE.fps || 24;
                const clipDurS = (clip.outFrame - clip.inFrame) / fps;
                const dur = currentEff ? currentEff.duration_s : Math.min(1.0, clipDurS * 0.3);
                this.setClipFade(clip.id, side, dur, p.id, 0);
                TIMELINE_HISTORY.commit();
                STATE.emit("timelineCutsUpdated");
                this.refreshClipInspector();
                if (this.renderer) this.renderer.requestRedraw();
                menu.remove();
            };
            menu.appendChild(item);
        });

        // Divisor
        const sep = document.createElement("div");
        sep.style.height = "1px";
        sep.style.background = "var(--border-glass)";
        sep.style.margin = "4px 0";
        menu.appendChild(sep);

        // Remover Fade
        const removeItem = document.createElement("div");
        removeItem.className = "menu-item";
        removeItem.style.display = "flex";
        removeItem.style.alignItems = "center";
        removeItem.style.gap = "8px";
        removeItem.style.padding = "7px 12px";
        removeItem.style.cursor = "pointer";
        removeItem.style.fontSize = "11px";
        removeItem.style.color = "var(--color-rose, #f43f5e)";
        removeItem.innerHTML = `<i class="fa-solid fa-trash" style="width:14px;"></i> <span>Remover Fade</span>`;

        removeItem.onclick = () => {
            TIMELINE_HISTORY.begin();
            this.setClipFade(clip.id, side, 0);
            TIMELINE_HISTORY.commit();
            STATE.emit("timelineCutsUpdated");
            this.refreshClipInspector();
            if (this.renderer) this.renderer.requestRedraw();
            menu.remove();
        };
        menu.appendChild(removeItem);

        document.body.appendChild(menu);

        // Fechar ao clicar fora
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener("mousedown", closeHandler);
            }
        };
        setTimeout(() => document.addEventListener("mousedown", closeHandler), 10);
    }

    /**
     * Tooltip visual durante o arrasto de duração ou curva de Fade.
     */
    showFadeTooltip(x, y, title, value) {
        let tip = document.getElementById("timeline-fade-tooltip");
        if (!tip) {
            tip = document.createElement("div");
            tip.id = "timeline-fade-tooltip";
            tip.style.position = "fixed";
            tip.style.zIndex = "99999";
            tip.style.pointerEvents = "none";
            tip.style.background = "rgba(18, 18, 24, 0.95)";
            tip.style.color = "#ffffff";
            tip.style.border = "1px solid rgba(6, 182, 212, 0.5)";
            tip.style.borderRadius = "4px";
            tip.style.padding = "4px 8px";
            tip.style.fontSize = "11px";
            tip.style.fontFamily = "Outfit, sans-serif";
            tip.style.backdropFilter = "blur(8px)";
            tip.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
            document.body.appendChild(tip);
        }
        tip.innerHTML = `<span style="color:var(--color-cyan); font-weight:600;">${title}:</span> <span style="font-family:monospace; font-weight:500;">${value}</span>`;
        tip.style.display = "block";
        tip.style.left = `${x + 12}px`;
        tip.style.top = `${y - 28}px`;
    }

    hideFadeTooltip() {
        const tip = document.getElementById("timeline-fade-tooltip");
        if (tip) tip.style.display = "none";
    }

    /**
     * Handler de clique duplo no canvas (abre edição de marcador ao clicar na régua).
     */
    onDblClick(e) {
        const { x, y, frame } = this.getCoordinates(e.clientX, e.clientY);
        const marker = this.getMarkerAtX(x, 14, y);
        if (marker) {
            this.openMarkerEditModal(marker);
            this.hideMarkerTooltip();
            return;
        }
        if (y < this.renderer.rulerHeight) {
            const newMarker = TIMELINE_STATE.addMarker({ frame: Math.round(frame) });
            this.openMarkerEditModal(newMarker);
            this.hideMarkerTooltip();
        }
    }

    /**
     * Soltura de mídia da biblioteca na timeline (foto ou vídeo).
     * A posição/pista vêm da coordenada do drop; pista de destino precisa ser de vídeo.
     */
    onDrop(e) {
        e.preventDefault();
        let payload = null;
        try {
            const raw = e.dataTransfer.getData("application/x-capiau-media");
            if (raw) payload = JSON.parse(raw);
        } catch (_) { payload = null; }
        if (!payload || payload.id === undefined || payload.id === null) return;

        const { frame, track } = this.getCoordinates(e.clientX, e.clientY);
        const trackObj = track ? TIMELINE_STATE.getTrack(track) : null;
        const targetTrack = (trackObj && trackObj.kind === "video" && !trackObj.locked) ? track : null;
        const dropFrame = Math.max(0, frame);

        if (payload.type === "photo") {
            TIMELINE_STATE.addPhotoCut(payload.id, { track: targetTrack, timelineStartFrame: dropFrame });
        } else {
            const video = STATE.allVideos.find(v => v.id === payload.id);
            const dur = (video && video.duration) ? video.duration : 5.0;
            TIMELINE_STATE.addCut(payload.id, 0, dur, targetTrack, dropFrame);
        }
    }

    /**
     * Calcula se o frame alvo deve sofrer encaixe (snapping) em relação a playhead, marcadores ou bordas de clipes.
     */
    snapFrame(targetFrame, tolerancePx = 8) {
        const zoom = TIMELINE_STATE.zoom || 0.5;
        const toleranceFrames = tolerancePx / zoom;

        let bestSnap = targetFrame;
        let minDiff = toleranceFrames;

        // 1. Encaixe na Playhead
        const playheadDiff = Math.abs(TIMELINE_STATE.playheadFrame - targetFrame);
        if (playheadDiff < minDiff) {
            minDiff = playheadDiff;
            bestSnap = TIMELINE_STATE.playheadFrame;
        }

        // 2. Encaixe nos Marcadores da Timeline
        if (TIMELINE_STATE.markers) {
            TIMELINE_STATE.markers.forEach(marker => {
                if (marker.id === this.draggedMarkerId) return;
                const diff = Math.abs(marker.frame - targetFrame);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestSnap = marker.frame;
                }
            });
        }

        // 3. Encaixe nas bordas dos cortes (início/fim de clipes)
        if (STATE.activeTimelineCuts) {
            STATE.activeTimelineCuts.forEach(cut => {
                const startDiff = Math.abs(cut.timelineStartFrame - targetFrame);
                if (startDiff < minDiff) {
                    minDiff = startDiff;
                    bestSnap = cut.timelineStartFrame;
                }
                const dur = (cut.outFrame - cut.inFrame);
                const endDiff = Math.abs((cut.timelineStartFrame + dur) - targetFrame);
                if (endDiff < minDiff) {
                    minDiff = endDiff;
                    bestSnap = cut.timelineStartFrame + dur;
                }
            });
        }

        return bestSnap;
    }

    /**
     * Retorna um marcador cujas coordenadas visíveis em tela (em pixels) estejam próximas do cursor X.
     */
    getMarkerAtX(mouseX, tolerancePx = 14, mouseY = null) {
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const markers = TIMELINE_STATE.getMarkersSorted();
        if (!markers || markers.length === 0) return null;

        const cuts = STATE.activeTimelineCuts || [];

        // Se mouseY for fornecido e estiver na área das pistas (ou se for buscar marcador de clipe)
        if (mouseY !== null && mouseY >= (this.renderer ? this.renderer.rulerHeight : 30)) {
            const laneObj = this.renderer ? this.renderer.getTrackAtY(mouseY) : null;
            for (const m of markers) {
                if (m.clipId) {
                    let cut = cuts.find(c => String(c.id) === String(m.clipId));
                    if (!cut) {
                        cut = cuts.find(c => m.frame >= c.timelineStartFrame && m.frame <= c.timelineStartFrame + (c.outFrame - c.inFrame));
                    }
                    if (cut && (!laneObj || cut.track === laneObj.id)) {
                        const markerX = (m.frame - scrollLeft) * zoom;
                        if (Math.abs(markerX - mouseX) <= tolerancePx) {
                            return m;
                        }
                    }
                }
            }
            return null;
        }

        // Se hover/clique foi na régua (y < rulerHeight): busca APENAS marcadores de régua (sem clipId)
        for (const m of markers) {
            if (!m.clipId) {
                const markerX = (m.frame - scrollLeft) * zoom;
                if (Math.abs(markerX - mouseX) <= tolerancePx) {
                    return m;
                }
            }
        }
        return null;
    }

    /**
     * Exibe o modal de edição de propriedades do marcador.
     */
    openMarkerEditModal(marker) {
        if (!marker) return;
        const doc = this.canvas ? this.canvas.ownerDocument : document;
        const modal = doc.getElementById("modal-edit-marker");
        if (!modal) return;

        modal.dataset.markerId = marker.id;
        modal.dataset.userChoice = "";
        const inputLabel = doc.getElementById("marker-edit-label");
        const inputComment = doc.getElementById("marker-edit-comment");
        const timecodeEl = doc.getElementById("marker-edit-timecode");
        const iconEl = doc.getElementById("marker-edit-icon");
        const colorSwatches = modal.querySelectorAll(".marker-color-swatch");
        const typeBtns = modal.querySelectorAll(".marker-type-btn");

        if (inputLabel) inputLabel.value = marker.label || "";
        if (inputComment) inputComment.value = marker.comment || "";
        if (timecodeEl) {
            timecodeEl.textContent = framesToTimecode(marker.frame, TIMELINE_STATE.fps);
        }

        const currentColor = marker.color || "#06b6d4";
        if (iconEl) iconEl.style.color = currentColor;
        colorSwatches.forEach(swatch => {
            if (swatch.dataset.color === currentColor) {
                swatch.classList.add("selected");
            } else {
                swatch.classList.remove("selected");
            }
        });

        const activeType = marker.clipId ? "clip" : "ruler";
        typeBtns.forEach(btn => {
            if (btn.dataset.type === activeType) {
                btn.classList.add("active");
                btn.style.background = "var(--color-cyan)";
                btn.style.color = "#000";
                btn.style.fontWeight = "700";
            } else {
                btn.classList.remove("active");
                btn.style.background = "transparent";
                btn.style.color = "var(--text-secondary)";
                btn.style.fontWeight = "500";
            }
        });

        modal.style.display = "flex";
        if (inputLabel) {
            setTimeout(() => {
                inputLabel.focus();
                inputLabel.select();
            }, 20);
        }
    }

    /**
     * Exibe a tooltip flutuante estilizada sobre o marcador na régua de tempo.
     */
    showMarkerTooltip(marker, clientX, clientY) {
        if (!marker) return;
        const doc = this.canvas ? this.canvas.ownerDocument : document;
        const tooltip = doc.getElementById("timeline-marker-tooltip");
        if (!tooltip) return;

        const titleEl = tooltip.querySelector(".marker-tooltip-title");
        const commentEl = tooltip.querySelector(".marker-tooltip-comment");

        const color = marker.color || "#06b6d4";

        tooltip.style.borderColor = color;
        if (titleEl) {
            titleEl.style.color = color;
            titleEl.innerHTML = `<i class="fa-solid fa-bookmark" style="font-size: 9px;"></i> ${marker.label || 'Marcador'}`;
        }
        if (commentEl) {
            if (marker.comment && marker.comment.trim()) {
                commentEl.textContent = marker.comment.trim();
                commentEl.style.display = "block";
            } else {
                commentEl.style.display = "none";
            }
        }

        tooltip.style.display = "flex";
        this.isMarkerTooltipActive = true;

        const tooltipRect = tooltip.getBoundingClientRect();
        let top = clientY - tooltipRect.height - 8;
        let left = clientX - tooltipRect.width / 2;

        if (top < 8) top = clientY + 18;
        const margin = 8;
        const win = doc.defaultView || window;
        if (left < margin) left = margin;
        if (left + tooltipRect.width > win.innerWidth - margin) {
            left = win.innerWidth - tooltipRect.width - margin;
        }

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    }

    /**
     * Oculta a tooltip do marcador.
     */
    hideMarkerTooltip() {
        const doc = this.canvas ? this.canvas.ownerDocument : document;
        const tooltip = doc.getElementById("timeline-marker-tooltip");
        if (tooltip) {
            tooltip.style.display = "none";
            this.isMarkerTooltipActive = false;
        }
    }

    // -- INSPETOR E AJUSTES DE CLIPE DE TIMELINE --

    /** Mostra os ajustes se houver um clipe selecionado; senão limpa. */
    refreshClipInspector() {
        const clip = STATE.activeTimelineCuts.find(c => c.id === TIMELINE_STATE.selectedClipId);
        if (clip) {
            this.showClipInspector(clip);
        } else {
            this.renderAdjustmentsPanel(null);
        }
        STATE.emit("timelineSelectionChanged", TIMELINE_STATE.selectedClipId);
    }

    showClipInspector(clip) {
        // Renderiza o painel de ajustes na aba correspondente
        this.renderAdjustmentsPanel(clip);

        // Abre automaticamente a aba de ajustes no menu esquerdo
        const tabBtn = this.canvas.ownerDocument.querySelector('.sidebar-left .tab-btn[data-tab="tab-adjustments"]');
        if (tabBtn) {
            if (tabBtn.style.display === "none") {
                setTabVisibility("tab-adjustments", true);
            }
            if (!tabBtn.classList.contains("active")) {
                tabBtn.click();
            }
        }
    }

    _mutateClipEffects(clipId, fn) {
        TIMELINE_HISTORY.record(() => {
            const cuts = [...STATE.activeTimelineCuts];
            const clip = cuts.find(c => c.id === clipId);
            if (!clip) return;
            clip.effects = clip.effects ? clip.effects.map(e => ({ ...e })) : [];
            fn(clip);
            STATE.activeTimelineCuts = cuts; // dispara recomposição do Program + redraw
        });
        const selected = STATE.activeTimelineCuts.find(c => c.id === TIMELINE_STATE.selectedClipId);
        if (selected) {
            this.showClipInspector(selected);
        } else {
            const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
            if (clip) this.showClipInspector(clip);
        }
    }

    setClipFit(clipId, mode) {
        this._mutateClipEffects(clipId, (clip) => {
            clip.effects = clip.effects.filter(e => e.type !== "fit");
            clip.effects.push({ type: "fit", mode });
        });
    }

    setClipKenBurns(clipId, preset) {
        const presets = {
            none: null,
            zoomIn: { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.25, x: 0, y: 0 } },
            zoomOut: { from: { scale: 1.25, x: 0, y: 0 }, to: { scale: 1, x: 0, y: 0 } },
            panRight: { from: { scale: 1.18, x: 6, y: 0 }, to: { scale: 1.18, x: -6, y: 0 } },
            panLeft: { from: { scale: 1.18, x: -6, y: 0 }, to: { scale: 1.18, x: 6, y: 0 } }
        };
        this._mutateClipEffects(clipId, (clip) => {
            clip.effects = clip.effects.filter(e => e.type !== "ken_burns");
            const cfg = presets[preset];
            if (cfg) clip.effects.push({ type: "ken_burns", preset, easing: "easeInOut", ...cfg });
        });
    }

    setClipTransform(clipId, key, value) {
        this._mutateClipEffects(clipId, (clip) => {
            let tf = clip.effects.find(e => e.type === "transform");
            if (!tf) {
                tf = { type: "transform", scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 };
                clip.effects.push(tf);
            }
            tf[key] = value;
        });
    }

    setClipColor(clipId, key, value) {
        this._mutateClipEffects(clipId, (clip) => {
            let col = clip.effects.find(e => e.type === "color");
            if (!col) {
                col = { type: "color", brightness: 0, contrast: 0, saturation: 100, hue: 0, sepia: 0, grayscale: 0, blur: 0 };
                clip.effects.push(col);
            }
            col[key] = value;
        });
    }

    setClipCrop(clipId, key, value) {
        this._mutateClipEffects(clipId, (clip) => {
            let crop = clip.effects.find(e => e.type === "crop");
            if (!crop) {
                crop = { type: "crop", top: 0, right: 0, bottom: 0, left: 0 };
                clip.effects.push(crop);
            }
            crop[key] = value;
        });
    }

    setClipVolume(clipId, level) {
        this._mutateClipEffects(clipId, (clip) => {
            clip.effects = clip.effects.filter(e => e.type !== "volume");
            clip.effects.push({ type: "volume", level });
        });
    }

    setClipFade(clipId, side, dur, curve = null, tension = null) {
        this._mutateClipEffects(clipId, (clip) => {
            const existing = clip.effects.find(e => e.type === "crossfade" && e.side === side);
            const chosenDur = dur !== null ? dur : (existing ? (existing.duration_s || 0.5) : 0.5);
            const chosenCurve = curve !== null ? curve : (existing ? (existing.curve || "linear") : "linear");
            const chosenTension = tension !== null ? tension : (existing ? (existing.tension || 0) : 0);
            const wasDisabled = existing ? existing.disabled : false;

            clip.effects = clip.effects.filter(e => !(e.type === "crossfade" && e.side === side));
            if (chosenDur > 0) {
                clip.effects.push({
                    type: "crossfade",
                    side,
                    duration_s: chosenDur,
                    curve: chosenCurve,
                    tension: chosenTension,
                    disabled: wasDisabled
                });
            }
        });
    }

    setClipFadeCurve(clipId, side, curve, tension = null) {
        this._mutateClipEffects(clipId, (clip) => {
            const existing = clip.effects.find(e => e.type === "crossfade" && e.side === side);
            if (existing) {
                existing.curve = curve;
                if (tension !== null) existing.tension = tension;
            } else {
                clip.effects.push({
                    type: "crossfade",
                    side,
                    duration_s: 0.5,
                    curve: curve,
                    tension: tension !== null ? tension : 0,
                    disabled: false
                });
            }
        });
    }

    // ── AJUSTES DE ÁUDIO AO VIVO (Etapa 2) — contratos E1/E2/E3 ──

    /** Defaults exatos do contrato E1. Objeto NOVO a cada chamada (nunca referência compartilhada). */
    _audioAoVivoDefaults(tipo) {
        if (tipo === "audio_dynamics") {
            return { type: "audio_dynamics", gate_db: -45, comp_ratio: 2.0, comp_thresh_db: -18, makeup_db: 0, disabled: false };
        }
        return { type: "audio_eq", hpf: 80, low: 0, mid: 0, high: 0, disabled: false };
    }

    /**
     * Puro: devolve um NOVO efeito do contrato E1 com `prop` ajustado a partir do controle,
     * preservando os demais campos do efeito existente. Clamp nos limites do E1 e passo
     * compatível com o slider (inteiros em Hz/dBFS; 0.5 em dB e na razão).
     */
    _construirEfeitoAudioAoVivo(base, tipo, prop, valor) {
        const efeito = Object.assign({}, this._audioAoVivoDefaults(tipo), (base && base.type === tipo) ? base : null);
        const limites = {
            hpf: [0, 300], low: [-12, 12], mid: [-12, 12], high: [-12, 12],
            gate_db: [-90, -20], comp_ratio: [1, 20], comp_thresh_db: [-60, 0], makeup_db: [-12, 12]
        }[prop];
        let v = Number(valor);
        if (!isFinite(v)) v = efeito[prop] !== undefined ? Number(efeito[prop]) : 0;
        if (limites) v = Math.max(limites[0], Math.min(limites[1], v));
        v = (prop === "hpf" || prop === "gate_db" || prop === "comp_thresh_db") ? Math.round(v) : Math.round(v * 2) / 2;
        efeito[prop] = v;
        return efeito;
    }

    /** Texto do value-disp/tooltipped do controle (mesmo papel dos "%"/"°"/"px" das seções antigas). */
    _formatarValorAudioAoVivo(prop, valor) {
        const v = Number(valor);
        if (!isFinite(v)) return "--";
        const dbComSinal = () => `${v > 0 ? "+" : ""}${Number(v.toFixed(1))} dB`;
        if (prop === "hpf") return v > 0 ? `${Math.round(v)} Hz` : "Desligado";
        if (prop === "gate_db") return v > -90 ? `${Math.round(v)} dBFS` : "Desligado";
        if (prop === "low" || prop === "mid" || prop === "high") return dbComSinal();
        if (prop === "comp_ratio") return `${Number(v).toFixed(1)}:1`;
        if (prop === "comp_thresh_db") return `${Math.round(v)} dBFS`;
        if (prop === "makeup_db") return dbComSinal();
        return String(valor);
    }

    /** Instância do ProgramPlayer quando a API E2 existe e o navegador suporta WebAudio; senão null. */
    _playerAudioAoVivo() {
        if (typeof window === "undefined") return null;
        const pp = (window.player && window.player.programPlayer) ? window.player.programPlayer : null;
        if (!pp || typeof pp.aplicarAudioAoVivo !== "function" || typeof pp.liberarAudioAoVivo !== "function") return null;
        if (typeof pp.audioAoVivoDisponivel !== "function" || pp.audioAoVivoDisponivel() !== true) return null;
        return pp;
    }

    /** Suporte do NAVEGADOR a AudioWorklet (exigência do gate; falha de carregamento é outra condição). */
    _suportaAudioWorklet() {
        if (typeof window === "undefined" || typeof AudioWorkletNode !== "function") return false;
        const AC = window.AudioContext || window.webkitAudioContext;
        // "audioWorklet" e um GETTER do prototype: ler AC.prototype.audioWorklet executa
        // o getter com this = prototype (que nao e um AudioContext) e lanca
        // "Illegal invocation". O operador `in` so pergunta se a propriedade existe.
        return !!(AC && AC.prototype && ("audioWorklet" in AC.prototype));
    }

    /**
     * Aplica/libera NA HORA no elemento da pista que está tocando (contrato E2).
     * Só fala com elementos que JÁ existem no pool do player — quem cria elemento é o
     * player no sync dele. Nunca lança: falha deixa o som no caminho normal até o
     * próximo sync do player (que reaplica sozinho).
     */
    _notificarPlayerAudioAoVivo(clipAlvo) {
        const pp = this._playerAudioAoVivo();
        if (!pp || !clipAlvo || !clipAlvo.track) return false;
        const el = (pp.audioPool && pp.audioPool[clipAlvo.track]) || null;
        if (!el) return false;
        const efeitos = Array.isArray(clipAlvo.effects) ? clipAlvo.effects : [];
        const temAtivo = efeitos.some(e => e && (e.type === "audio_eq" || e.type === "audio_dynamics") && e.disabled !== true);
        try {
            if (temAtivo) pp.aplicarAudioAoVivo(el, efeitos);
            else pp.liberarAudioAoVivo(el);
        } catch (err) {
            console.error("[timeline] falha ao aplicar áudio ao vivo no player:", err);
            return false;
        }
        return true;
    }

    setClipAudioEq(clipId, prop, valor) {
        this._mutateClipEffects(clipId, (clip) => {
            const i = clip.effects.findIndex(e => e.type === "audio_eq");
            const novo = this._construirEfeitoAudioAoVivo(i >= 0 ? clip.effects[i] : null, "audio_eq", prop, valor);
            if (i >= 0) clip.effects[i] = novo; else clip.effects.push(novo);
            this._notificarPlayerAudioAoVivo(clip);
        });
    }

    setClipAudioDynamics(clipId, prop, valor) {
        this._mutateClipEffects(clipId, (clip) => {
            const i = clip.effects.findIndex(e => e.type === "audio_dynamics");
            const novo = this._construirEfeitoAudioAoVivo(i >= 0 ? clip.effects[i] : null, "audio_dynamics", prop, valor);
            if (i >= 0) clip.effects[i] = novo; else clip.effects.push(novo);
            this._notificarPlayerAudioAoVivo(clip);
        });
    }

    renderAdjustmentsPanel(clip) {
        const container = this.canvas.ownerDocument.getElementById("adjustments-panel-content");
        if (!container) return;

        const roundVal = (v) => {
            if (v === undefined || v === null) return 0;
            const r = Math.round(v);
            return r === 0 ? 0 : r;
        };

        if (!clip) {
            const currentRes = `${TIMELINE_STATE.width}x${TIMELINE_STATE.height}`;
            const presetVal = ["1920x1080", "1080x1920", "3840x2160", "1080x1080"].includes(currentRes) ? currentRes : "custom";

            const gcd = (a, b) => b ? gcd(b, a % b) : a;
            const getAspectRatioText = (w, h) => {
                if (!w || !h) return "Desconhecido";
                const divisor = gcd(w, h);
                const rw = w / divisor;
                const rh = h / divisor;
                if (rw === 16 && rh === 9) return "16:9 (Widescreen)";
                if (rw === 9 && rh === 16) return "9:16 (Vertical)";
                if (rw === 4 && rh === 3) return "4:3 (Clássico)";
                if (rw === 1 && rh === 1) return "1:1 (Quadrado)";
                if (rw === 21 && rh === 9) return "21:9 (Ultrawide)";
                return `${rw}:${rh}`;
            };

            const html = `
                <div class="adjustments-section" style="padding: 16px;">
                    <div style="font-size:11px; font-weight:bold; color:var(--color-cyan); display:flex; gap: 6px; align-items:center; border-bottom: 1px solid var(--border-glass); padding-bottom: 8px; margin-bottom: 12px;">
                        <i class="fa-solid fa-gear"></i>
                        <span>Configurações da Sequência</span>
                    </div>

                    <!-- Preset Selection -->
                    <div class="adjustments-row" style="margin-bottom: 12px;">
                        <label style="font-size:10px; text-transform:uppercase; color:var(--text-muted); width: 80px;">Formato</label>
                        <div class="control-wrap" style="flex:1;">
                            <select id="seq-preset" class="nle-select" style="width:100%; height:24px; font-size:11px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; border-radius:4px; padding:0 4px;">
                                <option value="1920x1080">Horizontal (1920×1080 - 16:9)</option>
                                <option value="1080x1920">Vertical (1080×1920 - 9:16)</option>
                                <option value="3840x2160">Ultra HD (3840×2160 - 4K)</option>
                                <option value="1080x1080">Quadrado (1080×1080 - 1:1)</option>
                                <option value="custom">Personalizado</option>
                            </select>
                        </div>
                    </div>

                    <!-- Dimensions -->
                    <div class="adjustments-row" id="seq-dims-row" style="margin-bottom: 12px;">
                        <label style="font-size:10px; text-transform:uppercase; color:var(--text-muted); width: 80px;">Resolução</label>
                        <div class="control-wrap" style="flex:1; display:flex; gap:6px; align-items:center;">
                            <input id="seq-width" type="number" class="nle-input" style="width:65px; height:24px; text-align:center; font-size:11px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; border-radius:4px;" min="2" step="2" value="${TIMELINE_STATE.width}">
                            <span style="color:var(--text-muted); font-size:10px;">×</span>
                            <input id="seq-height" type="number" class="nle-input" style="width:65px; height:24px; text-align:center; font-size:11px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; border-radius:4px;" min="2" step="2" value="${TIMELINE_STATE.height}">
                        </div>
                    </div>

                    <!-- Aspect Ratio display -->
                    <div class="adjustments-row" style="margin-bottom: 12px;">
                        <label style="font-size:10px; text-transform:uppercase; color:var(--text-muted); width: 80px;">Proporção</label>
                        <div class="control-wrap" style="flex:1;">
                            <span id="seq-aspect-ratio" style="color:var(--text-secondary); font-size:11px; font-weight:bold;">${getAspectRatioText(TIMELINE_STATE.width, TIMELINE_STATE.height)}</span>
                        </div>
                    </div>

                    <!-- FPS Selection -->
                    <div class="adjustments-row" style="margin-bottom: 12px;">
                        <label style="font-size:10px; text-transform:uppercase; color:var(--text-muted); width: 80px;">Taxa (FPS)</label>
                        <div class="control-wrap" style="flex:1;">
                            <select id="seq-fps" class="nle-select" style="width:100%; height:24px; font-size:11px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; border-radius:4px; padding:0 4px;">
                                <option value="23.976">23.976 fps</option>
                                <option value="24">24 fps</option>
                                <option value="25">25 fps</option>
                                <option value="29.97">29.97 fps</option>
                                <option value="30">30 fps</option>
                                <option value="50">50 fps</option>
                                <option value="60">60 fps</option>
                            </select>
                        </div>
                    </div>

                    <!-- Warning message when clips exist -->
                    ${STATE.activeTimelineCuts.length > 0 ? `
                        <div id="seq-warning" style="margin-top:16px; padding:10px; border-radius:6px; background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.25); color:#facc15; font-size:10px; line-height:1.4; display:flex; gap:6px;">
                            <i class="fa-solid fa-triangle-exclamation" style="font-size:12px; margin-top:2px;"></i>
                            <span><strong>Aviso:</strong> A timeline possui clipes. Alterar o FPS irá reescalar os frames físicos para manter a sincronia em segundos.</span>
                        </div>
                    ` : ''}
                </div>
            `;

            container.innerHTML = html;

            const presetSelect = container.querySelector("#seq-preset");
            if (presetSelect) presetSelect.value = presetVal;

            const fpsSelect = container.querySelector("#seq-fps");
            if (fpsSelect) {
                const exists = Array.from(fpsSelect.options).some(opt => parseFloat(opt.value) === TIMELINE_STATE.fps);
                if (!exists) {
                    const opt = this.canvas.ownerDocument.createElement("option");
                    opt.value = TIMELINE_STATE.fps;
                    opt.textContent = `${TIMELINE_STATE.fps} fps`;
                    fpsSelect.appendChild(opt);
                }
                fpsSelect.value = TIMELINE_STATE.fps;
            }

            const widthInput = container.querySelector("#seq-width");
            const heightInput = container.querySelector("#seq-height");

            const updateDimInputsState = () => {
                if (presetSelect.value === "custom") {
                    widthInput.removeAttribute("disabled");
                    heightInput.removeAttribute("disabled");
                    widthInput.style.opacity = "1";
                    heightInput.style.opacity = "1";
                } else {
                    widthInput.setAttribute("disabled", "true");
                    heightInput.setAttribute("disabled", "true");
                    widthInput.style.opacity = "0.5";
                    heightInput.style.opacity = "0.5";
                    const [w, h] = presetSelect.value.split("x").map(Number);
                    widthInput.value = w;
                    heightInput.value = h;
                }
            };
            
            updateDimInputsState();

            const applySettings = () => {
                let wVal = parseInt(widthInput.value) || 1920;
                let hVal = parseInt(heightInput.value) || 1080;
                
                const w = wVal % 2 === 0 ? wVal : wVal + 1;
                const h = hVal % 2 === 0 ? hVal : hVal + 1;
                
                if (w !== wVal) widthInput.value = w;
                if (h !== hVal) heightInput.value = h;

                const fps = parseFloat(fpsSelect.value) || 24;

                TIMELINE_STATE.setTimelineProperties({ width: w, height: h, fps });

                const aspectSpan = container.querySelector("#seq-aspect-ratio");
                if (aspectSpan) aspectSpan.textContent = getAspectRatioText(w, h);
            };

            presetSelect.onchange = () => {
                updateDimInputsState();
                applySettings();
            };

            widthInput.onchange = applySettings;
            heightInput.onchange = applySettings;
            fpsSelect.onchange = applySettings;

            return;
        }

        const effects = clip.effects || [];
        const isPhoto = clip.type === "photo";
        const isAudioTrack = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
        let partnerAudioClip = null;
        if (!isAudioTrack && clip.type === "video" && clip.link_id) {
            partnerAudioClip = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
        }
        
        let displayTitle = "Clipe de Áudio";
        let realFilename = "";
        if (isPhoto) {
            const photoData = STATE.allPhotos.find(p => String(p.id) === String(clip.photo_id));
            if (photoData) {
                displayTitle = photoData.title || photoData.filename;
                realFilename = photoData.filename;
            } else {
                displayTitle = "Foto";
                realFilename = "";
            }
        } else {
            const videoData = STATE.allVideos.find(v => String(v.id) === String(clip.video_id));
            if (videoData) {
                if (isAudioTrack) {
                    displayTitle = videoData.title ? `${videoData.title} (Áudio)` : `${videoData.filename} (Áudio)`;
                } else {
                    displayTitle = videoData.title || videoData.filename;
                }
                realFilename = videoData.filename;
            } else {
                displayTitle = isAudioTrack ? "Áudio" : "Vídeo";
                realFilename = "";
            }
        }

        // Obter valores de efeito
        const fit = effects.find(e => e.type === "fit");
        const fitMode = fit ? fit.mode : "fill";

        const kb = effects.find(e => e.type === "ken_burns");
        const kbPreset = kb ? (kb.preset || "none") : "none";

        const tf = effects.find(e => e.type === "transform") || {};
        const scale = tf.scale !== undefined ? tf.scale : 1.0;
        const x = tf.x !== undefined ? tf.x : 0;
        const y = tf.y !== undefined ? tf.y : 0;
        const rotation = tf.rotation !== undefined ? tf.rotation : 0;
        const opacity = tf.opacity !== undefined ? tf.opacity : 1.0;

        const col = effects.find(e => e.type === "color") || {};
        const brightness = col.brightness !== undefined ? col.brightness : 0;
        const contrast = col.contrast !== undefined ? col.contrast : 0;
        const saturation = col.saturation !== undefined ? col.saturation : 100;
        const hue = col.hue !== undefined ? col.hue : 0;
        const sepia = col.sepia !== undefined ? col.sepia : 0;
        const grayscale = col.grayscale !== undefined ? col.grayscale : 0;
        const blur = col.blur !== undefined ? col.blur : 0;

        const cropEffect = effects.find(e => e.type === "crop") || {};
        const cropTop = cropEffect.top !== undefined ? cropEffect.top : 0;
        const cropRight = cropEffect.right !== undefined ? cropEffect.right : 0;
        const cropBottom = cropEffect.bottom !== undefined ? cropEffect.bottom : 0;
        const cropLeft = cropEffect.left !== undefined ? cropEffect.left : 0;

        let level = 1.0;
        if (isAudioTrack) {
            const vol = effects.find(e => e.type === "volume") || {};
            level = vol.level !== undefined ? vol.level : 1.0;
        } else if (partnerAudioClip) {
            const partnerEffects = partnerAudioClip.effects || [];
            const vol = partnerEffects.find(e => e.type === "volume") || {};
            level = vol.level !== undefined ? vol.level : 1.0;
        }

        const fadeIn = effects.find(e => e.type === "crossfade" && e.side === "in");
        const fadeOut = effects.find(e => e.type === "crossfade" && e.side === "out");
        const fadeInDur = fadeIn ? (fadeIn.duration_s || 0) : 0;
        const fadeOutDur = fadeOut ? (fadeOut.duration_s || 0) : 0;
        const fadeInCurve = (fadeIn && fadeIn.curve) || "linear";
        const fadeOutCurve = (fadeOut && fadeOut.curve) || "linear";

        // Renderizar seções
        let html = `
            <div style="font-size:11px; font-weight:bold; color:var(--color-cyan); display:flex; gap: 6px; align-items:center; border-bottom: 1px solid var(--border-glass); padding-bottom: 8px; margin-bottom: 4px;">
                <i class="fa-solid fa-sliders"></i>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;" title="${realFilename}">${displayTitle}</span>
                <span style="font-size:8.5px; padding:2px 6px; border-radius:4px; font-weight:bold; background:rgba(6,182,212,0.1); color:var(--color-cyan); text-transform:uppercase; letter-spacing:0.5px; margin-right: 4px;">${clip.track}</span>
                ${!isAudioTrack ? `
                <div style="display:flex; gap:8px; align-items:center; border-left: 1px solid var(--border-glass); padding-left:8px;">
                    <button class="nle-select-btn ${fitMode === 'fill' ? 'active' : ''}" data-action="fit:fill" title="Preencher (Fill)"><i class="fa-solid fa-expand"></i></button>
                    <button class="nle-select-btn ${fitMode === 'fit' ? 'active' : ''}" data-action="fit:fit" title="Ajustar (Fit)"><i class="fa-solid fa-compress"></i></button>
                </div>
                ` : ''}
            </div>
        `;

        // -- SEÇÃO: DIAGNÓSTICO DE ÁUDIO (somente leitura: sem bypass/reset, não cria efeito, não dispara autosave) --
        if (isAudioTrack || partnerAudioClip) {
            this.audioDiagCache = this.audioDiagCache || {};
            const diagVideoId = (clip.video_id !== undefined && clip.video_id !== null)
                ? clip.video_id
                : (partnerAudioClip ? partnerAudioClip.video_id : null);
            const diagIn = Number(clip.in);
            const diagOut = Number(clip.out);
            const diagKey = (diagVideoId !== null && isFinite(diagIn) && isFinite(diagOut))
                ? `${diagVideoId}|${diagIn.toFixed(3)}|${diagOut.toFixed(3)}`
                : null;
            const cachedDiag = (diagKey && this.audioDiagCache[diagKey]) ? this.audioDiagCache[diagKey] : null;

            const diagEmptyInner = `
                <div style="font-size:10px; color:var(--text-muted); padding:6px 0; line-height:1.5;">
                    Ainda não analisado. Use "Analisar" para medir loudness, pico real, clipping, ruído e dinâmica do trecho (in/out do clipe).
                </div>
            `;

            html += `
                <div class="adjustments-section" data-section="audio_diag">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-stethoscope"></i> Diagnóstico de Áudio
                        </span>
                        <button id="adj-audio-diag-run" title="Analisar o trecho com ffmpeg (ebur128 + astats)" style="background:none; border:none; color:var(--color-cyan); cursor:pointer; font-size:10px; display:flex; gap:4px; align-items:center;"><i class="fa-solid fa-wave-square"></i> Analisar</button>
                    </div>
                    <div id="adj-audio-diag-body" class="adjustments-section-body">
                        ${cachedDiag ? this._audioDiagResultInner(cachedDiag) : diagEmptyInner}
                    </div>
                </div>
            `;
        }

        // -- SEÇÕES: EQUALIZADOR E DINÂMICA DE ÁUDIO AO VIVO (Etapa 2, contrato E3) --
        // Mesma condição de exibição do diagnóstico (clipe de áudio ou vídeo com áudio
        // vinculado) e mesmo alvo da seção de volume: os efeitos moram no CLIPE DE ÁUDIO.
        if (isAudioTrack || partnerAudioClip) {
            const alvoAoVivo = isAudioTrack ? clip : partnerAudioClip;
            const efeitosAlvo = (alvoAoVivo && Array.isArray(alvoAoVivo.effects)) ? alvoAoVivo.effects : [];
            const eqVals = Object.assign({}, this._audioAoVivoDefaults("audio_eq"), efeitosAlvo.find(e => e.type === "audio_eq") || {});
            const dynVals = Object.assign({}, this._audioAoVivoDefaults("audio_dynamics"), efeitosAlvo.find(e => e.type === "audio_dynamics") || {});
            const eqDisabled = eqVals.disabled === true;
            const dynDisabled = dynVals.disabled === true;

            const ppAoVivo = this._playerAudioAoVivo();
            const aoVivoOk = !!ppAoVivo; // sem player/WebAudio: avisa NO LUGAR do controle (nunca controle morto)
            const gatePossivel = aoVivoOk && this._suportaAudioWorklet();
            const gatePronto = gatePossivel && typeof ppAoVivo.gateAoVivoDisponivel === "function" && ppAoVivo.gateAoVivoDisponivel() === true;

            const avisoSemWebAudio = `
                        <div style="margin:4px 0; padding:6px 8px; border-radius:4px; background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.25); color:#facc15; font-size:10px; line-height:1.4; display:flex; gap:6px;">
                            <i class="fa-solid fa-triangle-exclamation" style="font-size:11px; margin-top:1px;"></i>
                            <span>Ajustes de áudio ao vivo indisponíveis neste navegador (WebAudio ausente).</span>
                        </div>
            `;
            const gateAviso = `
                        <div style="margin:4px 0; padding:6px 8px; border-radius:4px; background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.25); color:#facc15; font-size:10px; line-height:1.4; display:flex; gap:6px;">
                            <i class="fa-solid fa-triangle-exclamation" style="font-size:11px; margin-top:1px;"></i>
                            <span>Gate indisponível neste navegador (AudioWorklet ausente). O compressor segue funcionando.</span>
                        </div>
            `;
            const gateNota = `
                        <div style="font-size:9px; color:var(--text-muted); padding:2px 0 4px;">Módulo do gate ainda não carregou; o valor já fica salvo e entra em ação quando carregar.</div>
            `;

            // Mesma anatomia das linhas de cor/crop: label + range + value-disp.
            const linhaAoVivo = (attr, prop, rotulo, min, max, step, val) => {
                const disp = this._formatarValorAudioAoVivo(prop, val);
                return `
                        <div class="adjustments-row">
                            <label>${rotulo}${this._slotExplica(this._chaveExplicaControle(prop))}</label>
                            <div class="control-wrap">
                                <input type="range" ${attr}="${prop}" min="${min}" max="${max}" step="${step}" value="${val}" data-tooltip="${rotulo}: ${disp}">
                                <span class="value-disp">${disp}</span>
                            </div>
                        </div>
                `;
            };

            html += `
                <div class="adjustments-section" data-section="audio_eq">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-sliders"></i> Equalizador
                        </span>
                        ${aoVivoOk ? `
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn-adj-bypass" data-section="audio_eq" title="${eqDisabled ? 'Ativar efeito' : 'Desativar efeito'}" style="background:none; border:none; color:${eqDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${eqDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button class="btn-adj-reset" data-section="audio_eq" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                        </div>
                        ` : ''}
                    </div>
                    <div class="adjustments-section-body" style="opacity:${aoVivoOk && eqDisabled ? 0.4 : 1}; pointer-events:${aoVivoOk && eqDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        ${aoVivoOk ? (
                            linhaAoVivo("data-aeq", "hpf", "Corte de Graves (HPF)", 0, 300, 10, Math.round(eqVals.hpf)) +
                            linhaAoVivo("data-aeq", "low", "Graves", -12, 12, 0.5, Number(eqVals.low)) +
                            linhaAoVivo("data-aeq", "mid", "Médios", -12, 12, 0.5, Number(eqVals.mid)) +
                            linhaAoVivo("data-aeq", "high", "Agudos", -12, 12, 0.5, Number(eqVals.high))
                        ) : avisoSemWebAudio}
                    </div>
                </div>

                <div class="adjustments-section" data-section="audio_dynamics">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-compress"></i> Dinâmica (Gate &amp; Compressor)
                        </span>
                        ${aoVivoOk ? `
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn-adj-bypass" data-section="audio_dynamics" title="${dynDisabled ? 'Ativar efeito' : 'Desativar efeito'}" style="background:none; border:none; color:${dynDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${dynDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button class="btn-adj-reset" data-section="audio_dynamics" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                        </div>
                        ` : ''}
                    </div>
                    <div class="adjustments-section-body" style="opacity:${aoVivoOk && dynDisabled ? 0.4 : 1}; pointer-events:${aoVivoOk && dynDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        ${aoVivoOk ? (
                            (gatePossivel
                                ? linhaAoVivo("data-adyn", "gate_db", "Gate", -90, -20, 1, Math.round(dynVals.gate_db)) + (gatePronto ? '' : gateNota)
                                : gateAviso) +
                            linhaAoVivo("data-adyn", "comp_ratio", "Razão", 1, 20, 0.5, Number(dynVals.comp_ratio)) +
                            linhaAoVivo("data-adyn", "comp_thresh_db", "Limiar", -60, 0, 1, Math.round(dynVals.comp_thresh_db)) +
                            linhaAoVivo("data-adyn", "makeup_db", "Ganho (Makeup)", -12, 12, 0.5, Number(dynVals.makeup_db))
                        ) : avisoSemWebAudio}
                    </div>
                </div>
            `;
        }

        // -- SEÇÕES: TRATAMENTO (gera arquivo) + RESULTADO (Etapa 3, Tipo B; contratos F1-F4) --
        // Mesma condição das seções ao vivo: clipe de áudio ou vídeo com áudio vinculado.
        // O efeito audio_render mora no CLIPE DE ÁUDIO (mesmo alvo do EQ/dinâmica).
        if (isAudioTrack || partnerAudioClip) {
            const alvoRender = isAudioTrack ? clip : partnerAudioClip;
            const efeitosRender = Array.isArray(alvoRender.effects) ? alvoRender.effects : [];
            const efeitoRender = efeitosRender.find(e => e && e.type === "audio_render") || null;
            const opcoesIniciais = this._opcoesDeEfeitoAudioRender(efeitoRender);
            const presetInicial = this._presetDeOpcoesAudioRender(opcoesIniciais) || "custom";

            const optSel = (valor, rotulo, atual) => `<option value="${valor}"${String(atual) === String(valor) ? " selected" : ""}>${rotulo}</option>`;
            const caixaPasso = (id, rotulo, marcado, explicaChaves) => `
                        <label style="display:flex; gap:6px; align-items:center; padding:2px 0; font-size:10px; color:var(--text-secondary); cursor:pointer;">
                            <input id="${id}" type="checkbox" ${marcado ? "checked" : ""} style="accent-color: var(--color-cyan); margin:0; cursor:pointer;">
                            <span>${rotulo}${this._slotExplica(explicaChaves)}</span>
                        </label>
            `;
            const selEstilo = "height:20px; font-size:10px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; border-radius:4px; padding:0 2px;";

            html += `
                <div class="adjustments-section" data-section="audio_render">
                    <div class="adjustments-section-title"><i class="fa-solid fa-file-audio"></i> Tratamento (gera arquivo)</div>
                    <div class="adjustments-section-body">
                        <div class="adjustments-row">
                            <label>Preset${this._slotExplica("presets resgate_estourado")}</label>
                            <div class="control-wrap">
                                <select id="adj-ar-preset" class="nle-select" style="${selEstilo} width:100%;">
                                    ${optSel("resgate_estourado", "Resgate de captação estourada", presetInicial)}
                                    ${optSel("so_entrega", "Só entrega", presetInicial)}
                                    ${optSel("ambiencia_preservada", "Ambiência preservada", presetInicial)}
                                    ${optSel("previa_rapida", "Prévia rápida", presetInicial)}
                                    ${optSel("resgate_ia", "Resgate estourado com IA (lento)", presetInicial)}
                                    ${optSel("voz_limpa_ia", "Voz limpa com IA (lento)", presetInicial)}
                                    ${optSel("custom", "Personalizado", presetInicial)}
                                </select>
                            </div>
                        </div>
                        ${caixaPasso("adj-ar-reparo", "Reparo de clipping (adeclip + adeclick)", opcoesIniciais.reparo, "reparo_clipping adeclip adeclick")}
                        ${caixaPasso("adj-ar-fala", "Nivelar fala (speechnorm)", opcoesIniciais.fala, "speechnorm nivelar_fala")}
                        <div class="adjustments-row">
                            <label></label>
                            <div class="control-wrap" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                                <input id="adj-ar-loudnorm" type="checkbox" ${opcoesIniciais.loudnorm ? "checked" : ""} style="accent-color: var(--color-cyan); margin:0; cursor:pointer;">
                                <span style="font-size:10px; color:var(--text-secondary); white-space:nowrap;">Loudness alvo</span>${this._slotExplica("loudnorm lufs alvo_loudness")}
                                <select id="adj-ar-lufs" style="${selEstilo}">
                                    ${optSel("-16", "-16 LUFS", opcoesIniciais.lufs)}
                                    ${optSel("-14", "-14 LUFS", opcoesIniciais.lufs)}
                                    ${optSel("-23", "-23 LUFS (broadcast)", opcoesIniciais.lufs)}
                                </select>
                                <span style="font-size:10px; color:var(--text-muted); white-space:nowrap;">teto</span>${this._slotExplica("dbtp true_peak_db teto_dbtp")}
                                <select id="adj-ar-teto" data-tooltip="Teto de pico real (dBTP), usado pelo loudnorm e pelo alimiter" style="${selEstilo}">
                                    ${optSel("-1.5", "-1,5 dBTP", opcoesIniciais.teto)}
                                    ${optSel("-1", "-1,0 dBTP", opcoesIniciais.teto)}
                                    ${optSel("-2", "-2,0 dBTP", opcoesIniciais.teto)}
                                </select>
                            </div>
                        </div>
                        ${caixaPasso("adj-ar-limitador", "Teto de pico (alimiter)", opcoesIniciais.limitador, "alimiter limitador")}
                        <div class="adjustments-row" style="margin-top:6px;">
                            <label>Motor</label>
                            <div class="control-wrap" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:10px; color:var(--text-secondary);">
                                <label style="display:flex; gap:4px; align-items:center; cursor:pointer;"><input type="radio" name="adj-ar-motor" value="local" checked style="accent-color: var(--color-cyan); cursor:pointer;"> Local</label>
                                <label data-motor-auphonic style="display:flex; gap:4px; align-items:center; opacity:0.45; cursor:not-allowed;" title="Consultando a cota no servidor..."><input type="radio" name="adj-ar-motor" value="auphonic" disabled style="cursor:not-allowed;"> Auphonic${this._slotExplica("auphonic nuvem_auphonic")}</label>
                                <label style="display:flex; gap:4px; align-items:center; opacity:0.45; cursor:not-allowed;" title="Disponível na Etapa 6"><input type="radio" name="adj-ar-motor" value="daw" disabled style="cursor:not-allowed;"> DAW</label>
                            </div>
                        </div>
                        <div id="adj-ar-cota-out"></div>
                        <div id="adj-ar-nuvem-wrap" style="display:none;">
                            <button type="button" id="adj-ar-nuvem-toggle" style="background:none; border:none; padding:4px 0; color:var(--color-violet); cursor:pointer; font-size:10px; display:flex; gap:5px; align-items:center;"><i id="adj-ar-nuvem-seta" class="fa-solid fa-chevron-right"></i> Ajustes da nuvem${this._slotExplica("ajustes_nuvem auphonic_nuvem")}<span id="adj-ar-nuvem-badge" style="color:#facc15;"></span></button>
                            <div id="adj-ar-nuvem-out" style="display:none;"></div>
                        </div>
                        <div style="font-size:9px; color:var(--text-muted); padding:2px 0 4px;">Local roda ffmpeg offline, sem custo. Auphonic usa sua cota mensal na nuvem. Enviar para DAW chega na Etapa 6.</div>
                        <div id="adj-ar-estimativa" style="font-size:10px; color:var(--color-cyan); padding:3px 0;"></div>
                        <div id="adj-ar-aviso-ia" style="display:none; font-size:10px; color:#facc15; padding:3px 0;">Este preset usa IA: o render pode levar vários minutos, não segundos. Vale começar pelo 'Prever 15 s' para ouvir o resultado antes de aplicar o trecho todo.</div>
                        <div style="display:flex; gap:12px; align-items:center; padding:4px 0;">
                            <button id="adj-ar-previa" title="Processa só 15 s a partir do In do clipe, para decidir antes de comprometer o trecho todo" style="background:none; border:none; color:var(--color-cyan); cursor:pointer; font-size:10px; display:flex; gap:4px; align-items:center;"><i class="fa-solid fa-play"></i> Prever 15 s</button>
                            <button id="adj-ar-aplicar" title="Entra numa fila de render e grava um WAV tratado; o original nunca é tocado" style="background:none; border:none; color:var(--color-emerald); cursor:pointer; font-size:10px; display:flex; gap:4px; align-items:center;"><i class="fa-solid fa-gears"></i> Aplicar</button>
                        </div>
                        <div id="adj-ar-previa-out"></div>
                        <div style="font-size:9px; color:var(--text-muted); padding-top:2px;">Diferente dos ajustes ao vivo (mudam na hora), o Aplicar entra numa fila: os números "depois" só aparecem quando o render termina.</div>
                    </div>
                </div>

                <div class="adjustments-section" data-section="audio_render_resultado">
                    <div class="adjustments-section-title"><i class="fa-solid fa-chart-column"></i> Resultado</div>
                    <div id="adj-ar-resultado-body" data-alvo="${alvoRender.id}" class="adjustments-section-body">
                        ${this._audioResultadoInner(efeitoRender, alvoRender.id)}
                    </div>
                </div>
            `;
        }

        if (!isAudioTrack) {

            // -- SEÇÃO: MOVIMENTO (KEN BURNS) --
            if (isPhoto) {
                html += `
                    <div class="adjustments-section">
                        <div class="adjustments-section-title"><i class="fa-solid fa-circle-nodes"></i> Movimento (Ken Burns)</div>
                        <div class="adjustments-row" style="margin-bottom:0;">
                            <select id="adj-kb-preset" class="nle-select" style="width:100%;">
                                <option value="none" ${kbPreset === 'none' ? 'selected' : ''}>Nenhum</option>
                                <option value="zoomIn" ${kbPreset === 'zoomIn' ? 'selected' : ''}>Zoom In</option>
                                <option value="zoomOut" ${kbPreset === 'zoomOut' ? 'selected' : ''}>Zoom Out</option>
                                <option value="panRight" ${kbPreset === 'panRight' ? 'selected' : ''}>Pan Direita →</option>
                                <option value="panLeft" ${kbPreset === 'panLeft' ? 'selected' : ''}>Pan Esquerda ←</option>
                            </select>
                        </div>
                    </div>
                `;
            }

            // -- SEÇÃO: GEOMETRIA --
            const tfDisabled = tf.disabled === true;
            html += `
                <div class="adjustments-section">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-arrows-up-down-left-right"></i> Transformações
                        </span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn-adj-bypass" data-section="transform" title="${tfDisabled ? 'Ativar efeito' : 'Desativar efeito'}" style="background:none; border:none; color:${tfDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${tfDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button class="btn-adj-reset" data-section="transform" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                        </div>
                    </div>
                    <div class="adjustments-section-body" style="opacity:${tfDisabled ? 0.4 : 1}; pointer-events:${tfDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        <div class="adjustments-row">
                            <label>Posição X</label>
                            <div class="control-wrap">
                                <input type="range" data-prop="x" min="-100" max="100" value="${roundVal(x)}" data-tooltip="Posição X: ${roundVal(x)}%">
                                <span class="value-disp">${roundVal(x)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Posição Y</label>
                            <div class="control-wrap">
                                <input type="range" data-prop="y" min="-100" max="100" value="${roundVal(y)}" data-tooltip="Posição Y: ${roundVal(y)}%">
                                <span class="value-disp">${roundVal(y)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Escala</label>
                            <div class="control-wrap">
                                <input type="range" data-prop="scale" min="50" max="300" value="${roundVal(scale * 100)}" data-tooltip="Escala: ${roundVal(scale * 100)}%">
                                <span class="value-disp">${roundVal(scale * 100)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Rotação</label>
                            <div class="control-wrap">
                                <input type="range" data-prop="rotation" min="-180" max="180" value="${roundVal(rotation)}" data-tooltip="Rotação: ${roundVal(rotation)}°">
                                <span class="value-disp">${roundVal(rotation)}°</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Opacidade</label>
                            <div class="control-wrap">
                                <input type="range" data-prop="opacity" min="0" max="100" value="${roundVal(opacity * 100)}" data-tooltip="Opacidade: ${roundVal(opacity * 100)}%">
                                <span class="value-disp">${roundVal(opacity * 100)}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // -- SEÇÃO: CORTE (CROP) --
            const cropDisabled = cropEffect.disabled === true;
            html += `
                <div class="adjustments-section">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-scissors"></i> Recorte (Crop)
                        </span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn-adj-bypass" data-section="crop" title="${cropDisabled ? 'Ativar efeito' : 'Desativar efeito'}" style="background:none; border:none; color:${cropDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${cropDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button class="btn-adj-reset" data-section="crop" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                        </div>
                    </div>
                    <div class="adjustments-section-body" style="opacity:${cropDisabled ? 0.4 : 1}; pointer-events:${cropDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        <div class="adjustments-row">
                            <label>Esquerda</label>
                            <div class="control-wrap">
                                <input type="range" data-crop="left" min="0" max="100" value="${roundVal(cropLeft)}" data-tooltip="Recorte Esquerda: ${roundVal(cropLeft)}%">
                                <span class="value-disp">${roundVal(cropLeft)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Direita</label>
                            <div class="control-wrap">
                                <input type="range" data-crop="right" min="0" max="100" value="${roundVal(cropRight)}" data-tooltip="Recorte Direita: ${roundVal(cropRight)}%">
                                <span class="value-disp">${roundVal(cropRight)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Topo</label>
                            <div class="control-wrap">
                                <input type="range" data-crop="top" min="0" max="100" value="${roundVal(cropTop)}" data-tooltip="Recorte Topo: ${roundVal(cropTop)}%">
                                <span class="value-disp">${roundVal(cropTop)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Base</label>
                            <div class="control-wrap">
                                <input type="range" data-crop="bottom" min="0" max="100" value="${roundVal(cropBottom)}" data-tooltip="Recorte Base: ${roundVal(cropBottom)}%">
                                <span class="value-disp">${roundVal(cropBottom)}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // -- SEÇÃO: CORES & FILTROS --
            const colDisabled = col.disabled === true;
            html += `
                <div class="adjustments-section">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-palette"></i> Efeitos de Cor
                        </span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn-adj-bypass" data-section="color" title="${colDisabled ? 'Ativar efeito' : 'Desativar efeito'}" style="background:none; border:none; color:${colDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${colDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button class="btn-adj-reset" data-section="color" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                        </div>
                    </div>
                    <div class="adjustments-section-body" style="opacity:${colDisabled ? 0.4 : 1}; pointer-events:${colDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        <div class="adjustments-row">
                            <label>Brilho</label>
                            <div class="control-wrap">
                                <input type="range" data-color="brightness" min="-100" max="100" value="${roundVal(brightness)}" data-tooltip="Brilho: ${roundVal(brightness)}%">
                                <span class="value-disp">${roundVal(brightness)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Contraste</label>
                            <div class="control-wrap">
                                <input type="range" data-color="contrast" min="-100" max="100" value="${roundVal(contrast)}" data-tooltip="Contraste: ${roundVal(contrast)}%">
                                <span class="value-disp">${roundVal(contrast)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Saturação</label>
                            <div class="control-wrap">
                                <input type="range" data-color="saturation" min="0" max="200" value="${roundVal(saturation)}" data-tooltip="Saturação: ${roundVal(saturation)}%">
                                <span class="value-disp">${roundVal(saturation)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Matiz</label>
                            <div class="control-wrap">
                                <input type="range" data-color="hue" min="-180" max="180" value="${roundVal(hue)}" data-tooltip="Matiz: ${roundVal(hue)}°">
                                <span class="value-disp">${roundVal(hue)}°</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Sépia</label>
                            <div class="control-wrap">
                                <input type="range" data-color="sepia" min="0" max="100" value="${roundVal(sepia)}" data-tooltip="Sépia: ${roundVal(sepia)}%">
                                <span class="value-disp">${roundVal(sepia)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Cinzas</label>
                            <div class="control-wrap">
                                <input type="range" data-color="grayscale" min="0" max="100" value="${roundVal(grayscale)}" data-tooltip="Cinzas: ${roundVal(grayscale)}%">
                                <span class="value-disp">${roundVal(grayscale)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Desfoque</label>
                            <div class="control-wrap">
                                <input type="range" data-color="blur" min="0" max="20" value="${roundVal(blur)}" data-tooltip="Desfoque: ${roundVal(blur)}px">
                                <span class="value-disp">${roundVal(blur)}px</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // -- SEÇÃO: VOLUME DE ÁUDIO --
        if (isAudioTrack || partnerAudioClip) {
            const dbVal = level > 0 ? (20 * Math.log10(level)).toFixed(1) : "-inf";
            const targetVolClip = isAudioTrack ? clip : partnerAudioClip;
            const volEffect = targetVolClip ? (targetVolClip.effects || []).find(e => e.type === "volume") : null;
            const volDisabled = volEffect ? volEffect.disabled === true : false;

            html += `
                <div class="adjustments-section">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-volume-high"></i> Áudio / Volume
                        </span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn-adj-bypass" data-section="volume" title="${volDisabled ? 'Ativar volume' : 'Desativar volume'}" style="background:none; border:none; color:${volDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${volDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button class="btn-adj-reset" data-section="volume" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                        </div>
                    </div>
                    <div class="adjustments-section-body" style="opacity:${volDisabled ? 0.4 : 1}; pointer-events:${volDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        <div class="adjustments-row">
                            <label>Nível</label>
                            <div class="control-wrap" style="flex:1; width:100%; display:flex; align-items:center; gap:6px; flex-wrap:nowrap;">
                                <input id="adj-volume-slider" type="range" min="0" max="200" value="${roundVal(level * 100)}" data-tooltip="Volume: ${roundVal(level * 100)}% (${dbVal} dB)" style="flex:1; min-width:50px;">
                                <span class="value-disp" style="min-width: 55px; white-space: nowrap; flex-shrink: 0; font-size: 8.5px;">${roundVal(level * 100)}% (${dbVal} dB)</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // -- SEÇÃO: TRANSIÇÕES (FADES) --
        const fadesDisabled = (fadeIn && fadeIn.disabled === true) || (fadeOut && fadeOut.disabled === true);
        html += `
            <div class="adjustments-section">
                <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span style="display:flex; gap:6px; align-items:center;">
                        <i class="fa-solid fa-circle-half-stroke"></i> Transições
                    </span>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <button class="btn-adj-bypass" data-section="fades" title="${fadesDisabled ? 'Ativar transições' : 'Desativar transições'}" style="background:none; border:none; color:${fadesDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${fadesDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                        <button class="btn-adj-reset" data-section="fades" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                    </div>
                </div>
                <div class="adjustments-section-body" style="opacity:${fadesDisabled ? 0.4 : 1}; pointer-events:${fadesDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        <div class="adjustments-row adjustments-row-fade" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <label style="font-size:11px; color:var(--text-secondary);">Fade In</label>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <div class="control-wrap" style="display:flex; align-items:center; gap:2px;">
                                    <input id="adj-fadein" type="number" class="nle-input-flat" min="0" step="0.1" value="${fadeInDur}" data-tooltip="Fade In: ${fadeInDur}s" style="background:transparent; border:none; outline:none; color:var(--color-cyan); font-size:11px; font-weight:600; text-align:right; width:34px; font-family:monospace; padding:0;">
                                    <span style="font-size:10px; color:var(--text-muted); user-select:none;">s</span>
                                    <div class="flat-number-stepper" style="display:flex; flex-direction:column; gap:1px; margin-left:3px;">
                                        <button class="btn-fade-step" data-target="adj-fadein" data-dir="up" title="Aumentar (0.1s)" style="background:transparent; border:none; padding:0; margin:0; color:var(--text-muted); font-size:7px; height:6px; line-height:6px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-chevron-up"></i></button>
                                        <button class="btn-fade-step" data-target="adj-fadein" data-dir="down" title="Diminuir (0.1s)" style="background:transparent; border:none; padding:0; margin:0; color:var(--text-muted); font-size:7px; height:6px; line-height:6px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-chevron-down"></i></button>
                                    </div>
                                </div>
                                <select id="adj-fadein-curve" class="nle-select" style="font-size:10px; padding:2px 4px; height:22px; width:95px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); border-radius:4px; color:var(--text-secondary);">
                                    <option value="linear" ${fadeInCurve === 'linear' ? 'selected' : ''}>Linear</option>
                                    <option value="exponential" ${fadeInCurve === 'exponential' ? 'selected' : ''}>Exponencial</option>
                                    <option value="logarithmic" ${fadeInCurve === 'logarithmic' ? 'selected' : ''}>Logarítmica</option>
                                    <option value="s_curve" ${fadeInCurve === 's_curve' ? 'selected' : ''}>Curva em S</option>
                                    <option value="custom" ${fadeInCurve === 'custom' ? 'selected' : ''}>Customizada</option>
                                </select>
                            </div>
                        </div>
                        <div class="adjustments-row adjustments-row-fade" style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:11px; color:var(--text-secondary);">Fade Out</label>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <div class="control-wrap" style="display:flex; align-items:center; gap:2px;">
                                    <input id="adj-fadeout" type="number" class="nle-input-flat" min="0" step="0.1" value="${fadeOutDur}" data-tooltip="Fade Out: ${fadeOutDur}s" style="background:transparent; border:none; outline:none; color:var(--color-cyan); font-size:11px; font-weight:600; text-align:right; width:34px; font-family:monospace; padding:0;">
                                    <span style="font-size:10px; color:var(--text-muted); user-select:none;">s</span>
                                    <div class="flat-number-stepper" style="display:flex; flex-direction:column; gap:1px; margin-left:3px;">
                                        <button class="btn-fade-step" data-target="adj-fadeout" data-dir="up" title="Aumentar (0.1s)" style="background:transparent; border:none; padding:0; margin:0; color:var(--text-muted); font-size:7px; height:6px; line-height:6px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-chevron-up"></i></button>
                                        <button class="btn-fade-step" data-target="adj-fadeout" data-dir="down" title="Diminuir (0.1s)" style="background:transparent; border:none; padding:0; margin:0; color:var(--text-muted); font-size:7px; height:6px; line-height:6px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-chevron-down"></i></button>
                                    </div>
                                </div>
                                <select id="adj-fadeout-curve" class="nle-select" style="font-size:10px; padding:2px 4px; height:22px; width:95px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); border-radius:4px; color:var(--text-secondary);">
                                    <option value="linear" ${fadeOutCurve === 'linear' ? 'selected' : ''}>Linear</option>
                                    <option value="exponential" ${fadeOutCurve === 'exponential' ? 'selected' : ''}>Exponencial</option>
                                    <option value="logarithmic" ${fadeOutCurve === 'logarithmic' ? 'selected' : ''}>Logarítmica</option>
                                    <option value="s_curve" ${fadeOutCurve === 's_curve' ? 'selected' : ''}>Curva em S</option>
                                    <option value="custom" ${fadeOutCurve === 'custom' ? 'selected' : ''}>Customizada</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            `;

        const savedScrollTop = container.scrollTop;
        container.innerHTML = html;
        container.scrollTop = savedScrollTop;

        // Acoplar listeners
        this.attachAdjustmentsListeners(container, clip.id);

        // N2: os ícones (i) entram POR FORA, quando o glossário chegar do servidor;
        // até lá as âncoras ficam vazias e nada aparece (painel inteiro e usável).
        this._montarIconesExplica(container).catch((err) => console.error("[timeline] falha ao montar os ícones de explicação:", err));
    }

    _audioDiagEsc(s) {
        return String(s === undefined || s === null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    _audioDiagLabel(metrica) {
        const labels = {
            lufs_i: "Loudness",
            lra: "Dinâmica (LRA)",
            true_peak_db: "Pico real",
            rms_db: "RMS",
            peak_db: "Pico (sample)",
            crest_factor: "Fator de crista",
            noise_floor_db: "Ruído (piso)",
            n_samples: "Amostras",
            peak_count: "Amostras clipadas",
            clip_pct: "Clipping",
            stereo_corr: "Correlação estéreo",
            canais: "Canais",
        };
        if (!metrica) return "Métrica";
        return labels[String(metrica)] || String(metrica);
    }

    _audioDiagValor(metrica, valor) {
        if (valor === null || valor === undefined) return "--";
        const num = Number(valor);
        if (!isFinite(num)) return "-inf";
        const key = String(metrica || "");
        if (key === "n_samples" || key === "peak_count" || key === "canais") return String(Math.round(num));
        if (key === "stereo_corr") return num.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
        if (key === "clip_pct") return `${num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% das amostras`;
        const unidade = key === "lufs_i" ? "LUFS" : (key === "lra" ? "LU" : "dB");
        return `${num.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unidade}`;
    }

    _audioDiagBadge(severidade) {
        const meta = {
            ok: { label: "OK", color: "var(--color-emerald)", bg: "rgba(16,185,129,0.12)" },
            atencao: { label: "ATENÇÃO", color: "#facc15", bg: "rgba(234,179,8,0.12)" },
            grave: { label: "GRAVE", color: "var(--color-rose)", bg: "rgba(244,63,94,0.12)" },
        }[severidade] || { label: String(severidade || "?").toUpperCase(), color: "var(--text-muted)", bg: "rgba(255,255,255,0.06)" };
        return `<span style="font-size:8px; font-weight:bold; padding:2px 6px; border-radius:4px; letter-spacing:0.5px; background:${meta.bg}; color:${meta.color}; white-space:nowrap;">${this._audioDiagEsc(meta.label)}</span>`;
    }

    _audioDiagResultInner(data, expandido = false) {
        this._audioDiagLastData = data;
        const erroBox = (msg) => `
            <div style="margin:4px 0; padding:6px 8px; border-radius:4px; background:rgba(244,63,94,0.08); border:1px solid rgba(244,63,94,0.25); color:var(--color-rose); font-size:10px; line-height:1.4; display:flex; gap:6px; align-items:flex-start;">
                <i class="fa-solid fa-circle-exclamation" style="margin-top:1px;"></i>
                <span>${this._audioDiagEsc(msg)}</span>
            </div>
        `;

        if (!data || data.ok !== true) {
            return erroBox((data && data.erro) ? data.erro : "Resposta inválida da análise de áudio.");
        }

        const avaliacao = data.avaliacao || {};
        const selos = Array.isArray(avaliacao.selos) ? avaliacao.selos : [];
        if (selos.length === 0) {
            return erroBox("A análise não retornou métricas de áudio.");
        }

        const rows = selos.map(s => `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:3px 0;">
                <span style="font-size:10px; color:var(--text-secondary); flex-shrink:0;">${this._audioDiagEsc(this._audioDiagLabel(s && s.metrica))}</span>
                ${this._slotExplica(this._chaveExplicaMetrica(s && s.metrica))}
                <span style="display:flex; gap:6px; align-items:center; min-width:0;">
                    <span title="${this._audioDiagEsc(s && s.texto)}" style="font-size:10px; color:var(--text-primary); font-family:monospace; white-space:nowrap;">${this._audioDiagEsc(this._audioDiagValor(s && s.metrica, s ? s.valor : null))}</span>
                    ${this._audioDiagBadge(s && s.severidade)}
                </span>
            </div>
        `).join("");

        // Contrato C3: fonte "proxy" significa que a medida veio do intermediario, não do arquivo bruto.
        const proxyNota = data.fonte === "proxy" ? `
            <div style="margin-top:5px; padding:5px 7px; border-radius:4px; background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.25); color:#facc15; font-size:9px; line-height:1.4; display:flex; gap:5px; align-items:flex-start;">
                <i class="fa-solid fa-triangle-exclamation" style="margin-top:1px;"></i>
                <span>Análise medida no proxy (arquivo intermediário): os valores podem diferir do arquivo original.</span>
            </div>
        ` : "";

        const fonteLinha = (data.fonte && data.fonte !== "proxy") ? `
            <div style="margin-top:4px; font-size:9px; color:var(--text-muted);">
                Fonte: ${this._audioDiagEsc(data.fonte)}${data.cached === true ? " (resultado em cache)" : ""}
            </div>
        ` : "";

        const presetLinha = avaliacao.preset_sugerido ? `
            <div style="border-top:1px solid var(--border-glass); margin-top:5px; padding-top:5px; font-size:10px; line-height:1.4; color:var(--color-cyan); display:flex; gap:6px; align-items:flex-start;">
                <i class="fa-solid fa-wand-magic-sparkles" style="margin-top:1px;"></i>
                <span>Sugestão: ${this._audioDiagEsc(avaliacao.preset_sugerido)}</span>
            </div>
        ` : "";

        // Rodada 2: bloco "onde estourou" (contrato D1: diag.momentos + diag.envelope).
        // Resposta antiga sem as chaves novas não ganha o bloco (nem lista vazia pendurada).
        const diag = data.diag || {};
        const temSerieNova = Array.isArray(diag.momentos) || Array.isArray(diag.envelope);
        const blocoMomentos = temSerieNova ? this._audioDiagMomentsBlock(diag.momentos, expandido === true) : "";

        return `${rows}${blocoMomentos}${fonteLinha}${proxyNota}${presetLinha}`;
    }

    _audioDiagOrdenarMomentos(momentos) {
        const lista = Array.isArray(momentos)
            ? momentos.filter(m => m && typeof m === "object")
            : [];
        const picoDe = (m) => {
            const n = Number(m.pico);
            return isFinite(n) ? n : -Infinity;
        };
        return lista.slice().sort((a, b) => picoDe(b) - picoDe(a));
    }

    _audioDiagTimecode(segundos) {
        const total = Math.max(0, Math.floor(Number(segundos) || 0));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const pad = (n) => String(n).padStart(2, "0");
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    _audioDiagFormatPico(pico) {
        const n = Number(pico);
        if (!isFinite(n)) return "-- dBTP";
        const sinal = n > 0 ? "+" : "";
        return `${sinal}${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dBTP`;
    }

    _audioDiagMomentsBlock(momentos, expandido) {
        const lista = this._audioDiagOrdenarMomentos(momentos);
        if (lista.length === 0) {
            return `
                <div style="border-top:1px solid var(--border-glass); margin-top:5px; padding-top:5px; font-size:10px; color:var(--color-emerald); display:flex; gap:6px; align-items:center;">
                    <i class="fa-solid fa-circle-check" style="flex-shrink:0;"></i>
                    <span>Nenhum estouro nem trecho no limite neste intervalo. Áudio sob controle.</span>
                </div>
            `;
        }

        const contaTipo = (tipo) => lista.filter(m => m.tipo === tipo).length;
        const estouros = contaTipo("estouro");
        const quases = contaTipo("quase");
        const plural = (n, singular, pluralStr) => (n === 1 ? singular : pluralStr);
        const resumo = [];
        if (estouros > 0) resumo.push(`<span style="color:var(--color-rose);">Estourou em ${estouros} ${plural(estouros, "trecho", "trechos")}</span>`);
        if (quases > 0) resumo.push(`<span style="color:#facc15;">${quases} ${plural(quases, "trecho", "trechos")} no limite</span>`);

        const MAX_VISIVEIS = 6;
        const visiveis = expandido === true ? lista : lista.slice(0, MAX_VISIVEIS);
        const linhas = visiveis.map(m => {
            const cor = (m.tipo === "estouro" || m.severidade === "grave") ? "var(--color-rose)" : "#facc15";
            const t = Number(m.inicio);
            return `
                <button type="button" class="adj-diag-jump" data-time="${isFinite(t) ? t : ""}" data-tooltip="Ir para ${this._audioDiagTimecode(t)} na timeline" style="display:flex; justify-content:space-between; align-items:center; gap:8px; width:100%; background:none; border:none; border-radius:4px; padding:3px 4px; margin:1px 0; cursor:pointer; font-family:inherit;">
                    <span style="font-size:10px; color:${cor}; font-family:monospace; white-space:nowrap;">${this._audioDiagTimecode(t)}</span>
                    <span style="font-size:10px; color:${cor}; font-family:monospace; white-space:nowrap;">${this._audioDiagFormatPico(m.pico)}</span>
                </button>
            `;
        }).join("");

        const restantes = lista.length - visiveis.length;
        let toggleBtn = "";
        if (restantes > 0) {
            toggleBtn = `<button type="button" class="adj-diag-more" style="background:none; border:none; padding:2px 4px; color:var(--color-cyan); cursor:pointer; font-size:9px;">Ver mais (${restantes})</button>`;
        } else if ((expandido === true) && lista.length > MAX_VISIVEIS) {
            toggleBtn = `<button type="button" class="adj-diag-more" style="background:none; border:none; padding:2px 4px; color:var(--text-muted); cursor:pointer; font-size:9px;">Ver menos</button>`;
        }

        return `
            <div style="border-top:1px solid var(--border-glass); margin-top:5px; padding-top:5px;">
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:10px; font-weight:bold; margin-bottom:2px;">${resumo.join("")}</div>
                ${linhas}
                ${toggleBtn}
            </div>
        `;
    }

    // Converte segundos ABSOLUTOS da fonte para quadro da TIMELINE:
    // desconta o in do clipe na fonte e soma a posição do clipe na timeline.
    _audioDiagSourceToTimelineFrame(clip, sourceSeconds) {
        if (!clip) return null;
        const t = Number(sourceSeconds);
        const srcIn = Number(clip.in);
        if (!isFinite(t) || !isFinite(srcIn)) return null;
        const fps = TIMELINE_STATE.fps || 24;
        let inicioNaTimeline = 0;
        if (clip.timelineStartFrame !== undefined && clip.timelineStartFrame !== null) {
            inicioNaTimeline = Number(clip.timelineStartFrame);
        } else {
            inicioNaTimeline = Math.round(Number(clip.timeline_start || 0) * fps);
        }
        if (!isFinite(inicioNaTimeline)) inicioNaTimeline = 0;
        return Math.max(0, inicioNaTimeline + secondsToFrames(t - srcIn, fps));
    }

    // ── TRATAMENTO RENDERIZADO (Etapa 3, Tipo B) — contratos F1/F2/F3/F4 ──

    /** Velocidade medida por motor, em x tempo real. Etapa 3: só Local (~90x medido no
     *  ffmpeg: clipe de 90 s renderiza em ~1 s). Quando a Etapa 4 trouxer denoise IA,
     *  entra aqui uma chave nova (ia: 1.2) e o resto não muda. */
    _velocidadesRender() {
        // Fonte única das velocidades MEDIDAS (constantes no topo do arquivo);
        // 'ia' cobre os presets *_ia, cujo custo é dominado pelo passo denoise_ia.
        return { local: VELOCIDADE_RENDER_FFMPEG_X_TEMPO_REAL, ia: VELOCIDADE_RENDER_DENOISE_IA_X_TEMPO_REAL };
    }

    /** Conta honesta da estimativa: duração do trecho ÷ velocidade medida. Puro.
     *  H6: com motor Auphonic não há velocidade medida daqui — o tempo é da fila
     *  de lá, e a preocupação real do dono é a cota, então aponta para ela.
     *  Preset de IA usa a velocidade medida do denoise_ia: prometer a conta do
     *  ffmpeg aqui mentiria ~50x (30 s anunciados para um trabalho de ~11 min). */
    _estimativaRenderTexto(duracaoS, engine, preset) {
        const duracao = Math.max(0, Number(duracaoS) || 0);
        const curta = (s) => {
            if (s < 60) return `${Number(s.toFixed(1)).toLocaleString("pt-BR")} s`;
            const min = Math.floor(s / 60);
            const seg = Math.round(s - min * 60);
            return `${min} min ${String(seg).padStart(2, "0")} s`;
        };
        if (String(engine || "local") === "auphonic") {
            return `Estimativa (Auphonic): ${Number(duracao.toFixed(1)).toLocaleString("pt-BR")} s sobem para a nuvem; o tempo depende da fila lá. Confira a cota antes de aplicar.`;
        }
        if (this._presetEhDeIa(preset)) {
            const velIa = this._velocidadesRender().ia;
            const estimado = duracao / velIa;
            return `Estimativa (IA): ${Number(duracao.toFixed(1)).toLocaleString("pt-BR")} s ÷ ${velIa} ≈ ${curta(estimado)} de render — o passo de IA é dezenas de vezes mais lento que o ffmpeg.`;
        }
        const velLocal = this._velocidadesRender().local;
        const estimado = duracao / velLocal;
        return `Estimativa (Local): ${Number(duracao.toFixed(1)).toLocaleString("pt-BR")} s ÷ ${velLocal} ≈ ${curta(estimado)} de render`;
    }

    /** Os únicos presets cuja cadeia leva o passo caro denoise_ia (espelho dos
     *  *_ia de PRESETS_CADEIA em src/media/audio_chain.py). Puro. */
    _presetEhDeIa(preset) {
        return preset === "resgate_ia" || preset === "voz_limpa_ia";
    }

    /** Espelho local dos presets do contrato F1 (PRESETS_CADEIA), só para marcar o
     *  seletor. Ao enviar um preset pelo nome, quem expande de verdade é o servidor.
     *  Os dois *_ia repetem opções de um clássico + ia:true: é essa chave que os
     *  distingue na hora de nomear o preset no corpo do POST. */
    _presetsAudioRender() {
        return {
            resgate_estourado:    { reparo: true,  fala: true,  loudnorm: true, lufs: -16, teto: -1.5, limitador: true },
            so_entrega:           { reparo: false, fala: false, loudnorm: true, lufs: -16, teto: -1.5, limitador: true },
            ambiencia_preservada: { reparo: false, fala: true,  loudnorm: true, lufs: -16, teto: -1.5, limitador: false },
            previa_rapida:        { reparo: false, fala: false, loudnorm: true, lufs: -14, teto: -1,   limitador: false },
            resgate_ia:           { reparo: true,  fala: false, loudnorm: true, lufs: -16, teto: -1.5, limitador: true,  ia: true, denoise_ia_db: 18 },
            voz_limpa_ia:         { reparo: false, fala: false, loudnorm: true, lufs: -16, teto: -1.5, limitador: false, ia: true, denoise_ia_db: 6 },
        };
    }

    /** Cadeia na ORDEM canônica do F1 (reparo de clipping sempre primeiro; loudnorm e
     *  alimiter carregam os parâmetros dos controles). Pura. */
    _montarCadeiaLocal(opcoes) {
        const o = opcoes || {};
        const num = (v, def) => { const n = Number(v); return isFinite(n) ? n : def; };
        const cadeia = [];
        if (o.reparo === true) cadeia.push("adeclip", "adeclick");
        if (o.ia === true) cadeia.push(`denoise_ia:${num(o.denoise_ia_db, 12)}`);
        if (o.fala === true) cadeia.push("speechnorm");
        if (o.loudnorm === true) cadeia.push(`loudnorm:${num(o.lufs, -16)}:${num(o.teto, -1.5)}`);
        if (o.limitador === true) cadeia.push(`alimiter:${num(o.teto, -1.5)}`);
        return cadeia;
    }

    _opcoesIguaisAudioRender(a, b) {
        for (const k of ["reparo", "fala", "loudnorm", "limitador", "ia"]) {
            if ((a ? !!a[k] : false) !== (b ? !!b[k] : false)) return false;
        }
        for (const k of ["lufs", "teto"]) {
            if (Number(a ? a[k] : NaN) !== Number(b ? b[k] : NaN)) return false;
        }
        return true;
    }

    /** Nome do preset quando as opções batem exatamente com o espelho local; senão null. */
    _presetDeOpcoesAudioRender(opcoes) {
        const presets = this._presetsAudioRender();
        for (const nome of Object.keys(presets)) {
            if (this._opcoesIguaisAudioRender(opcoes, presets[nome])) return nome;
        }
        return null;
    }

    /** Lê os controles do bloco TRATAMENTO a partir de um container com querySelector. */
    _lerOpcoesAudioRender(container) {
        const marcado = (id) => { const el = container.querySelector(`#${id}`); return !!(el && el.checked); };
        const numero = (id, def) => {
            const el = container.querySelector(`#${id}`);
            const n = el ? parseFloat(el.value) : NaN;
            return isFinite(n) ? n : def;
        };
        const selPreset = container.querySelector("#adj-ar-preset");
        const defPreset = selPreset ? this._presetsAudioRender()[selPreset.value] : null;
        return {
            reparo: marcado("adj-ar-reparo"),
            fala: marcado("adj-ar-fala"),
            loudnorm: marcado("adj-ar-loudnorm"),
            lufs: numero("adj-ar-lufs", -16),
            teto: numero("adj-ar-teto", -1.5),
            limitador: marcado("adj-ar-limitador"),
            // A IA não tem checkbox próprio: ela é o que diferencia resgate_ia de
            // resgate_estourado (e voz_limpa_ia do custom), então vem do seletor.
            ia: !!(defPreset && defPreset.ia === true),
            denoise_ia_db: defPreset && defPreset.ia === true ? defPreset.denoise_ia_db : undefined,
        };
    }

    /** Reconstrói opções a partir da cadeia gravada no efeito (F3), para reabrir o painel coerente. */
    _opcoesDeEfeitoAudioRender(efeito) {
        const opcoes = { reparo: false, fala: false, loudnorm: false, lufs: -16, teto: -1.5, limitador: false, ia: false };
        const cadeia = efeito && Array.isArray(efeito.chain) ? efeito.chain : [];
        for (const passo of cadeia) {
            const partes = String(passo).split(":");
            if (partes[0] === "adeclip" || partes[0] === "adeclick") opcoes.reparo = true;
            else if (partes[0] === "denoise_ia") {
                // Render de preset *_ia grava o passo caro na chain; a presença
                // dele reabre o seletor no preset de IA certo.
                opcoes.ia = true;
                if (partes[1] !== undefined && partes[1] !== "" && isFinite(Number(partes[1]))) opcoes.denoise_ia_db = Number(partes[1]);
            }
            else if (partes[0] === "speechnorm") opcoes.fala = true;
            else if (partes[0] === "loudnorm") {
                opcoes.loudnorm = true;
                if (partes[1] !== undefined && partes[1] !== "") opcoes.lufs = Number(partes[1]);
                if (partes[2] !== undefined && partes[2] !== "") opcoes.teto = Number(partes[2]);
            } else if (partes[0] === "alimiter") {
                opcoes.limitador = true;
                if (partes[1] !== undefined && partes[1] !== "") opcoes.teto = Number(partes[1]);
            }
        }
        return opcoes;
    }

    /** Corpo do POST do contrato F2: preset quando as opções batem com um preset,
     *  cadeia explícita quando não. Puro (independe de DOM). */
    _montarCorpoRender(opcoes, inS, outS, previa) {
        const corpo = { in: Number(inS), out: Number(outS), previa: previa === true };
        const preset = this._presetDeOpcoesAudioRender(opcoes);
        if (preset) corpo.preset = preset;
        else corpo.cadeia = this._montarCadeiaLocal(opcoes);
        return corpo;
    }

    /** Tolerante aos dois formatos de análise: chaves curtas do plano (lufs/tp/nf/lra/
     *  clip_pct) ou completas da rota de análise (lufs_i/true_peak_db/noise_floor_db). */
    _resumirAnalise(analise) {
        if (!analise || typeof analise !== "object") return null;
        const pega = (...chaves) => {
            for (const k of chaves) {
                const v = analise[k];
                const n = Number(v);
                if (v !== undefined && v !== null && isFinite(n)) return n;
            }
            return null;
        };
        return {
            lufs: pega("lufs", "lufs_i"),
            tp: pega("tp", "true_peak_db"),
            nf: pega("nf", "noise_floor_db"),
            lra: pega("lra"),
            clip_pct: pega("clip_pct"),
        };
    }

    /** Efeito NOVO exatamente com as chaves do contrato F3 — nada entra, nada falta. */
    _montarEfeitoAudioRender(base, patch) {
        const b = (base && base.type === "audio_render") ? base : {};
        const p = patch || {};
        const ou = (novo, antigo, def) => (novo !== undefined ? novo : (antigo !== undefined ? antigo : def));
        return {
            type: "audio_render",
            engine: ou(p.engine, b.engine, "local"),
            ref: ou(p.ref, b.ref, null),
            chain: Array.isArray(p.chain) ? p.chain.slice() : (Array.isArray(b.chain) ? b.chain.slice() : []),
            status: ou(p.status, b.status, "pending"),
            analysis_before: ou(p.analysis_before, b.analysis_before, null),
            analysis_after: ou(p.analysis_after, b.analysis_after, null),
        };
    }

    /** Clipe de ÁUDIO que recebe o efeito (mesma regra das seções ao vivo: vídeo usa o parceiro via link_id). */
    _alvoAudioRenderId(clip) {
        if (!clip) return null;
        if (TIMELINE_STATE.trackKindOf(clip.track) === "audio") return clip.id;
        if (clip.type === "video" && clip.link_id) {
            const parceiro = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
            if (parceiro) return parceiro.id;
        }
        return clip.id;
    }

    /** Grava/atualiza o efeito audio_render no clipe de áudio; o autosave sai pelo
     *  caminho de sempre (_mutateClipEffects -> STATE.activeTimelineCuts -> timelineCutsUpdated). */
    _gravarEfeitoAudioRender(alvoClipId, patch) {
        this._mutateClipEffects(alvoClipId, (c) => {
            const i = c.effects.findIndex(e => e.type === "audio_render");
            const novo = this._montarEfeitoAudioRender(i >= 0 ? c.effects[i] : null, patch);
            if (i >= 0) c.effects[i] = novo; else c.effects.push(novo);
        });
    }

    _registrarErroRender(alvoClipId, mensagem) {
        this._errosRenderAudio = this._errosRenderAudio || {};
        this._errosRenderAudio[String(alvoClipId)] = String(mensagem || "");
    }

    _erroRenderDe(alvoClipId) {
        return (this._errosRenderAudio && this._errosRenderAudio[String(alvoClipId)]) || null;
    }

    /** ProgramPlayer cru (sem exigir WebAudio, diferente de _playerAudioAoVivo). */
    _playerPrograma() {
        if (typeof window === "undefined") return null;
        return (window.player && window.player.programPlayer) ? window.player.programPlayer : null;
    }

    /** F4: registra (ou devolve) a fonte tratada do clipe no player.
     *  true = usar o ref do próprio efeito audio_render ready; null = original. */
    _conectarFonteTratada(alvoClipId, tratado) {
        const pp = this._playerPrograma();
        if (!pp || typeof pp.definirFonteAudioTratada !== "function") return false;
        try {
            pp.definirFonteAudioTratada(alvoClipId, tratado === true ? true : null);
            return true;
        } catch (err) {
            console.error("[timeline] falha ao registrar fonte tratada no player:", err);
            return false;
        }
    }

    _urlArquivoTratado(path, videoId, chainHash) {
        const caminho = String(path || "").trim().replace(/\\/g, "/");
        if (caminho.startsWith("/api/audio/tratado/")) return caminho;
        const m = caminho.match(/data\/audio_tratado\/([^\/]+)\/([^\/]+\.wav)$/i);
        if (m) return `/api/audio/tratado/${m[1]}/${m[2]}`;
        const nome = caminho.split("/").pop() || "";
        if (/^[a-f0-9]{8,64}\.wav$/i.test(nome)) return `/api/audio/tratado/${videoId}/${nome}`;
        return `/api/audio/tratado/${videoId}/${chainHash}.wav`;
    }

    _audioResultadoInner(efeito, alvoClipId, progresso, erroRede) {
        const esc = this._audioDiagEsc;
        if (!efeito) {
            return `<div style="font-size:10px; color:var(--text-muted); padding:4px 0; line-height:1.5;">Nenhum tratamento aplicado a este clipe ainda. Configure os passos acima e use "Aplicar".</div>`;
        }

        if (efeito.status === "failed") {
            const erro = this._erroRenderDe(alvoClipId);
            return `
                <div style="margin:4px 0; padding:6px 8px; border-radius:4px; background:rgba(244,63,94,0.08); border:1px solid rgba(244,63,94,0.25); color:var(--color-rose); font-size:10px; line-height:1.4; display:flex; gap:6px; align-items:flex-start;">
                    <i class="fa-solid fa-circle-exclamation" style="margin-top:1px;"></i>
                    <span>O último render falhou${erro ? `: ${esc(erro)}` : "."}</span>
                </div>
            `;
        }

        if (efeito.status === "pending" || efeito.status === "running") {
            const pct = (typeof progresso === "number" && isFinite(progresso)) ? Math.max(0, Math.min(100, Math.round(progresso))) : null;
            return `
                <div style="font-size:10px; color:var(--text-secondary); padding:4px 0; display:flex; gap:6px; align-items:center;">
                    <i class="fa-solid fa-circle-notch fa-spin"></i>
                    <span>${efeito.status === "running" ? "Renderizando..." : "Na fila do render..."}${pct !== null ? ` ${pct}%` : ""}</span>
                </div>
                ${pct !== null ? `<div style="height:4px; border-radius:2px; background:rgba(255,255,255,0.08); overflow:hidden;"><div style="height:100%; width:${pct}%; background:var(--color-cyan); transition:width 0.4s;"></div></div>` : ""}
                ${erroRede ? `<div style="margin-top:3px; font-size:9px; color:#facc15;">${esc(erroRede)}</div>` : ""}
                <div style="font-size:9px; color:var(--text-muted); padding-top:3px;">Sem números "depois" enquanto o render não termina.</div>
            `;
        }

        if (efeito.status === "ready") {
            const pp = this._playerPrograma();
            const tratadoAtivo = !!(pp && typeof pp.fonteAudioTratadaAtual === "function" && pp.fonteAudioTratadaAtual(alvoClipId));
            // H6: o dono tratou uma entrevista inteira e NÃO achou o WAV (nome = sha256).
            // O caminho relativo vai na tela, copiável num clique, com tamanho se a
            // resposta do render o trouxer.
            const caminhoTratado = this._caminhoTratadoDe(efeito, alvoClipId);
            const tamanhoTratado = this._tamanhoFormatado(this._tamanhoTratadoDe(caminhoTratado));
            const radio = (valor, rotulo, marcado) => `
                        <label style="display:flex; gap:4px; align-items:center; cursor:pointer; font-size:10px; color:var(--text-secondary);">
                            <input type="radio" name="adj-ar-ab" value="${valor}" ${marcado ? "checked" : ""} style="accent-color: var(--color-cyan); cursor:pointer;"> ${rotulo}
                        </label>
            `;
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:3px 0;">
                    <span style="display:flex; gap:10px; align-items:center;">
                        ${radio("tratado", "Tratado", tratadoAtivo)}
                        ${radio("original", "Original", !tratadoAtivo)}
                    </span>
                    <button id="adj-ar-descartar" title="Tira o efeito do clipe (o arquivo tratado continua em disco)" style="background:none; border:none; color:var(--color-rose); cursor:pointer; font-size:10px; display:flex; gap:4px; align-items:center;"><i class="fa-solid fa-trash-can"></i> Descartar</button>
                </div>
                ${this._textoCaminhoTratadoInner(caminhoTratado, tamanhoTratado)}
                ${this._numerosABInner(this._resumirAnalise(efeito.analysis_before), this._resumirAnalise(efeito.analysis_after))}
                <div style="font-size:9px; color:var(--text-muted); padding-top:3px;">A/B troca a fonte no player sem salto de posição nem silêncio.</div>
            `;
        }

        // Status desconhecido: honesto em vez de inventar estado.
        return `<div style="font-size:10px; color:#facc15; padding:4px 0;">Estado do tratamento desconhecido (${esc(String(efeito.status))}).</div>`;
    }

    /** Números antes/depois lado a lado (desenho da seção 4 do plano). Célula sem
     *  medida vira "--": nunca mostra número que não veio de medição. */
    _numerosABInner(antes, depois) {
        const fmt = (v, unidade, casas) => (v === null || v === undefined || !isFinite(Number(v)))
            ? "--"
            : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}${unidade}`;
        const celula = (texto, forte) => `<span style="font-family:monospace; font-size:10px; text-align:right; justify-self:end; color:${forte ? "var(--color-emerald)" : "var(--text-primary)"}; white-space:nowrap;">${texto}</span>`;
        const linhas = [
            ["Loudness", fmt(antes && antes.lufs, " LUFS", 1), fmt(depois && depois.lufs, " LUFS", 1)],
            ["Pico real", fmt(antes && antes.tp, " dBTP", 1), fmt(depois && depois.tp, " dBTP", 1)],
            ["Ruído", fmt(antes && antes.nf, " dB", 1), fmt(depois && depois.nf, " dB", 1)],
            ["Dinâmica (LRA)", fmt(antes && antes.lra, " LU", 1), fmt(depois && depois.lra, " LU", 1)],
            ["Clipping", fmt(antes && antes.clip_pct, "%", 2), fmt(depois && depois.clip_pct, "%", 2)],
        ].map(([rotulo, valAntes, valDepois]) =>
            `<span style="font-size:10px; color:var(--text-secondary);">${rotulo}</span>${celula(valAntes)}${celula(valDepois, true)}`
        ).join("");
        return `
            <div style="border-top:1px solid var(--border-glass); margin-top:4px; padding-top:4px;">
                <div style="display:grid; grid-template-columns:1fr auto auto; gap:2px 12px; align-items:center;">
                    <span style="font-size:9px; color:var(--text-muted); text-transform:uppercase;">Métrica</span>
                    <span style="font-size:9px; color:var(--text-muted); text-transform:uppercase;">Antes</span>
                    <span style="font-size:9px; color:var(--text-muted); text-transform:uppercase;">Depois</span>
                    ${linhas}
                </div>
            </div>
        `;
    }

    /** Repinta só o corpo do RESULTADO no DOM vivo (o painel pode ter sido redesenhado). */
    _pintarResultado(alvoClipId, progresso, erroRede) {
        const doc = (this.canvas && this.canvas.ownerDocument) || document;
        const body = doc.getElementById("adj-ar-resultado-body");
        if (!body || body.dataset.alvo !== String(alvoClipId)) return;
        const alvo = STATE.activeTimelineCuts.find(c => String(c.id) === String(alvoClipId));
        const efeito = alvo && Array.isArray(alvo.effects) ? alvo.effects.find(e => e.type === "audio_render") : null;
        body.innerHTML = this._audioResultadoInner(efeito || null, alvoClipId, progresso, erroRede);
    }

    /** F4: o player registrou falha da fonte tratada; A/B volta para Original na tela. */
    _refletirFalhaFonteTratada(registro) {
        const doc = (this.canvas && this.canvas.ownerDocument) || document;
        const body = doc.getElementById("adj-ar-resultado-body");
        if (!body || !registro || body.dataset.alvo !== String(registro.clipId)) return;
        const original = body.querySelector('input[name="adj-ar-ab"][value="original"]');
        if (original) original.checked = true;
        const aviso = doc.createElement("div");
        aviso.style.cssText = "margin-top:4px; padding:5px 7px; border-radius:4px; background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.25); color:#facc15; font-size:9px; line-height:1.4;";
        aviso.textContent = "O arquivo tratado ficou indisponível para o player; voltando ao original.";
        body.prepend(aviso);
    }

    async aplicarRenderAudio(container, clipId) {
        const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
        if (!clip) return;
        const alvoId = this._alvoAudioRenderId(clip);
        const alvo = STATE.activeTimelineCuts.find(c => c.id === alvoId);
        const btnApl = container.querySelector("#adj-ar-aplicar");
        const btnPrev = container.querySelector("#adj-ar-previa");
        if (!alvo || !btnApl) return;

        const videoId = (alvo.video_id !== undefined && alvo.video_id !== null)
            ? alvo.video_id
            : ((clip.video_id !== undefined && clip.video_id !== null) ? clip.video_id : null);
        const inS = Number(alvo.in);
        const outS = Number(alvo.out);

        if (videoId === null || !isFinite(inS) || !isFinite(outS) || outS <= inS) {
            this._registrarErroRender(alvoId, "Clipe sem fonte de áudio ou intervalo in/out inválido.");
            this._gravarEfeitoAudioRender(alvoId, { status: "failed" });
            return;
        }

        const opcoes = this._lerOpcoesAudioRender(container);
        const cadeiaEnviada = this._montarCadeiaLocal(opcoes);
        if (cadeiaEnviada.length === 0) {
            this._registrarErroRender(alvoId, "Selecione pelo menos um passo da cadeia.");
            this._gravarEfeitoAudioRender(alvoId, { status: "failed" });
            return;
        }

        // H6: o motor é o que está marcado; Auphonic só segue se o SERVIDOR disser que
        // dá (cota). Nada de gastar a nuvem sem o dono mandar — e sem cota confirmada.
        const radioMotor = container.querySelector('input[name="adj-ar-motor"]:checked');
        const motor = radioMotor ? String(radioMotor.value) : "local";
        if (motor === "auphonic") {
            const estado = this._estadoRadioAuphonic(this._cotaCacheDados);
            if (!estado.ligado) {
                this._registrarErroRender(alvoId, `Auphonic indisponível agora: ${estado.motivo}`);
                window.showToast(`Auphonic indisponível: ${estado.motivo}`, "error");
                return;
            }
        }
        const corpo = this._montarCorpoRender(opcoes, inS, outS, false);
        corpo.engine = motor; // contrato H4: default do servidor é "local" quando ausente
        // L4: SÓ o que o dono marcou como manual sai em algorithms_override — mandar o
        // bloco inteiro transformaria decisão automática em manual sem ele perceber,
        // e ele perderia a automação no clipe seguinte.
        if (motor === "auphonic") {
            const ov = this._overridesNuvemParaEnviar(alvoId);
            if (ov.erro) {
                this._registrarErroRender(alvoId, ov.erro);
                window.showToast(ov.erro, "error");
                return;
            }
            if (Object.keys(ov.campos).length > 0) corpo.algorithms_override = ov.campos;
        }

        // Contrato F3 gravado ANTES do POST: pending com a cadeia enviada. Análise
        // "antes" só entra se foi MEDIDA (diagnóstico em cache), nunca inventada.
        const chaveDiag = `${videoId}|${inS.toFixed(3)}|${outS.toFixed(3)}`;
        const diagCache = (this.audioDiagCache && this.audioDiagCache[chaveDiag]) || null;
        const antesMedido = diagCache ? this._resumirAnalise(diagCache.diag || diagCache) : null;
        this._gravarEfeitoAudioRender(alvoId, {
            engine: motor,
            ref: null,
            chain: cadeiaEnviada,
            status: "pending",
            analysis_before: antesMedido,
            analysis_after: null,
        });

        this._audioRenderGeracoes[alvoId] = (this._audioRenderGeracoes[alvoId] || 0) + 1;
        const geracao = this._audioRenderGeracoes[alvoId];

        const origApl = btnApl.innerHTML;
        btnApl.disabled = true;
        btnApl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        if (btnPrev) btnPrev.disabled = true;

        const buscar = this._fetchRenderDuble || fetch;
        let data = null;
        let falha = null;
        try {
            const resp = await buscar(`/api/video/${videoId}/audio/render`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(corpo),
            });
            if (resp.ok) data = await resp.json();
            else falha = resp.status === 404 ? "Rota de render não encontrada no servidor (HTTP 404)." : `O servidor respondeu HTTP ${resp.status}.`;
        } catch (err) {
            falha = "Falha de rede ao contatar o servidor de render.";
        }

        // O painel pode ter sido redesenhado durante a espera; reancorar no DOM vivo.
        const btnAplVivo = container.querySelector("#adj-ar-aplicar") || btnApl;
        btnAplVivo.disabled = false;
        btnAplVivo.innerHTML = origApl;
        const btnPrevVivo = container.querySelector("#adj-ar-previa");
        if (btnPrevVivo) btnPrevVivo.disabled = false;

        if (falha || !data || data.ok !== true) {
            const msg = falha || ((data && (data.erro || data.detail)) ? String(data.erro || data.detail) : "Resposta inválida da rota de render.");
            this._registrarErroRender(alvoId, msg);
            if (this._audioRenderGeracoes[alvoId] === geracao) this._gravarEfeitoAudioRender(alvoId, { status: "failed" });
            this._pintarResultado(alvoId);
            return;
        }

        const chainHash = data.chain_hash;
        if (chainHash) this._audioRenderHashes[`${alvoId}|${cadeiaEnviada.join("|")}`] = { videoId, chainHash };

        if (this._audioRenderGeracoes[alvoId] !== geracao) return;
        this._gravarEfeitoAudioRender(alvoId, { status: data.status || "pending", ref: data.path || null });

        if (data.status === "ready" && data.path) {
            this._guardarTamanhoTratado(data.path, data.tamanho_bytes !== undefined ? data.tamanho_bytes : data.tamanho);
            await this._fecharRenderReady(alvoId, videoId, chainHash);
            return;
        }
        await this._acompanharRenderAudio(alvoId, videoId, chainHash, geracao);
    }

    /** Ready direto no POST (cache ou prévia síncrona do servidor): um GET para trazer
     *  as análises medidas e fechar. Não sobrescreve análise existente por ausência. */
    async _fecharRenderReady(alvoClipId, videoId, chainHash) {
        const buscar = this._fetchRenderDuble || fetch;
        let analises = {};
        try {
            const resp = await buscar(`/api/video/${videoId}/audio/render/${chainHash}`);
            if (resp.ok) analises = await resp.json();
        } catch (err) {
            console.error("[timeline] falha ao ler análises do render pronto:", err);
        }
        const patch = { status: "ready" };
        const antes = this._resumirAnalise(analises.analise_antes);
        const depois = this._resumirAnalise(analises.analise_depois);
        if (antes) patch.analysis_before = antes;
        if (depois) patch.analysis_after = depois;
        this._gravarEfeitoAudioRender(alvoClipId, patch);
        this._conectarFonteTratada(alvoClipId, true);
        this._pintarResultado(alvoClipId);
    }

    /** Máquina de estados pending/running -> ready|failed pelo GET do contrato F2.
     *  Progresso vai SÓ para a tela (nada de autosave por tick); o efeito muda apenas
     *  na virada de estado. Erro de REDE não marca failed: o estado do clipe espelha
     *  o SERVIDOR — rede ruim aparece como aviso amarelo enquanto o loop segue vivo. */
    async _acompanharRenderAudio(alvoClipId, videoId, chainHash, geracao) {
        if (!chainHash) return;
        const buscar = this._fetchRenderDuble || fetch;
        const esperar = this._esperarRenderDuble || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        let falhasSeguidas = 0;
        while (true) {
            if (this._audioRenderGeracoes[alvoClipId] !== geracao) return;

            let data = null;
            let falha = null;
            try {
                const resp = await buscar(`/api/video/${videoId}/audio/render/${chainHash}`);
                if (resp.ok) data = await resp.json();
                else falha = `HTTP ${resp.status}`;
            } catch (err) {
                falha = "Falha de rede acompanhando o render.";
            }
            if (this._audioRenderGeracoes[alvoClipId] !== geracao) return;

            if (falha || !data || data.ok !== true) {
                falhasSeguidas++;
                if (falhasSeguidas >= 5) {
                    this._pintarResultado(alvoClipId, undefined, `Acompanhamento interrompido (${falha || "resposta inválida"}). Reabra o painel para tentar de novo.`);
                    return;
                }
                this._pintarResultado(alvoClipId, undefined, `${falha || "Resposta inválida do acompanhamento."} Tentando de novo...`);
            } else {
                falhasSeguidas = 0;
                const st = data.status;
                if (st === "ready") {
                    const patch = { status: "ready", ref: data.path || null };
                    this._guardarTamanhoTratado(data.path, data.tamanho_bytes !== undefined ? data.tamanho_bytes : data.tamanho);
                    const antes = this._resumirAnalise(data.analise_antes);
                    const depois = this._resumirAnalise(data.analise_depois);
                    if (antes) patch.analysis_before = antes;
                    if (depois) patch.analysis_after = depois;
                    this._gravarEfeitoAudioRender(alvoClipId, patch);
                    this._conectarFonteTratada(alvoClipId, true);
                    this._pintarResultado(alvoClipId);
                    return;
                }
                if (st === "failed") {
                    this._registrarErroRender(alvoClipId, data.erro || data.detail || "O render falhou no servidor.");
                    this._gravarEfeitoAudioRender(alvoClipId, { status: "failed" });
                    this._pintarResultado(alvoClipId);
                    return;
                }
                // pending | running: grava o efeito só quando o estado muda de verdade.
                const alvo = STATE.activeTimelineCuts.find(c => c.id === alvoClipId);
                const efAtual = alvo && Array.isArray(alvo.effects) ? alvo.effects.find(e => e.type === "audio_render") : null;
                const statusAtual = efAtual ? efAtual.status : null;
                const desejado = st === "running" ? "running" : "pending";
                if (statusAtual !== desejado) {
                    this._gravarEfeitoAudioRender(alvoClipId, { status: desejado });
                }
                this._pintarResultado(alvoClipId, data.progresso);
            }
            await esperar(1000);
        }
    }

    /** Botão "Prever 15 s": POST com previa=true (contrato F2). NÃO mexe no efeito do
     *  clipe: é uma amostra para ouvir aqui mesmo, via GET /api/audio/tratado/. */
    async _tocarPreviaAudioRender(container, clipId) {
        const saida = container.querySelector("#adj-ar-previa-out");
        const btnPrev = container.querySelector("#adj-ar-previa");
        if (!saida || !btnPrev) return;

        const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
        if (!clip) return;
        const alvoId = this._alvoAudioRenderId(clip);
        const alvo = STATE.activeTimelineCuts.find(c => c.id === alvoId);
        const videoId = (alvo && alvo.video_id !== undefined && alvo.video_id !== null)
            ? alvo.video_id
            : ((clip.video_id !== undefined && clip.video_id !== null) ? clip.video_id : null);
        const inS = alvo ? Number(alvo.in) : NaN;
        const outS = alvo ? Number(alvo.out) : NaN;

        const erroBox = (msg) => `
            <div style="margin:3px 0; padding:5px 7px; border-radius:4px; background:rgba(244,63,94,0.08); border:1px solid rgba(244,63,94,0.25); color:var(--color-rose); font-size:9px; line-height:1.4;">${this._audioDiagEsc(msg)}</div>
        `;

        if (videoId === null || !isFinite(inS) || !isFinite(outS) || outS <= inS) {
            saida.innerHTML = erroBox("Clipe sem fonte de áudio ou intervalo in/out inválido para prévia.");
            return;
        }
        const opcoes = this._lerOpcoesAudioRender(container);
        if (this._montarCadeiaLocal(opcoes).length === 0) {
            saida.innerHTML = erroBox("Selecione pelo menos um passo da cadeia para prever.");
            return;
        }
        const corpo = this._montarCorpoRender(opcoes, inS, outS, true);
        corpo.engine = "local"; // H6: prévia NUNCA gasta cota de nuvem; amostra local da mesma cadeia.

        const origHtml = btnPrev.innerHTML;
        btnPrev.disabled = true;
        btnPrev.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        const btnApl = container.querySelector("#adj-ar-aplicar");
        if (btnApl) btnApl.disabled = true;
        saida.innerHTML = `<div style="font-size:9px; color:var(--text-muted); padding:3px 0; display:flex; gap:5px; align-items:center;"><i class="fa-solid fa-circle-notch fa-spin"></i> Renderizando 15 s de prévia...</div>`;

        const buscar = this._fetchRenderDuble || fetch;
        const esperar = this._esperarRenderDuble || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        let data = null;
        let falha = null;
        try {
            const resp = await buscar(`/api/video/${videoId}/audio/render`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(corpo),
            });
            if (resp.ok) data = await resp.json();
            else falha = resp.status === 404 ? "Rota de render não encontrada no servidor (HTTP 404)." : `O servidor respondeu HTTP ${resp.status}.`;
        } catch (err) {
            falha = "Falha de rede ao contatar o servidor de render.";
        }

        const btnPrevVivo = container.querySelector("#adj-ar-previa") || btnPrev;
        btnPrevVivo.disabled = false;
        btnPrevVivo.innerHTML = origHtml;
        const btnAplVivo = container.querySelector("#adj-ar-aplicar");
        if (btnAplVivo) btnAplVivo.disabled = false;
        const saidaViva = container.querySelector("#adj-ar-previa-out") || saida;

        if (falha || !data || data.ok !== true) {
            saidaViva.innerHTML = erroBox(falha || ((data && (data.erro || data.detail)) ? String(data.erro || data.detail) : "Resposta inválida da rota de render."));
            return;
        }

        let status = data.status || "pending";
        let path = data.path || null;
        let tentativas = 0;
        while (status !== "ready" && status !== "failed" && tentativas < 60) {
            await esperar(1000);
            try {
                const r = await buscar(`/api/video/${videoId}/audio/render/${data.chain_hash}`);
                if (r.ok) {
                    const d = await r.json();
                    if (d && d.ok === true) { status = d.status; path = d.path || path; }
                }
            } catch (err) {
                console.error("[timeline] falha acompanhando a prévia:", err);
            }
            tentativas++;
        }

        if (status === "ready" && path && data.chain_hash) {
            const url = this._urlArquivoTratado(path, videoId, data.chain_hash);
            saidaViva.innerHTML = `
                <div style="font-size:9px; color:var(--color-emerald); padding-top:2px;">Prévia de 15 s pronta (não altera o clipe):</div>
                <audio controls preload="none" src="${url}" style="width:100%; height:26px; margin-top:2px;"></audio>
            `;
        } else if (status === "failed") {
            saidaViva.innerHTML = erroBox((data && (data.erro || data.detail)) ? String(data.erro || data.detail) : "A prévia falhou no servidor.");
        } else {
            saidaViva.innerHTML = erroBox("A prévia não ficou pronta a tempo. Tente novamente.");
        }
    }

    /** Descartar: tira o efeito do CLIPE (autosave pelo caminho de sempre) e volta o
     *  player ao original. NÃO apaga arquivo do disco (órfãos são coisa do backend). */
    _descartarRenderAudio(clipId) {
        const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
        if (!clip) return;
        const alvoId = this._alvoAudioRenderId(clip);
        this._audioRenderGeracoes[alvoId] = (this._audioRenderGeracoes[alvoId] || 0) + 1; // encerra polls deste clipe
        delete this._ajustesNuvemManuais[String(alvoId)]; // L4: sem tratamento, não há o que sobrescrever
        this._mutateClipEffects(alvoId, (c) => {
            c.effects = c.effects.filter(e => !(e.type === "audio_render"));
        });
        this._conectarFonteTratada(alvoId, false);
        if (typeof window !== "undefined" && typeof window.showToast === "function") {
            window.showToast("Tratamento descartado do clipe; o arquivo tratado segue em disco.", "success");
        }
    }

    // ==================== H6: cota da nuvem + onde ficou o arquivo ====================

    /** Cache curto de sessão: a consulta é leve, mas não deve pingar o servidor a cada
     *  redesenho do painel. */
    _COTA_TTL_MS() { return 60000; }

    /** GET /api/audio/nuvem/cota (contrato H4). Leve, só quando expira o TTL ou na
     *  primeira abertura; dedupe de chamadas concorrentes. NUNCA envia nada à nuvem. */
    async _consultarCotaAuphonic() {
        const agora = Date.now();
        if (this._cotaCacheDados !== null && (agora - this._cotaCacheQuando) < this._COTA_TTL_MS()) {
            return this._cotaCacheDados;
        }
        if (this._cotaEmVoo) return this._cotaEmVoo;
        this._cotaEmVoo = (async () => {
            const buscar = this._fetchCotaDuble || fetch;
            let dados = null;
            try {
                const resp = await buscar("/api/audio/nuvem/cota");
                if (resp.ok) {
                    const j = await resp.json();
                    if (j && typeof j === "object") dados = j;
                } else {
                    dados = { ok: false, erro: `O servidor respondeu HTTP ${resp.status} na rota de cota.` };
                }
            } catch (err) {
                console.error("[timeline] falha ao consultar a cota da nuvem:", err);
                dados = { ok: false, erro: "Não foi possível consultar a cota agora (servidor acessível?)." };
            }
            this._cotaCacheDados = dados;
            this._cotaCacheQuando = Date.now();
            this._cotaEmVoo = null;
            return dados;
        })();
        return this._cotaEmVoo;
    }

    /** Decisão do radio Auphonic SEMPRE pela resposta do SERVIDOR (contrato H4).
     *  Pura: {ligado: bool, motivo: string} — o motivo real vai no title. */
    _estadoRadioAuphonic(resposta) {
        if (!resposta || typeof resposta !== "object") {
            return { ligado: false, motivo: "Consultando a cota no servidor..." };
        }
        if (resposta.ok !== true) {
            const msg = String(resposta.erro || resposta.detail || "").trim();
            return { ligado: false, motivo: msg || "Configure a chave em Configurações > Modelos & Chaves." };
        }
        const restante = Number(resposta.restante_min);
        if (!isFinite(restante)) {
            return { ligado: false, motivo: "O servidor respondeu sem um restante de cota utilizável." };
        }
        const mes = resposta.mes ? ` (${String(resposta.mes)})` : "";
        if (restante <= 0) {
            const usados = isFinite(Number(resposta.usados_min)) ? `${Number(resposta.usados_min).toLocaleString("pt-BR")} min` : "tudo";
            return { ligado: false, motivo: `Sem cota restante neste mês${mes}: ${usados} já usados.` };
        }
        return { ligado: true, motivo: `Restam ${Number(restante).toLocaleString("pt-BR")} min de cota neste mês${mes}.` };
    }

    /** Barra da cota quando o motor Auphonic está escolhido. Pura. Com avisar=true o
     *  aviso é impossível de ignorar (caixa rose + ícone + frase do que se perde). */
    _cotaAuphonicInner(cota) {
        const esc = this._audioDiagEsc;
        const usados = Math.max(0, Number(cota.usados_min) || 0);
        const total = Math.max(0, Number(cota.total_min) || 0);
        const restante = Math.max(0, Number(cota.restante_min) || 0);
        const pct = total > 0 ? Math.min(100, Math.round((usados / total) * 100)) : 100;
        const alerta = cota.avisar === true;
        const mes = cota.mes ? ` (${esc(String(cota.mes))})` : "";
        return `
            <div class="${alerta ? "adj-ar-cota-alerta" : ""}" style="margin:4px 0 2px; padding:${alerta ? "6px 8px" : "4px 8px"}; border-radius:4px; ${alerta ? "background:rgba(244,63,94,0.14); border:1px solid rgba(244,63,94,0.55);" : "background:rgba(6,182,212,0.06); border:1px solid var(--border-glass);"}">
                ${alerta ? `
                <div style="font-size:10px; font-weight:bold; color:var(--color-rose); display:flex; gap:5px; align-items:center; padding-bottom:4px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>Cota quase esgotada${mes}: só restam ${esc(restante.toLocaleString("pt-BR"))} dos ${esc(total.toLocaleString("pt-BR"))} min deste mês. Um render longo pode estourar o limite e parar no meio.</span>
                </div>` : ""}
                <div style="height:4px; border-radius:2px; background:rgba(255,255,255,0.08); overflow:hidden;" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
                    <div style="height:100%; width:${pct}%; background:${alerta ? "var(--color-rose)" : "var(--color-cyan)"}; transition:width 0.4s;"></div>
                </div>
                <div style="font-size:9px; color:var(--text-secondary); padding-top:3px;">Auphonic${mes}: usados ${esc(usados.toLocaleString("pt-BR"))} de ${esc(total.toLocaleString("pt-BR"))} min — restam ${esc(restante.toLocaleString("pt-BR"))} min.</div>
            </div>
        `;
    }

    /** Caminho relativo normalizado do WAV tratado a partir do ref do efeito
     *  (contrato H1/F2: ex.: data/audio_tratado/550/9fc0945b....wav). Puro. */
    _caminhoRelativoTratado(ref) {
        const p = String(ref || "").trim().replace(/\\/g, "/");
        if (!p) return null;
        const m = p.match(/data\/audio_tratado\/[^\/]+\/[^\/]+$/i);
        return m ? m[0].replace(/^\.\//, "") : null;
    }

    /** Caminho mostrado no RESULTADO: prefere o ref gravado; sem ref na sessão,
     *  reconstrói com o chain_hash que O SERVIDOR devolveu (é ele quem nomeia o arquivo). */
    _caminhoTratadoDe(efeito, alvoClipId) {
        const direto = this._caminhoRelativoTratado(efeito && efeito.ref);
        if (direto) return direto;
        for (const chave of Object.keys(this._audioRenderHashes || {})) {
            const partes = chave.split("|");
            if (partes[0] !== String(alvoClipId)) continue;
            const reg = this._audioRenderHashes[chave];
            if (reg && reg.videoId !== undefined && reg.videoId !== null && reg.chainHash) {
                return `data/audio_tratado/${reg.videoId}/${reg.chainHash}.wav`;
            }
        }
        return null;
    }

    /** Tamanho do WAV tratado, guardado SÓ quando a resposta do render o trouxer. */
    _guardarTamanhoTratado(ref, valor) {
        if (ref === undefined || ref === null || String(ref).trim() === "") return;
        const n = Number(valor);
        if (valor === undefined || valor === null || !isFinite(n) || n < 0) return;
        this._audioRenderTamanhos[String(ref)] = n;
    }

    _tamanhoTratadoDe(caminho) {
        if (!caminho) return null;
        const chave = String(caminho);
        if (this._audioRenderTamanhos[chave] !== undefined) return this._audioRenderTamanhos[chave];
        const nome = chave.split("/").pop();
        for (const k of Object.keys(this._audioRenderTamanhos)) {
            if (k.split("/").pop() === nome) return this._audioRenderTamanhos[k];
        }
        return null;
    }

    /** Formato humano pt-BR: 379586485 -> "362 MB". Puro; null quando não há medida. */
    _tamanhoFormatado(bytes) {
        const n = Number(bytes);
        if (!isFinite(n) || n <= 0) return null;
        const unidades = [["GB", 1073741824], ["MB", 1048576], ["kB", 1024]];
        for (const [sufixo, fator] of unidades) {
            if (n >= fator) return `${(n / fator).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${sufixo}`;
        }
        return `${n.toLocaleString("pt-BR")} B`;
    }

    /** Bloco "onde ficou o arquivo": caminho copiável num clique, tamanho se houver e
     *  a explicação curta do porquê do nome-feio. Puro; "" quando não há caminho. */
    _textoCaminhoTratadoInner(caminho, tamanhoTexto) {
        if (!caminho) return "";
        const esc = this._audioDiagEsc;
        const tam = tamanhoTexto ? `<span style="font-size:9px; color:var(--text-muted); white-space:nowrap; flex-shrink:0;">(${esc(tamanhoTexto)})</span>` : "";
        return `
            <div style="margin-top:4px; padding:5px 7px; border-radius:4px; background:rgba(16,185,129,0.07); border:1px solid rgba(16,185,129,0.25);">
                <div style="display:flex; gap:6px; align-items:center;">
                    <i class="fa-solid fa-folder-open" style="color:var(--color-emerald); font-size:10px; flex-shrink:0;"></i>
                    <span id="adj-ar-caminho" style="font-family:monospace; font-size:10px; color:var(--text-primary); word-break:break-all; user-select:all;">${esc(caminho)}</span>
                    <button id="adj-ar-copiar-caminho" data-copia="${esc(caminho)}" title="Copia o caminho relativo do WAV tratado para a área de transferência" style="background:none; border:none; color:var(--color-cyan); cursor:pointer; font-size:9px; display:flex; gap:3px; align-items:center; flex-shrink:0;"><i class="fa-solid fa-copy"></i> Copiar</button>
                    ${tam}
                </div>
                <div style="font-size:9px; color:var(--text-muted); padding-top:3px; line-height:1.4;">O nome é o hash SHA-256 da cadeia de tratamento — é a chave de cache: reaplicar a mesma cadeia reusa este arquivo em vez de reprocessar.</div>
            </div>
        `;
    }

    /** Cópia num clique: Clipboard API com fallback de textarea. true quando copiou. */
    async _copiarTexto(texto) {
        const valor = String(texto || "");
        if (!valor) return false;
        const duble = this._clipboardDuble;
        if (duble && typeof duble.escrever === "function") return duble.escrever(valor) === true;
        try {
            if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                await navigator.clipboard.writeText(valor);
                return true;
            }
        } catch (err) {
            console.error("[timeline] Clipboard API indisponível:", err);
        }
        try {
            const doc = (this.canvas && this.canvas.ownerDocument) || document;
            const ta = doc.createElement("textarea");
            ta.value = valor;
            ta.setAttribute("readonly", "");
            ta.style.cssText = "position:fixed; left:-9999px; top:0;";
            doc.body.appendChild(ta);
            ta.select();
            const ok = doc.execCommand("copy");
            doc.body.removeChild(ta);
            return ok === true;
        } catch (err) {
            console.error("[timeline] fallback de cópia falhou:", err);
            return false;
        }
    }

    /** Repinta o bloco de cota conforme o motor marcado AGORA (sem rede). */
    _pintarCotaAuphonic() {
        const doc = (this.canvas && this.canvas.ownerDocument) || document;
        const saida = doc.getElementById("adj-ar-cota-out");
        if (!saida) return;
        const sel = doc.querySelector('input[name="adj-ar-motor"]:checked');
        if (!sel || sel.value !== "auphonic") { saida.innerHTML = ""; return; }
        const estado = this._estadoRadioAuphonic(this._cotaCacheDados);
        if (!estado.ligado) {
            saida.innerHTML = `
                <div style="margin:4px 0 2px; padding:5px 8px; border-radius:4px; background:rgba(234,179,8,0.08); border:1px solid rgba(234,179,8,0.3); font-size:10px; color:#facc15; display:flex; gap:5px; align-items:center;">
                    <i class="fa-solid fa-circle-info"></i><span>${this._audioDiagEsc(estado.motivo)}</span>
                </div>
            `;
            return;
        }
        saida.innerHTML = this._cotaAuphonicInner(this._cotaCacheDados);
    }

    /** Liga/desliga o radio Auphonic pela resposta do SERVIDOR e repinta a cota.
     *  Consulta leve ao mostrar a seção, com cache curto; nunca submete nada. */
    async _atualizarRadioAuphonic() {
        const pintar = (cota) => {
            const doc = (this.canvas && this.canvas.ownerDocument) || document;
            const radio = doc.querySelector('input[name="adj-ar-motor"][value="auphonic"]');
            if (!radio) return;
            const estado = this._estadoRadioAuphonic(cota);
            const label = radio.closest("label");
            radio.disabled = !estado.ligado;
            radio.style.cursor = estado.ligado ? "pointer" : "not-allowed";
            if (label) {
                label.style.opacity = estado.ligado ? "1" : "0.45";
                label.style.cursor = estado.ligado ? "pointer" : "not-allowed";
                label.title = estado.motivo;
            }
            if (!estado.ligado && radio.checked) {
                radio.checked = false;
                const local = doc.querySelector('input[name="adj-ar-motor"][value="local"]');
                if (local) local.checked = true;
            }
            this._pintarCotaAuphonic();
        };
        if (this._cotaCacheDados !== null && (Date.now() - this._cotaCacheQuando) < this._COTA_TTL_MS()) {
            pintar(this._cotaCacheDados);
            return;
        }
        pintar(await this._consultarCotaAuphonic()); // reancora por querySelector no documento vivo
    }

    // ==================== L4: ajustes manuais da nuvem por clipe ====================

    /** TTL do cache da grade de campos, na mesma disciplina da cota. */
    _CAMPOS_NUVEM_TTL_MS() { return 60000; }

    /** GET /api/audio/nuvem/campos (contrato L2). Cache curto de sessão + dedupe.
     *  Falha de HTTP/rede/corpo inútil devolve null e NÃO envenena o cache: a área
     *  some e o envio segue 100% automático — inventar grade no cliente nunca é opção. */
    async _consultarCamposNuvem() {
        const agora = Date.now();
        if (this._camposNuvemCache !== null && (agora - this._camposNuvemQuando) < this._CAMPOS_NUVEM_TTL_MS()) {
            return this._camposNuvemCache;
        }
        if (this._camposNuvemEmVoo) return this._camposNuvemEmVoo;
        this._camposNuvemEmVoo = (async () => {
            const buscar = this._fetchCamposDuble || fetch;
            let campos = null;
            try {
                // Com o clipe identificado o servidor devolve tambem "automatico":
                // o que a medicao decidiu para ESTE trecho. Sem isso a area so
                // consegue escrever "Automatico" e o usuario nao tem como julgar
                // se discorda da maquina - que e o ponto da tela.
                const ctx = this._ctxNuvem || null;
                const qs = (ctx && ctx.videoId !== null && ctx.videoId !== undefined)
                    ? `?video_id=${ctx.videoId}&in=${Number(ctx.inS).toFixed(3)}&out=${Number(ctx.outS).toFixed(3)}`
                    : "";
                const resp = await buscar("/api/audio/nuvem/campos" + qs);
                if (resp.ok) {
                    const corpo = await resp.json();
                    this._automaticoNuvem = (corpo && typeof corpo.automatico === "object") ? corpo.automatico : null;
                    campos = this._gradeCamposNuvem(corpo);
                    if (campos === null) console.error("[timeline] rota de campos da nuvem respondeu um corpo inutilizável; seguindo sem ajustes manuais.");
                } else {
                    console.error(`[timeline] rota de campos da nuvem respondeu HTTP ${resp.status}; seguindo sem ajustes manuais.`);
                }
            } catch (err) {
                console.error("[timeline] falha ao consultar os campos ajustáveis da nuvem:", err);
            }
            if (campos !== null) {
                this._camposNuvemCache = campos;
                this._camposNuvemQuando = Date.now();
            }
            this._camposNuvemEmVoo = null;
            return campos;
        })();
        return this._camposNuvemEmVoo;
    }

    /** Valida o corpo da resposta contra o contrato L2 e devolve a lista usável
     *  [{campo, tipo, valores, rotulo, ajuda}] na ordem do SERVIDOR — ou null. */
    _gradeCamposNuvem(resposta) {
        if (!resposta || typeof resposta !== "object") return null;
        const bruto = (resposta.campos && typeof resposta.campos === "object" && !Array.isArray(resposta.campos)) ? resposta.campos : resposta;
        const lista = [];
        for (const campo of Object.keys(bruto)) {
            const def = bruto[campo];
            if (!def || typeof def !== "object") continue;
            const tipo = String(def.tipo || "");
            const valores = Array.isArray(def.valores) ? def.valores : null;
            if ((tipo !== "bool" && tipo !== "select") || (tipo === "select" && (!valores || valores.length === 0))) continue;
            lista.push({ campo, tipo, valores, rotulo: String(def.rotulo || campo), ajuda: String(def.ajuda || "") });
        }
        return lista.length > 0 ? lista : null;
    }

    /** Valor coerido para a grade: bool -> booleano; grade numérica -> número; resto -> texto. */
    _valorCoercionadoNuvem(def, valorBruto) {
        if (def.tipo === "bool") return valorBruto === true || valorBruto === "true";
        if (Array.isArray(def.valores) && def.valores.length > 0 && def.valores.every(v => typeof v === "number")) {
            const n = Number(valorBruto);
            return isFinite(n) ? n : valorBruto;
        }
        return String(valorBruto);
    }

    /** Overrides MANUAIS deste clipe, revalidados campo a campo contra a grade EM CACHE
     *  antes de sair daqui (regra de ouro). Devolve {campos:{...}} ou {erro:"..."} —
     *  campo que saiu da grade bloqueia o envio, nunca vai pela metade em silêncio. */
    _overridesNuvemParaEnviar(alvoClipId) {
        const manuais = this._ajustesNuvemManuais[String(alvoClipId)] || {};
        const chaves = Object.keys(manuais);
        if (chaves.length === 0) return { campos: {} };
        const grade = this._camposNuvemCache;
        if (!grade) return { erro: "A grade de campos da nuvem não está carregada; não vou enviar ajustes manuais pela metade." };
        const campos = {};
        for (const nome of chaves) {
            const def = grade.find(d => d.campo === nome);
            if (!def) return { erro: `O campo "${nome}" saiu da grade da nuvem; volte ele ao automático antes de aplicar.` };
            const valor = this._valorCoercionadoNuvem(def, manuais[nome]);
            if (def.tipo === "select" && !def.valores.some(v => String(v) === String(valor))) {
                return { erro: `"${def.rotulo}" está fora dos valores aceitos pela nuvem (${def.valores.map(v => String(v)).join(", ")}).` };
            }
            campos[nome] = valor;
        }
        return { campos };
    }

    /** Uma linha da área: rótulo+ajuda, controle (Auto é o padrão visível) e a marca
     *  AUTO/MANUAL com o botão de voltar ao automático. Pura. */
    _linhaAjusteNuvemInner(def, manual, auto) {
        const esc = this._audioDiagEsc;
        const estilo = "height:20px; font-size:10px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; border-radius:4px; padding:0 2px;";
        const rotuloAuto = (valor) => {
            if (valor === undefined || valor === null) return "Automático";
            if (valor === true) return "Automático (ligado)";
            if (valor === false) return "Automático (desligado)";
            const n = Number(valor);
            return `Automático (${Number.isFinite(n) ? n.toLocaleString("pt-BR") : String(valor)})`;
        };
        const optAuto = `<option value="">${esc(rotuloAuto(auto))}</option>`;
        let controle = "";
        if (def.tipo === "bool") {
            const lig = (manual === true || manual === "true") ? " selected" : "";
            const des = (manual === false || manual === "false") ? " selected" : "";
            controle = `<select class="nle-select" data-nuvem-campo="${esc(def.campo)}" title="${esc(def.ajuda)}" style="${estilo}">${optAuto}<option value="true"${lig}>Ligado</option><option value="false"${des}>Desligado</option></select>`;
        } else {
            const ops = def.valores.map((v) => {
                const sel = (manual !== undefined && manual !== null && String(manual) === String(v)) ? " selected" : "";
                const rotulo = typeof v === "number" ? v.toLocaleString("pt-BR") : esc(String(v));
                return `<option value="${esc(String(v))}"${sel}>${rotulo}</option>`;
            }).join("");
            controle = `<select class="nle-select" data-nuvem-campo="${esc(def.campo)}" title="${esc(def.ajuda)}" style="${estilo}">${optAuto}${ops}</select>`;
        }
        const ehManual = manual !== undefined && manual !== null && manual !== "";
        const marca = ehManual
            ? `<span style="font-size:8px; font-weight:bold; color:#facc15; white-space:nowrap;">MANUAL</span><button type="button" data-volta-auto="${esc(def.campo)}" title="Volta este campo para a decisão automática da medição" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:9px; padding:0 2px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>`
            : `<span style="font-size:8px; color:var(--text-muted); white-space:nowrap;">AUTO</span>`;
        return `
            <div style="display:flex; gap:6px; align-items:center; padding:2px 0 2px 6px; border-left:3px solid ${ehManual ? "rgba(234,179,8,0.75)" : "transparent"};">
                <span style="font-size:10px; color:var(--text-secondary); width:110px; flex-shrink:0;" title="${esc(def.ajuda)}">${esc(def.rotulo)}</span>
                ${controle}
                ${marca}
            </div>
        `;
    }

    /** Corpo da área recolhível: cada campo da grade do SERVIDOR, Auto como padrão
     *  visível (a medição decide o que ninguém marcou). Puro. */
    _ajustesNuvemInner(campos, manuais) {
        const auto = this._automaticoNuvem || {};
        const linhas = campos.map((def) => this._linhaAjusteNuvemInner(def, manuais[def.campo], auto[def.campo])).join("");
        return `
            <div style="margin:2px 0 4px; padding:6px 8px; border-radius:4px; background:rgba(139,92,246,0.06); border:1px solid var(--border-glass);">
                <div style="font-size:9px; color:var(--text-muted); line-height:1.45; padding-bottom:3px;">Sem marcar nada, a medição decide tudo sozinha neste clipe. O que você marcar sai como ajuste manual para a nuvem; o resto continua automático.</div>
                ${linhas}
            </div>
        `;
    }

    /** Alvo (clipe de áudio) dono dos ajustes, anotado no corpo do RESULTADO. */
    _alvoIdDoPainelNuvem(doc) {
        const body = doc.getElementById("adj-ar-resultado-body");
        return body ? body.dataset.alvo : null;
    }

    /** Marca UM campo como manual (valor "" volta ao auto) e repinta. */
    _marcarAjusteNuvem(alvoId, campo, valorBruto) {
        if (!alvoId || !campo) return;
        const chave = String(alvoId);
        const manuais = this._ajustesNuvemManuais[chave] || {};
        if (valorBruto === "") delete manuais[campo];
        else manuais[campo] = valorBruto;
        if (Object.keys(manuais).length > 0) this._ajustesNuvemManuais[chave] = manuais;
        else delete this._ajustesNuvemManuais[chave];
        this._pintarAjustesNuvem();
    }

    /** Volta UM campo à decisão automática e repinta. */
    _voltarAjusteNuvemAoAuto(alvoId, campo) {
        this._marcarAjusteNuvem(alvoId, campo, "");
    }

    /** Mostra a área SÓ com motor Auphonic marcado E grade válida em mãos; pinta
     *  conteúdo, seta e contador de manuais. Sem rede. */
    _pintarAjustesNuvem() {
        const doc = (this.canvas && this.canvas.ownerDocument) || document;
        const wrap = doc.getElementById("adj-ar-nuvem-wrap");
        if (!wrap) return;
        const sel = doc.querySelector('input[name="adj-ar-motor"]:checked');
        const visivel = !!sel && sel.value === "auphonic" && this._camposNuvemCache !== null;
        wrap.style.display = visivel ? "block" : "none";
        if (!visivel) return;
        const saida = doc.getElementById("adj-ar-nuvem-out");
        const seta = doc.getElementById("adj-ar-nuvem-seta");
        if (seta) seta.className = `fa-solid fa-chevron-${this._nuvemAjustesAberto ? "down" : "right"}`;
        const alvoId = this._alvoIdDoPainelNuvem(doc);
        const manuais = this._ajustesNuvemManuais[String(alvoId)] || {};
        const badge = doc.getElementById("adj-ar-nuvem-badge");
        if (badge) {
            const n = Object.keys(manuais).length;
            badge.textContent = n > 0 ? ` · ${n} ${n > 1 ? "manuais" : "manual"}` : "";
        }
        if (saida) {
            saida.style.display = this._nuvemAjustesAberto ? "block" : "none";
            if (this._nuvemAjustesAberto) saida.innerHTML = this._ajustesNuvemInner(this._camposNuvemCache, manuais);
        }
    }

    /** Busca a grade (cache curto, duble nos testes) e repinta a área. Falha da rota
     *  só esconde a área; painel e envio seguem inteiros, 100% automáticos. */
    async _atualizarAjustesNuvem() {
        await this._consultarCamposNuvem();
        this._pintarAjustesNuvem();
    }

    /** Cabos do bloco TRATAMENTO + RESULTADO (chamado de attachAdjustmentsListeners). */
    _ligarControlesAudioRender(container, clip) {
        const presetSel = container.querySelector("#adj-ar-preset");
        const estimativaEl = container.querySelector("#adj-ar-estimativa");

        const recalcEstimativa = () => {
            if (!estimativaEl) return;
            const alvo = STATE.activeTimelineCuts.find(c => c.id === this._alvoAudioRenderId(clip));
            const duracao = alvo ? Math.max(0, Number(alvo.out) - Number(alvo.in)) : 0;
            const motorSel = container.querySelector('input[name="adj-ar-motor"]:checked');
            const presetAtual = presetSel ? String(presetSel.value || "") : "";
            estimativaEl.textContent = this._estimativaRenderTexto(duracao, motorSel ? motorSel.value : "local", presetAtual);
            // Aviso NÃO bloqueante: com preset de IA o custo muda de ordem de
            // grandeza, então ele fica VISÍVEL enquanto o preset estiver escolhido.
            const avisoIaEl = container.querySelector("#adj-ar-aviso-ia");
            if (avisoIaEl) avisoIaEl.style.display = this._presetEhDeIa(presetAtual) ? "" : "none";
        };
        recalcEstimativa();

        const marcarCustom = () => { if (presetSel) presetSel.value = "custom"; recalcEstimativa(); };

        ["adj-ar-reparo", "adj-ar-fala", "adj-ar-loudnorm", "adj-ar-limitador"].forEach((id) => {
            const el = container.querySelector(`#${id}`);
            if (el) el.onchange = marcarCustom;
        });
        ["adj-ar-lufs", "adj-ar-teto"].forEach((id) => {
            const el = container.querySelector(`#${id}`);
            if (el) el.onchange = () => { marcarCustom(); recalcEstimativa(); };
        });
        container.querySelectorAll('input[name="adj-ar-motor"]').forEach((radio) => {
            radio.onchange = () => { recalcEstimativa(); this._pintarCotaAuphonic(); this._pintarAjustesNuvem(); };
        });

        // H6: radio Auphonic decidido pelo SERVIDOR — consulta leve ao mostrar a seção,
        // com cache curto de sessão; nada é enviado à nuvem aqui.
        this._atualizarRadioAuphonic().catch((err) => console.error("[timeline] falha ao atualizar o radio Auphonic:", err));

        // L4: grade de ajustes da nuvem vem do SERVIDOR; falha da rota esconde só a área.
        // O contexto do clipe faz o servidor devolver TAMBÉM o que a medição decidiu
        // para este trecho. Trocar de clipe invalida o cache: mostrar a decisão do
        // clipe anterior seria pior do que não mostrar decisão nenhuma.
        const ctxAnterior = this._ctxNuvem ? this._ctxNuvem.chave : null;
        const inNuvem = Number(clip && clip.in);
        const outNuvem = Number(clip && clip.out);
        const vidNuvem = (clip && clip.video_id !== undefined) ? clip.video_id : null;
        this._ctxNuvem = (vidNuvem !== null && isFinite(inNuvem) && isFinite(outNuvem))
            ? { videoId: vidNuvem, inS: inNuvem, outS: outNuvem,
                chave: `${vidNuvem}|${inNuvem.toFixed(3)}|${outNuvem.toFixed(3)}` }
            : null;
        const ctxAtual = this._ctxNuvem ? this._ctxNuvem.chave : null;
        if (ctxAtual !== ctxAnterior) {
            this._camposNuvemCache = null;
            this._automaticoNuvem = null;
        }
        this._atualizarAjustesNuvem().catch((err) => console.error("[timeline] falha ao atualizar os ajustes da nuvem:", err));
        const nuvemToggle = container.querySelector("#adj-ar-nuvem-toggle");
        if (nuvemToggle) {
            nuvemToggle.onclick = (e) => { e.stopPropagation(); this._nuvemAjustesAberto = !this._nuvemAjustesAberto; this._pintarAjustesNuvem(); };
        }
        const nuvemOut = container.querySelector("#adj-ar-nuvem-out");
        if (nuvemOut) {
            const alvoDoPainel = () => this._alvoIdDoPainelNuvem(nuvemOut.ownerDocument);
            nuvemOut.addEventListener("change", (e) => {
                const selCampo = e.target.closest("select[data-nuvem-campo]");
                if (selCampo) this._marcarAjusteNuvem(alvoDoPainel(), selCampo.dataset.nuvemCampo, selCampo.value);
            });
            nuvemOut.addEventListener("click", (e) => {
                const volta = e.target.closest("[data-volta-auto]");
                if (volta) { e.stopPropagation(); this._voltarAjusteNuvemAoAuto(alvoDoPainel(), volta.dataset.voltaAuto); }
            });
        }

        if (presetSel) {
            presetSel.onchange = () => {
                const def = this._presetsAudioRender()[presetSel.value];
                if (!def) return;
                const marcar = (id, valor) => { const el = container.querySelector(`#${id}`); if (el) el.checked = valor; };
                marcar("adj-ar-reparo", def.reparo);
                marcar("adj-ar-fala", def.fala);
                marcar("adj-ar-loudnorm", def.loudnorm);
                marcar("adj-ar-limitador", def.limitador);
                const lufs = container.querySelector("#adj-ar-lufs"); if (lufs) lufs.value = String(def.lufs);
                const teto = container.querySelector("#adj-ar-teto"); if (teto) teto.value = String(def.teto);
                recalcEstimativa();
            };
        }

        const btnPrevia = container.querySelector("#adj-ar-previa");
        if (btnPrevia) btnPrevia.onclick = async (e) => { e.stopPropagation(); await this._tocarPreviaAudioRender(container, clip.id); };
        const btnAplicar = container.querySelector("#adj-ar-aplicar");
        if (btnAplicar) btnAplicar.onclick = async (e) => { e.stopPropagation(); await this.aplicarRenderAudio(container, clip.id); };

        // RESULTADO é repintado por fora (poll/descarte): cabos por delegação no corpo.
        const resultadoBody = container.querySelector("#adj-ar-resultado-body");
        if (resultadoBody) {
            resultadoBody.addEventListener("change", (e) => {
                const ab = e.target.closest('input[name="adj-ar-ab"]');
                if (!ab) return;
                const ok = this._conectarFonteTratada(resultadoBody.dataset.alvo, ab.value === "tratado");
                if (ok) {
                    this._pintarResultado(resultadoBody.dataset.alvo);
                    STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
                }
            });
            resultadoBody.addEventListener("click", (e) => {
                // H6: copiar o caminho do WAV tratado num clique.
                const copiar = e.target.closest("#adj-ar-copiar-caminho");
                if (copiar) {
                    const span = resultadoBody.querySelector("#adj-ar-caminho");
                    const caminho = copiar.dataset.copia || (span ? span.textContent : "");
                    this._copiarTexto(caminho).then((ok) => {
                        if (ok && typeof window !== "undefined" && typeof window.showToast === "function") {
                            window.showToast("Caminho do arquivo tratado copiado.", "success");
                        }
                    });
                    return;
                }
                if (e.target.closest("#adj-ar-descartar")) this._descartarRenderAudio(clip.id);
            });
        }
    }

    // ==================== N2/N3: explicações clicáveis (fonte única: glossário do servidor) ====================

    /** TTL do cache do glossário, na mesma disciplina da cota e dos campos da nuvem. */
    _GLOSSARIO_TTL_MS() { return 60000; }

    /** Chaves candidatas do glossário para uma métrica do diagnóstico. O servidor já
     *  nomeia as métricas (selos[].metrica); o apelido extra cobre a chave curta que
     *  o glossário pode usar. Vira ícone só a PRIMEIRA candidata que existir. Puro. */
    _chaveExplicaMetrica(metrica) {
        // A chamada vem de avaliacao.selos[].metrica, cujos valores sao os nomes
        // que avaliar() usa - NAO os nomes dos campos do diagnostico. A primeira
        // versao indexava por lufs_i/true_peak_db/noise_floor_db e por isso
        // nenhuma metrica do diagnostico ganhava icone. As chaves do lado
        // direito sao as REAIS de src/nlp/audio_glossario.py.
        const candidatas = {
            loudness: "loudness",
            pico_real: "pico_real",
            clipping: "clipping",
            ruido: "piso_ruido",
            dinamica: "dinamica_lra",
            estereo: "correlacao_canais",
            // nomes de campo do diagnostico, caso algum chamador use o dict cru
            lufs_i: "loudness",
            true_peak_db: "pico_real",
            noise_floor_db: "piso_ruido",
            lra: "dinamica_lra",
            clip_pct: "clipping",
            peak_count: "clipping",
            stereo_corr: "correlacao_canais",
        };
        return candidatas[String(metrica || "")] || "";
    }

    /** Chaves candidatas do glossário para um controle ao vivo (EQ/dinâmica). Puro. */
    _chaveExplicaControle(prop) {
        // Chaves REAIS de src/nlp/audio_glossario.py, conferidas contra
        // GET /api/audio/glossario. A primeira versao desta tabela foi escrita
        // antes do glossario existir e usava nomes inventados (eq_low, gate_db,
        // comp_ratio): nenhum casava, e o efeito era o icone sumir em silencio.
        const candidatas = {
            hpf: "hpf",
            low: "eq_bandas",
            mid: "eq_bandas",
            high: "eq_bandas",
            gate_db: "gate",
            comp_ratio: "compressor",
            comp_thresh_db: "compressor",
            makeup_db: "makeup",
        };
        return candidatas[String(prop || "")] || "";
    }

    /** Âncora inertíssima onde o ícone (i) entra DEPOIS que o glossário chegar do
     *  servidor. Recebe as chaves candidatas separadas por espaço; sem candidatas,
     *  não há âncora nenhuma. Pura. */
    _slotExplica(candidatas) {
        const chaves = String(candidatas || "").trim();
        return chaves ? `<span class="capiau-explica-slot" data-explica="${this._audioDiagEsc(chaves)}"></span>` : "";
    }

    /** GET /api/audio/glossario (contrato N2). Cache curto de sessão + dedupe, como a
     *  cota e os campos da nuvem. Falha de HTTP/rede/corpo inútil devolve null e NÃO
     *  envenena o cache: os ícones não aparecem e o painel segue 100% usável — ícone
     *  que abre painel vazio é pior que ícone nenhum. */
    async _consultarGlossario() {
        const agora = Date.now();
        if (this._glossarioCache !== null && (agora - this._glossarioQuando) < this._GLOSSARIO_TTL_MS()) {
            return this._glossarioCache;
        }
        if (this._glossarioEmVoo) return this._glossarioEmVoo;
        this._glossarioEmVoo = (async () => {
            const buscar = this._fetchGlossarioDuble || fetch;
            let entradas = null;
            try {
                const resp = await buscar("/api/audio/glossario");
                if (resp.ok) {
                    entradas = this._validarGlossario(await resp.json());
                    if (entradas === null) console.error("[timeline] rota do glossário respondeu um corpo inutilizável; seguindo sem ícones de explicação.");
                } else {
                    console.error(`[timeline] rota do glossário respondeu HTTP ${resp.status}; seguindo sem ícones de explicação.`);
                }
            } catch (err) {
                console.error("[timeline] falha ao consultar o glossário de áudio:", err);
            }
            if (entradas !== null) {
                this._glossarioCache = entradas;
                this._glossarioQuando = Date.now();
            }
            this._glossarioEmVoo = null;
            return entradas;
        })();
        return this._glossarioEmVoo;
    }

    /** Valida o corpo contra o contrato N2 ({ok, total, entradas:{chave:{titulo,resumo,
     *  detalhe,na_pratica,secao,relacionado}}}) e devolve o mapa usável — ou null.
     *  Entrada sem título não tem o que mostrar; relacionado inexistente nunca vira link. */
    _validarGlossario(resposta) {
        if (!resposta || typeof resposta !== "object" || resposta.ok !== true) return null;
        const bruto = (resposta.entradas && typeof resposta.entradas === "object" && !Array.isArray(resposta.entradas)) ? resposta.entradas : null;
        if (!bruto) return null;
        const entradas = {};
        for (const chave of Object.keys(bruto)) {
            const def = bruto[chave];
            if (!def || typeof def === "string" || Array.isArray(def)) continue;
            const titulo = String(def.titulo || "").trim();
            if (!titulo) continue;
            entradas[chave] = {
                titulo,
                resumo: String(def.resumo || ""),
                detalhe: String(def.detalhe || ""),
                na_pratica: String(def.na_pratica || ""),
                secao: String(def.secao || ""),
                relacionado: Array.isArray(def.relacionado) ? def.relacionado.map(r => String(r)).filter(Boolean) : [],
            };
        }
        return Object.keys(entradas).length > 0 ? entradas : null;
    }

    /** Troca cada âncora que tenha entrada no glossário pelo botão (i) - sutil, com o
     *  resumo curtinho na tooltip global de hover; o detalhado vem no CLIQUE. Âncora
     *  sem entrada é removida (rota falhou => nenhum ícone aparece). Reancora no DOM
     *  vivo porque o painel pode ter sido redesenhado durante a espera. */
    _montarIconesExplica(container) {
        return Promise.resolve(this._consultarGlossario()).then((entradas) => {
            const doc = (container && container.ownerDocument) || document;
            const raiz = doc.getElementById("adjustments-panel-content") || container;
            if (!raiz) return entradas;
            raiz.querySelectorAll(".capiau-explica-slot[data-explica]").forEach((slot) => {
                const lista = String(slot.dataset.explica || "").split(/\s+/).filter(Boolean);
                const chave = lista.find(k => entradas && entradas[k]) || null;
                if (!chave) { slot.remove(); return; }
                const btn = doc.createElement("button");
                btn.type = "button";
                btn.className = "capiau-explica";
                btn.dataset.explicaChave = chave;
                btn.setAttribute("aria-label", `Explicar: ${entradas[chave].titulo}`);
                if (entradas[chave].resumo) btn.setAttribute("data-tooltip", this._audioDiagEsc(entradas[chave].resumo));
                btn.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
                slot.replaceWith(btn);
            });
            // Painel que ficou órfão de um redesenho não sobra como estado fantasma.
            if (this._explicaAberta && this._explicaAberta.painel && !this._explicaAberta.painel.isConnected) {
                this._explicaAberta = null;
            }
            return entradas;
        });
    }

    /** Delegação de cliques dos (i): UM ouvinte por painel - o container persiste entre
     *  redesenhos, então a marcação evita empilhar ouvintes a cada render. O clique no
     *  ícone não vaza para os handlers de seção (stopPropagation). */
    _ligarDelegacaoExplica(container) {
        if (!container || container.__capiauExplicaLigado) return;
        container.__capiauExplicaLigado = true;
        container.addEventListener("click", (e) => {
            const icone = e.target.closest(".capiau-explica");
            if (!icone) return;
            e.stopPropagation();
            this._alternarExplica(container, icone.dataset.explicaChave, icone);
        });
    }

    /** Clique no (i): segundo clique no MESMO ícone fecha; outro ícone fecha o anterior
     *  e abre o delele - UM painel aberto por vez, nunca dois. */
    _alternarExplica(container, chave, icone) {
        const aberto = this._explicaAberta;
        if (aberto && aberto.painel && aberto.painel.isConnected && aberto.chave === chave) {
            aberto.painel.remove();
            this._explicaAberta = null;
            return;
        }
        this._abrirPainelExplica(container, chave, icone, null);
    }

    /** Monta e posiciona o painel detalhado junto ao ícone (com as travas de canto do
     *  motor de tooltips da casa). Sem entrada no glossário não abre painel vazio. */
    _abrirPainelExplica(container, chave, icone, herdarDe) {
        const entrada = (this._glossarioCache || {})[chave] || null;
        if (!entrada) return;
        const doc = (container && container.ownerDocument) || document;
        if (this._explicaAberta && this._explicaAberta.painel) this._explicaAberta.painel.remove();
        const painel = doc.createElement("div");
        painel.className = "capiau-explica-painel";
        painel.dataset.explicaAtual = chave;
        painel.innerHTML = this._painelExplicaInner(entrada);
        doc.body.appendChild(painel);

        // Posição: perto do ícone; navegação por relacionados mantém o lugar do painel anterior.
        const margem = 8;
        const win = doc.defaultView || window;
        const rect = painel.getBoundingClientRect();
        const ancora = (icone && icone.isConnected) ? icone.getBoundingClientRect() : null;
        let top;
        let left;
        if (ancora) {
            top = ancora.bottom + 6;
            left = ancora.left;
            if (top + rect.height > win.innerHeight - margem) top = Math.max(margem, ancora.top - rect.height - 6);
        } else if (herdarDe && herdarDe.isConnected) {
            const r0 = herdarDe.getBoundingClientRect();
            top = r0.top;
            left = r0.left;
        } else {
            top = margem;
            left = win.innerWidth - rect.width - margem;
        }
        if (left + rect.width > win.innerWidth - margem) left = Math.max(margem, win.innerWidth - rect.width - margem);
        if (left < margem) left = margem;
        painel.style.position = "fixed";
        painel.style.top = `${Math.round(top)}px`;
        painel.style.left = `${Math.round(left)}px`;
        painel.style.zIndex = "10000";

        // Cabos do próprio painel: fechar e navegar para relacionados (delegação).
        painel.addEventListener("click", (e) => {
            const fechar = e.target.closest(".capiau-explica-fechar");
            if (fechar) {
                e.stopPropagation();
                painel.remove();
                if (this._explicaAberta && this._explicaAberta.painel === painel) this._explicaAberta = null;
                return;
            }
            const vai = e.target.closest("[data-explica-vai]");
            if (vai) {
                e.stopPropagation();
                this._navegarExplica(painel, vai.dataset.explicaVai);
            }
        });

        this._explicaAberta = { chave, painel };
    }

    /** Relacionado clicado: o MESMO painel passa a mostrar a outra entrada (o título
     *  novo também precisa existir no glossário; link morto nunca fica no ar). */
    _navegarExplica(painel, chave) {
        const entrada = (this._glossarioCache || {})[chave] || null;
        if (!entrada) {
            painel.remove();
            if (this._explicaAberta && this._explicaAberta.painel === painel) this._explicaAberta = null;
            return;
        }
        painel.dataset.explicaAtual = chave;
        painel.innerHTML = this._painelExplicaInner(entrada);
        this._explicaAberta = { chave, painel };
    }

    /** Corpo do painel: título, resumo, detalhe e o bloco "Na prática" destacado;
     *  relacionados viram botões que levam direto à explicação deles. Puro. */
    _painelExplicaInner(entrada) {
        const esc = this._audioDiagEsc;
        const relacionados = (Array.isArray(entrada.relacionado) ? entrada.relacionado : []).map((ch) => {
            const alvo = (this._glossarioCache || {})[ch] || null;
            if (!alvo) return "";
            return `<button type="button" class="capiau-explica-rel" data-explica-vai="${esc(ch)}">${esc(alvo.titulo)} <i class="fa-solid fa-arrow-right"></i></button>`;
        }).filter(Boolean).join("");
        return `
            <div class="capiau-explica-cabecalho">
                <span class="capiau-explica-titulo">${esc(entrada.titulo)}</span>
                <button type="button" class="capiau-explica-fechar" aria-label="Fechar explicação"><i class="fa-solid fa-xmark"></i></button>
            </div>
            ${entrada.resumo ? `<div class="capiau-explica-resumo" style="white-space:pre-line;">${esc(entrada.resumo)}</div>` : ""}
            ${entrada.detalhe ? `<div class="capiau-explica-detalhe" style="white-space:pre-line;">${esc(entrada.detalhe)}</div>` : ""}
            ${entrada.na_pratica ? `<div class="capiau-explica-pratica"><span class="capiau-explica-pratica-rotulo">Na prática</span><span style="white-space:pre-line;">${esc(entrada.na_pratica)}</span></div>` : ""}
            ${relacionados ? `<div class="capiau-explica-relacionados"><span class="capiau-explica-rel-rotulo">Relacionados</span>${relacionados}</div>` : ""}
        `;
    }

    async runAudioDiagnosis(container, clipId) {
        const btn = container.querySelector("#adj-audio-diag-run");
        let body = container.querySelector("#adj-audio-diag-body");
        if (!btn || !body) return;

        const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
        if (!clip) return;

        const videoId = (clip.video_id !== undefined && clip.video_id !== null) ? clip.video_id : null;
        const inS = Number(clip.in);
        const outS = Number(clip.out);

        this.audioDiagCache = this.audioDiagCache || {};
        if (videoId === null || !isFinite(inS) || !isFinite(outS) || outS <= inS) {
            body.innerHTML = this._audioDiagResultInner({ ok: false, erro: "Clipe sem fonte de áudio ou intervalo in/out inválido para análise." });
            return;
        }

        const cacheKey = `${videoId}|${inS.toFixed(3)}|${outS.toFixed(3)}`;
        const refresh = Boolean(this.audioDiagCache[cacheKey]);

        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Analisando...';
        body.innerHTML = `
            <div style="font-size:10px; color:var(--text-muted); padding:6px 0; display:flex; gap:6px; align-items:center;">
                <i class="fa-solid fa-circle-notch fa-spin"></i>
                <span>Analisando o trecho com ffmpeg (ebur128 + astats)...</span>
            </div>
        `;

        let data = null;
        let falha = null;
        try {
            const resp = await fetch(`/api/video/${videoId}/audio/analysis?in=${inS.toFixed(3)}&out=${outS.toFixed(3)}${refresh ? "&refresh=true" : ""}`);
            if (resp.ok) {
                data = await resp.json();
            } else {
                falha = resp.status === 404 ? "Vídeo não encontrado no servidor (HTTP 404)." : `O servidor respondeu HTTP ${resp.status}.`;
            }
        } catch (err) {
            falha = "Falha de rede ao contatar o servidor de análise.";
        }

        // O painel pode ter sido redesenhado durante a espera; reancorar no DOM vivo.
        btn.disabled = false;
        btn.innerHTML = origHtml;
        body = container.querySelector("#adj-audio-diag-body") || body;
        this._montarIconesExplica(container).catch((err) => console.error("[timeline] falha ao montar os ícones de explicação:", err));

        if (falha) {
            body.innerHTML = this._audioDiagResultInner({ ok: false, erro: falha });
            return;
        }
        if (!data || data.ok !== true) {
            body.innerHTML = this._audioDiagResultInner(data || { ok: false });
            return;
        }

        this.audioDiagCache[cacheKey] = data;

        // Contrato D3: publica para o desenhador da faixa (timelineRenderer lê STATE.audioDiag).
        const diag = data.diag || {};
        STATE.audioDiag = STATE.audioDiag || {};
        STATE.audioDiag[cacheKey] = {
            video_id: videoId,
            in_s: inS,
            out_s: outS,
            envelope: Array.isArray(diag.envelope) ? diag.envelope : [],
            momentos: Array.isArray(diag.momentos) ? diag.momentos : [],
            quando: Date.now()
        };

        this._audioDiagMomentsExpanded = false;
        body.innerHTML = this._audioDiagResultInner(data);

        // Redesenho da timeline pelo caminho que o arquivo já usa.
        if (this.renderer) this.renderer.requestRedraw();
    }

    attachAdjustmentsListeners(container, clipId) {
        const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
        if (!clip) return;

        // Diagnóstico de áudio (somente leitura: não cria efeito no clipe e não dispara autosave)
        const diagRunBtn = container.querySelector("#adj-audio-diag-run");
        if (diagRunBtn) {
            diagRunBtn.onclick = async (e) => {
                e.stopPropagation();
                await this.runAudioDiagnosis(container, clipId);
            };
        }

        // Momentos de estouro: clique leva o playhead até o instante da fonte;
        // "Ver mais/Ver menos" expande a lista sem redesenhar o painel inteiro.
        const diagBody = container.querySelector("#adj-audio-diag-body");
        if (diagBody) {
            diagBody.onclick = (e) => {
                const jump = e.target.closest(".adj-diag-jump");
                if (jump) {
                    const clipAlvo = STATE.activeTimelineCuts.find(c => c.id === clipId);
                    const destino = this._audioDiagSourceToTimelineFrame(clipAlvo, parseFloat(jump.dataset.time));
                    if (destino !== null) {
                        this.updatePlayhead(destino);
                        if (this.renderer) this.renderer.requestRedraw();
                    }
                    return;
                }
                if (e.target.closest(".adj-diag-more")) {
                    this._audioDiagMomentsExpanded = !this._audioDiagMomentsExpanded;
                    const liveBody = container.querySelector("#adj-audio-diag-body");
                    if (liveBody && this._audioDiagLastData) {
                        liveBody.innerHTML = this._audioDiagResultInner(this._audioDiagLastData, this._audioDiagMomentsExpanded);
                        this._montarIconesExplica(container).catch((err) => console.error("[timeline] falha ao montar os ícones de explicação:", err));
                    }
                }
            };
        }

        // Fades
        const fi = container.querySelector("#adj-fadein");
        const fo = container.querySelector("#adj-fadeout");
        const fic = container.querySelector("#adj-fadein-curve");
        const foc = container.querySelector("#adj-fadeout-curve");
        if (fi) {
            fi.oninput = () => {
                const val = parseFloat(fi.value) || 0;
                fi.setAttribute("data-tooltip", `Fade In: ${val}s`);
            };
            fi.onchange = () => {
                const val = parseFloat(fi.value) || 0;
                fi.setAttribute("data-tooltip", `Fade In: ${val}s`);
                const curve = fic ? fic.value : "linear";
                this.setClipFade(clipId, "in", val, curve);
                if (this.renderer) this.renderer.requestRedraw();
            };
        }
        if (fo) {
            fo.oninput = () => {
                const val = parseFloat(fo.value) || 0;
                fo.setAttribute("data-tooltip", `Fade Out: ${val}s`);
            };
            fo.onchange = () => {
                const val = parseFloat(fo.value) || 0;
                fo.setAttribute("data-tooltip", `Fade Out: ${val}s`);
                const curve = foc ? foc.value : "linear";
                this.setClipFade(clipId, "out", val, curve);
                if (this.renderer) this.renderer.requestRedraw();
            };
        }
        if (fic) {
            fic.onchange = () => {
                const curve = fic.value;
                this.setClipFadeCurve(clipId, "in", curve, 0);
                if (this.renderer) this.renderer.requestRedraw();
            };
        }
        if (foc) {
            foc.onchange = () => {
                const curve = foc.value;
                this.setClipFadeCurve(clipId, "out", curve, 0);
                if (this.renderer) this.renderer.requestRedraw();
            };
        }

        // Stepper flat buttons para fades (apenas traços sem box depois do 's')
        container.querySelectorAll(".btn-fade-step").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const targetId = btn.dataset.target;
                const dir = btn.dataset.dir;
                const input = container.querySelector(`#${targetId}`);
                if (!input) return;

                let cur = parseFloat(input.value) || 0;
                if (dir === "up") {
                    cur = Math.round((cur + 0.1) * 10) / 10;
                } else {
                    cur = Math.max(0, Math.round((cur - 0.1) * 10) / 10);
                }
                input.value = cur;
                const tooltipText = `${targetId === "adj-fadein" ? "Fade In" : "Fade Out"}: ${cur}s`;
                input.setAttribute("data-tooltip", tooltipText);
                
                const side = targetId === "adj-fadein" ? "in" : "out";
                const curveSelect = side === "in" ? fic : foc;
                const curve = curveSelect ? curveSelect.value : "linear";
                this.setClipFade(clipId, side, cur, curve);
                if (this.renderer) this.renderer.requestRedraw();
            };
        });

        // Enquadramento (fit/fill)
        container.querySelectorAll(".nle-select-btn").forEach(btn => {
            btn.onclick = () => {
                const action = btn.dataset.action;
                const [kind, val] = action.split(":");
                if (kind === "fit") {
                    this.setClipFit(clipId, val);
                }
            };
        });

        // Presets Ken Burns
        const kbSelect = container.querySelector("#adj-kb-preset");
        if (kbSelect) {
            kbSelect.onchange = () => {
                this.setClipKenBurns(clipId, kbSelect.value);
            };
        }

        // Transformações (Geometria)
        const propLabels = { x: "Posição X", y: "Posição Y", scale: "Escala", rotation: "Rotação", opacity: "Opacidade" };
        container.querySelectorAll("input[data-prop]").forEach(slider => {
            const prop = slider.dataset.prop;
            const disp = slider.nextElementSibling;
            const defaults = { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 };

            slider.oninput = () => {
                TIMELINE_HISTORY.begin();
                let val = parseFloat(slider.value);
                if (prop === "scale") val = val / 100;
                else if (prop === "opacity") val = val / 100;

                const dispText = slider.value + (prop === "rotation" ? "°" : "%");
                if (disp) {
                    disp.textContent = dispText;
                }
                const tooltipText = `${propLabels[prop] || prop}: ${dispText}`;
                slider.setAttribute("data-tooltip", tooltipText);
                const globalTooltip = document.getElementById("global-tooltip");
                if (globalTooltip && globalTooltip.classList.contains("visible")) {
                    globalTooltip.textContent = tooltipText;
                }

                // Mutação rápida sem Undo/Redo no meio do arrasto para feedback em tempo real
                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === clipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    let tf = targetClip.effects.find(e => e.type === "transform");
                    if (!tf) {
                        tf = { type: "transform", scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 };
                        targetClip.effects.push(tf);
                    }
                    tf[prop] = val;
                    STATE.activeTimelineCuts = cuts;
                }
            };

            slider.onchange = () => {
                let val = parseFloat(slider.value);
                if (prop === "scale") val = val / 100;
                else if (prop === "opacity") val = val / 100;
                this.setClipTransform(clipId, prop, val);
                TIMELINE_HISTORY.commit();
            };

            slider.addEventListener("dblclick", () => {
                const defVal = defaults[prop] !== undefined ? defaults[prop] : 0;
                slider.value = defVal;
                const dispText = defVal + (prop === "rotation" ? "°" : "%");
                if (disp) {
                    disp.textContent = dispText;
                }
                slider.setAttribute("data-tooltip", `${propLabels[prop] || prop}: ${dispText}`);
                let val = parseFloat(defVal);
                if (prop === "scale") val = val / 100;
                else if (prop === "opacity") val = val / 100;
                this.setClipTransform(clipId, prop, val);
            });
        });

        // Recorte (Crop)
        const cropLabels = { left: "Recorte Esquerda", right: "Recorte Direita", top: "Recorte Topo", bottom: "Recorte Base" };
        container.querySelectorAll("input[data-crop]").forEach(slider => {
            const prop = slider.dataset.crop;
            const disp = slider.nextElementSibling;

            slider.oninput = () => {
                TIMELINE_HISTORY.begin();
                const val = parseFloat(slider.value);

                const dispText = slider.value + "%";
                if (disp) {
                    disp.textContent = dispText;
                }
                const tooltipText = `${cropLabels[prop] || prop}: ${dispText}`;
                slider.setAttribute("data-tooltip", tooltipText);
                const globalTooltip = document.getElementById("global-tooltip");
                if (globalTooltip && globalTooltip.classList.contains("visible")) {
                    globalTooltip.textContent = tooltipText;
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === clipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    let crop = targetClip.effects.find(e => e.type === "crop");
                    if (!crop) {
                        crop = { type: "crop", top: 0, right: 0, bottom: 0, left: 0 };
                        targetClip.effects.push(crop);
                    }
                    crop[prop] = val;
                    STATE.activeTimelineCuts = cuts;
                }
            };

            slider.onchange = () => {
                const val = parseFloat(slider.value);
                this.setClipCrop(clipId, prop, val);
                TIMELINE_HISTORY.commit();
            };

            slider.addEventListener("dblclick", () => {
                const defVal = 0;
                slider.value = defVal;
                if (disp) {
                    disp.textContent = defVal + "%";
                }
                slider.setAttribute("data-tooltip", `${cropLabels[prop] || prop}: ${defVal}%`);
                this.setClipCrop(clipId, prop, defVal);
            });
        });

        // Efeitos de Cor
        const colorLabels = { brightness: "Brilho", contrast: "Contraste", saturation: "Saturação", hue: "Matiz", sepia: "Sépia", grayscale: "Cinzas", blur: "Desfoque" };
        container.querySelectorAll("input[data-color]").forEach(slider => {
            const prop = slider.dataset.color;
            const disp = slider.nextElementSibling;
            const colorDefaults = {
                brightness: 0,
                contrast: 0,
                saturation: 100,
                hue: 0,
                sepia: 0,
                grayscale: 0,
                blur: 0
            };

            slider.oninput = () => {
                TIMELINE_HISTORY.begin();
                const val = parseFloat(slider.value);
                const dispText = slider.value + (prop === "blur" ? "px" : prop === "hue" ? "°" : "%");
                if (disp) {
                    disp.textContent = dispText;
                }
                const tooltipText = `${colorLabels[prop] || prop}: ${dispText}`;
                slider.setAttribute("data-tooltip", tooltipText);
                const globalTooltip = document.getElementById("global-tooltip");
                if (globalTooltip && globalTooltip.classList.contains("visible")) {
                    globalTooltip.textContent = tooltipText;
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === clipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    let col = targetClip.effects.find(e => e.type === "color");
                    if (!col) {
                        col = { type: "color", brightness: 0, contrast: 0, saturation: 100, hue: 0, sepia: 0, grayscale: 0, blur: 0 };
                        targetClip.effects.push(col);
                    }
                    col[prop] = val;
                    STATE.activeTimelineCuts = cuts;
                }
            };

            slider.onchange = () => {
                const val = parseFloat(slider.value);
                this.setClipColor(clipId, prop, val);
                TIMELINE_HISTORY.commit();
            };

            slider.addEventListener("dblclick", () => {
                const defVal = colorDefaults[prop] !== undefined ? colorDefaults[prop] : 0;
                slider.value = defVal;
                const dispText = defVal + (prop === "blur" ? "px" : prop === "hue" ? "°" : "%");
                if (disp) {
                    disp.textContent = dispText;
                }
                slider.setAttribute("data-tooltip", `${colorLabels[prop] || prop}: ${dispText}`);
                this.setClipColor(clipId, prop, defVal);
            });
        });

        // Ajustes de Áudio AO VIVO (Etapa 2): mesmo ciclo das seções acima - grava em
        // clip.effects (o autosave dispara por "timelineCutsUpdated", caminho de sempre) -
        // e ainda chama o player para aplicar no elemento que está tocando (contrato E2).
        const aoVivoTargetClipId = () => {
            const isAudio = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
            if (!isAudio && clip.type === "video" && clip.link_id) {
                const partner = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
                if (partner) return partner.id;
            }
            return clipId;
        };
        const aoVivoGrupo = (datasetKey, rotulos, tipo) => {
            container.querySelectorAll(`input[data-${datasetKey}]`).forEach(slider => {
                const prop = slider.dataset[datasetKey];
                const disp = slider.nextElementSibling;
                const inteiro = prop === "hpf" || prop === "gate_db" || prop === "comp_thresh_db";

                const refletir = (val) => {
                    const dispText = this._formatarValorAudioAoVivo(prop, val);
                    if (disp) disp.textContent = dispText;
                    const tooltipText = `${rotulos[prop] || prop}: ${dispText}`;
                    slider.setAttribute("data-tooltip", tooltipText);
                    const globalTooltip = document.getElementById("global-tooltip");
                    if (globalTooltip && globalTooltip.classList.contains("visible")) {
                        globalTooltip.textContent = tooltipText;
                    }
                };

                const lerVal = () => {
                    let val = parseFloat(slider.value);
                    if (inteiro) val = Math.round(val);
                    return val;
                };

                const gravar = (val) => {
                    if (tipo === "audio_eq") this.setClipAudioEq(aoVivoTargetClipId(), prop, val);
                    else this.setClipAudioDynamics(aoVivoTargetClipId(), prop, val);
                };

                slider.oninput = () => {
                    TIMELINE_HISTORY.begin();
                    const val = lerVal();
                    refletir(val);

                    // Mutação rápida sem Undo/Redo no meio do arrasto (padrão das seções vizinhas)
                    const cuts = [...STATE.activeTimelineCuts];
                    const targetClip = cuts.find(c => c.id === aoVivoTargetClipId());
                    if (targetClip) {
                        targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                        const i = targetClip.effects.findIndex(e => e.type === tipo);
                        const novo = this._construirEfeitoAudioAoVivo(i >= 0 ? targetClip.effects[i] : null, tipo, prop, val);
                        if (i >= 0) targetClip.effects[i] = novo; else targetClip.effects.push(novo);
                        STATE.activeTimelineCuts = cuts; // dispara o autosave pelo caminho de sempre
                        this._notificarPlayerAudioAoVivo(targetClip); // aplicação na hora (E2)
                    }
                };

                slider.onchange = () => {
                    gravar(lerVal());
                    TIMELINE_HISTORY.commit();
                };

                slider.addEventListener("dblclick", () => {
                    const defVal = this._audioAoVivoDefaults(tipo)[prop];
                    slider.value = defVal;
                    refletir(defVal);
                    gravar(defVal);
                });
            });
        };
        aoVivoGrupo("aeq", { hpf: "Corte de Graves (HPF)", low: "Graves", mid: "Médios", high: "Agudos" }, "audio_eq");
        aoVivoGrupo("adyn", { gate_db: "Gate", comp_ratio: "Razão", comp_thresh_db: "Limiar", makeup_db: "Ganho (Makeup)" }, "audio_dynamics");

        // Volume de Áudio
        const volSlider = container.querySelector("#adj-volume-slider");
        if (volSlider) {
            const disp = volSlider.nextElementSibling;
            volSlider.oninput = () => {
                TIMELINE_HISTORY.begin();
                const val = parseFloat(volSlider.value) / 100;
                const dbVal = val > 0 ? (20 * Math.log10(val)).toFixed(1) : "-inf";
                const dispText = `${volSlider.value}% (${dbVal} dB)`;
                if (disp) {
                    disp.textContent = dispText;
                }
                const tooltipText = `Volume: ${dispText}`;
                volSlider.setAttribute("data-tooltip", tooltipText);
                const globalTooltip = document.getElementById("global-tooltip");
                if (globalTooltip && globalTooltip.classList.contains("visible")) {
                    globalTooltip.textContent = tooltipText;
                }

                const isAudioTrack = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
                let targetClipId = clipId;
                if (!isAudioTrack && clip.type === "video" && clip.link_id) {
                    const partner = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
                    if (partner) {
                        targetClipId = partner.id;
                    }
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === targetClipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    let vol = targetClip.effects.find(e => e.type === "volume");
                    if (!vol) {
                        vol = { type: "volume", level: 1.0 };
                        targetClip.effects.push(vol);
                    }
                    vol.level = val;
                    STATE.activeTimelineCuts = cuts;
                }
            };

            volSlider.onchange = () => {
                const val = parseFloat(volSlider.value) / 100;

                const isAudioTrack = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
                let targetClipId = clipId;
                if (!isAudioTrack && clip.type === "video" && clip.link_id) {
                    const partner = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
                    if (partner) {
                        targetClipId = partner.id;
                    }
                }

                this.setClipVolume(targetClipId, val);
                TIMELINE_HISTORY.commit();
            };

            volSlider.addEventListener("dblclick", () => {
                const defVal = 100; // 100%
                volSlider.value = defVal;
                if (disp) {
                    disp.textContent = `100% (0.0 dB)`;
                }

                const isAudioTrack = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
                let targetClipId = clipId;
                if (!isAudioTrack && clip.type === "video" && clip.link_id) {
                    const partner = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
                    if (partner) {
                        targetClipId = partner.id;
                    }
                }

                this.setClipVolume(targetClipId, 1.0);
            });
        }



        // Explicações (i): delegação única por painel (ver _ligarDelegacaoExplica).
        this._ligarDelegacaoExplica(container);

        // TRATAMENTO RENDERIZADO (Etapa 3, Tipo B; contratos F1-F4). Os controles só
        // existem quando o painel desenhou as seções de áudio; daqui pra baixo é null-safe.
        this._ligarControlesAudioRender(container, clip);

        // Ouvintes de Bypass (Ativar/Desativar Efeito)
        container.querySelectorAll(".btn-adj-bypass").forEach(btn => {
            btn.onclick = () => {
                const section = btn.dataset.section;
                TIMELINE_HISTORY.begin();

                const isAudio = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
                let targetClipId = clipId;
                if ((section === "volume" || section === "audio_eq" || section === "audio_dynamics") && !isAudio && clip.type === "video" && clip.link_id) {
                    const partner = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
                    if (partner) targetClipId = partner.id;
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === targetClipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    if (section === "transform") {
                        let tf = targetClip.effects.find(e => e.type === "transform");
                        if (!tf) {
                            tf = { type: "transform", scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 };
                            targetClip.effects.push(tf);
                        }
                        tf.disabled = !tf.disabled;
                    } else if (section === "crop") {
                        let crop = targetClip.effects.find(e => e.type === "crop");
                        if (!crop) {
                            crop = { type: "crop", top: 0, right: 0, bottom: 0, left: 0 };
                            targetClip.effects.push(crop);
                        }
                        crop.disabled = !crop.disabled;
                    } else if (section === "color") {
                        let col = targetClip.effects.find(e => e.type === "color");
                        if (!col) {
                            col = { type: "color", brightness: 0, contrast: 0, saturation: 100, hue: 0, sepia: 0, grayscale: 0, blur: 0 };
                            targetClip.effects.push(col);
                        }
                        col.disabled = !col.disabled;
                    } else if (section === "volume") {
                        let vol = targetClip.effects.find(e => e.type === "volume");
                        if (!vol) {
                            vol = { type: "volume", level: 1.0 };
                            targetClip.effects.push(vol);
                        }
                        vol.disabled = !vol.disabled;
                    } else if (section === "audio_eq") {
                        let eq = targetClip.effects.find(e => e.type === "audio_eq");
                        if (!eq) {
                            eq = this._audioAoVivoDefaults("audio_eq");
                            targetClip.effects.push(eq);
                        }
                        eq.disabled = !eq.disabled;
                    } else if (section === "audio_dynamics") {
                        let dyn = targetClip.effects.find(e => e.type === "audio_dynamics");
                        if (!dyn) {
                            dyn = this._audioAoVivoDefaults("audio_dynamics");
                            targetClip.effects.push(dyn);
                        }
                        dyn.disabled = !dyn.disabled;
                    } else if (section === "fades") {
                        const fades = targetClip.effects.filter(e => e.type === "crossfade");
                        fades.forEach(f => { f.disabled = !f.disabled; });
                    }
                    STATE.activeTimelineCuts = cuts;
                    if (section === "audio_eq" || section === "audio_dynamics") this._notificarPlayerAudioAoVivo(targetClip);
                    this.refreshClipInspector();
                }

                TIMELINE_HISTORY.commit();
            };
        });

        // Ouvintes de Reset (Redefinir Padrão)
        container.querySelectorAll(".btn-adj-reset").forEach(btn => {
            btn.onclick = () => {
                const section = btn.dataset.section;
                TIMELINE_HISTORY.begin();

                const isAudio = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
                let targetClipId = clipId;
                if ((section === "volume" || section === "audio_eq" || section === "audio_dynamics") && !isAudio && clip.type === "video" && clip.link_id) {
                    const partner = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
                    if (partner) targetClipId = partner.id;
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === targetClipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    if (section === "transform") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "transform");
                        targetClip.effects.push({ type: "transform", scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 });
                    } else if (section === "crop") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "crop");
                        targetClip.effects.push({ type: "crop", top: 0, right: 0, bottom: 0, left: 0 });
                    } else if (section === "color") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "color");
                        targetClip.effects.push({ type: "color", brightness: 0, contrast: 0, saturation: 100, hue: 0, sepia: 0, grayscale: 0, blur: 0 });
                    } else if (section === "volume") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "volume");
                        targetClip.effects.push({ type: "volume", level: 1.0 });
                    } else if (section === "audio_eq") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "audio_eq");
                        targetClip.effects.push(this._audioAoVivoDefaults("audio_eq"));
                    } else if (section === "audio_dynamics") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "audio_dynamics");
                        targetClip.effects.push(this._audioAoVivoDefaults("audio_dynamics"));
                    } else if (section === "fades") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "crossfade");
                    }
                    STATE.activeTimelineCuts = cuts;
                    if (section === "audio_eq" || section === "audio_dynamics") this._notificarPlayerAudioAoVivo(targetClip);
                    this.refreshClipInspector();
                }

                TIMELINE_HISTORY.commit();
            };
        });
    }

    onWheel(e) {
        e.preventDefault();

        if (e.ctrlKey) {
            // Zoom horizontal centralizado no mouse
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;

            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;

            const oldZoom = TIMELINE_STATE.zoom;
            const newZoom = Math.max(0.01, Math.min(5.0, oldZoom * zoomFactor));

            const mouseFrame = TIMELINE_STATE.scrollLeftFrame + (mouseX / oldZoom);
            const newScrollLeft = mouseFrame - (mouseX / newZoom);

            TIMELINE_STATE.setZoom(newZoom);
            TIMELINE_STATE.setScrollLeftFrame(newScrollLeft);
        } else if (e.shiftKey) {
            // Shift + roda = Zoom vertical das pistas (altura das pistas)
            const currentScale = TIMELINE_STATE.trackHeightScale || 1.0;
            const delta = e.deltaY < 0 ? 0.05 : -0.05;
            const newScale = Math.min(1.7, Math.max(0.5, Math.round((currentScale + delta) * 100) / 100));
            TIMELINE_STATE.setTrackHeightScale(newScale);
        } else {
            // Roda simples: scroll vertical das pistas quando excedem a área visível ou quando scrollTop > 0
            const viewportH = (this.renderer.height || 200) - (this.renderer.rulerHeight || 30);
            const overflow = TIMELINE_STATE.totalTracksHeight() > viewportH;
            if ((overflow || TIMELINE_STATE.scrollTop > 0) && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                TIMELINE_STATE.setScrollTop(TIMELINE_STATE.scrollTop + e.deltaY * 0.5, viewportH);
            } else {
                const deltaFrames = (e.deltaX || e.deltaY) / TIMELINE_STATE.zoom;
                TIMELINE_STATE.setScrollLeftFrame(TIMELINE_STATE.scrollLeftFrame + deltaFrames);
            }
        }
    }

    onKeyDown(e) {
        // Ignora atalhos se o usuário estiver digitando em campos de formulário
        if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") {
            return;
        }

        const selectedId = TIMELINE_STATE.selectedClipId;
        const cuts = [...STATE.activeTimelineCuts];

        // Atalhos de Marcadores da Timeline (M, Shift+M, Alt+M)
        if (e.key.toLowerCase() === "m" && !e.ctrlKey && !e.metaKey) {
            if (window.activeFocusedPlayer === "source") {
                return;
            }
            e.preventDefault();
            const playhead = TIMELINE_STATE.playheadFrame;

            if (e.shiftKey) {
                // Shift + M: Pula para o próximo marcador
                const nextM = TIMELINE_STATE.getNextMarker(playhead);
                if (nextM) {
                    this.updatePlayhead(nextM.frame);
                }
                return;
            } else if (e.altKey) {
                // Alt + M: Pula para o marcador anterior
                const prevM = TIMELINE_STATE.getPrevMarker(playhead);
                if (prevM) {
                    this.updatePlayhead(prevM.frame);
                }
                return;
            }

            // Se o popover de edição já estiver aberto, salva primeiro as edições antes de prosseguir
            const modal = this.canvas ? this.canvas.ownerDocument.getElementById("modal-edit-marker") : document.getElementById("modal-edit-marker");
            if (modal && modal.style.display !== "none") {
                const btnSave = modal.querySelector("#btn-marker-save");
                if (btnSave) btnSave.click();
            }

            // Tecla M simples: abre o popover de edição se já houver marcador no local ou cria novo
            const existing = TIMELINE_STATE.getMarkerAtFrame(playhead, 3);
            if (existing) {
                this.openMarkerEditModal(existing);
            } else {
                const newMarker = TIMELINE_STATE.addMarker({ frame: playhead });
                this.openMarkerEditModal(newMarker);
            }
            return;
        }

        // Toggle do popup de alternativas com a tecla 'A'
        if (e.key.toLowerCase() === "a" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (window.activeFocusedPlayer === "source") {
                return; // Let the media library inspector handle it
            }
            const popup = this.canvas.ownerDocument.querySelector("#timeline-alternatives-popup");
            if (popup && popup.style.display === "flex") {
                this.hideAlternativesPopup();
                e.preventDefault();
                return;
            } else if (selectedId) {
                const clip = cuts.find(c => c.id === selectedId);
                if (clip && clip.origin === "ai" && clip.alternatives && clip.alternatives.length > 0) {
                    this.showAlternativesPopup(clip);
                    e.preventDefault();
                    return;
                }
            }
        }

        // Fechar popup de alternativas com a tecla 'Escape'
        if (e.key === "Escape") {
            const popup = this.canvas.ownerDocument.querySelector("#timeline-alternatives-popup");
            if (popup && popup.style.display === "flex") {
                this.hideAlternativesPopup();
                e.preventDefault();
                return;
            }
        }

        // Undo / Redo globais da timeline
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (e.shiftKey) TIMELINE_HISTORY.redo();
            else TIMELINE_HISTORY.undo();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
            e.preventDefault();
            TIMELINE_HISTORY.redo();
            return;
        }

        if (e.key === "Delete" || e.key === "Backspace") {
            if (TIMELINE_STATE.selectedMarkerIds.size > 0) {
                TIMELINE_STATE.removeSelectedMarkers();
                if (this.renderer) this.renderer.requestRedraw();
                e.preventDefault();
                return;
            }
            if (selectedId) {
                const idx = cuts.findIndex(c => c.id === selectedId);
                if (idx !== -1) {
                    TIMELINE_HISTORY.record(() => {
                        const clip = cuts[idx];
                        const linkId = clip.link_id;
                        if (e.altKey || !linkId) {
                            // Alt+Delete: apaga só o selecionado e desvincula o par
                            cuts.splice(idx, 1);
                            if (linkId) {
                                cuts.forEach(c => { if (c.link_id === linkId) c.link_id = null; });
                            }
                        } else {
                            // Delete: apaga o clipe e o par A/V vinculado
                            for (let i = cuts.length - 1; i >= 0; i--) {
                                if (cuts[i].link_id === linkId) cuts.splice(i, 1);
                            }
                        }
                        STATE.activeTimelineCuts = cuts;
                        TIMELINE_STATE.selectedClipId = null;
                    });
                    this.refreshClipInspector();
                    e.preventDefault();
                }
            } else if (TIMELINE_STATE.selectedGhostClipId) {
                // Rejeitar sugestão fantasma
                TIMELINE_STATE.rejectGhostSuggestion(TIMELINE_STATE.selectedGhostClipId);
                TIMELINE_STATE.selectedGhostClipId = null;
                e.preventDefault();
            }
        }
        else if (e.key.toLowerCase() === "u" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // U: desvincula o par A/V do clipe selecionado
            if (selectedId) {
                const clip = cuts.find(c => c.id === selectedId);
                if (clip && clip.link_id) {
                    TIMELINE_HISTORY.record(() => {
                        const linkId = clip.link_id;
                        cuts.forEach(c => { if (c.link_id === linkId) c.link_id = null; });
                        STATE.activeTimelineCuts = cuts;
                    });
                    e.preventDefault();
                }
            }
        }
        else if (e.key === "Enter" || e.key.toLowerCase() === "y") {
            if (TIMELINE_STATE.selectedGhostClipId) {
                // Aceitar sugestão fantasma
                TIMELINE_STATE.acceptGhostSuggestion(TIMELINE_STATE.selectedGhostClipId);
                TIMELINE_STATE.selectedGhostClipId = null;
                e.preventDefault();
            }
        }
        else if (e.key.toLowerCase() === "z" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Z: divide o clipe selecionado no playhead
            if (selectedId) {
                TIMELINE_STATE.splitClip(selectedId, TIMELINE_STATE.playheadFrame);
                e.preventDefault();
            }
        }
        else if (e.key === "ArrowLeft") {
            if (selectedId) {
                if (e.altKey) {
                    this.nudgeTrim(selectedId, "left", -1);
                } else if (e.shiftKey) {
                    this.nudgeTrim(selectedId, "right", -1);
                } else {
                    this.nudgeSelection(selectedId, -1); // 1 frame para trás
                }
            }
            e.preventDefault();
        }
        else if (e.key === "ArrowRight") {
            if (selectedId) {
                if (e.altKey) {
                    this.nudgeTrim(selectedId, "left", 1);
                } else if (e.shiftKey) {
                    this.nudgeTrim(selectedId, "right", 1);
                } else {
                    this.nudgeSelection(selectedId, 1); // 1 frame para frente
                }
            }
            e.preventDefault();
        }
        else if (e.key === "[") {
            if (selectedId) this.nudgeTrim(selectedId, "left", -1);
            e.preventDefault();
        }
        else if (e.key === "]") {
            if (selectedId) this.nudgeTrim(selectedId, "right", 1);
            e.preventDefault();
        }
    }

    // --- MÉTODOS AUXILIARES DE EDICAO ---

    updatePlayhead(frame) {
        TIMELINE_STATE.setPlayheadFrame(frame);
    }

    syncPlayerToClip(clip) {
        if (clip && clip.type === "photo") {
            const photo = STATE.allPhotos.find(p => p.id === clip.photo_id);
            if (photo) STATE.activePhoto = photo;
            return;
        }
        const video = STATE.allVideos.find(v => v.id === clip.video_id);
        if (video) {
            STATE.activeVideo = video;
            const player = document.getElementById("source-video");
            if (player) {
                player.currentTime = clip.in;
            }
        }
    }

    /**
     * Insere um clipe magneticamente na sequência da pista alvo (ordenado pelo centro do drop).
     */
    _insertMagnetic(cuts, clip, trackId, targetStartFrame) {
        const duration = clip.outFrame - clip.inFrame;
        const targetCenter = targetStartFrame + duration / 2;

        const idx = cuts.findIndex(c => c.id === clip.id);
        if (idx !== -1) cuts.splice(idx, 1);

        const trackCuts = cuts.filter(c => c.track === trackId);
        const otherCuts = cuts.filter(c => c.track !== trackId);

        let inserted = false;
        let currentOffset = 0;
        for (let i = 0; i < trackCuts.length; i++) {
            const c = trackCuts[i];
            const cDur = c.outFrame - c.inFrame;
            if (targetCenter < currentOffset + cDur / 2) {
                trackCuts.splice(i, 0, clip);
                inserted = true;
                break;
            }
            currentOffset += cDur;
        }
        if (!inserted) {
            trackCuts.push(clip);
        }
        STATE.activeTimelineCuts = [...trackCuts, ...otherCuts];
    }

    moveClip(clipId, targetStartFrame, targetTrack) {
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        const clipKind = TIMELINE_STATE.trackKindOf(clip.track);

        // Trilha final do clipe: precisa ser do mesmo tipo (vídeo com vídeo, áudio com áudio) e estar livre
        let finalTrackId = clip.track;
        if (targetTrack && targetTrack !== clip.track) {
            const t = TIMELINE_STATE.getTrack(targetTrack);
            if (t && !t.locked && (t.kind || "video") === clipKind) {
                console.log(`[Timeline] Transpondo clipe ${clipId} de ${clip.track} para ${targetTrack}`);
                finalTrackId = targetTrack;
            }
        }
        const finalTrack = TIMELINE_STATE.getTrack(finalTrackId);
        if (finalTrack && finalTrack.locked) return;
        if (finalTrackId !== clip.track) clip.track = finalTrackId;

        if (clipKind === "audio") {
            if (clip.link_id) {
                // Áudio vinculado: o par se move junto — o delta horizontal é aplicado
                // ao vídeo par e a passada de sincronia A/V reancora o áudio.
                const partner = cuts.find(c => c.id !== clip.id && c.link_id === clip.link_id &&
                    TIMELINE_STATE.trackKindOf(c.track) === "video");
                if (partner) {
                    const partnerTrack = TIMELINE_STATE.getTrack(partner.track);
                    if (partnerTrack && !partnerTrack.magnetic && !partnerTrack.locked) {
                        const delta = targetStartFrame - clip.timelineStartFrame;
                        partner.timelineStartFrame = Math.max(0, partner.timelineStartFrame + delta);
                    }
                    // Em pista magnética o vídeo é rippleado: o áudio fica ancorado
                    STATE.activeTimelineCuts = cuts;
                    return;
                }
            }
            // Áudio destacado: posicionamento livre
            clip.timelineStartFrame = Math.max(0, targetStartFrame);
            STATE.activeTimelineCuts = cuts;
            return;
        }

        const isMagnetic = finalTrack ? !!finalTrack.magnetic : (finalTrackId === "V1");

        if (isMagnetic) {
            // Pista magnética: reordena a sequência (ripple)
            this._insertMagnetic(cuts, clip, finalTrackId, targetStartFrame);
        } else {
            // Pista livre: posicionamento absoluto
            clip.timelineStartFrame = targetStartFrame;
            STATE.activeTimelineCuts = cuts;
        }
    }

    trimClipLeft(clipId, deltaFrames) {
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        const maxStart = clip.outFrame - 12; // Mínimo de 12 frames de duração
        const targetIn = Math.min(maxStart, Math.max(0, this.dragStartInFrame + deltaFrames));

        clip.inFrame = targetIn;
        const fps = TIMELINE_STATE.fps; // frames sempre em fps da timeline
        clip.in = targetIn / fps;

        const trackObj = TIMELINE_STATE.getTrack(clip.track);
        if (!trackObj || !trackObj.magnetic) {
            // Pista livre: desloca o início na timeline proporcionalmente
            const targetStart = Math.max(0, this.dragStartClipFrame + deltaFrames);
            clip.timelineStartFrame = targetStart;
        }

        STATE.activeTimelineCuts = cuts;
    }

    trimClipRight(clipId, deltaFrames) {
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        const minOut = clip.inFrame + 12; // Mínimo de 12 frames
        const targetOut = Math.max(minOut, this.dragStartOutFrame + deltaFrames);

        clip.outFrame = targetOut;
        const fps = TIMELINE_STATE.fps; // frames sempre em fps da timeline
        clip.out = targetOut / fps;

        STATE.activeTimelineCuts = cuts;
    }

    nudgeSelection(clipId, deltaFrames) {
        if (!clipId) return;
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        const trackObj = TIMELINE_STATE.getTrack(clip.track);
        if (trackObj && trackObj.locked) return;

        const kind = trackObj ? (trackObj.kind || "video") : "video";

        TIMELINE_HISTORY.record(() => {
            if (kind === "video" && (trackObj ? trackObj.magnetic : clip.track === "V1")) {
                // Pista magnética: reordena na sequência (move posições na array)
                const idx = cuts.findIndex(c => c.id === clipId);
                const targetIdx = idx + deltaFrames;
                if (targetIdx >= 0 && targetIdx < cuts.length) {
                    // Swap
                    cuts[idx] = cuts[targetIdx];
                    cuts[targetIdx] = clip;
                    STATE.activeTimelineCuts = cuts;
                }
            } else {
                // Pistas livres (e áudio vinculado/destacado): desloca no tempo via moveClip
                this.moveClip(clipId, Math.max(0, clip.timelineStartFrame + deltaFrames), null);
            }
        });
    }

    nudgeTrim(clipId, edge, deltaFrames) {
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        const fps = TIMELINE_STATE.fps; // frames sempre em fps da timeline

        TIMELINE_HISTORY.record(() => {
            if (edge === "left") {
                clip.inFrame = Math.max(0, clip.inFrame + deltaFrames);
                clip.in = clip.inFrame / fps;
                const trackObj = TIMELINE_STATE.getTrack(clip.track);
                if (!trackObj || !trackObj.magnetic) {
                    clip.timelineStartFrame = Math.max(0, clip.timelineStartFrame + deltaFrames);
                }
            } else {
                clip.outFrame = Math.max(clip.inFrame + 12, clip.outFrame + deltaFrames);
                clip.out = clip.outFrame / fps;
            }
            STATE.activeTimelineCuts = cuts;
        });
    }

    // --- POPUPS E INTERACTION IA CONTEXTUAL ---

    /**
     * Posiciona um popup `position: fixed` próximo ao cursor, sem sair da viewport.
     * Os popups vivem no <body> da janela do canvas: dentro do container da timeline
     * (overflow: hidden) eles eram cortados ao abrir acima das pistas superiores.
     */
    _placeFixedPopup(popup, clientX, clientY, offsetX = 12) {
        const win = this.canvas.ownerDocument.defaultView || window;
        popup.style.visibility = "hidden";
        popup.style.display = "flex";
        const w = popup.offsetWidth || 300;
        const h = popup.offsetHeight || 150;

        let left = clientX + offsetX;
        if (left + w > win.innerWidth - 8) left = Math.max(8, clientX - w - offsetX);

        let top = clientY - h - 12; // preferência: acima do cursor
        if (top < 8) top = Math.min(clientY + 16, win.innerHeight - h - 8);
        top = Math.max(8, Math.min(top, win.innerHeight - h - 8));

        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.style.visibility = "visible";
    }

    showGhostActionsPopup(clientX, clientY, ghost) {
        const doc = this.canvas.ownerDocument;
        let popup = doc.querySelector("#ghost-action-popup");
        if (!popup) {
            popup = doc.createElement("div");
            popup.id = "ghost-action-popup";
            popup.style.cssText = `
                position: fixed;
                background: rgba(15, 23, 42, 0.95);
                border: 1px solid var(--border-glass);
                border-radius: 8px;
                padding: 10px 14px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
                z-index: 10001;
                font-family: sans-serif;
                min-width: 220px;
                backdrop-filter: blur(8px);
            `;
            doc.body.appendChild(popup);
        }

        popup.innerHTML = `
            <div style="font-size: 11px; color: var(--color-cyan); font-weight: bold; margin-bottom: 2px;">SUGESTÃO DE CORTE IA</div>
            <div style="font-size: 12px; color: #fff; line-height: 1.4; margin-bottom: 6px;">"${ghost.reason}"</div>
            <div style="display: flex; gap: 8px;">
                <button id="btn-popup-accept" class="btn-primary" style="flex: 1; height: 26px; font-size: 11px; font-weight: bold; padding: 0 10px; display: flex; align-items: center; justify-content: center; gap: 4px; border-radius: 4px;">
                     <i class="fa-solid fa-check"></i> Aceitar (Y)
                </button>
                <button id="btn-popup-reject" class="btn-secondary" style="flex: 1; height: 26px; font-size: 11px; font-weight: bold; padding: 0 10px; display: flex; align-items: center; justify-content: center; gap: 4px; border-radius: 4px; border-color: rgba(239, 68, 68, 0.3); color: #ef4444; background: rgba(239, 68, 68, 0.08);">
                     <i class="fa-solid fa-xmark"></i> Rejeitar (N)
                </button>
            </div>
        `;

        this._placeFixedPopup(popup, clientX, clientY);

        // Listeners dos botões
        popup.querySelector("#btn-popup-accept").onclick = () => {
            TIMELINE_STATE.acceptGhostSuggestion(ghost.id);
            popup.style.display = "none";
        };
        popup.querySelector("#btn-popup-reject").onclick = () => {
            TIMELINE_STATE.rejectGhostSuggestion(ghost.id);
            popup.style.display = "none";
        };

        // Fecha popup se clicar fora
        const closeHandler = (event) => {
            if (!popup.contains(event.target) && event.target.id !== this.canvas.id) {
                popup.style.display = "none";
                this.canvas.ownerDocument.removeEventListener("mousedown", closeHandler);
            }
        };
        setTimeout(() => this.canvas.ownerDocument.addEventListener("mousedown", closeHandler), 10);
    }

    /**
     * Atualiza a exibição do popup flutuante de preview com o vídeo proxy correspondente.
     */
    updateHoverPreview(clientX, clientY, frame, track) {
        const doc = this.canvas.ownerDocument;
        let previewCard = doc.querySelector("#timeline-preview-card");
        if (!previewCard) {
            previewCard = doc.createElement("div");
            previewCard.id = "timeline-preview-card";
            previewCard.style.cssText = `
                position: fixed;
                width: 200px;
                height: 112px;
                background: #000;
                border: none;
                border-radius: 6px;
                overflow: hidden;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
                z-index: 3500;
                display: none;
                flex-direction: column;
                pointer-events: none;
            `;
            previewCard.innerHTML = `<video autoplay muted loop playsinline style="width: 100%; height: 100%; object-fit: cover; background: #000; display: none;"></video><img class="preview-img" style="width: 100%; height: 100%; object-fit: cover; background: #000; display: block;"><div class="preview-info" style="display: none;"></div>`;
            doc.body.appendChild(previewCard);
        }

        // Se hover preview estiver desativado globalmente ou se houver modal aberto, esconde e sai
        const isModalOpen = !!doc.querySelector(".modal-overlay.active, .modal-overlay[style*='display: flex'], .modal-overlay[style*='display: block'], dialog[open]");
        if (TIMELINE_STATE.hoverPreviewEnabled === false || isModalOpen || this.dragState || !track || (track && track.hidden)) {
            this.clearHoverTimer();
            previewCard.style.display = "none";
            const videoEl = previewCard.querySelector("video");
            if (videoEl && !videoEl.paused) { videoEl.pause(); videoEl.src = ""; }
            return;
        }

        const hit = this.findClipAt(frame, track);
        if (hit && hit.type === "clip") {
            const clip = hit.data;

            // Reporta atividade para o editor (heartbeat)
            fetch("/api/editor/heartbeat", { method: "POST" }).catch(() => {});

            // Preview de FOTO: mostra a imagem no card, oculta o vídeo, limpa o timer de vídeo
            if (clip.type === "photo") {
                this.clearHoverTimer();
                const photo = STATE.allPhotos.find(p => p.id === clip.photo_id);
                if (photo) {
                    const imgEl = previewCard.querySelector(".preview-img");
                    const videoEl = previewCard.querySelector("video");
                    const infoEl = previewCard.querySelector(".preview-info");
                    if (videoEl) { videoEl.pause(); videoEl.style.display = "none"; }
                    const src = (photo.proxy_path || photo.filepath || `/originals/${photo.filename}`).replace(/\\/g, "/");
                    if (imgEl) {
                        if (imgEl.src.indexOf(src) === -1) imgEl.src = src;
                        imgEl.style.display = "block";
                    }
                    const durS = clip.out - clip.in;
                    if (infoEl) infoEl.textContent = `${photo.filename} (${durS.toFixed(1)}s)`;
                    this._placeFixedPopup(previewCard, clientX, clientY, 15);
                    return;
                }
            }

            // Preview de VÍDEO
            const video = STATE.allVideos.find(v => String(v.id) === String(clip.video_id));
            if (video) {
                const imgEl = previewCard.querySelector(".preview-img");
                const videoEl = previewCard.querySelector("video");
                const infoEl = previewCard.querySelector(".preview-info");

                const fps = TIMELINE_STATE?.fps || 24;
                const offsetFrames = frame - clip.timelineStartFrame;
                const hoverTime = clip.in + (offsetFrames / fps);

                // Mostra a miniatura estática instantaneamente
                const interval = TIMELINE_STATE.globalThumbnailsInterval || 1.0;
                const roundedTime = Math.round(hoverTime / interval) * interval;
                const thumbSrc = `/api/video/${video.id}/thumbnail-at?time=${roundedTime.toFixed(1)}`;

                if (imgEl) {
                    imgEl.onerror = () => {
                        // Fallback: se a miniatura do segundo exato ainda não existe, usa a vizinha mais próxima ou a capa
                        const closest = window.timelineRenderer?.getClosestLoadedVideoThumb(video.id, roundedTime);
                        if (closest && closest.src && closest.src !== imgEl.src) {
                            imgEl.src = closest.src;
                        } else {
                            const vVersion = video._thumbVersion || video.thumb_version || video.updated_at || "";
                            imgEl.src = `/api/video/${video.id}/thumbnail?v=${vVersion}`;
                        }
                    };
                    if (imgEl.src.indexOf(thumbSrc) === -1) imgEl.src = thumbSrc;
                    imgEl.style.display = "block";
                }

                const duration = clip.out - clip.in;
                if (infoEl) infoEl.textContent = `${video.filename} (${duration.toFixed(1)}s) @ ${hoverTime.toFixed(1)}s`;

                // Reposiciona o popup
                this._placeFixedPopup(previewCard, clientX, clientY, 15);

                // Gerenciamento de mouse & timer para reprodução do vídeo (3s de tolerância a tremores)
                const dist = Math.hypot(clientX - this.hoverLastX, clientY - this.hoverLastY);
                const clipChanged = this.hoverLastClipId !== clip.id;

                if (clipChanged || dist > 8) {
                    // O mouse se moveu além do limite de microvariações humanas ou mudou de clipe
                    this.clearHoverTimer();
                    this.hoverLastX = clientX;
                    this.hoverLastY = clientY;
                    this.hoverLastTime = hoverTime;
                    this.hoverLastClipId = clip.id;

                    // Oculta o vídeo e exibe a imagem
                    if (videoEl) { videoEl.pause(); videoEl.style.display = "none"; }
                    if (imgEl) imgEl.style.display = "block";

                    // Inicia o timer de 3 segundos para reprodução
                    this.hoverTimer = setTimeout(() => {
                        if (videoEl && imgEl) {
                            imgEl.style.display = "none";
                            videoEl.style.display = "block";

                            const videoSrc = video.proxy_path || video.filepath || `/originals/${video.filename}`;
                            // Começa a tocar a partir do exato ponto do hover até o fim do clipe
                            const targetSrc = `${videoSrc}#t=${hoverTime.toFixed(1)},${clip.out.toFixed(1)}`;
                            const fullTargetSrc = window.location.origin + targetSrc;

                            if (videoEl.src !== fullTargetSrc && !videoEl.src.endsWith(targetSrc)) {
                                videoEl.src = targetSrc;
                                videoEl.load();
                                videoEl.play().catch(() => {});
                            }
                        }
                    }, 3000);
                }

                return;
            }
        }

        // Se não houver clipe sob o cursor, limpa e esconde
        this.clearHoverTimer();
        previewCard.style.display = "none";
        const videoEl = previewCard.querySelector("video");
        if (videoEl && !videoEl.paused) { videoEl.pause(); videoEl.src = ""; }
    }

    clearHoverTimer() {
        if (this.hoverTimer) {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = null;
        }
    }

    /**
     * Esconde o card de preview.
     */
    hideHoverPreview() {
        this.clearHoverTimer();
        const previewCard = this.canvas.ownerDocument.querySelector("#timeline-preview-card");
        if (previewCard) {
            previewCard.style.display = "none";
            const videoEl = previewCard.querySelector("video");
            if (videoEl) {
                videoEl.pause();
                videoEl.src = "";
            }
        }
    }

    /**
     * Exibe o carrossel popup de mídias alternativas como modal com backdrop desfocado.
     */
    showAlternativesPopup(clip) {
        const doc = this.canvas.ownerDocument;
        
        // Criar backdrop se não existir
        let backdrop = doc.querySelector("#timeline-alternatives-backdrop");
        if (!backdrop) {
            backdrop = doc.createElement("div");
            backdrop.id = "timeline-alternatives-backdrop";
            backdrop.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(5px);
                z-index: 10000;
                display: none;
            `;
            backdrop.addEventListener("click", () => this.hideAlternativesPopup());
            doc.body.appendChild(backdrop);
        }

        // Criar popup se não existir
        let popup = doc.querySelector("#timeline-alternatives-popup");
        if (!popup) {
            popup = doc.createElement("div");
            popup.id = "timeline-alternatives-popup";
            popup.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(15, 23, 42, 0.98);
                border: 1px solid var(--color-cyan);
                border-radius: 12px;
                padding: 20px;
                display: none;
                flex-direction: column;
                gap: 15px;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
                z-index: 10001;
                font-family: sans-serif;
                width: 720px;
                max-width: 90vw;
                backdrop-filter: blur(10px);
                color: #fff;
            `;
            doc.body.appendChild(popup);
        }

        if (popup.dataset.clipId === clip.id && popup.style.display === "flex") {
            return;
        }
        popup.dataset.clipId = clip.id;

        // Renderiza lista de alternativas
        let altsHtml = "";
        const activeAlts = (clip.alternatives || []).filter(alt => alt.video_id !== clip.video_id);
        
        activeAlts.forEach((alt, idx) => {
            const video = STATE.allVideos.find(v => v.id === alt.video_id);
            if (!video) return;
            const videoSrc = video.proxy_path || video.filepath || `/originals/${video.filename}`;
            const targetSrc = `${videoSrc}#t=${alt.in_s.toFixed(1)},${alt.out_s.toFixed(1)}`;
            
            altsHtml += `
                <div class="alt-card" style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="position: relative; border-radius: 6px; overflow: hidden; background: #000; aspect-ratio: 16/9;">
                        <video src="${targetSrc}" autoplay loop muted playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
                        <div style="position: absolute; top: 8px; left: 8px; font-size: 10px; font-weight: bold; background: rgba(0,0,0,0.6); padding: 2px 6px; border-radius: 4px; color: #fff;">
                            Candidato #${idx + 1}
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #e2e8f0; line-height: 1.4; flex-grow: 1; min-height: 36px;">
                        "${alt.reason || 'Sem justificativa.'}"
                    </div>
                    <div style="font-size: 11px; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                        <span>Duração Ideal: ${alt.ideal_duration_s ? alt.ideal_duration_s.toFixed(1) + 's' : 'N/A'}</span>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-alt-swap-fixed btn-icon" data-video-id="${alt.video_id}" data-in="${alt.in_s}" data-out="${alt.out_s}" title="Slot Fixo (substitui mantendo a duração atual)" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 15px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff; cursor: pointer; outline: none; transition: all 0.2s;">
                                <i class="fa-solid fa-arrows-left-right"></i>
                            </button>
                            <button class="btn-alt-swap-ripple btn-icon" data-video-id="${alt.video_id}" data-in="${alt.in_s}" data-out="${alt.out_s}" title="Ripple (aplica duração ideal e empurra os seguintes)" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 15px; background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.3); border-radius: 6px; color: var(--color-cyan); cursor: pointer; outline: none; transition: all 0.2s;">
                                <i class="fa-solid fa-angles-right"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        popup.innerHTML = `
            <style>
                .btn-alt-swap-fixed:hover {
                    background: rgba(255,255,255,0.15) !important;
                    border-color: rgba(255,255,255,0.3) !important;
                }
                .btn-alt-swap-ripple:hover {
                    background: rgba(6,182,212,0.25) !important;
                    border-color: rgba(6,182,212,0.6) !important;
                }
                .btn-close-alts:hover {
                    color: #fff !important;
                }
            </style>
            <div style="font-size: 14px; color: var(--color-cyan); font-weight: bold; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
                <span><i class="fa-solid fa-wand-magic-sparkles"></i> Opções Alternativas da IA</span>
                <span style="font-size: 11px; color: var(--text-secondary); cursor: pointer; padding: 4px;" class="btn-close-alts"><i class="fa-solid fa-xmark"></i></span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: -5px;">
                Atalho: pressione <kbd style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px; font-family: monospace;">A</kbd> para fechar ou clique fora.
            </div>
            <div style="max-height: 400px; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; padding-right: 4px; margin-top: 10px;">
                ${altsHtml || '<div style="grid-column: 1/-1; font-size: 12px; color: var(--text-secondary); text-align: center; padding: 20px 0;">Nenhum clipe alternativo configurado no acervo.</div>'}
            </div>
        `;

        backdrop.style.display = "block";
        popup.style.display = "flex";

        // Listeners dos botões
        popup.querySelector(".btn-close-alts").onclick = () => this.hideAlternativesPopup();

        popup.querySelectorAll(".btn-alt-swap-fixed").forEach(btn => {
            btn.onclick = () => {
                const vid = parseInt(btn.dataset.videoId);
                const inS = parseFloat(btn.dataset.in);
                const outS = parseFloat(btn.dataset.out);
                TIMELINE_STATE.replaceClipWithAlternative(clip.id, vid, inS, outS, false);
                this.hideAlternativesPopup();
            };
        });

        popup.querySelectorAll(".btn-alt-swap-ripple").forEach(btn => {
            btn.onclick = () => {
                const vid = parseInt(btn.dataset.videoId);
                const inS = parseFloat(btn.dataset.in);
                const outS = parseFloat(btn.dataset.out);
                TIMELINE_STATE.replaceClipWithAlternative(clip.id, vid, inS, outS, true);
                this.hideAlternativesPopup();
            };
        });
    }

    /**
     * Oculta o popup flutuante de alternativas.
     */
    hideAlternativesPopup() {
        const doc = this.canvas.ownerDocument;
        const popup = doc.querySelector("#timeline-alternatives-popup");
        const backdrop = doc.querySelector("#timeline-alternatives-backdrop");
        if (popup) {
            popup.style.display = "none";
            // Limpar sources e pausar para economizar recursos
            popup.querySelectorAll("video").forEach(v => {
                v.pause();
                v.src = "";
            });
        }
        if (backdrop) {
            backdrop.style.display = "none";
        }
    }
}
