// Aplica o tema da interface antes do primeiro paint (script clássico, síncrono, no <head>).
// Plano: docs/PLANO_TEMA_NEUTRO.md. A escolha salva vem do cache local; sem cache, Neutro.
(function () {
    var theme = "neutro";
    try {
        var saved = localStorage.getItem("capiau.theme");
        if (saved === "neutro" || saved === "classico" || saved === "custom") theme = saved;
    } catch (e) { /* sem storage: padrão */ }
    document.documentElement.setAttribute("data-theme", theme);
})();
