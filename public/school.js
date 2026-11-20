// Fish lifecycle in the tank: entering -> swimming -> leaving -> gone (deleted from the map).
// Positions are fractions of the tank (x of width, y of height); velocities are in tank widths
// per second on both axes so steering is isotropic on any aspect ratio.

export const LEAVE_MS = 7000;
const SWIM_AREA = { x0: 0.08, x1: 0.92, y0: 0.15, y1: 0.7 };
// Keep wandering targets out from under the QR card in the bottom-right corner.
const QR_CORNER = { x: 0.74, y: 0.48 };

export function createFishEntity(data, kind, now, rand = Math.random) {
  const fromLeft = rand() < 0.5;
  const inside = kind === 'swimming';
  const f = {
    id: data.id,
    name: data.name,
    facing: data.facing,
    phase: { kind, since: now },
    x: inside ? lerp(SWIM_AREA.x0, SWIM_AREA.x1, rand()) : fromLeft ? -0.2 : 1.2,
    y: lerp(SWIM_AREA.y0, SWIM_AREA.y1, rand()),
    vx: inside ? 0 : fromLeft ? 0.08 : -0.08,
    vy: 0,
    size: 0.12 + rand() * 0.06,
    cruise: 0.035 + rand() * 0.03,
    wiggle: rand() * Math.PI * 2,
    bob: rand() * Math.PI * 2,
    dir: inside ? (rand() < 0.5 ? -1 : 1) : fromLeft ? 1 : -1,
    target: null,
  };
  f.target = kind === 'entering'
    ? { x: fromLeft ? lerp(0.15, 0.4, rand()) : lerp(0.6, 0.85, rand()), y: f.y }
    : pickTarget(rand);
  return f;
}

export function reconcile(school, snapshot, { initial = false, now = 0, rand = Math.random } = {}) {
  const present = new Set(snapshot.map((d) => d.id));
  const entered = [];
  for (const data of snapshot) {
    const f = school.get(data.id);
    if (!f) {
      const kind = initial ? 'swimming' : 'entering';
      school.set(data.id, createFishEntity(data, kind, now, rand));
      if (kind === 'entering') entered.push(data.id);
    } else if (f.phase.kind === 'leaving') {
      f.phase = { kind: 'swimming', since: now };
      f.target = pickTarget(rand);
    }
  }
  for (const f of school.values()) {
    if (!present.has(f.id) && f.phase.kind !== 'leaving') {
      f.phase = { kind: 'leaving', since: now, exitX: f.x < 0.5 ? -0.25 : 1.25 };
    }
  }
  return entered;
}

export function fishAlpha(f, now) {
  if (f.phase.kind !== 'leaving') return 1;
  return Math.max(0, 1 - (now - f.phase.since) / LEAVE_MS);
}

const PHASES = {
  entering(f, dt, now, view, rand) {
    steer(f, f.target, 0.12, dt, view, 1.5);
    if (f.x > SWIM_AREA.x0 && f.x < SWIM_AREA.x1 && Math.abs(f.x - f.target.x) < 0.05) {
      f.phase = { kind: 'swimming', since: now };
      f.target = pickTarget(rand);
    }
  },

  swimming(f, dt, now, view, rand) {
    const speed = f.cruise * (0.75 + 0.35 * Math.sin(now / 1000 * 0.45 + f.bob));
    steer(f, f.target, speed, dt, view, 0.8);
    const dx = (f.target.x - f.x), dy = (f.target.y - f.y) / view.aspect;
    if (Math.hypot(dx, dy) < 0.03) f.target = pickTarget(rand);
  },

  leaving(f, dt, now, view) {
    const remaining = Math.max(0.05, (LEAVE_MS - (now - f.phase.since)) / 1000);
    const speed = Math.abs(f.phase.exitX - f.x) / remaining;
    steer(f, { x: f.phase.exitX, y: f.y }, speed, dt, view, 1.2);
    if (now - f.phase.since >= LEAVE_MS) return 'gone';
  },
};

// `ready(id)` is false while a fish's image is still loading; entering fish wait off-screen.
export function stepSchool(school, dt, now, view, { ready = () => true, rand = Math.random } = {}) {
  for (const f of school.values()) {
    if (f.phase.kind === 'entering' && !ready(f.id)) {
      f.phase.since = now;
      continue;
    }
    if (PHASES[f.phase.kind](f, dt, now, view, rand) === 'gone') {
      school.delete(f.id);
      continue;
    }
    f.x += f.vx * dt;
    f.y += f.vy * dt * view.aspect;
    f.bob += dt * 1.4;
    f.wiggle += dt * (3 + Math.hypot(f.vx, f.vy) * 60);
    if (Math.abs(f.vx) > 0.004) f.dir += (Math.sign(f.vx) - f.dir) * Math.min(1, dt * 2.5);
  }
}

function steer(f, target, speed, dt, view, responsiveness) {
  const dx = target.x - f.x;
  const dy = (target.y - f.y) / view.aspect;
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, dt * responsiveness);
  f.vx += ((dx / d) * speed - f.vx) * k;
  f.vy += ((dy / d) * speed * 0.6 - f.vy) * k;
}

function pickTarget(rand) {
  for (;;) {
    const t = { x: lerp(SWIM_AREA.x0, SWIM_AREA.x1, rand()), y: lerp(SWIM_AREA.y0, SWIM_AREA.y1, rand()) };
    if (!(t.x > QR_CORNER.x && t.y > QR_CORNER.y)) return t;
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
