import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { KEEP_ON_DISK, TANK_CAPACITY, openStore } from '../lib/store.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let dir;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aquarium-store-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function addMany(store, n) {
  const added = [];
  for (let i = 0; i < n; i++) added.push(await store.add({ name: `f${i}`, facing: 'left', png: PNG }));
  return added;
}

test('active() is the newest TANK_CAPACITY fish, oldest first', async () => {
  const store = await openStore(dir);
  const added = await addMany(store, TANK_CAPACITY + 3);
  assert.deepEqual(
    store.active().map((f) => f.name),
    added.slice(-TANK_CAPACITY).map((f) => f.name),
  );
  assert.equal(store.active().length, 10);
});

test('state survives reopening the store', async () => {
  const store = await openStore(dir);
  const added = await addMany(store, 12);
  await store.remove(added[11].id);
  const reopened = await openStore(dir);
  assert.deepEqual(reopened.all(), store.all());
  assert.deepEqual(reopened.active().map((f) => f.name), added.slice(1, 11).map((f) => f.name));
});

test('keeps only the newest KEEP_ON_DISK records and images', async () => {
  const store = await openStore(dir);
  const added = await addMany(store, KEEP_ON_DISK + 4);
  assert.equal(store.all().length, KEEP_ON_DISK);
  assert.equal(store.all()[0].id, added[4].id);
  const files = await readdir(path.join(dir, 'fish'));
  assert.equal(files.length, KEEP_ON_DISK);
  assert.ok(!existsSync(store.imagePath(added[0].id)), 'oldest png pruned');
  assert.ok(existsSync(store.imagePath(added.at(-1).id)), 'newest png kept');
  assert.equal((await openStore(dir)).all().length, KEEP_ON_DISK);
});

test('remove deletes the record and image, unknown id is a no-op', async () => {
  const store = await openStore(dir);
  const [a, b] = await addMany(store, 2);
  assert.equal(await store.remove(a.id), true);
  assert.equal(await store.remove(a.id), false);
  assert.deepEqual(store.all().map((f) => f.id), [b.id]);
  assert.ok(!existsSync(store.imagePath(a.id)));
});

test('concurrent adds all persist', async () => {
  const store = await openStore(dir);
  await Promise.all(Array.from({ length: 8 }, (_, i) => store.add({ name: `c${i}`, facing: 'right', png: PNG })));
  assert.equal((await openStore(dir)).all().length, 8);
});

test('a relative data dir still yields absolute image paths', async () => {
  const store = await openStore(path.relative(process.cwd(), dir));
  const fish = await store.add({ name: 'rel', facing: 'left', png: PNG });
  assert.ok(path.isAbsolute(store.imagePath(fish.id)));
  assert.ok(existsSync(store.imagePath(fish.id)));
});
