import { createScene } from './scene.js';
import { fishAlpha, reconcile, stepSchool } from './school.js';
import { createSound } from './sound.js';

const STRIPS = 22;
const canvas = document.getElementById('tank');
const ctx = canvas.getContext('2d');
const emptyNote = document.getElementById('empty');
const offlineNote = document.getElementById('offline');
const soundButton = document.getElementById('sound');

const scene = createScene();
const sound = createSound();
const school = new Map();
const images = new Map();
let W = 0, H = 0;

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scene.resize(W, H, dpr);
}
window.addEventListener('resize', resize);
resize();

function loadImage(id) {
  const img = new Image();
  img.decoding = 'async';
  img.src = `/fish/${id}.png`;
  img.onload = () => {
    const f = school.get(id);
    if (f?.phase.kind !== 'entering') return;
    const y = f.y * H;
    scene.burst(f.x < 0.5 ? W * 0.03 : W * 0.97, y, W * f.size);
    sound.entrance();
  };
  images.set(id, img);
}

const isReady = (id) => {
  const img = images.get(id);
  return Boolean(img?.complete && img.naturalWidth);
};

function applySnapshot(fish, initial) {
  reconcile(school, fish, { initial, now: performance.now() });
  for (const f of school.values()) if (!images.has(f.id)) loadImage(f.id);
  emptyNote.hidden = fish.length > 0;
}

function connect() {
  let initial = true;
  const events = new EventSource('/api/events');
  events.onmessage = (e) => {
    applySnapshot(JSON.parse(e.data).fish, initial);
    initial = false;
    offlineNote.hidden = true;
  };
  events.onerror = () => {
    offlineNote.hidden = events.readyState === EventSource.OPEN;
  };
}
connect();

soundButton.addEventListener('click', async () => {
  const on = await sound.toggle();
  soundButton.setAttribute('aria-pressed', String(on));
  soundButton.setAttribute('aria-label', on ? 'ปิดเสียง' : 'เปิดเสียง');
});

function fishSize(f, img) {
  let w = W * f.size;
  let h = (w * img.naturalHeight) / img.naturalWidth;
  const maxH = H * 0.28;
  if (h > maxH) {
    w *= maxH / h;
    h = maxH;
  }
  return { w, h };
}

// Drawn in vertical strips displaced by a travelling sine wave; the tail end swings most.
function drawFish(f, img, now) {
  const { w, h } = fishSize(f, img);
  const alpha = fishAlpha(f, now);
  const cx = f.x * W;
  const cy = f.y * H + Math.sin(f.bob) * H * 0.008;
  const sourceDir = f.facing === 'right' ? 1 : -1;
  const tilt = Math.max(-0.3, Math.min(0.3, (f.vy / (Math.abs(f.vx) + 0.01)) * 0.25)) * Math.sign(f.dir || 1);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.scale(f.dir * sourceDir, 1);
  const sw = img.naturalWidth / STRIPS;
  const dw = w / STRIPS;
  for (let i = 0; i < STRIPS; i++) {
    const u = (i + 0.5) / STRIPS;
    const tailness = sourceDir === 1 ? 1 - u : u;
    const amp = h * (0.012 + 0.07 * tailness ** 1.6);
    const offset = Math.sin(f.wiggle + tailness * Math.PI * 1.5) * amp;
    ctx.drawImage(img, i * sw, 0, sw + 0.5, img.naturalHeight, -w / 2 + i * dw, -h / 2 + offset, dw + 0.6, h);
  }
  ctx.restore();

  if (f.name) drawLabel(f.name, cx, cy + h / 2 + H * 0.012, alpha);
}

function drawLabel(text, x, y, alpha) {
  const size = Math.max(14, Math.min(34, W * 0.016));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `600 ${size}px Mali, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padX = size * 0.6;
  const boxW = ctx.measureText(text).width + padX * 2;
  const boxH = size * 1.6;
  ctx.fillStyle = 'rgba(255, 253, 246, 0.9)';
  ctx.strokeStyle = 'rgba(11, 79, 122, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - boxW / 2, y, boxW, boxH, boxH / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#12384a';
  ctx.fillText(text, x, y + boxH / 2 + size * 0.05);
  ctx.restore();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  stepSchool(school, dt, now, { aspect: W / H }, { ready: isReady });
  for (const id of images.keys()) if (!school.has(id)) images.delete(id);

  scene.drawBack(ctx, W, H, t, dt);
  for (const f of school.values()) {
    const img = images.get(f.id);
    if (!isReady(f.id)) continue;
    if (f.phase.kind === 'entering') {
      const { w } = fishSize(f, img);
      scene.trail(f.x * W - f.dir * w * 0.45, f.y * H, w);
    }
    drawFish(f, img, now);
  }
  scene.drawFront(ctx, W, H, t, dt);
  sound.tick(now);
  requestAnimationFrame(frame);
}
document.fonts?.load('600 20px Mali').catch(() => {});
requestAnimationFrame(frame);
