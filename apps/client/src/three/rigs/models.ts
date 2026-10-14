import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AttackStyle, Pose, Rig } from './pose.js';

/**
 * Character models authored in Blender (tools/blender) and loaded as glTF. Each model is a
 * skinned mesh with baked clips — idle, walk, attack, faint, plus optional special, leap,
 * charge and dormant — that `animate` blends from the same Pose the game always used.
 */

export interface ModelInfo {
  height: number;
  flyHeight: number;
  attackStyle: AttackStyle;
  attackDuration: number;
  clips: string[];
}

const BASE = `${import.meta.env.BASE_URL}models/`;
const models = new Map<string, { gltf: GLTF; info: ModelInfo }>();

/** Loads every model in the manifest. Must finish before any rig is built; fails loudly. */
export async function loadModels(onProgress?: (done: number, total: number) => void): Promise<void> {
  const res = await fetch(`${BASE}manifest.json`);
  if (!res.ok) throw new Error(`Model manifest failed to load: ${res.status}`);
  const manifest = (await res.json()) as Record<string, ModelInfo>;
  const names = Object.keys(manifest);
  // Models are Draco-compressed; the decoder is three's own, vendored into public/draco.
  const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  let done = 0;
  await Promise.all(names.map(async (name) => {
    const gltf = await loader.loadAsync(`${BASE}${name}.glb`).catch((err: unknown) => {
      throw new Error(`Model "${name}" failed to load: ${err instanceof Error ? err.message : String(err)}`);
    });
    models.set(name, { gltf, info: manifest[name]! });
    onProgress?.(++done, names.length);
  }));
  draco.dispose();
}

const WHITE = new THREE.Color(0xffffff);
const TINT = new THREE.Color();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function modelRig(name: string): Rig {
  const entry = models.get(name);
  if (!entry) throw new Error(`Model "${name}" is not loaded`);
  const { gltf, info } = entry;

  const root = new THREE.Group();
  // Squash/stretch and tremble live on their own node: owners move, yaw and scale `root`.
  const squash = new THREE.Group();
  const model = cloneSkinned(gltf.scene);
  root.add(squash);
  squash.add(model);

  // Per-rig materials so flashing or fading one unit never touches another.
  // 'glow_*' parts are always lit (flames, gems); 'charge_*' parts only light up on attack or special.
  const mats: Array<{ m: THREE.MeshStandardMaterial; base: THREE.Color; light: 'glow' | 'charge' | null }> = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    // Skinned bounds don't follow the animation; never cull a character mid-swing.
    mesh.frustumCulled = false;
    const own = (mesh.material as THREE.MeshStandardMaterial).clone();
    mesh.material = own;
    const light = own.name.startsWith('glow') ? 'glow' : own.name.startsWith('charge') ? 'charge' : null;
    mats.push({ m: own, base: own.emissive.clone(), light });
  });

  const muzzle = model.getObjectByName('muzzle');
  if (!muzzle) throw new Error(`Model "${name}" has no muzzle socket`);

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
    a.paused = true; // time is driven from the Pose, never by the mixer clock
    a.setEffectiveWeight(0);
    actions.set(clip.name, a);
  }
  for (const required of ['idle', 'walk', 'attack', 'faint']) {
    if (!actions.has(required)) throw new Error(`Model "${name}" is missing its ${required} clip`);
  }
  const charges = info.attackStyle === 'cast' || info.attackStyle === 'breath' || info.attackStyle === 'beam';

  /** Set an action's weight and its time as a 0..1 fraction of the clip. */
  const drive = (clip: string, weight: number, progress: number) => {
    const a = actions.get(clip);
    if (!a) return;
    const d = a.getClip().duration;
    a.setEffectiveWeight(weight);
    // Stay a hair short of the end so one-shot clips hold their final pose.
    a.time = Math.min(d - 1e-4, Math.max(0, progress) * d);
  };

  return {
    root,
    height: info.height,
    flyHeight: info.flyHeight,
    muzzle,
    attackStyle: info.attackStyle,
    attackDuration: info.attackDuration,
    animate(p: Pose) {
      for (const a of actions.values()) a.setEffectiveWeight(0);
      const fainting = p.faint >= 0;
      if (fainting) {
        drive('faint', 1, p.faint);
      } else {
        let free = 1;
        if (p.attack >= 0) {
          // Blend in fast, out a little slower, so the wind-up and follow-through read.
          const w = Math.min(1, p.attack * 10, (1 - p.attack) * 6);
          drive('attack', w, p.attack);
          free -= w;
        }
        if (p.special > 0 && actions.has('special')) {
          const w = free * clamp01(p.special * 1.5);
          drive('special', w, 1 - p.special);
          free -= w;
        }
        if (p.airborne > 0 && actions.has('leap')) {
          const w = free * clamp01(p.airborne);
          drive('leap', w, 0.5);
          free -= w;
        }
        const stride = clamp01(p.speed / 1.1);
        const walkClip = p.charging && actions.has('charge') ? 'charge' : 'walk';
        const idleClip = p.dormant && actions.has('dormant') ? 'dormant' : 'idle';
        drive(walkClip, free * stride, (p.walk / (Math.PI * 2)) % 1);
        const idle = actions.get(idleClip)!;
        drive(idleClip, free * (1 - stride), (p.t % idle.getClip().duration) / idle.getClip().duration);
      }
      mixer.update(0);

      // Procedural extras on top of the clips: impact squash, rage tremble, glowing parts.
      const sq = p.land * 0.28 + p.hit * 0.16;
      squash.scale.set(1 + sq * 0.7, 1 - sq, 1 + sq * 0.7);
      squash.position.x = p.enraged ? Math.sin(p.t * 70) * 0.025 : 0;
      const charge = charges && p.attack >= 0 ? clamp01(1 - Math.abs(p.attack - 0.3) / 0.35) : 0;
      const glowLevel = 1 + charge * 2.5 + p.special * 1.5 + Math.sin(p.t * 23) * 0.12;
      const chargeLevel = charge * 2.2 + p.special * 2 + (charge > 0 && Math.sin(p.t * 40) > 0.5 ? 0.8 : 0);
      for (const g of mats) {
        if (g.light === 'glow') g.m.emissiveIntensity = glowLevel;
        else if (g.light === 'charge') g.m.emissiveIntensity = chargeLevel;
      }
    },
    flash(amount: number, color?: number) {
      const target = color === undefined ? WHITE : TINT.set(color);
      for (const { m, base } of mats) m.emissive.copy(base).lerp(target, amount);
    },
    fade(opacity: number) {
      for (const { m } of mats) {
        m.transparent = opacity < 1;
        m.opacity = opacity;
        m.depthWrite = opacity >= 1;
      }
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      for (const { m } of mats) m.dispose();
    },
  };
}
