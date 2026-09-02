// Motor de Gerenciamento de Atalhos e Perfis NLE do CapIAu-Talho
// Suporta múltiplos perfis da indústria (CapIAu, Kdenlive, Premiere, DaVinci Resolve, Final Cut Pro e Personalizado),
// detecção de conflitos, gravação interativa de teclas, exportação/importação JSON e persistência em localStorage.

import { STATE } from "./state.js";

export const PRESET_NAMES = {
    capiau: "CapIAu Padrão",
    kdenlive: "Kdenlive",
    premiere: "Adobe Premiere Pro",
    resolve: "DaVinci Resolve",
    finalcut: "Apple Final Cut Pro",
    custom: "Personalizado"
};

export const COMMAND_CATEGORIES = {
    playback: { label: "1. Reprodução & Navegação", icon: "fa-play" },
    tools: { label: "2. Ferramentas & Modos", icon: "fa-toolbox" },
    edit: { label: "3. Edição, Cortes & Trims", icon: "fa-scissors" },
    markers: { label: "4. Marcadores", icon: "fa-bookmark" },
    ai: { label: "5. Assistência de IA & Tomadas", icon: "fa-wand-magic-sparkles" },
    canvas_history: { label: "6. Canvas, Zoom & Histórico", icon: "fa-sliders" }
};

