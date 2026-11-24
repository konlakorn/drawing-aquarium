import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OUTPUT_LONG_SIDE, cutout, hasClearBackground, trimClear } from '../public/cutout.js';
import { DEFAULT_LIGHTING, fishInk, photograph } from '../scripts/synth.js';

const W = 640, H = 480;
const fish = fishInk({
  cx: 360, cy: 230, rx: 150, ry: 90, facing: 'right',
  body: [240, 130, 40], outline: [30, 35, 90], stripe: [70, 130, 230],
});
const photo = photograph({ width: W, height: H, ink: fish.ink, seed: 42 });
const result = cutout(photo);

function alphaAt(x, y) {
  const { image, box } = result;
  const sx = image.width / box.width;
  const ox = Math.round((x - box.x) * sx), oy = Math.round((y - box.y) * sx);
  if (ox < 0 || oy < 0 || ox >= image.width || oy >= image.height) return 0;
  return image.data[(oy * image.width + ox) * 4 + 3];
}

test('the fixture really is unevenly lit', () => {
  const lum = (x, y) => photo.data[(y * W + x) * 4 + 1];
  assert.ok(lum(630, 20) < 160, `right edge paper is dark (${lum(630, 20)})`);
  assert.ok(lum(10, 20) > 220, `left edge paper is bright (${lum(10, 20)})`);
  assert.ok(lum(96, 408) < 170, `shadowed paper is dark (${lum(96, 408)})`);
});

test('finds the fish', () => {
  assert.equal(result.ok, true, `reason: ${result.reason}, fraction ${result.fraction}`);
});

test('paper background is fully transparent, including the dark side and the shadow', () => {
  for (const [x, y] of [
    [fish.box.x - 15, fish.box.y + 40],
    [fish.box.x + fish.box.width + 12, fish.box.y + 60],
    [fish.box.x + 40, fish.box.y + fish.box.height + 12],
    [fish.box.x + fish.box.width - 20, fish.box.y + 10],
  ]) {
    assert.equal(alphaAt(x, y), 0, `background at (${x}, ${y})`);
  }
});

test('fish body is fully opaque', () => {
  assert.equal(alphaAt(...fish.probes.body), 255);
});

test('white areas enclosed by the drawing stay opaque', () => {
  assert.equal(alphaAt(...fish.probes.belly), 255, 'belly');
  assert.equal(alphaAt(...fish.probes.eyeWhite), 255, 'eye white');
});

test('enclosed white is still white after lighting correction', () => {
  const { image, box } = result;
  const [x, y] = fish.probes.belly.map(Math.round);
  const i = ((y - box.y) * image.width + (x - box.x)) * 4;
  for (let c = 0; c < 3; c++) assert.ok(image.data[i + c] > 225, `channel ${c} = ${image.data[i + c]}`);
});

test('crop box hugs the fish within a few pixels', () => {
  const { box } = result;
  const slack = 9;
  assert.ok(box.x <= fish.box.x && fish.box.x - box.x <= slack, `left ${box.x} vs ${fish.box.x}`);
  assert.ok(box.y <= fish.box.y && fish.box.y - box.y <= slack, `top ${box.y} vs ${fish.box.y}`);
  const right = box.x + box.width, fishRight = fish.box.x + fish.box.width;
  const bottom = box.y + box.height, fishBottom = fish.box.y + fish.box.height;
  assert.ok(right >= fishRight && right - fishRight <= slack, `right ${right} vs ${fishRight}`);
  assert.ok(bottom >= fishBottom && bottom - fishBottom <= slack, `bottom ${bottom} vs ${fishBottom}`);
});

test('blank unevenly lit paper reports no fish', () => {
  // A neutral tint keeps the uncorrected dark side under the 90% ceiling, so only lighting
  // correction (not the area ceiling) can make this pass.
  const lighting = { ...DEFAULT_LIGHTING, tint: [1, 1, 1], gradient: 0.35 };
  const r = cutout(photograph({ width: W, height: H, lighting, seed: 7 }));
  assert.equal(r.ok, false, `fraction ${r.fraction}`);
  assert.equal(r.reason, 'no-fish');
});

test('a specks-only photo reports no fish', () => {
  const dots = (x, y) => ((x * 31 + y * 17) % 997 === 0 ? [20, 20, 20] : null);
  assert.equal(cutout(photograph({ width: W, height: H, ink: dots, seed: 3 })).ok, false);
});

test('output long side is capped', () => {
  const big = fishInk({ cx: 600, cy: 400, rx: 380, ry: 220, body: [60, 170, 90], outline: [20, 20, 20] });
  const lighting = { ...DEFAULT_LIGHTING, shadow: { ...DEFAULT_LIGHTING.shadow, depth: 0 } };
  const r = cutout(photograph({ width: 1200, height: 800, ink: big.ink, lighting, seed: 5 }));
  assert.equal(r.ok, true);
  assert.equal(Math.max(r.image.width, r.image.height), OUTPUT_LONG_SIDE);
});

function clearCanvas(w, h, rect) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) data.set([20, 160, 70, 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
}

test('a photo of paper is not mistaken for a ready-cut PNG, a cut-out PNG is', () => {
  assert.equal(hasClearBackground(photo), false);
  assert.equal(hasClearBackground(clearCanvas(400, 300, { x: 100, y: 80, w: 150, h: 90 })), true);
});

test('a ready-cut PNG is trimmed to its opaque fish so it swims at full size', () => {
  const trimmed = trimClear(clearCanvas(400, 300, { x: 100, y: 80, w: 150, h: 90 }));
  assert.ok(trimmed.ok);
  assert.ok(Math.abs(trimmed.image.width - 158) <= 2, `width ${trimmed.image.width}`);
  assert.ok(Math.abs(trimmed.image.height - 98) <= 2, `height ${trimmed.image.height}`);
  assert.equal(trimmed.image.data[3], 0, 'padding corner stays clear');
});

test('a fully clear PNG reports no fish', () => {
  assert.equal(trimClear({ data: new Uint8ClampedArray(50 * 40 * 4), width: 50, height: 40 }).ok, false);
});
