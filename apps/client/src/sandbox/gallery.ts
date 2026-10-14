// Model gallery: every character side by side, cycling one animation. Dev tool: /gallery.html.
// ?only=pikachu,gengar narrows the line-up; ?yaw=0.6 turns everyone.
import * as THREE from 'three';
import { buildArena } from '../three/arena.js';
import { restPose, type Rig } from '../three/rigs/pose.js';
import { RIG_NAMES, buildRig } from '../three/rigs/registry.js';
import { Stage } from '../three/stage.js';
import { bootModels } from '../ui/boot.js';
import { h } from '../ui/dom.js';

type Mode = 'idle' | 'walk' | 'attack' | 'faint' | 'special' | 'leap' | 'charge' | 'dormant';
const MODES: Mode[] = ['idle', 'walk', 'attack', 'faint', 'special', 'leap', 'charge', 'dormant'];

await bootModels();
const params = new URLSearchParams(location.search);
const host = h('div', { class: 'stage-host' });
const bar = h('div', { class: 'sandbox-bar' });
document.body.append(h('div', { attrs: { id: 'sandbox' } }, h('div', { class: 'stage-wrap' }, host), bar));

const stage = new Stage(host, { team: 0, framing: 'battle', shadows: true });
const arena = buildArena();
stage.scene.add(arena.group);
stage.onFrame((dt, t) => arena.update(dt, t));

const names = params.get('only')?.split(',') ?? [...RIG_NAMES];
const cols = Number(params.get('cols') ?? Math.min(6, names.length));
const gap = Number(params.get('gap') ?? 2.6);
let mode: Mode = (params.get('mode') as Mode) ?? 'idle';
const rigs: Rig[] = [];
names.forEach((name, i) => {
  const rig = buildRig(name);
  const col = i % cols;
  const row = Math.floor(i / cols);
  rig.root.position.set((col - (cols - 1) / 2) * gap, rig.flyHeight, 10 - row * 3.2);
  rig.root.rotation.y = Number(params.get('yaw') ?? 0.45);
  stage.scene.add(rig.root);
  rigs.push(rig);
});

let clock = 0;
stage.onFrame((dt) => {
  clock += dt;
  for (const rig of rigs) {
    const p = restPose();
    p.t = clock;
    if (mode === 'walk' || mode === 'charge') {
      p.speed = 1.2;
      p.walk = clock * 9;
      p.charging = mode === 'charge';
    }
    const cycle = clock % 1.6;
    if (mode === 'attack') p.attack = cycle / rig.attackDuration < 1 ? cycle / rig.attackDuration : -1;
    if (mode === 'faint') p.faint = Math.min(1, cycle / 1.1);
    if (mode === 'special') p.special = Math.max(0, 1 - cycle / 1.2);
    if (mode === 'leap') p.airborne = Math.sin(Math.min(1, cycle / 1.2) * Math.PI);
    if (mode === 'dormant') p.dormant = true;
    rig.animate(p, dt);
  }
  const rows = Math.floor((names.length - 1) / cols);
  stage.camera.position.set(0, 6 + rows * 2.4, 17 + rows * 1.6);
  stage.camera.lookAt(0, 0.9, 9 - rows * 1.7);
});
stage.start();

function render() {
  bar.replaceChildren(...MODES.map((m) => {
    const b = h('button', { class: 'btn small', textContent: m, attrs: { 'aria-pressed': String(m === mode) } });
    b.addEventListener('click', () => {
      mode = m;
      clock = 0;
      render();
    });
    return b;
  }));
}
render();
Object.assign(window, { __gallery: { rigs, THREE } });
