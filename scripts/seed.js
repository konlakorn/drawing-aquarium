// Usage: node scripts/seed.js [count=12] [baseUrl=http://localhost:3000]
// Draws synthetic kid fish on photo-like paper, cuts them out with the same cutout.js the
// phone uses, and uploads them. The server allows one upload per 5 s per IP, so a run of
// 12 takes about a minute.
import { cutout } from '../public/cutout.js';
import { encodePNG } from './png.js';
import { randomFishPhoto } from './synth.js';

const count = Number(process.argv[2] ?? 12);
const base = (process.argv[3] ?? process.env.SEED_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const NAMES = ['มะลิ', 'ต้นกล้า', 'ใบเตย', 'ข้าวปั้น', 'น้ำหวาน', 'ภูผา', 'ขนมปัง', 'ปลาวาฬ', 'มะปราง', 'โกโก้', 'พายุ', 'ส้มโอ', ''];
const firstSeed = Date.now() % 100000;

for (let i = 0; i < count; i++) {
  const { facing, image } = randomFishPhoto(firstSeed + i);
  const result = cutout(image);
  if (!result.ok) {
    console.error(`#${i + 1}: cutout found no fish (fraction ${result.fraction.toFixed(3)})`);
    process.exitCode = 1;
    continue;
  }
  const png = encodePNG(result.image);
  const body = JSON.stringify({
    name: NAMES[i % NAMES.length],
    facing,
    image: `data:image/png;base64,${png.toString('base64')}`,
  });
  const fish = await upload(body);
  console.log(`#${i + 1} ${fish.id} ${facing} "${fish.name}" ${result.image.width}x${result.image.height} ${png.length} B`);
}

async function upload(body) {
  for (;;) {
    const res = await fetch(`${base}/api/fish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after') ?? 5) * 1000 + 100));
      continue;
    }
    if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
}
