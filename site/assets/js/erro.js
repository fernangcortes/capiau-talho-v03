/* 404: o timecode do monitor corre enquanto a página está visível. */
(() => {
    "use strict";
    const tc = document.querySelector("[data-erro-tc]");
    const monitor = document.querySelector(".erro__monitor");
    if (!tc || !monitor || !window.Talho) return;
    const START_S = (4 * 24 + 4) / 24; // começa em 00:00:04:04, o "404" do monitor
    Talho.loop(monitor, (t) => {
        tc.textContent = Talho.timecode(START_S + t);
    });
})();
