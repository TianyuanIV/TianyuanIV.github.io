(function () {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const num = parseInt(full, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function mixColor(a, b, t) {
    return {
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t)
    };
  }

  function colorRgba(c, alpha) {
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + alpha + ")";
  }

  function clipPolygonHalfPlane(poly, nx, ny, c) {
    const out = [];
    const eps = 1e-7;
    if (!poly || poly.length === 0) return out;

    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = nx * a.x + ny * a.y - c;
      const db = nx * b.x + ny * b.y - c;
      const aIn = da <= eps;
      const bIn = db <= eps;

      if (aIn && bIn) {
        out.push({ x: b.x, y: b.y });
      } else if (aIn && !bIn) {
        const t = da / (da - db);
        out.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t
        });
      } else if (!aIn && bIn) {
        const t = da / (da - db);
        out.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t
        });
        out.push({ x: b.x, y: b.y });
      }
    }

    return out;
  }

  function initBackground() {
    // Shared single background animation across pages.
    if (document.querySelector(".research-bg-canvas")) return;

    const canvas = document.createElement("canvas");
    canvas.className = "research-bg-canvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const anchors = [hexToRgb("#74afc5"), hexToRgb("#cba5c4"), hexToRgb("#e2cf97")];
    const palettes = [
      [hexToRgb("#87bbcf"), hexToRgb("#d2b2cb"), hexToRgb("#e4d29f")],
      [hexToRgb("#7eaec4"), hexToRgb("#d8b5d1"), hexToRgb("#e7d9ac")],
      [hexToRgb("#94c4d5"), hexToRgb("#caa5c3"), hexToRgb("#e8d7a6")]
    ];

    const state = {
      width: 0,
      height: 0,
      dpr: 1,
      points: [],
      rafId: 0
    };

    function buildPoints() {
      const area = state.width * state.height;
      const count = clamp(Math.round(area / 110000), 18, 34);
      const margin = 120;
      state.points = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * state.width,
        y: Math.random() * state.height,
        vx: (Math.random() - 0.5) * 0.045,
        vy: (Math.random() - 0.5) * 0.04,
        phaseA: Math.random() * Math.PI * 2,
        phaseB: Math.random() * Math.PI * 2,
        wobble: 8 + Math.random() * 10,
        margin: margin,
        colorA: i % anchors.length,
        colorB: (i + 1) % anchors.length
      }));
    }

    function resize() {
      state.width = window.innerWidth;
      state.height = window.innerHeight;
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(state.width * state.dpr));
      canvas.height = Math.max(1, Math.floor(state.height * state.dpr));
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      buildPoints();
    }

    function updatePoints(delta, time) {
      const speedScale = Math.min(2.3, Math.max(0.7, delta));
      for (const p of state.points) {
        p.x += p.vx * speedScale;
        p.y += p.vy * speedScale;

        const m = p.margin;
        if (p.x < -m) p.x = state.width + m;
        if (p.x > state.width + m) p.x = -m;
        if (p.y < -m) p.y = state.height + m;
        if (p.y > state.height + m) p.y = -m;

        p.cx = p.x + Math.cos(time * 0.00022 + p.phaseA) * p.wobble;
        p.cy = p.y + Math.sin(time * 0.00019 + p.phaseB) * p.wobble * 0.85;
      }
    }

    function drawGradient(time) {
      const t = (time * 0.00003) % palettes.length;
      const i0 = Math.floor(t);
      const i1 = (i0 + 1) % palettes.length;
      const f = t - i0;

      const c0 = mixColor(palettes[i0][0], palettes[i1][0], f);
      const c1 = mixColor(palettes[i0][1], palettes[i1][1], f);
      const c2 = mixColor(palettes[i0][2], palettes[i1][2], f);

      const x1 = state.width * (0.5 + 0.4 * Math.cos(time * 0.00006));
      const y1 = state.height * (0.5 + 0.34 * Math.sin(time * 0.000055));
      const x2 = state.width - x1;
      const y2 = state.height - y1;

      ctx.clearRect(0, 0, state.width, state.height);
      ctx.fillStyle = "#deebf2";
      ctx.fillRect(0, 0, state.width, state.height);

      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, colorRgba(c0, 0.43));
      grad.addColorStop(0.52, colorRgba(c1, 0.35));
      grad.addColorStop(1, colorRgba(c2, 0.39));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, state.width, state.height);

      const creamGlow = ctx.createRadialGradient(
        state.width * 0.88,
        state.height * 0.06,
        0,
        state.width * 0.88,
        state.height * 0.06,
        Math.max(state.width, state.height) * 0.42
      );
      creamGlow.addColorStop(0, "rgba(228,206,146,0.26)");
      creamGlow.addColorStop(1, "rgba(234,226,200,0)");
      ctx.fillStyle = creamGlow;
      ctx.fillRect(0, 0, state.width, state.height);
    }

    function drawVoronoi(time) {
      const bbox = [
        { x: 0, y: 0 },
        { x: state.width, y: 0 },
        { x: state.width, y: state.height },
        { x: 0, y: state.height }
      ];

      for (let i = 0; i < state.points.length; i += 1) {
        const s = state.points[i];
        let poly = bbox.slice();

        for (let j = 0; j < state.points.length; j += 1) {
          if (i === j) continue;
          const q = state.points[j];
          const nx = q.cx - s.cx;
          const ny = q.cy - s.cy;
          const c = 0.5 * (q.cx * q.cx + q.cy * q.cy - s.cx * s.cx - s.cy * s.cy);
          poly = clipPolygonHalfPlane(poly, nx, ny, c);
          if (poly.length === 0) break;
        }

        if (poly.length < 3) continue;
        const blend = 0.5 + 0.5 * Math.sin(time * 0.00022 + s.phaseA * 0.7);
        const color = mixColor(anchors[s.colorA], anchors[s.colorB], blend);

        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let k = 1; k < poly.length; k += 1) {
          ctx.lineTo(poly[k].x, poly[k].y);
        }
        ctx.closePath();
        ctx.fillStyle = colorRgba(color, 0.2);
        ctx.fill();
        ctx.strokeStyle = "rgba(63, 80, 94, 0.24)";
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
    }

    function drawSitePoints() {
      for (const p of state.points) {
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, 1.35, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(61, 89, 110, 0.44)";
        ctx.fill();
      }
    }

    let prevTime = performance.now();
    function frame(now) {
      const delta = (now - prevTime) / 16.6667;
      prevTime = now;

      drawGradient(now);
      updatePoints(delta, now);
      drawVoronoi(now);
      drawSitePoints();

      state.rafId = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize, { passive: true });
    state.rafId = requestAnimationFrame(frame);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
      } else if (!document.hidden && !state.rafId) {
        prevTime = performance.now();
        state.rafId = requestAnimationFrame(frame);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBackground);
  } else {
    initBackground();
  }
})();
