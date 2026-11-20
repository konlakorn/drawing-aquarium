import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEAVE_MS, fishAlpha, reconcile, stepSchool } from '../public/school.js';
import { mulberry32 } from '../scripts/synth.js';

const view = { aspect: 16 / 9 };
const fish = (id) => ({ id, name: id, facing: 'left', createdAt: 0 });
const kinds = (school) => Object.fromEntries([...school.values()].map((f) => [f.id, f.phase.kind]));

function run(school, fromMs, toMs, rand) {
  for (let now = fromMs; now <= toMs; now += 1000 / 60) stepSchool(school, 1 / 60, now, view, { rand });
}

test('first snapshot places fish inside the tank already swimming', () => {
  const school = new Map();
  const entered = reconcile(school, [fish('a'), fish('b')], { initial: true, rand: mulberry32(1) });
  assert.deepEqual(entered, []);
  assert.deepEqual(kinds(school), { a: 'swimming', b: 'swimming' });
  for (const f of school.values()) assert.ok(f.x > 0 && f.x < 1);
});

test('a new id enters from off-screen and settles into swimming', () => {
  const rand = mulberry32(2);
  const school = new Map();
  reconcile(school, [fish('a')], { initial: true, rand });
  assert.deepEqual(reconcile(school, [fish('a'), fish('b')], { now: 0, rand }), ['b']);
  const b = school.get('b');
  assert.equal(b.phase.kind, 'entering');
  assert.ok(b.x < 0 || b.x > 1, `starts off-screen at x=${b.x}`);
  run(school, 0, 8000, rand);
  assert.equal(school.get('b').phase.kind, 'swimming');
  assert.ok(b.x > 0 && b.x < 1);
});

test('a fish missing from the snapshot swims out, fades, then is removed', () => {
  const rand = mulberry32(3);
  const school = new Map();
  reconcile(school, [fish('a'), fish('b')], { initial: true, rand });
  const a = school.get('a');
  const startX = a.x;
  reconcile(school, [fish('b')], { now: 1000, rand });
  assert.equal(a.phase.kind, 'leaving');
  assert.equal(a.phase.exitX, startX < 0.5 ? -0.25 : 1.25, 'heads to the nearer side');

  run(school, 1000, 1000 + LEAVE_MS / 2, rand);
  const midAlpha = fishAlpha(a, 1000 + LEAVE_MS / 2);
  assert.ok(midAlpha > 0.3 && midAlpha < 0.7, `half faded (${midAlpha})`);
  assert.ok(school.has('a'));

  run(school, 1000 + LEAVE_MS / 2, 1000 + LEAVE_MS + 50, rand);
  assert.ok(!school.has('a'), 'gone after the leave duration');
  assert.ok(a.x < 0 || a.x > 1, `ended off-screen at x=${a.x}`);
  assert.deepEqual(kinds(school), { b: 'swimming' });
});

test('repeated identical snapshots change nothing', () => {
  const rand = mulberry32(4);
  const school = new Map();
  reconcile(school, [fish('a')], { initial: true, rand });
  reconcile(school, [fish('a'), fish('b')], { now: 0, rand });
  assert.deepEqual(reconcile(school, [fish('a'), fish('b')], { now: 10, rand }), []);
  assert.deepEqual(kinds(school), { a: 'swimming', b: 'entering' });
});

test('a leaving fish that reappears in the snapshot turns back to swimming', () => {
  const rand = mulberry32(5);
  const school = new Map();
  reconcile(school, [fish('a')], { initial: true, rand });
  reconcile(school, [], { now: 0, rand });
  assert.equal(school.get('a').phase.kind, 'leaving');
  reconcile(school, [fish('a')], { now: 500, rand });
  assert.equal(school.get('a').phase.kind, 'swimming');
  assert.equal(fishAlpha(school.get('a'), 600), 1);
});

test('swimming fish that start on top of each other drift apart', () => {
  const rand = mulberry32(7);
  const school = new Map();
  reconcile(school, [fish('a'), fish('b')], { initial: true, rand });
  const [a, b] = school.values();
  Object.assign(b, { x: a.x + 0.01, y: a.y, target: { ...a.target } });
  const gap = () => Math.hypot(a.x - b.x, (a.y - b.y) / view.aspect);
  run(school, 0, 3000, () => 0.5);
  assert.ok(gap() > 0.08, `gap ${gap()}`);
});

test('entering fish wait off-screen until their image is ready', () => {
  const rand = mulberry32(6);
  const school = new Map();
  reconcile(school, [fish('a')], { now: 0, rand });
  const x0 = school.get('a').x;
  stepSchool(school, 1 / 60, 16, view, { ready: () => false, rand });
  assert.equal(school.get('a').x, x0);
});

test('crowded swimming fish never get pushed above the water or into the sand', () => {
  const school = new Map();
  const snapshot = Array.from({ length: 10 }, (_, i) => ({ id: `crowd${i}`, name: '', facing: 'left' }));
  reconcile(school, snapshot, { initial: true, now: 0, rand: () => 0.01 });
  let i = 0;
  for (const f of school.values()) f.x = 0.5 + (i++) * 0.001;
  const view = { aspect: 16 / 9 };
  for (let t = 0; t < 600; t++) {
    stepSchool(school, 1 / 30, t * 33, view);
    for (const f of school.values()) assert.ok(f.y >= 0.12 && f.y <= 0.75, `y=${f.y} at step ${t}`);
  }
});
