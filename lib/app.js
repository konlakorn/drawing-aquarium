import { timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { isFishId, openStore } from './store.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_PNG_BYTES = 1024 * 1024;
const MAX_NAME_GRAPHEMES = 20;
const HEARTBEAT_MS = 20_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL_PREFIX = 'data:image/png;base64,';

export async function createApp({ dataDir, adminKey, publicUrl = '', uploadCooldownMs = 5000 }) {
  const store = await openStore(dataDir);
  const clients = new Set();
  const lastUpload = new Map();
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  const snapshot = () => `data: ${JSON.stringify({ fish: store.active() })}\n\n`;
  const broadcast = () => {
    const frame = snapshot();
    for (const res of clients) res.write(frame);
  };

  const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
  app.get('/', page('tank.html'));
  app.get('/draw', page('draw.html'));
  app.get('/admin', page('admin.html'));
  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.post('/api/fish', express.json({ limit: '1.5mb' }), async (req, res) => {
    const parsed = parseFishInput(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const now = Date.now();
    const waitMs = (lastUpload.get(req.ip) ?? -Infinity) + uploadCooldownMs - now;
    if (waitMs > 0) {
      res.set('Retry-After', String(Math.ceil(waitMs / 1000)));
      return res.status(429).json({ error: 'too_fast' });
    }
    lastUpload.set(req.ip, now);
    if (lastUpload.size > 5000) {
      for (const [ip, t] of lastUpload) if (now - t > uploadCooldownMs) lastUpload.delete(ip);
    }

    const fish = await store.add(parsed.value);
    broadcast();
    res.status(201).json(fish);
  });

  app.delete('/api/fish/:id', async (req, res) => {
    if (!keyMatches(req.get('x-admin-key'), adminKey)) return res.status(403).json({ error: 'forbidden' });
    if (!(await store.remove(req.params.id))) return res.status(404).json({ error: 'not_found' });
    broadcast();
    res.status(204).end();
  });

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write(snapshot());
    clients.add(res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  });

  app.get('/fish/:id.png', (req, res) => {
    if (!isFishId(req.params.id)) return res.status(404).end();
    res.sendFile(store.imagePath(req.params.id), {
      maxAge: '365d',
      immutable: true,
      headers: { 'Content-Type': 'image/png' },
    }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  const qrCache = new Map();
  app.get('/qr.svg', async (req, res) => {
    const url = `${publicUrl ? publicUrl.replace(/\/+$/, '') : requestOrigin(req)}/draw`;
    if (!qrCache.has(url)) {
      qrCache.set(url, await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
    }
    res.set('Cache-Control', 'no-cache').set('X-Draw-Url', url).type('image/svg+xml').send(qrCache.get(url));
  });

  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return { app, store, closeStreams: () => clients.forEach((res) => res.end()) };
}

export function parseFishInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad_json' };
  const { name = '', facing, image } = body;
  if (facing !== 'left' && facing !== 'right') return { ok: false, error: 'bad_facing' };
  if (typeof name !== 'string') return { ok: false, error: 'bad_name' };
  if (typeof image !== 'string' || !image.startsWith(DATA_URL_PREFIX)) return { ok: false, error: 'bad_image' };

  const png = Buffer.from(image.slice(DATA_URL_PREFIX.length), 'base64');
  if (png.length > MAX_PNG_BYTES) return { ok: false, error: 'too_large' };
  if (png.length < PNG_MAGIC.length || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return { ok: false, error: 'bad_image' };
  }
  return { ok: true, value: { name: cleanName(name), facing, png } };
}

// Counted in graphemes so a Thai vowel or tone mark is never split from its consonant.
function cleanName(raw) {
  const clean = raw.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  const segments = [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(clean)];
  return segments.slice(0, MAX_NAME_GRAPHEMES).map((s) => s.segment).join('').trim();
}

function keyMatches(given, expected) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function requestOrigin(req) {
  const host = req.get('host') ?? 'localhost';
  const { hostname, port } = new URL(`http://${host}`);
  if (!LOOPBACK.has(hostname)) return `${req.protocol}://${host}`;
  const lan = lanIPv4();
  return lan ? `${req.protocol}://${lan}${port ? `:${port}` : ''}` : `${req.protocol}://${host}`;
}

export function lanIPv4() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}
