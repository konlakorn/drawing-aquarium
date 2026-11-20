// Generates photo-like images of kid fish drawings on paper: uneven lighting, a soft shadow,
// a warm tint and sensor noise. Shared by the cutout tests and the seed script.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_LIGHTING = {
  gradient: 0.45,
  shadow: { x: 0.15, y: 0.85, sigma: 90, depth: 0.4 },
  tint: [1, 0.97, 0.9],
  noise: 6,
};

export function photograph({ width, height, ink = () => null, lighting = DEFAULT_LIGHTING, seed = 1 }) {
  const rand = mulberry32(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  const paper = [246, 244, 240];
  const { gradient, shadow, tint, noise } = lighting;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - shadow.x * width, dy = y - shadow.y * height;
      const light =
        (1 - gradient * (x / width)) *
        (1 - 0.08 * (y / height)) *
        (1 - shadow.depth * Math.exp(-(dx * dx + dy * dy) / (2 * shadow.sigma * shadow.sigma)));
      const colour = ink(x, y) ?? paper;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = colour[c] * light * tint[c] + (rand() * 2 - 1) * noise;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

function triangleInk(px, py, a, b, c, thickness) {
  const edges = [[a, b], [b, c], [c, a]];
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let minDist = Infinity;
  for (const [p, q] of edges) {
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const d = (Math.sign(area) * (ex * (py - p[1]) - ey * (px - p[0]))) / Math.hypot(ex, ey);
    if (d < 0) return null;
    minDist = Math.min(minDist, d);
  }
  return minDist < thickness ? 'outline' : 'fill';
}

function ellipseInk(px, py, cx, cy, rx, ry, thickness) {
  const outer = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
  if (outer > 1) return null;
  const inner = ((px - cx) / (rx - thickness)) ** 2 + ((py - cy) / (ry - thickness)) ** 2;
  return inner > 1 ? 'outline' : 'fill';
}

// A fish whose head points `facing`. The belly and the eye are left as white paper but are
// enclosed by the drawing, which is what the cutout must keep opaque.
export function fishInk({ cx, cy, rx, ry, facing = 'right', body, outline, stripe = null, thickness = 5 }) {
  const tailLen = rx * 0.5, tailH = ry * 0.75;
  const belly = { x: cx - rx * 0.1, y: cy + ry * 0.35, rx: rx * 0.45, ry: ry * 0.3 };
  const eye = { x: cx + rx * 0.55, y: cy - ry * 0.25, r: Math.max(6, ry * 0.2) };
  const tail = [[cx - rx + 12, cy], [cx - rx - tailLen, cy - tailH], [cx - rx - tailLen, cy + tailH]];
  const fin = [[cx - rx * 0.4, cy - ry + 8], [cx + rx * 0.2, cy - ry + 6], [cx - rx * 0.3, cy - ry - ry * 0.5]];
  const mirror = (x) => (facing === 'right' ? x : 2 * cx - x);

  const ink = (x0, y) => {
    const x = mirror(x0);
    const eyeD = Math.hypot(x - eye.x, y - eye.y);
    if (eyeD < eye.r * 0.4) return outline;
    if (eyeD < eye.r) return null;
    if (eyeD < eye.r + 3) return outline;

    const b = ellipseInk(x, y, belly.x, belly.y, belly.rx, belly.ry, 3);
    if (b === 'fill') return null;
    if (b === 'outline') return outline;

    const e = ellipseInk(x, y, cx, cy, rx, ry, thickness);
    if (e === 'outline') return outline;
    if (e === 'fill') return stripe && Math.floor((x - cx) / (rx * 0.22)) % 2 === 0 ? stripe : body;

    const t = triangleInk(x, y, ...tail, thickness) ?? triangleInk(x, y, ...fin, thickness);
    if (t === 'outline') return outline;
    if (t === 'fill') return body;
    return null;
  };

  const xs = [cx - rx - tailLen, cx + rx].map(mirror);
  const box = {
    x: Math.floor(Math.min(...xs)),
    y: Math.floor(cy - ry - ry * 0.5),
    width: Math.ceil(Math.abs(xs[1] - xs[0])) + 1,
    height: Math.ceil(cy + ry - (cy - ry - ry * 0.5)) + 1,
  };
  const probes = {
    body: [mirror(cx + rx * 0.1), cy - ry * 0.45],
    belly: [mirror(belly.x), belly.y],
    eyeWhite: [mirror(eye.x + eye.r * 0.7), eye.y],
  };
  return { ink, box, probes };
}

const PALETTE = [
  [240, 120, 40], [235, 70, 90], [250, 200, 40], [60, 170, 90], [70, 130, 230],
  [160, 90, 210], [30, 190, 190], [245, 150, 190],
];
const OUTLINES = [[30, 35, 90], [25, 25, 25], [90, 30, 30], [20, 70, 40]];

export function randomFishPhoto(seed, width = 640, height = 480) {
  const rand = mulberry32(seed * 7919 + 13);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const facing = rand() < 0.5 ? 'left' : 'right';
  const rx = width * (0.18 + rand() * 0.08);
  const ry = rx * (0.5 + rand() * 0.2);
  const body = pick(PALETTE);
  const fish = fishInk({
    cx: width / 2 + (rand() - 0.5) * width * 0.1,
    cy: height / 2 + (rand() - 0.5) * height * 0.1,
    rx, ry, facing, body,
    outline: pick(OUTLINES),
    stripe: rand() < 0.6 ? pick(PALETTE.filter((c) => c !== body)) : null,
    thickness: 4 + Math.floor(rand() * 3),
  });
  const lighting = {
    gradient: 0.2 + rand() * 0.3,
    shadow: { x: rand(), y: 0.6 + rand() * 0.4, sigma: 70 + rand() * 60, depth: 0.2 + rand() * 0.2 },
    tint: [1, 0.96 + rand() * 0.04, 0.86 + rand() * 0.1],
    noise: 5,
  };
  return { facing, image: photograph({ width, height, ink: fish.ink, lighting, seed }) };
}
