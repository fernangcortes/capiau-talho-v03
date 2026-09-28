// Tokens de tema (--t-*) para quem desenha em canvas, onde o CSS não alcança.
// Mesma regra do CSS: se o preset ativo não define o token (Clássico), vale a cor original passada
// como fallback. Plano: docs/PLANO_TEMA_NEUTRO.md.

const cache = new Map();

export const THEME_CHANGED_EVENT = "capiau:theme-changed";

export function themeColor(token, fallback) {
    if (!cache.has(token)) {
        // Sem DOM (autotestes em Node) vale o fallback, como no Clássico.
        if (typeof getComputedStyle !== "function" || typeof document === "undefined") return fallback;
        const v = getComputedStyle(document.documentElement).getPropertyValue("--t-" + token).trim();
        cache.set(token, v || null);
    }
    return cache.get(token) || fallback;
}

// Chamar depois de trocar o preset ou os valores dos tokens: limpa o cache e avisa os canvas.
export function notifyThemeChanged() {
    cache.clear();
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT));
}

// O js/themeBoot.js avisa quando aplica um tema (nesta janela ou vindo de outra): recalcula os canvas.
if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("capiau:theme-applied", () => notifyThemeChanged());
}
