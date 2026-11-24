// Cuts a drawn fish out of a phone photo of white paper.
// Pure over ImageData-like { data: RGBA bytes, width, height }, so the browser and node:test share it.

export const WORK_LONG_SIDE = 640;
export const OUTPUT_LONG_SIDE = 512;

const CELL = 32;
const MIN_AREA = 0.01;
const MAX_AREA = 0.9;
const PAD = 4;

export function cutout(img) {
  const { width: w, height: h } = img;
  const illum = estimateIllumination(img);
  const norm = normalise(img, illum);
  const paper = classifyPaper(norm, w, h);
  const background = floodFromBorder(dilateBarrier(paper, w, h), w, h);
  const mask = keepMainDrawing(background, w, h);

  let area = 0;
  for (let i = 0; i < mask.length; i++) area += mask[i];
  const fraction = area / (w * h);
  if (fraction < MIN_AREA || fraction > MAX_AREA) return { ok: false, reason: 'no-fish', fraction };

  const alpha = feather(mask, w, h);
  const box = boundingBox(alpha, w, h, PAD);
  const cropped = crop(norm, alpha, w, box);
  const image = resizeToFit(cropped, OUTPUT_LONG_SIDE);
  return { ok: true, image, box, fraction };
}

// Paper brightness and tint per CELL, from the brightest pixels of each cell.
// Cells whose brightest pixels are coloured or very dark are covered by the drawing; their
// illumination is inpainted from neighbouring paper cells.
function estimateIllumination({ data, width: w, height: h }) {
  const gw = Math.ceil(w / CELL);
  const gh = Math.ceil(h / CELL);
  const cells = new Float32Array(gw * gh * 3);
  const reliable = new Uint8Array(gw * gh);
  const lums = [];

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * CELL, y0 = gy * CELL;
      const x1 = Math.min(w, x0 + CELL), y1 = Math.min(h, y0 + CELL);
      const pix = [];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          pix.push([0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2], i]);
        }
      }
      pix.sort((a, b) => b[0] - a[0]);
      const top = Math.max(1, Math.floor(pix.length * 0.1));
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < top; k++) {
        const i = pix[k][1];
        r += data[i]; g += data[i + 1]; b += data[i + 2];
      }
      r /= top; g /= top; b /= top;
      const c = gy * gw + gx;
      cells[c * 3] = r; cells[c * 3 + 1] = g; cells[c * 3 + 2] = b;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      reliable[c] = max > 0 && (max - min) / max < 0.25 ? 1 : 0;
      lums.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }

  const brightest = Math.max(...lums);
  for (let c = 0; c < reliable.length; c++) if (lums[c] < brightest * 0.3) reliable[c] = 0;
  if (!reliable.some(Boolean)) reliable.fill(1);

  inpaint(cells, reliable, gw, gh);
  return { cells: boxBlurCells(cells, gw, gh), gw, gh };
}

function inpaint(cells, reliable, gw, gh) {
  const known = reliable.slice();
  let missing = known.reduce((n, k) => n + (k ? 0 : 1), 0);
  while (missing > 0) {
    const next = known.slice();
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const c = gy * gw + gx;
        if (known[c]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = gx + dx, y = gy + dy;
            if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
            const o = y * gw + x;
            if (!known[o]) continue;
            r += cells[o * 3]; g += cells[o * 3 + 1]; b += cells[o * 3 + 2]; n++;
          }
        }
        if (n === 0) continue;
        cells[c * 3] = r / n; cells[c * 3 + 1] = g / n; cells[c * 3 + 2] = b / n;
        next[c] = 1;
        missing--;
      }
    }
    known.set(next);
  }
}

function boxBlurCells(cells, gw, gh) {
  const out = new Float32Array(cells.length);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = gx + dx, y = gy + dy;
            if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
            sum += cells[(y * gw + x) * 3 + ch]; n++;
          }
        }
        out[(gy * gw + gx) * 3 + ch] = sum / n;
      }
    }
  }
  return out;
}

