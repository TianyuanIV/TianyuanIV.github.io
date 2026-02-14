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

  function initBackground() {
    const canvas = document.createElement("canvas");
    canvas.className = "research-bg-canvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const palettes = [
      [hexToRgb("#2f5ea8"), hexToRgb("#1f8a7a"), hexToRgb("#b88231")],
      [hexToRgb("#3568b8"), hexToRgb("#2a8f6d"), hexToRgb("#b06f2f")],
      [hexToRgb("#2a76a9"), hexToRgb("#1d857d"), hexToRgb("#c09338")]
    ];

    const state = {
      width: 0,
      height: 0,
      dpr: 1,
      shapes: [],
      particles: [],
      rafId: 0
    };

    function buildShapes() {
      const area = state.width * state.height;
      const count = clamp(Math.round(area / 260000), 4, 10);
      const colors = [hexToRgb("#2f5ea8"), hexToRgb("#2f8f73"), hexToRgb("#c5882a")];
      state.shapes = Array.from({ length: count }, (_, i) => {
        const radius = 80 + Math.random() * 110;
        return {
          x: Math.random() * state.width,
          y: Math.random() * state.height,
          vx: (Math.random() - 0.5) * 0.09,
          vy: (Math.random() - 0.5) * 0.08,
          radius: radius,
          phase: Math.random() * Math.PI * 2,
          rotate: Math.random() * Math.PI * 2,
          rotateSpeed: (Math.random() - 0.5) * 0.00045,
          wobble: 0.14 + Math.random() * 0.12,
          points: 3 + (i % 4),
          color: colors[i % colors.length],
          alpha: 0.06 + Math.random() * 0.06
        };
      });
    }

    function buildParticles() {
      const area = state.width * state.height;
      const count = clamp(Math.round(area / 18000), 45, 130);
      state.particles = Array.from({ length: count }, () => ({
        x: Math.random() * state.width,
        y: Math.random() * state.height,
        vx: (Math.random() - 0.5) * 0.24,
        vy: (Math.random() - 0.5) * 0.24,
        r: 0.8 + Math.random() * 1.7
      }));
    }

    function resize() {
      state.width = window.innerWidth;
      state.height = window.innerHeight;
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(state.width * state.dpr));
      canvas.height = Math.max(1, Math.floor(state.height * state.dpr));
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      buildShapes();
      buildParticles();
    }

    function updateShapes(delta) {
      const margin = 180;
      for (const s of state.shapes) {
        s.x += s.vx * delta;
        s.y += s.vy * delta;
        s.rotate += s.rotateSpeed * delta;

        if (s.x < -margin) s.x = state.width + margin;
        if (s.x > state.width + margin) s.x = -margin;
        if (s.y < -margin) s.y = state.height + margin;
        if (s.y > state.height + margin) s.y = -margin;
      }
    }

    function updateParticles(delta) {
      const margin = 35;
      for (const p of state.particles) {
        p.x += p.vx * delta;
        p.y += p.vy * delta;

        if (p.x < -margin) p.x = state.width + margin;
        if (p.x > state.width + margin) p.x = -margin;
        if (p.y < -margin) p.y = state.height + margin;
        if (p.y > state.height + margin) p.y = -margin;
      }
    }

    function drawGradient(time) {
      const t = (time * 0.000035) % palettes.length;
      const i0 = Math.floor(t);
      const i1 = (i0 + 1) % palettes.length;
      const f = t - i0;

      const c0 = mixColor(palettes[i0][0], palettes[i1][0], f);
      const c1 = mixColor(palettes[i0][1], palettes[i1][1], f);
      const c2 = mixColor(palettes[i0][2], palettes[i1][2], f);

      ctx.clearRect(0, 0, state.width, state.height);
      ctx.fillStyle = "#eaf2fb";
      ctx.fillRect(0, 0, state.width, state.height);

      const x1 = state.width * (0.5 + 0.42 * Math.cos(time * 0.00007));
      const y1 = state.height * (0.5 + 0.38 * Math.sin(time * 0.000065));
      const x2 = state.width - x1;
      const y2 = state.height - y1;
      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, colorRgba(c0, 0.32));
      grad.addColorStop(0.5, colorRgba(c1, 0.26));
      grad.addColorStop(1, colorRgba(c2, 0.29));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, state.width, state.height);
    }

    function drawShapes(time) {
      for (const s of state.shapes) {
        ctx.beginPath();
        for (let i = 0; i < s.points; i += 1) {
          const angle = s.rotate + (Math.PI * 2 * i) / s.points;
          const wobble = 1 + s.wobble * Math.sin(time * 0.001 * 0.42 + s.phase + i * 1.37);
          const rr = s.radius * wobble;
          const px = s.x + Math.cos(angle) * rr;
          const py = s.y + Math.sin(angle) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = colorRgba(s.color, s.alpha);
        ctx.fill();
      }
    }

    function drawParticles() {
      const maxDist = 130;
      const maxDistSq = maxDist * maxDist;

      for (let i = 0; i < state.particles.length; i += 1) {
        const p1 = state.particles[i];
        for (let j = i + 1; j < state.particles.length; j += 1) {
          const p2 = state.particles[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > maxDistSq) continue;
          const alpha = 1 - d2 / maxDistSq;
          ctx.strokeStyle = "rgba(34,118,142," + (alpha * 0.22).toFixed(3) + ")";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }

      for (const p of state.particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(22,98,126,0.35)";
        ctx.fill();
      }
    }

    let prevTime = performance.now();
    function frame(now) {
      const delta = Math.min(2.2, (now - prevTime) / 16.6667);
      prevTime = now;

      drawGradient(now);
      updateShapes(delta);
      drawShapes(now);
      updateParticles(delta);
      drawParticles();

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
