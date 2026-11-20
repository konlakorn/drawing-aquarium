// The hand-drawn underwater scene. A static layer is painted once per resize; plants, light
// rays, drifting specks and bubbles are drawn every frame.

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SAND_TOP = 0.84;

const PLANT_COLOURS = ['#2fa36b', '#45c07a', '#1f8a5c', '#7ccf5a', '#2b9b8f'];

export function createScene() {
  const rand = seeded(20261120);
  const plants = Array.from({ length: 9 }, (_, i) => ({
    x: (i + 0.3 + rand() * 0.4) / 9,
    height: 0.16 + rand() * 0.22,
    blades: 3 + Math.floor(rand() * 3),
    colour: PLANT_COLOURS[Math.floor(rand() * PLANT_COLOURS.length)],
    phase: rand() * Math.PI * 2,
    front: i % 4 === 1,
  }));
  const rocks = Array.from({ length: 6 }, () => ({
    x: rand(), w: 0.05 + rand() * 0.08, h: 0.04 + rand() * 0.06, tone: rand(),
  }));
  const specks = Array.from({ length: 60 }, () => ({ x: rand(), y: rand(), r: 0.6 + rand() * 1.6, s: 0.2 + rand() }));
  const rays = Array.from({ length: 6 }, (_, i) => ({ x: (i + rand()) / 6, w: 0.04 + rand() * 0.07, phase: rand() * 6 }));
  const bubbles = [];
  let staticLayer = null;

  function paintStatic(w, h, dpr) {
    staticLayer = document.createElement('canvas');
    staticLayer.width = Math.round(w * dpr);
    staticLayer.height = Math.round(h * dpr);
    const g = staticLayer.getContext('2d');
    g.scale(dpr, dpr);

    const water = g.createLinearGradient(0, 0, 0, h);
    water.addColorStop(0, '#6fdcec');
    water.addColorStop(0.35, '#2aa9cc');
    water.addColorStop(0.8, '#14769f');
    water.addColorStop(1, '#0d5a82');
    g.fillStyle = water;
    g.fillRect(0, 0, w, h);

    g.fillStyle = 'rgba(8, 70, 105, 0.35)';
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 40) {
      g.lineTo(x, h * (0.72 + 0.05 * Math.sin(x / w * 7 + 1) + 0.03 * Math.sin(x / w * 17)));
    }
    g.lineTo(w, h);
    g.fill();

    const sandTop = h * SAND_TOP;
    const sand = g.createLinearGradient(0, sandTop, 0, h);
    sand.addColorStop(0, '#f6dca6');
    sand.addColorStop(1, '#d9b36e');
    g.fillStyle = sand;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 60) g.lineTo(x, sandTop + h * 0.015 * Math.sin(x / w * 11) + h * 0.01 * Math.sin(x / w * 29));
    g.lineTo(w, h);
    g.fill();

    const r = seeded(7);
    g.fillStyle = 'rgba(160, 118, 60, 0.35)';
    for (let i = 0; i < 260; i++) {
      g.beginPath();
      g.arc(r() * w, sandTop + h * 0.03 + r() * (h - sandTop), 1 + r() * 2.2, 0, Math.PI * 2);
      g.fill();
    }

    for (const rock of rocks) {
      const rx = rock.x * w, rw = rock.w * w, rh = rock.h * h, base = sandTop + h * 0.03;
      g.fillStyle = rock.tone > 0.5 ? '#6f7f8c' : '#857a8e';
      g.beginPath();
      g.ellipse(rx, base, rw / 2, rh, 0, Math.PI, 0);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.ellipse(rx - rw * 0.12, base - rh * 0.55, rw * 0.22, rh * 0.22, -0.4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(30, 40, 60, 0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(rx, base, rw / 2, rh, 0, Math.PI, 0);
      g.stroke();
    }

    const shell = (x, y, s) => {
      g.fillStyle = '#ffb3a0';
      g.strokeStyle = '#d9735a';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, s, Math.PI, 0);
      g.closePath();
      g.fill();
      g.stroke();
      for (let k = -2; k <= 2; k++) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + k * s * 0.4, y - s * 0.9);
        g.stroke();
      }
    };
    shell(w * 0.23, h * 0.95, h * 0.018);
    shell(w * 0.61, h * 0.93, h * 0.014);

    g.fillStyle = '#ff9f43';
    g.strokeStyle = '#d9732a';
    g.lineWidth = 2;
    const sx = w * 0.42, sy = h * 0.955, sr = h * 0.022;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 ? sr * 0.45 : sr;
      g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
  }

  function drawPlant(ctx, p, w, h, t) {
    const baseY = h * (SAND_TOP + 0.03);
    ctx.strokeStyle = p.colour;
    ctx.lineCap = 'round';
    for (let b = 0; b < p.blades; b++) {
      const bx = p.x * w + (b - p.blades / 2) * w * 0.008;
      const len = p.height * h * (0.7 + 0.3 * ((b * 37) % 10) / 10);
      const sway = Math.sin(t * 0.9 + p.phase + b * 0.7) * w * 0.018;
      ctx.lineWidth = Math.max(4, w * 0.007);
      ctx.beginPath();
      ctx.moveTo(bx, baseY);
      ctx.bezierCurveTo(bx + sway * 0.2, baseY - len * 0.35, bx - sway * 0.6, baseY - len * 0.7, bx + sway, baseY - len);
      ctx.stroke();
    }
  }

  function addBubble(x, y, r, vy, life = Infinity) {
    bubbles.push({ x, y, r, vy, life, age: 0, wobble: Math.random() * 6 });
  }

  return {
    resize: paintStatic,

    burst(x, y, size) {
      for (let i = 0; i < 26; i++) {
        addBubble(x + (Math.random() - 0.5) * size, y + (Math.random() - 0.5) * size * 0.6, 3 + Math.random() * size * 0.06, 60 + Math.random() * 120, 3 + Math.random() * 2);
      }
    },

    trail(x, y, size) {
      if (Math.random() < 0.3) addBubble(x, y, 2 + Math.random() * size * 0.03, 50 + Math.random() * 50, 2.5);
    },

    drawBack(ctx, w, h, t, dt) {
      ctx.drawImage(staticLayer, 0, 0, w, h);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const ray of rays) {
        const a = 0.05 + 0.04 * Math.sin(t * 0.35 + ray.phase);
        const grad = ctx.createLinearGradient(0, 0, 0, h * 0.85);
        grad.addColorStop(0, `rgba(255,255,240,${a})`);
        grad.addColorStop(1, 'rgba(255,255,240,0)');
        ctx.fillStyle = grad;
        const x = ray.x * w + Math.sin(t * 0.12 + ray.phase) * w * 0.02;
        ctx.beginPath();
        ctx.moveTo(x - ray.w * w * 0.3, 0);
        ctx.lineTo(x + ray.w * w * 0.3, 0);
        ctx.lineTo(x + ray.w * w * 1.4 - w * 0.08, h * 0.85);
        ctx.lineTo(x - ray.w * w * 0.6 - w * 0.08, h * 0.85);
        ctx.fill();
      }
      ctx.restore();

      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (const s of specks) {
        s.y -= dt * 0.004 * s.s;
        if (s.y < 0) s.y += SAND_TOP;
        ctx.beginPath();
        ctx.arc(s.x * w + Math.sin(t * 0.3 + s.y * 20) * 6, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const p of plants) if (!p.front) drawPlant(ctx, p, w, h, t);

      if (Math.random() < dt * 1.6) addBubble(Math.random() * w, h * SAND_TOP, 2 + Math.random() * 5, 30 + Math.random() * 40);
    },

    drawFront(ctx, w, h, t, dt) {
      for (const p of plants) if (p.front) drawPlant(ctx, p, w, h, t);

      ctx.lineWidth = 1.6;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.age += dt;
        b.y -= b.vy * dt;
        b.x += Math.sin(t * 2 + b.wobble) * 0.4;
        if (b.y < -20 || b.age > b.life) { bubbles.splice(i, 1); continue; }
        const fade = Number.isFinite(b.life) ? Math.max(0, 1 - b.age / b.life) : 1;
        ctx.strokeStyle = `rgba(255,255,255,${0.75 * fade})`;
        ctx.fillStyle = `rgba(255,255,255,${0.12 * fade})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.8 * fade})`;
        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }

      const surface = ctx.createLinearGradient(0, 0, 0, h * 0.05);
      surface.addColorStop(0, 'rgba(255,255,255,0.35)');
      surface.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = surface;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let x = 0; x <= w; x += w / 30) ctx.lineTo(x, h * 0.03 + Math.sin(x / w * 14 + t * 1.2) * h * 0.006);
      ctx.lineTo(w, 0);
      ctx.fill();
    },
  };
}
