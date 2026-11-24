import { prepareFish } from './photo.js';

const MESSAGES = {
  'no-fish': 'หาปลาไม่เจอเลย ลองถ่ายใหม่ให้เห็นปลาทั้งตัวบนกระดาษขาวนะ',
  'bad-photo': 'เปิดรูปนี้ไม่ได้ ลองถ่ายใหม่อีกครั้งนะ',
  too_fast: 'ใจเย็น ๆ นะ ปลาตัวก่อนเพิ่งว่ายไป รอแป๊บนึงแล้วกดส่งอีกครั้ง',
  too_large: 'รูปใหญ่เกินไป ลองถ่ายใหม่อีกครั้งนะ',
  failed: 'ส่งปลาไม่สำเร็จ ลองกดส่งอีกครั้งนะ',
};

const els = {
  steps: [...document.querySelectorAll('[data-step]')],
  photo: document.getElementById('photo'),
  preview: document.getElementById('preview'),
  name: document.getElementById('name'),
  send: document.getElementById('send'),
  error: document.getElementById('error'),
  facing: [...document.querySelectorAll('[data-facing]')],
};

let state = { step: 'pick', image: null, facing: null, error: null };

function setState(patch) {
  state = { ...state, ...patch };
  for (const section of els.steps) section.hidden = section.dataset.step !== state.step;
  els.error.textContent = state.error ? MESSAGES[state.error] ?? MESSAGES.failed : '';
  for (const btn of els.facing) btn.setAttribute('aria-pressed', String(btn.dataset.facing === state.facing));
  els.send.disabled = !state.facing;
  if (state.image && els.preview.src !== state.image) els.preview.src = state.image;
}

const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

els.photo.addEventListener('change', async () => {
  const file = els.photo.files?.[0];
  els.photo.value = '';
  if (!file) return;
  setState({ step: 'working', error: null, facing: null });
  await nextPaint();

  const result = await prepareFish(file);
  if (!result.ok) return setState({ step: 'pick', error: result.error });
  setState({ step: 'review', image: result.image });
});

for (const btn of els.facing) {
  btn.addEventListener('click', () => setState({ facing: btn.dataset.facing, error: null }));
}

els.send.addEventListener('click', async () => {
  setState({ step: 'sending', error: null });
  try {
    const res = await fetch('/api/fish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: els.name.value, facing: state.facing, image: state.image }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      return setState({ step: 'review', error: error ?? 'failed' });
    }
    setState({ step: 'done' });
  } catch {
    setState({ step: 'review', error: 'failed' });
  }
});

for (const btn of document.querySelectorAll('[data-action="restart"]')) {
  btn.addEventListener('click', () => setState({ step: 'pick', image: null, facing: null, error: null }));
}

setState({});