// Divides each pixel by the bilinearly interpolated paper colour, so paper becomes ~1.0 everywhere.
function normalise({ data, width: w, height: h }, { cells, gw, gh }) {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / CELL - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / CELL - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const p = y * w + x;
      for (let ch = 0; ch < 3; ch++) {
        const a = cells[(y0 * gw + x0) * 3 + ch], b = cells[(y0 * gw + x1) * 3 + ch];
        const c = cells[(y1 * gw + x0) * 3 + ch], d = cells[(y1 * gw + x1) * 3 + ch];
        const paper = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
        out[p * 3 + ch] = Math.min(1, data[p * 4 + ch] / Math.max(8, paper));
      }
    }
  }
  return out;
}

function classifyPaper(norm, w, h) {
  const paper = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const r = norm[p * 3], g = norm[p * 3 + 1], b = norm[p * 3 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    paper[p] = min > 0.8 && max - min < 0.15 ? 1 : 0;
  }
  return paper;
}

// Thickens the drawn lines by one pixel so a hairline gap in an outline does not let the
// background flood leak into enclosed white areas.
function dilateBarrier(paper, w, h) {
  const out = paper.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (paper[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 0;
        }
      }
    }
  }
  return out;
}

function floodFromBorder(passable, w, h) {
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const seed = (p) => {
    if (passable[p] && !bg[p]) { bg[p] = 1; queue[tail++] = p; }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w, y = (p - x) / w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  return bg;
}

// Foreground components smaller than 5% of the largest one are specks of dirt or noise.
function keepMainDrawing(background, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const queue = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (background[start] || labels[start] !== -1) continue;
    const id = sizes.length;
    let head = 0, tail = 0, size = 0;
    labels[start] = id;
    queue[tail++] = start;
    while (head < tail) {
      const p = queue[head++];
      size++;
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (background[q] || labels[q] !== -1) continue;
          labels[q] = id;
          queue[tail++] = q;
        }
      }
    }
    sizes.push(size);
  }
  const largest = sizes.length ? Math.max(...sizes) : 0;
  const keep = sizes.map((s) => s >= Math.max(40, largest * 0.05));
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) mask[p] = labels[p] >= 0 && keep[labels[p]] ? 1 : 0;
  return mask;
}

function feather(mask, w, h) {
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          sum += mask[ny * w + nx]; n++;
        }
      }
      alpha[y * w + x] = Math.round((255 * sum) / n);
    }
  }
  return alpha;
}

// A PNG someone already cut out arrives with a clear background; cutting it again would find no paper.
export function hasClearBackground({ data }) {
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++;
  return clear > (data.length / 4) * 0.05;
}

export function trimClear(img) {
  const { data, width: w, height: h } = img;
  const alpha = new Uint8Array(w * h);
  for (let p = 0; p < alpha.length; p++) alpha[p] = data[p * 4 + 3] >= 16 ? 1 : 0;
  const box = boundingBox(alpha, w, h, PAD);
  if (box.width <= 0 || box.height <= 0) return { ok: false, reason: 'no-fish' };
  const out = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    const from = ((box.y + y) * w + box.x) * 4;
    out.set(data.subarray(from, from + box.width * 4), y * box.width * 4);
  }
  return { ok: true, image: resizeToFit({ data: out, width: box.width, height: box.height }, OUTPUT_LONG_SIDE) };
}

function boundingBox(alpha, w, h, pad) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!alpha[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function crop(norm, alpha, w, box) {
  const out = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const p = (box.y + y) * w + box.x + x;
      const o = (y * box.width + x) * 4;
      out[o] = norm[p * 3] * 255;
      out[o + 1] = norm[p * 3 + 1] * 255;
      out[o + 2] = norm[p * 3 + 2] * 255;
      out[o + 3] = alpha[p];
    }
  }
  return { data: out, width: box.width, height: box.height };
}

// Area-average downscale in premultiplied alpha so transparent paper does not bleed into edges.
export function resizeToFit(img, longSide) {
  const scale = Math.min(1, longSide / Math.max(img.width, img.height));
  if (scale === 1) return img;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const ya = Math.floor(y * sy), yb = Math.max(ya + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const xa = Math.floor(x * sx), xb = Math.max(xa + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = ya; yy < yb; yy++) {
        for (let xx = xa; xx < xb; xx++) {
          const i = (yy * img.width + xx) * 4;
          const al = img.data[i + 3];
          r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += al; n++;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / n;
    }
  }
  return { data: out, width: w, height: h };
}
