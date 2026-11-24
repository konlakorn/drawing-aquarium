import { WORK_LONG_SIDE, cutout, hasClearBackground, resizeToFit, trimClear } from './cutout.js';

const MAX_UPLOAD_BYTES = 950_000;

// Resolves to { ok: true, image: pngDataUrl } or { ok: false, error: 'bad-photo' | 'no-fish' }.
export async function prepareFish(file) {
  let pixels;
  try {
    pixels = toImageData(await decodePhoto(file));
  } catch {
    return { ok: false, error: 'bad-photo' };
  }
  const result = hasClearBackground(pixels) ? trimClear(pixels) : cutout(pixels);
  if (!result.ok) return { ok: false, error: 'no-fish' };
  return { ok: true, image: toPngDataUrl(result.image) };
}

async function decodePhoto(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toImageData(source) {
  const sw = source.naturalWidth ?? source.width;
  const sh = source.naturalHeight ?? source.height;
  const scale = Math.min(1, WORK_LONG_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function toPngDataUrl(img) {
  for (;;) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    const url = canvas.toDataURL('image/png');
    const bytes = ((url.length - url.indexOf(',') - 1) * 3) / 4;
    if (bytes <= MAX_UPLOAD_BYTES || img.width < 64) return url;
    img = resizeToFit(img, Math.round(Math.max(img.width, img.height) * 0.8));
  }
}
