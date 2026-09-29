// Aplica o tema da interface antes do primeiro paint (script clássico, síncrono, no <head>).
// Plano: docs/PLANO_TEMA_NEUTRO.md. O estado calculado ({ theme, vars }) vem do cache local, gravado
// por js/themeManager.js a partir das Configurações → Aparência; sem cache, Neutro.
// Também mantém as janelas destacadas em dia: qualquer gravação do cache em outra janela reaplica aqui.
(function () {
    var KEY = "capiau.themeState";
    var THEMES = { neutro: 1, classico: 1, custom: 1 };
    var applied = [];

    function read() {
        try {
            var st = JSON.parse(localStorage.getItem(KEY) || "null");
            if (st && typeof st === "object") return st;
        } catch (e) { /* sem storage ou JSON ruim: padrão */ }
        return { theme: "neutro", vars: {} };
    }

    function apply(state) {
        var root = document.documentElement;
        var theme = state && THEMES[state.theme] ? state.theme : "neutro";
        root.setAttribute("data-theme", theme);
        for (var i = 0; i < applied.length; i++) root.style.removeProperty(applied[i]);
        applied = [];
        var vars = (state && state.vars) || {};
        for (var name in vars) {
            if (Object.prototype.hasOwnProperty.call(vars, name) && name.indexOf("--") === 0) {
                root.style.setProperty(name, String(vars[name]));
                applied.push(name);
            }
        }
        try { window.dispatchEvent(new CustomEvent("capiau:theme-applied", { detail: state })); } catch (e) { /* navegador antigo */ }
    }

    window.CapiauTheme = { KEY: KEY, read: read, apply: apply };
    apply(read());
    window.addEventListener("storage", function (e) { if (e.key === KEY) apply(read()); });
})();