export const COMMANDS_CATALOG = [
    // ── REPRODUÇÃO & NAVEGAÇÃO ──────────────────────────────────────────────
    {
        id: "playback.play_pause",
        category: "playback",
        label: "Play / Pause",
        description: "Inicia ou pausa a reprodução no player ativo (Source ou Program)"
    },
    {
        id: "playback.shuttle_reverse",
        category: "playback",
        label: "Shuttle Reverso (J)",
        description: "Reproduz para trás. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x)"
    },
    {
        id: "playback.shuttle_stop",
        category: "playback",
        label: "Shuttle Parar (K)",
        description: "Interrompe e pausa a reprodução/shuttle imediatamente"
    },
    {
        id: "playback.shuttle_forward",
        category: "playback",
        label: "Shuttle Avanço (L)",
        description: "Reproduz para frente. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x)"
    },
    {
        id: "playback.jog_prev_frame",
        category: "playback",
        label: "Jog Recuar 1 Frame (K + J)",
        description: "Segure K e pressione J para recuar exatamente 1 frame"
    },
    {
        id: "playback.jog_next_frame",
        category: "playback",
        label: "Jog Avançar 1 Frame (K + L)",
        description: "Segure K e pressione L para avançar exatamente 1 frame"
    },
    {
        id: "playback.mark_in",
        category: "playback",
        label: "Marcar Ponto de Entrada (IN)",
        description: "Define o ponto inicial de corte no Player ou Linha do Tempo"
    },
    {
        id: "playback.mark_out",
        category: "playback",
        label: "Marcar Ponto de Saída (OUT)",
        description: "Define o ponto final de corte no Player ou Linha do Tempo"
    },
    {
        id: "playback.clear_in",
        category: "playback",
        label: "Limpar Ponto IN",
        description: "Remove o ponto de entrada (IN) no Player ou Linha do Tempo"
    },
    {
        id: "playback.clear_out",
        category: "playback",
        label: "Limpar Ponto OUT",
        description: "Remove o ponto de saída (OUT) no Player ou Linha do Tempo"
    },
    {
        id: "playback.clear_in_out",
        category: "playback",
        label: "Limpar Pontos IN e OUT",
        description: "Remove ambos os pontos de entrada e saída (IN e OUT)"
    },
    {
        id: "playback.mark_clip",
        category: "playback",
        label: "Marcar Clipe (IN / OUT)",
        description: "Define pontos IN e OUT nos limites do clipe selecionado ou sob a agulha"
    },
    {
        id: "playback.goto_in",
        category: "playback",
        label: "Ir para o Ponto IN",
        description: "Move a agulha de reprodução diretamente para o ponto IN"
    },
    {
        id: "playback.goto_out",
        category: "playback",
        label: "Ir para o Ponto OUT",
        description: "Move a agulha de reprodução diretamente para o ponto OUT"
    },
    {
        id: "playback.play_in_to_out",
        category: "playback",
        label: "Tocar de IN até OUT",
        description: "Reproduz o trecho delimitado entre os pontos IN e OUT e pausa"
    },
    {
        id: "playback.toggle_loop",
        category: "playback",
        label: "Alternar Reprodução em Loop",
        description: "Liga ou desliga a reprodução contínua em loop entre os pontos IN e OUT"
    },
    {
        id: "playback.append_timeline",
        category: "playback",
        label: "Inserir na Timeline (Append)",
        description: "Insere o trecho marcado (IN ➔ OUT) na timeline"
    },
    {
        id: "playback.step_prev",
        category: "playback",
        label: "Navegar 1 Frame para Trás",
        description: "Move a agulha 1 frame para trás (quando nenhum clipe estiver selecionado)"
    },
    {
        id: "playback.step_next",
        category: "playback",
        label: "Navegar 1 Frame para Frente",
        description: "Move a agulha 1 frame para frente (quando nenhum clipe estiver selecionado)"
    },
    {
        id: "playback.prev_edit_point",
        category: "playback",
        label: "Pular para Ponto Anterior / Início",
        description: "Program: move a agulha para o corte anterior; Source: vai para IN ou Início"
    },
    {
        id: "playback.next_edit_point",
        category: "playback",
        label: "Pular para Próximo Ponto / Fim",
        description: "Program: move a agulha para o corte seguinte; Source: vai para OUT ou Fim"
    },

    // ── FERRAMENTAS & MODOS ─────────────────────────────────────────────────
    {
        id: "tools.select",
        category: "tools",
        label: "Ferramenta de Seleção",
        description: "Ativa a ferramenta de seleção padrão da timeline (Seta)"
    },
    {
        id: "tools.track_forward",
        category: "tools",
        label: "Selecionar Faixa para Frente",
        description: "Ativa a ferramenta de seleção de todos os clipes à direita"
    },
    {
        id: "tools.track_backward",
        category: "tools",
        label: "Selecionar Faixa para Trás",
        description: "Ativa a ferramenta de seleção de todos os clipes à esquerda"
    },
    {
        id: "tools.snapping",
        category: "tools",
        label: "Alternar Snapping Magnético",
        description: "Liga ou desliga o alinhamento magnético inteligente de bordas e agulha"
    },
    {
        id: "tools.escape",
        category: "tools",
        label: "Desmarcar Seleção / Fechar Caixas",
        description: "Limpa a seleção de clipes ou fecha pop-ups contextuais e modais"
    },

    // ── EDIÇÃO, CORTES & TRIMS ──────────────────────────────────────────────
    {
        id: "edit.split",
        category: "edit",
        label: "Dividir Clipe no Playhead (Split)",
        description: "Fatia o clipe selecionado na posição exata da agulha de reprodução"
    },
    {
        id: "edit.ripple_trim_head",
        category: "edit",
        label: "Ripple Trim Início (Até a Agulha)",
        description: "Corta o início do clipe até a agulha e fecha o espaço na timeline"
    },
    {
        id: "edit.ripple_trim_tail",
        category: "edit",
        label: "Ripple Trim Fim (Da Agulha ao Fim)",
        description: "Corta da agulha até o final do clipe e fecha o espaço na timeline"
    },
    {
        id: "edit.lift_delete",
        category: "edit",
        label: "Lift Delete (Apagar Clipe)",
        description: "Apaga o clipe selecionado deixando o espaço vazio (gap) intacto"
    },
    {
        id: "edit.ripple_delete",
        category: "edit",
        label: "Ripple Delete (Apagar e Fechar Espaço)",
        description: "Apaga o clipe e puxa todos os clipes posteriores para fechar a lacuna"
    },
    {
        id: "edit.lift_in_out",
        category: "edit",
        label: "Lift no Intervalo IN–OUT",
        description: "Apaga o conteúdo dentro do intervalo IN–OUT nas pistas ativas deixando o espaço vazio (gap)"
    },
    {
        id: "edit.extract_in_out",
        category: "edit",
        label: "Extract (Ripple Delete) no Intervalo IN–OUT",
        description: "Apaga o conteúdo dentro do intervalo IN–OUT e puxa os clipes posteriores para fechar o espaço"
    },
    {
        id: "edit.delete_single_stream",
        category: "edit",
        label: "Apagar Faixa Única (Desvincular Par)",
        description: "Apaga apenas o vídeo ou o áudio selecionado, preservando o outro fluxo"
    },
    {
        id: "edit.unlink_av",
        category: "edit",
        label: "Desvincular Par Áudio/Vídeo",
        description: "Quebra a vinculação estrita entre o vídeo e seu par de áudio correspondente"
    },
    {
        id: "edit.nudge_left",
        category: "edit",
        label: "Nudge: Deslocar 1 Frame para Trás",
        description: "Move o clipe selecionado 1 frame para a esquerda na timeline"
    },
    {
        id: "edit.nudge_right",
        category: "edit",
        label: "Nudge: Deslocar 1 Frame para Frente",
        description: "Move o clipe selecionado 1 frame para a direita na timeline"
    },
    {
        id: "edit.trim_in_nudge_left",
        category: "edit",
        label: "Trim Ponto IN: Recuar 1 Frame",
        description: "Expande ou contrai a ponta inicial do clipe selecionado em 1 frame"
    },
    {
        id: "edit.trim_in_nudge_right",
        category: "edit",
        label: "Trim Ponto IN: Avançar 1 Frame",
        description: "Avança a ponta inicial do clipe selecionado em 1 frame"
    },
    {
        id: "edit.trim_out_nudge_left",
        category: "edit",
        label: "Trim Ponto OUT: Recuar 1 Frame",
        description: "Recua a ponta final do clipe selecionado em 1 frame"
    },
    {
        id: "edit.trim_out_nudge_right",
        category: "edit",
        label: "Trim Ponto OUT: Avançar 1 Frame",
        description: "Avança a ponta final do clipe selecionado em 1 frame"
    },

    // ── MARCADORES ──────────────────────────────────────────────────────────
    {
        id: "markers.add_edit",
        category: "markers",
        label: "Adicionar / Editar Marcador",
        description: "Cria um novo marcador ou abre o popover de edição rápida no playhead"
    },
    {
        id: "markers.next",
        category: "markers",
        label: "Pular para o Próximo Marcador",
        description: "Avança a agulha de reprodução até o marcador seguinte na timeline"
    },
    {
        id: "markers.prev",
        category: "markers",
        label: "Pular para o Marcador Anterior",
        description: "Recua a agulha de reprodução até o marcador anterior na timeline"
    },

    // ── ASSISTÊNCIA DE IA & TOMADAS ─────────────────────────────────────────
    {
        id: "ai.toggle_alternatives",
        category: "ai",
        label: "Alternar Tomadas / Alternativas de IA",
        description: "Abre o seletor de tomadas alternativas em clipes gerados por IA / Inspetor"
    },
    {
        id: "ai.accept_ghost",
        category: "ai",
        label: "Aceitar Sugestão de IA",
        description: "Aprova a sugestão da faixa fantasma de IA, tornando-a clipe real na trilha"
    },
    {
        id: "ai.reject_ghost",
        category: "ai",
        label: "Rejeitar Sugestão de IA",
        description: "Descarta e remove a sugestão fantasma da timeline"
    },

    // ── CANVAS, ZOOM & HISTÓRICO ────────────────────────────────────────────
    {
        id: "history.undo",
        category: "canvas_history",
        label: "Desfazer Ação (Undo)",
        description: "Desfaz a última alteração realizada na timeline"
    },
    {
        id: "history.redo",
        category: "canvas_history",
        label: "Refazer Ação (Redo)",
        description: "Refaz a edição desfeita anteriormente"
    },
    {
        id: "workspace.save",
        category: "canvas_history",
        label: "Salvar Preset de Workspace",
        description: "Abre o diálogo para salvar o layout visual atual da interface"
    }
];

