(function () {
    var ROOT_CLASS = "research-bg-lowcost";
    var STYLE_ID = "research-bg-lowcost-style";

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;

        var style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent =
            "." + ROOT_CLASS + "{" +
            "position:fixed !important;inset:0 !important;z-index:0 !important;pointer-events:none !important;overflow:hidden;" +
            "background:linear-gradient(180deg,#deebf2 0%,#e4edf0 38%,#e9deea 100%);" +
            "}" +
            "." + ROOT_CLASS + " .bg-glow{" +
            "position:absolute;width:68vmax;height:68vmax;border-radius:50%;" +
            "transform:translate3d(0,0,0);will-change:transform,opacity;" +
            "}" +
            "." + ROOT_CLASS + " .bg-glow.blue{" +
            "left:-22vmax;top:-20vmax;" +
            "background:radial-gradient(circle at 35% 35%,rgba(116,175,197,0.35) 0%,rgba(116,175,197,0.19) 44%,rgba(116,175,197,0) 76%);" +
            "animation:bgBlueMove 52s ease-in-out infinite alternate;" +
            "}" +
            "." + ROOT_CLASS + " .bg-glow.pink{" +
            "right:-20vmax;bottom:-24vmax;" +
            "background:radial-gradient(circle at 55% 45%,rgba(203,165,196,0.34) 0%,rgba(203,165,196,0.18) 42%,rgba(203,165,196,0) 74%);" +
            "animation:bgPinkMove 64s ease-in-out infinite alternate;" +
            "}" +
            "." + ROOT_CLASS + " .bg-glow.amber{" +
            "right:-18vmax;top:-22vmax;" +
            "background:radial-gradient(circle at 48% 52%,rgba(226,207,151,0.32) 0%,rgba(226,207,151,0.17) 42%,rgba(226,207,151,0) 74%);" +
            "animation:bgAmberMove 78s ease-in-out infinite alternate;" +
            "}" +
            "@keyframes bgBlueMove{0%{transform:translate3d(0,0,0) scale(1);}100%{transform:translate3d(9vmax,8vmax,0) scale(1.08);}}" +
            "@keyframes bgPinkMove{0%{transform:translate3d(0,0,0) scale(1);}100%{transform:translate3d(-8vmax,-10vmax,0) scale(1.09);}}" +
            "@keyframes bgAmberMove{0%{transform:translate3d(0,0,0) scale(1);}100%{transform:translate3d(-7vmax,7vmax,0) scale(1.06);}}" +
            "@media (prefers-reduced-motion: reduce){" +
            "." + ROOT_CLASS + " .bg-glow{animation:none !important;}" +
            "}";
        document.head.appendChild(style);
    }

    function buildBackground() {
        if (document.querySelector("." + ROOT_CLASS)) return;

        // Clean old high-cost canvas if it exists from stale cache/session.
        var oldCanvas = document.querySelector(".research-bg-canvas");
        if (oldCanvas && oldCanvas.parentNode) oldCanvas.parentNode.removeChild(oldCanvas);

        var root = document.createElement("div");
        root.className = ROOT_CLASS;
        root.setAttribute("aria-hidden", "true");

        var blue = document.createElement("div");
        blue.className = "bg-glow blue";
        var pink = document.createElement("div");
        pink.className = "bg-glow pink";
        var amber = document.createElement("div");
        amber.className = "bg-glow amber";

        root.appendChild(blue);
        root.appendChild(pink);
        root.appendChild(amber);
        document.body.appendChild(root);
    }

    function init() {
        injectStyle();
        buildBackground();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();