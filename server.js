import { randomBytes } from 'node:crypto';
import { createApp, lanIPv4 } from './lib/app.js';

const port = Number(process.env.PORT) || 3000;
const dataDir = process.env.DATA_DIR || './data';
const publicUrl = process.env.PUBLIC_URL || '';
const adminKey = process.env.ADMIN_KEY || randomBytes(12).toString('hex');

const { app, closeStreams } = await createApp({ dataDir, adminKey, publicUrl });
const server = app.listen(port, () => {
  const base = publicUrl.replace(/\/+$/, '') || `http://${lanIPv4() ?? 'localhost'}:${port}`;
  console.log(`ตู้ปลา: ${base}/`);
  console.log(`หน้าส่งปลา: ${base}/draw`);
  if (process.env.ADMIN_KEY) console.log(`แอดมิน: ${base}/admin?key=<ADMIN_KEY>`);
  else console.log(`แอดมิน: ${base}/admin?key=${adminKey}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    closeStreams();
    server.close(() => process.exit(0));
  });
}
