import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const TANK_CAPACITY = 10;
export const KEEP_ON_DISK = 50;

const ID_PATTERN = /^[a-f0-9]{16}$/;

export function isFishId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export async function openStore(dataDirInput) {
  const dataDir = path.resolve(dataDirInput);
  const fishDir = path.join(dataDir, 'fish');
  const listPath = path.join(dataDir, 'fish.json');
  await mkdir(fishDir, { recursive: true });

  let list = await readList(listPath);
  let writes = Promise.resolve();
  let tmpCounter = 0;

  const imagePath = (id) => path.join(fishDir, `${id}.png`);

  // Writes are chained so an older snapshot can never be renamed over a newer one.
  function persist() {
    writes = writes.then(async () => {
      const tmp = `${listPath}.${process.pid}.${tmpCounter++}.tmp`;
      await writeFile(tmp, JSON.stringify(list));
      await rename(tmp, listPath);
    });
    return writes;
  }

  return {
    imagePath,

    all: () => list.slice(),

    active: () => list.slice(-TANK_CAPACITY),

    async add({ name, facing, png }) {
      const fish = { id: randomBytes(8).toString('hex'), name, facing, createdAt: Date.now() };
      await writeFile(imagePath(fish.id), png);
      list = [...list, fish];
      const pruned = list.slice(0, Math.max(0, list.length - KEEP_ON_DISK));
      list = list.slice(-KEEP_ON_DISK);
      await persist();
      await Promise.all(pruned.map((f) => rm(imagePath(f.id), { force: true })));
      return fish;
    },

    async remove(id) {
      if (!list.some((f) => f.id === id)) return false;
      list = list.filter((f) => f.id !== id);
      await persist();
      await rm(imagePath(id), { force: true });
      return true;
    },
  };
}

async function readList(listPath) {
  try {
    const parsed = JSON.parse(await readFile(listPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}