// Normaliza propriedades name e label para interoperabilidade total
COMMANDS_CATALOG.forEach(cmd => {
    if (!cmd.name && cmd.label) cmd.name = cmd.label;
    if (!cmd.label && cmd.name) cmd.label = cmd.name;
});
Object.values(COMMAND_CATEGORIES).forEach(cat => {
    if (!cat.name && cat.label) cat.name = cat.label;
    if (!cat.label && cat.name) cat.label = cat.name;
});

// Mapeamentos Padrão dos Perfis
export const KEYMAP_PRESETS = {
    // 1. CapIAu Padrão (Moderno, Híbrido, Eficiente)
    capiau: {
        "playback.play_pause": ["Space"],
        "playback.shuttle_reverse": ["KeyJ"],
        "playback.shuttle_stop": ["KeyK"],
        "playback.shuttle_forward": ["KeyL"],
        "playback.jog_prev_frame": ["KeyK+KeyJ"],
        "playback.jog_next_frame": ["KeyK+KeyL"],
        "playback.mark_in": ["KeyI"],
        "playback.mark_out": ["KeyO"],
        "playback.clear_in": ["Alt+KeyI"],
        "playback.clear_out": ["Alt+KeyO"],
        "playback.clear_in_out": ["Alt+KeyX"],
        "playback.mark_clip": ["KeyX"],
        "playback.goto_in": ["Shift+KeyI"],
        "playback.goto_out": ["Shift+KeyO"],
        "playback.play_in_to_out": ["Shift+Space", "Alt+Slash"],
        "playback.toggle_loop": ["Ctrl+KeyL", "Ctrl+Shift+Space"],
        "playback.append_timeline": ["KeyE"],
        "playback.step_prev": ["ArrowLeft"],
        "playback.step_next": ["ArrowRight"],
        "playback.prev_edit_point": ["ArrowUp"],
        "playback.next_edit_point": ["ArrowDown"],

        "tools.select": ["KeyV"],
        "tools.track_forward": ["KeyT"],
        "tools.track_backward": ["Shift+KeyT"],
        "tools.snapping": ["KeyS"],
        "tools.escape": ["Escape"],

        "edit.split": ["KeyZ"],
        "edit.ripple_trim_head": ["KeyQ"],
        "edit.ripple_trim_tail": ["KeyW"],
        "edit.lift_delete": ["Delete", "Backspace"],
        "edit.ripple_delete": ["Shift+Delete"],
        "edit.lift_in_out": ["Semicolon", "Alt+Delete"],
        "edit.extract_in_out": ["Quote", "Alt+Shift+Delete"],
        "edit.delete_single_stream": ["Alt+Delete"],
        "edit.unlink_av": ["KeyU"],
        "edit.nudge_left": ["ArrowLeft"],
        "edit.nudge_right": ["ArrowRight"],
        "edit.trim_in_nudge_left": ["Alt+ArrowLeft", "BracketLeft"],
        "edit.trim_in_nudge_right": ["Alt+ArrowRight"],
        "edit.trim_out_nudge_left": ["Shift+ArrowLeft"],
        "edit.trim_out_nudge_right": ["Shift+ArrowRight", "BracketRight"],

        "markers.add_edit": ["KeyM"],
        "markers.next": ["Shift+KeyM"],
        "markers.prev": ["Alt+KeyM"],

        "ai.toggle_alternatives": ["KeyA"],
        "ai.accept_ghost": ["Enter", "KeyY"],
        "ai.reject_ghost": ["Delete", "KeyN"],

        "history.undo": ["Ctrl+KeyZ"],
        "history.redo": ["Ctrl+Shift+KeyZ", "Ctrl+KeyY"],
        "workspace.save": ["Ctrl+Shift+KeyS"]
    },

    // 2. Kdenlive (Padrão Clássico Open-Source)
    kdenlive: {
        "playback.play_pause": ["Space"],
        "playback.shuttle_reverse": ["KeyJ"],
        "playback.shuttle_stop": ["KeyK"],
        "playback.shuttle_forward": ["KeyL"],
        "playback.jog_prev_frame": ["KeyK+KeyJ", "ArrowLeft"],
        "playback.jog_next_frame": ["KeyK+KeyL", "ArrowRight"],
        "playback.mark_in": ["KeyI"],
        "playback.mark_out": ["KeyO"],
        "playback.clear_in": ["Ctrl+Shift+KeyI", "Alt+KeyI"],
        "playback.clear_out": ["Ctrl+Shift+KeyO", "Alt+KeyO"],
        "playback.clear_in_out": ["Ctrl+Shift+KeyX", "Alt+KeyX"],
        "playback.mark_clip": ["KeyX"],
        "playback.goto_in": ["Shift+KeyI"],
        "playback.goto_out": ["Shift+KeyO"],
        "playback.play_in_to_out": ["Shift+Space"],
        "playback.toggle_loop": ["Ctrl+Shift+Space", "Ctrl+KeyL"],
        "playback.append_timeline": ["KeyV", "KeyE"],
        "playback.step_prev": ["ArrowLeft"],
        "playback.step_next": ["ArrowRight"],
        "playback.prev_edit_point": ["Alt+ArrowLeft", "ArrowUp"],
        "playback.next_edit_point": ["Alt+ArrowRight", "ArrowDown"],

        "tools.select": ["KeyS"],
        "tools.track_forward": ["KeyM"],
        "tools.track_backward": ["Shift+KeyM"],
        "tools.snapping": ["F10", "KeyN"],
        "tools.escape": ["Escape"],

        "edit.split": ["Shift+KeyR", "KeyX"],
        "edit.ripple_trim_head": ["BracketLeft", "KeyQ"],
        "edit.ripple_trim_tail": ["BracketRight", "KeyW"],
        "edit.lift_delete": ["Backspace"],
        "edit.ripple_delete": ["Delete", "Shift+Delete"],
        "edit.lift_in_out": ["Alt+Backspace", "Semicolon"],
        "edit.extract_in_out": ["Shift+Delete", "Quote"],
        "edit.delete_single_stream": ["Alt+Delete"],
        "edit.unlink_av": ["KeyU", "Ctrl+Shift+KeyU"],
        "edit.nudge_left": ["ArrowLeft"],
        "edit.nudge_right": ["ArrowRight"],
        "edit.trim_in_nudge_left": ["Alt+ArrowLeft"],
        "edit.trim_in_nudge_right": ["Alt+ArrowRight"],
        "edit.trim_out_nudge_left": ["Shift+ArrowLeft"],
        "edit.trim_out_nudge_right": ["Shift+ArrowRight"],

        "markers.add_edit": ["NumpadMultiply", "KeyG", "KeyM"],
        "markers.next": ["Alt+KeyG", "Shift+KeyM"],
        "markers.prev": ["Alt+Shift+KeyG", "Alt+KeyM"],

        "ai.toggle_alternatives": ["KeyA"],
        "ai.accept_ghost": ["Enter", "KeyY"],
        "ai.reject_ghost": ["Delete", "KeyN"],

        "history.undo": ["Ctrl+KeyZ"],
        "history.redo": ["Ctrl+Shift+KeyZ", "Ctrl+KeyY"],
        "workspace.save": ["Ctrl+Shift+KeyS"]
    },

    // 3. Adobe Premiere Pro
    premiere: {
        "playback.play_pause": ["Space"],
        "playback.shuttle_reverse": ["KeyJ"],
        "playback.shuttle_stop": ["KeyK"],
        "playback.shuttle_forward": ["KeyL"],
        "playback.jog_prev_frame": ["KeyK+KeyJ", "ArrowLeft"],
        "playback.jog_next_frame": ["KeyK+KeyL", "ArrowRight"],
        "playback.mark_in": ["KeyI"],
        "playback.mark_out": ["KeyO"],
        "playback.clear_in": ["Ctrl+Shift+KeyI", "Alt+KeyI"],
        "playback.clear_out": ["Ctrl+Shift+KeyO", "Alt+KeyO"],
        "playback.clear_in_out": ["Ctrl+Shift+KeyX", "Alt+KeyX"],
        "playback.mark_clip": ["Slash", "KeyX"],
        "playback.goto_in": ["Shift+KeyI"],
        "playback.goto_out": ["Shift+KeyO"],
        "playback.play_in_to_out": ["Ctrl+Shift+Space", "Shift+Space", "Alt+KeyK"],
        "playback.toggle_loop": ["Ctrl+KeyL"],
        "playback.append_timeline": ["Period", "KeyE"],
        "playback.step_prev": ["ArrowLeft"],
        "playback.step_next": ["ArrowRight"],
        "playback.prev_edit_point": ["ArrowUp"],
        "playback.next_edit_point": ["ArrowDown"],

        "tools.select": ["KeyV"],
        "tools.track_forward": ["KeyA"],
        "tools.track_backward": ["Shift+KeyA"],
        "tools.snapping": ["KeyS"],
        "tools.escape": ["Escape"],

        "edit.split": ["Ctrl+KeyK", "KeyC"],
        "edit.ripple_trim_head": ["KeyQ"],
        "edit.ripple_trim_tail": ["KeyW"],
        "edit.lift_delete": ["Backspace"],
        "edit.ripple_delete": ["Shift+Delete", "Alt+Backspace"],
        "edit.lift_in_out": ["Semicolon", "Alt+Delete"],
        "edit.extract_in_out": ["Quote", "Shift+Delete"],
        "edit.delete_single_stream": ["Alt+Delete"],
        "edit.unlink_av": ["Ctrl+KeyL", "KeyU"],
        "edit.nudge_left": ["Alt+ArrowLeft"],
        "edit.nudge_right": ["Alt+ArrowRight"],
        "edit.trim_in_nudge_left": ["Ctrl+Alt+ArrowLeft"],
        "edit.trim_in_nudge_right": ["Ctrl+Alt+ArrowRight"],
        "edit.trim_out_nudge_left": ["Ctrl+Shift+ArrowLeft"],
        "edit.trim_out_nudge_right": ["Ctrl+Shift+ArrowRight"],

        "markers.add_edit": ["KeyM"],
        "markers.next": ["Shift+KeyM"],
        "markers.prev": ["Ctrl+Shift+KeyM", "Alt+KeyM"],

        "ai.toggle_alternatives": ["Shift+KeyT", "KeyA"],
        "ai.accept_ghost": ["Enter", "KeyY"],
        "ai.reject_ghost": ["Delete", "KeyN"],

        "history.undo": ["Ctrl+KeyZ"],
        "history.redo": ["Ctrl+Shift+KeyZ", "Ctrl+KeyY"],
        "workspace.save": ["Ctrl+Shift+KeyS"]
    },

    // 4. DaVinci Resolve
    resolve: {
        "playback.play_pause": ["Space"],
        "playback.shuttle_reverse": ["KeyJ"],
        "playback.shuttle_stop": ["KeyK"],
        "playback.shuttle_forward": ["KeyL"],
        "playback.jog_prev_frame": ["KeyK+KeyJ", "ArrowLeft"],
        "playback.jog_next_frame": ["KeyK+KeyL", "ArrowRight"],
        "playback.mark_in": ["KeyI"],
        "playback.mark_out": ["KeyO"],
        "playback.clear_in": ["Alt+KeyI"],
        "playback.clear_out": ["Alt+KeyO"],
        "playback.clear_in_out": ["Alt+KeyX"],
        "playback.mark_clip": ["KeyX"],
        "playback.goto_in": ["Shift+KeyI"],
        "playback.goto_out": ["Shift+KeyO"],
        "playback.play_in_to_out": ["Alt+Slash", "Shift+Space"],
        "playback.toggle_loop": ["Ctrl+Slash", "Ctrl+KeyL"],
        "playback.append_timeline": ["Shift+F12", "F9", "KeyE"],
        "playback.step_prev": ["ArrowLeft"],
        "playback.step_next": ["ArrowRight"],
        "playback.prev_edit_point": ["ArrowUp"],
        "playback.next_edit_point": ["ArrowDown"],

        "tools.select": ["KeyA"],
        "tools.track_forward": ["KeyY"],
        "tools.track_backward": ["Ctrl+KeyY"],
        "tools.snapping": ["KeyN"],
        "tools.escape": ["Escape"],

        "edit.split": ["Ctrl+Backslash", "KeyB"],
        "edit.ripple_trim_head": ["Shift+BracketLeft", "KeyQ"],
        "edit.ripple_trim_tail": ["Shift+BracketRight", "KeyW"],
        "edit.lift_delete": ["Backspace"],
        "edit.ripple_delete": ["Shift+Backspace", "Delete"],
        "edit.lift_in_out": ["Backspace", "Semicolon"],
        "edit.extract_in_out": ["Shift+Backspace", "Quote"],
        "edit.delete_single_stream": ["Alt+Delete", "Alt+Backspace"],
        "edit.unlink_av": ["Ctrl+Alt+KeyL", "KeyU"],
        "edit.nudge_left": ["Comma"],
        "edit.nudge_right": ["Period"],
        "edit.trim_in_nudge_left": ["Shift+Comma"],
        "edit.trim_in_nudge_right": ["Shift+Period"],
        "edit.trim_out_nudge_left": ["Ctrl+Comma"],
        "edit.trim_out_nudge_right": ["Ctrl+Period"],

        "markers.add_edit": ["KeyM"],
        "markers.next": ["Shift+KeyM"],
        "markers.prev": ["Alt+KeyM"],

        "ai.toggle_alternatives": ["KeyT", "KeyA"],
        "ai.accept_ghost": ["Enter", "KeyY"],
        "ai.reject_ghost": ["Delete", "KeyN"],

        "history.undo": ["Ctrl+KeyZ"],
        "history.redo": ["Ctrl+Shift+KeyZ", "Ctrl+KeyY"],
        "workspace.save": ["Ctrl+Shift+KeyS"]
    },

    // 5. Apple Final Cut Pro
    finalcut: {
        "playback.play_pause": ["Space"],
        "playback.shuttle_reverse": ["KeyJ"],
        "playback.shuttle_stop": ["KeyK"],
        "playback.shuttle_forward": ["KeyL"],
        "playback.jog_prev_frame": ["KeyK+KeyJ", "ArrowLeft"],
        "playback.jog_next_frame": ["KeyK+KeyL", "ArrowRight"],
        "playback.mark_in": ["KeyI"],
        "playback.mark_out": ["KeyO"],
        "playback.clear_in": ["Alt+KeyI"],
        "playback.clear_out": ["Alt+KeyO"],
        "playback.clear_in_out": ["Alt+KeyX"],
        "playback.mark_clip": ["KeyX"],
        "playback.goto_in": ["Shift+KeyI"],
        "playback.goto_out": ["Shift+KeyO"],
        "playback.play_in_to_out": ["Alt+Slash", "Shift+Space"],
        "playback.toggle_loop": ["Cmd+KeyL", "Ctrl+KeyL"],
        "playback.append_timeline": ["KeyE"],
        "playback.step_prev": ["ArrowLeft"],
        "playback.step_next": ["ArrowRight"],
        "playback.prev_edit_point": ["ArrowUp", "BracketLeft"],
        "playback.next_edit_point": ["ArrowDown", "BracketRight"],

        "tools.select": ["KeyA"],
        "tools.track_forward": ["KeyP"],
        "tools.track_backward": ["Shift+KeyP"],
        "tools.snapping": ["KeyN"],
        "tools.escape": ["Escape"],

        "edit.split": ["Cmd+KeyB", "KeyB"],
        "edit.ripple_trim_head": ["Alt+BracketLeft", "KeyQ"],
        "edit.ripple_trim_tail": ["Alt+BracketRight", "KeyW"],
        "edit.lift_delete": ["Delete"],
        "edit.ripple_delete": ["Shift+Delete", "Backspace"],
        "edit.lift_in_out": ["Delete", "Semicolon"],
        "edit.extract_in_out": ["Shift+Delete", "Quote"],
        "edit.delete_single_stream": ["Alt+Delete"],
        "edit.unlink_av": ["Cmd+Shift+KeyS", "KeyU"],
        "edit.nudge_left": ["Comma"],
        "edit.nudge_right": ["Period"],
        "edit.trim_in_nudge_left": ["Shift+Comma"],
        "edit.trim_in_nudge_right": ["Shift+Period"],
        "edit.trim_out_nudge_left": ["Alt+Comma"],
        "edit.trim_out_nudge_right": ["Alt+Period"],

        "markers.add_edit": ["KeyM"],
        "markers.next": ["Ctrl+Quote", "Shift+KeyM"],
        "markers.prev": ["Ctrl+Semicolon", "Alt+KeyM"],

        "ai.toggle_alternatives": ["KeyY", "KeyA"],
        "ai.accept_ghost": ["Enter", "KeyY"],
        "ai.reject_ghost": ["Delete", "KeyN"],

        "history.undo": ["Ctrl+KeyZ"],
        "history.redo": ["Ctrl+Shift+KeyZ", "Ctrl+KeyY"],
        "workspace.save": ["Ctrl+Shift+KeyS"]
    }
};

