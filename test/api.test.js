import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp, lanIPv4 } from '../lib/app.js';
import { encodePNG } from '../scripts/png.js';

const ADMIN_KEY = 'test-admin-key';
const pixel = encodePNG({ data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 });
const PNG_URL = `data:image/png;base64,${pixel.toString('base64')}`;

let dir, server, base, closeStreams;

async function boot(cooldownMs) {
  const created = await createApp({ dataDir: dir, adminKey: ADMIN_KEY, uploadCooldownMs: cooldownMs });
  const srv = created.app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { srv, url: `http://127.0.0.1:${srv.address().port}`, closeStreams: created.closeStreams };
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aquarium-api-'));
  ({ srv: server, url: base, closeStreams } = await boot(0));
});
after(async () => {
  closeStreams();
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

const post = (body, url = base) =>
  fetch(`${url}/api/fish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function expectError(body, status, error) {
  const res = await post(body);
  assert.equal(res.status, status);
  assert.deepEqual(await res.json(), { error });
}

test('accepts a valid fish, trims and caps the name, serves the image', async () => {
  const res = await post({ name: '  ปลาทองน้อยของหนูน่ารักที่สุดในโลกเลย  ', facing: 'left', image: PNG_URL });
  assert.equal(res.status, 201);
  const fish = await res.json();
  assert.equal(fish.facing, 'left');
  assert.equal([...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(fish.name)].length, 20);
  assert.ok(fish.name.startsWith('ปลาทอง'));
  assert.equal(typeof fish.createdAt, 'number');

  const img = await fetch(`${base}/fish/${fish.id}.png`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control'), /max-age=31536000/);
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), pixel);
});

test('name may be empty or missing', async () => {
  const res = await post({ facing: 'right', image: PNG_URL });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).name, '');
});

test('rejects bad facing', () => expectError({ facing: 'up', image: PNG_URL }, 400, 'bad_facing'));

test('rejects a non-PNG data URL', () =>
  expectError({ facing: 'left', image: `data:image/jpeg;base64,${pixel.toString('base64')}` }, 400, 'bad_image'));

test('rejects bytes that are not a PNG', () =>
  expectError({ facing: 'left', image: `data:image/png;base64,${Buffer.from('GIF89a-not-a-png').toString('base64')}` }, 400, 'bad_image'));

test('rejects a PNG over 1 MB', () => {
  const big = Buffer.concat([pixel, Buffer.alloc(1024 * 1024)]);
  return expectError({ facing: 'left', image: `data:image/png;base64,${big.toString('base64')}` }, 400, 'too_large');
});

test('rejects a body over the JSON limit', () =>
  expectError({ facing: 'left', image: `data:image/png;base64,${'A'.repeat(1_700_000)}` }, 413, 'too_large'));

test('rejects malformed JSON', () => expectError('{"facing":', 400, 'bad_json'));

test('unknown or malformed image ids are 404', async () => {
  assert.equal((await fetch(`${base}/fish/0123456789abcdef.png`)).status, 404);
  assert.equal((await fetch(`${base}/fish/..%2Ffish.json.png`)).status, 404);
});

test('second upload from the same IP within the cooldown is refused, failures do not count', async () => {
  const limited = await boot(5000);
  try {
    assert.equal((await post({ facing: 'up', image: PNG_URL }, limited.url)).status, 400);
    assert.equal((await post({ facing: 'left', image: PNG_URL }, limited.url)).status, 201);
    const res = await post({ facing: 'left', image: PNG_URL }, limited.url);
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: 'too_fast' });
    assert.ok(Number(res.headers.get('retry-after')) > 0);
  } finally {
    limited.closeStreams();
    await new Promise((r) => limited.srv.close(r));
  }
});

test('uploads with the admin key skip the cooldown, a wrong key does not', async () => {
  const limited = await boot(5000);
  const postAs = (key) => fetch(`${limited.url}/api/fish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-admin-key': key } : {}) },
    body: JSON.stringify({ facing: 'left', image: PNG_URL }),
  });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await postAs(ADMIN_KEY)).status, 201);
    assert.equal((await postAs('wrong')).status, 201);
    assert.equal((await postAs('wrong')).status, 429);
    assert.equal((await postAs(ADMIN_KEY)).status, 201);
  } finally {
    limited.closeStreams();
    await new Promise((r) => limited.srv.close(r));
  }
});

async function firstSnapshot() {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  let text = '';
  while (!text.includes('data: ')) text += new TextDecoder().decode((await reader.read()).value);
  ctrl.abort();
  return JSON.parse(text.split('data: ')[1].split('\n')[0]);
}

test('admin delete needs the key and updates the snapshot', async () => {
  const fish = await (await post({ name: 'ลบฉัน', facing: 'left', image: PNG_URL })).json();
  const del = (key) => fetch(`${base}/api/fish/${fish.id}`, { method: 'DELETE', headers: key ? { 'x-admin-key': key } : {} });

  assert.equal((await del()).status, 403);
  assert.equal((await del('wrong')).status, 403);
  assert.ok((await firstSnapshot()).fish.some((f) => f.id === fish.id));

  assert.equal((await del(ADMIN_KEY)).status, 204);
  assert.equal((await del(ADMIN_KEY)).status, 404);
  assert.ok(!(await firstSnapshot()).fish.some((f) => f.id === fish.id));
  assert.equal((await fetch(`${base}/fish/${fish.id}.png`)).status, 404);
});

test('qr.svg encodes the draw URL', async () => {
  const res = await fetch(`${base}/qr.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(res.headers.get('x-draw-url'), /^http:\/\/[^/]+\/draw$/);
  if (lanIPv4()) assert.equal(res.headers.get('x-draw-url'), `http://${lanIPv4()}:${new URL(base).port}/draw`);
  assert.match(await res.text(), /^<svg/);
});