const STORAGE_KEY_PRESET = "capiau_active_keymap_preset";
const STORAGE_KEY_CUSTOM = "capiau_custom_keymap";

class KeymapService {
    constructor() {
        this.activePreset = localStorage.getItem(STORAGE_KEY_PRESET) || "capiau";
        if (!KEYMAP_PRESETS[this.activePreset] && this.activePreset !== "custom") {
            this.activePreset = "capiau";
        }
        this.customBindings = this.loadCustomBindings();
        this.activeBindings = {};
        this.recalculateActiveBindings();
    }

    loadCustomBindings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_CUSTOM);
            if (raw) {
                const parsed = JSON.parse(raw);
                return typeof parsed === "object" && parsed !== null ? parsed : {};
            }
        } catch (e) {
            console.warn("[KeymapService] Falha ao carregar customBindings:", e);
        }
        return {};
    }

    saveCustomBindings() {
        try {
            localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(this.customBindings));
        } catch (e) {
            console.error("[KeymapService] Falha ao salvar customBindings:", e);
        }
    }

    saveActivePreset() {
        try {
            localStorage.setItem(STORAGE_KEY_PRESET, this.activePreset);
        } catch (e) {
            console.error("[KeymapService] Falha ao salvar activePreset:", e);
        }
    }

    recalculateActiveBindings() {
        const base = KEYMAP_PRESETS[this.activePreset] || KEYMAP_PRESETS.capiau;
        this.activeBindings = {};

        // Inicializa com a base do perfil
        COMMANDS_CATALOG.forEach(cmd => {
            const defaultCombos = base[cmd.id] || KEYMAP_PRESETS.capiau[cmd.id] || [];
            this.activeBindings[cmd.id] = Array.isArray(defaultCombos) ? [...defaultCombos] : [defaultCombos];
        });

        // Se estiver em modo custom, aplica os overrides
        if (this.activePreset === "custom") {
            Object.keys(this.customBindings).forEach(cmdId => {
                if (this.customBindings[cmdId]) {
                    this.activeBindings[cmdId] = Array.isArray(this.customBindings[cmdId])
                        ? [...this.customBindings[cmdId]]
                        : [this.customBindings[cmdId]];
                }
            });
        }
    }

    getActivePreset() {
        return this.activePreset;
    }

    setPreset(presetId) {
        if (!KEYMAP_PRESETS[presetId] && presetId !== "custom") {
            console.warn(`[KeymapService] Preset inválido: ${presetId}`);
            return false;
        }
        this.activePreset = presetId;
        this.saveActivePreset();
        this.recalculateActiveBindings();
        STATE.emit("keymapChanged", { preset: this.activePreset, bindings: this.activeBindings });
        return true;
    }

    getBindingsForCommand(commandId) {
        return this.activeBindings[commandId] || [];
    }

    getCommand(commandId) {
        return COMMANDS_CATALOG.find(c => c.id === commandId) || null;
    }

    getCategory(categoryId) {
        return COMMAND_CATEGORIES[categoryId] || null;
    }

    getReverseBindingMap() {
        const reverseMap = {};
        Object.entries(this.activeBindings).forEach(([cmdId, combos]) => {
            const cmd = this.getCommand(cmdId);
            if (!cmd) return;
            combos.forEach(combo => {
                reverseMap[combo] = cmd;
            });
        });
        return reverseMap;
    }

    setCustomBinding(commandId, keyCombos) {
        const combosArray = Array.isArray(keyCombos) ? keyCombos : [keyCombos];
        this.customBindings[commandId] = combosArray;
        this.activePreset = "custom";
        this.saveCustomBindings();
        this.saveActivePreset();
        this.recalculateActiveBindings();
        STATE.emit("keymapChanged", { preset: "custom", bindings: this.activeBindings });
    }

    resetCommandToPreset(commandId) {
        if (this.customBindings[commandId]) {
            delete this.customBindings[commandId];
            this.saveCustomBindings();
            this.recalculateActiveBindings();
            STATE.emit("keymapChanged", { preset: this.activePreset, bindings: this.activeBindings });
        }
    }

    resetAllToDefault() {
        this.customBindings = {};
        this.activePreset = "capiau";
        this.saveCustomBindings();
        this.saveActivePreset();
        this.recalculateActiveBindings();
        STATE.emit("keymapChanged", { preset: "capiau", bindings: this.activeBindings });
    }

    // ── MOTOR DE MATCHING ───────────────────────────────────────────────────

    /**
     * Normaliza um KeyboardEvent em uma string de combinação de teclas (ex: "Ctrl+Shift+KeyZ", "Space", "KeyK+KeyJ").
     */
    serializeEvent(e, isComboHolding = false, comboPrefixKey = null) {
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
        if (e.shiftKey) parts.push("Shift");
        if (e.altKey) parts.push("Alt");

        let code = e.code || e.key;

        // Trata combos como K+J ou K+L
        if (isComboHolding && comboPrefixKey) {
            return `${comboPrefixKey}+${code}`;
        }

        // Mapeamentos comuns de code
        if (parts.length > 0) {
            parts.push(code);
            return parts.join("+");
        }
        return code;
    }

    /**
     * Compara se o evento disparado corresponde a algum dos atalhos cadastrados para o commandId.
     */
    matches(e, commandId, options = {}) {
        if (!e) return false;
        const bindings = this.activeBindings[commandId];
        if (!bindings || bindings.length === 0) return false;

        const { isHoldingKey = null } = options;

        const eventCtrl = e.ctrlKey || e.metaKey;
        const eventShift = e.shiftKey;
        const eventAlt = e.altKey;
        const eventCode = e.code;
        const eventKey = e.key;

        for (const binding of bindings) {
            if (!binding) continue;

            // Se for um combo de 2 teclas normais (ex: "KeyK+KeyJ")
            if (binding.includes("+") && !binding.includes("Ctrl") && !binding.includes("Shift") && !binding.includes("Alt") && !binding.includes("Cmd")) {
                const [lead, follow] = binding.split("+");
                if (isHoldingKey === lead && (eventCode === follow || eventKey.toLowerCase() === follow.toLowerCase().replace("key", ""))) {
                    return true;
                }
                continue;
            }

            const parts = binding.split("+");
            const wantCtrl = parts.includes("Ctrl") || parts.includes("Cmd");
            const wantShift = parts.includes("Shift");
            const wantAlt = parts.includes("Alt");
            const targetKey = parts[parts.length - 1];

            // Verifica modificadores
            if (wantCtrl !== eventCtrl) continue;
            if (wantShift !== eventShift) continue;
            if (wantAlt !== eventAlt) continue;

            // Verifica tecla principal por code ou por key
            if (eventCode === targetKey || eventKey === targetKey) {
                return true;
            }

            // Normalização de letras (ex: targetKey="KeyA" ou "KeyZ" vs eventCode="KeyA", e.key="a" ou "A")
            if (targetKey.startsWith("Key") && eventCode === targetKey) {
                return true;
            }
            if (targetKey.startsWith("Key") && eventKey.toLowerCase() === targetKey.substring(3).toLowerCase()) {
                return true;
            }

            // Normalização de setas e especiais
            if (targetKey === "ArrowLeft" && (eventCode === "ArrowLeft" || eventKey === "ArrowLeft")) return true;
            if (targetKey === "ArrowRight" && (eventCode === "ArrowRight" || eventKey === "ArrowRight")) return true;
            if (targetKey === "ArrowUp" && (eventCode === "ArrowUp" || eventKey === "ArrowUp")) return true;
            if (targetKey === "ArrowDown" && (eventCode === "ArrowDown" || eventKey === "ArrowDown")) return true;
            if (targetKey === "Space" && (eventCode === "Space" || eventKey === " " || eventKey === "Spacebar")) return true;
            if (targetKey === "Escape" && (eventCode === "Escape" || eventKey === "Escape" || eventKey === "Esc")) return true;
            if (targetKey === "Enter" && (eventCode === "Enter" || eventKey === "Enter")) return true;
            if (targetKey === "Delete" && (eventCode === "Delete" || eventKey === "Delete")) return true;
            if (targetKey === "Backspace" && (eventCode === "Backspace" || eventKey === "Backspace")) return true;
            if (targetKey === "BracketLeft" && (eventCode === "BracketLeft" || eventKey === "[")) return true;
            if (targetKey === "BracketRight" && (eventCode === "BracketRight" || eventKey === "]")) return true;
            if (targetKey === "Comma" && (eventCode === "Comma" || eventKey === ",")) return true;
            if (targetKey === "Period" && (eventCode === "Period" || eventKey === ".")) return true;
            if (targetKey === "F10" && (eventCode === "F10" || eventKey === "F10")) return true;
            if (targetKey === "F12" && (eventCode === "F12" || eventKey === "F12")) return true;
            if (targetKey === "F9" && (eventCode === "F9" || eventKey === "F9")) return true;
            if (targetKey === "NumpadMultiply" && (eventCode === "NumpadMultiply" || eventKey === "*")) return true;
            if (targetKey === "Backslash" && (eventCode === "Backslash" || eventKey === "\\")) return true;
        }

        return false;
    }

    // ── FORMATAÇÃO HUMANA DE ATALHOS ────────────────────────────────────────

    /**
     * Converte um código técnico em formato amigável para exibição em badges (ex: "KeyZ" -> "Z", "BracketLeft" -> "[").
     */
    formatKeySingle(key) {
        if (!key) return "";
        if (key.startsWith("Key")) return key.substring(3).toUpperCase();
        if (key.startsWith("Digit")) return key.substring(5);
        if (key === "ArrowLeft") return "←";
        if (key === "ArrowRight") return "→";
        if (key === "ArrowUp") return "↑";
        if (key === "ArrowDown") return "↓";
        if (key === "Space") return "Espaço";
        if (key === "Escape") return "Esc";
        if (key === "Delete") return "Del";
        if (key === "Backspace") return "Backspace";
        if (key === "BracketLeft") return "[";
        if (key === "BracketRight") return "]";
        if (key === "Comma") return ",";
        if (key === "Period") return ".";
        if (key === "Backslash") return "\\";
        if (key === "NumpadMultiply") return "Num *";
        return key;
    }

    formatCombo(combo) {
        if (!combo) return "";
        const parts = combo.split("+");
        return parts.map(p => this.formatKeySingle(p)).join(" + ");
    }

    getShortcutDisplay(commandId) {
        const bindings = this.activeBindings[commandId] || [];
        if (bindings.length === 0) return "Nenhum";
        return bindings.map(b => this.formatCombo(b)).join(" ou ");
    }

    getShortcutBadgesHTML(commandId) {
        const bindings = this.activeBindings[commandId] || [];
        if (bindings.length === 0) {
            return `<span style="color: var(--text-muted); font-size: 11px; font-style: italic;">Nenhum</span>`;
        }
        return bindings.map(b => {
            const formatted = this.formatCombo(b);
            return `<kbd class="keymap-badge" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; color: #fff; display: inline-block;">${formatted}</kbd>`;
        }).join(" <span style='color:var(--text-muted); font-size:10px;'>/</span> ");
    }

    // ── CONFLITOS ───────────────────────────────────────────────────────────

    findConflicts(targetCombo, currentCommandId = null) {
        const conflicts = [];
        const normalizedTarget = this.formatCombo(targetCombo);

        Object.keys(this.activeBindings).forEach(cmdId => {
            if (cmdId === currentCommandId) return;
            const combos = this.activeBindings[cmdId] || [];
            combos.forEach(c => {
                if (this.formatCombo(c) === normalizedTarget) {
                    const meta = COMMANDS_CATALOG.find(x => x.id === cmdId);
                    if (meta) {
                        conflicts.push(meta);
                    }
                }
            });
        });
        return conflicts;
    }

    // ── EXPORTAÇÃO / IMPORTAÇÃO ─────────────────────────────────────────────

    exportJSON() {
        const payload = {
            version: "1.0",
            timestamp: new Date().toISOString(),
            preset: this.activePreset,
            customBindings: this.customBindings
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `capiau-keymap-${this.activePreset}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    importJSON(jsonString) {
        try {
            const parsed = typeof jsonString === "string" ? JSON.parse(jsonString) : jsonString;
            if (!parsed || typeof parsed !== "object") throw new Error("JSON inválido");

            const customData = parsed.customBindings || parsed.customKeymap;
            if (customData && typeof customData === "object") {
                this.customBindings = { ...customData };
            }
            const presetVal = parsed.preset || parsed.activePreset;
            if (presetVal && (KEYMAP_PRESETS[presetVal] || presetVal === "custom")) {
                this.activePreset = presetVal;
            } else {
                this.activePreset = "custom";
            }
            this.saveCustomBindings();
            this.saveActivePreset();
            this.recalculateActiveBindings();
            STATE.emit("keymapChanged", { preset: this.activePreset, bindings: this.activeBindings });
            return { success: true };
        } catch (e) {
            console.error("[KeymapService] Erro ao importar keymap JSON:", e);
            return { success: false, error: e.message };
        }
    }
}

export const KEYMAP_SERVICE = new KeymapService();
if (typeof window !== "undefined") {
    window.KEYMAP_SERVICE = KEYMAP_SERVICE;
}
