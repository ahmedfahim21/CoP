import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARD_IDS, FORMS, STARTER_IDS } from '@cop/shared';
import { RIG_NAMES } from './names.js';

/**
 * The Blender build (tools/blender) writes these files; this checks every model the game can
 * ask for is there and carries what modelRig() needs, without needing a browser or Blender.
 */
const DIR = fileURLToPath(new URL('../../../public/models/', import.meta.url));
const manifest = JSON.parse(readFileSync(`${DIR}manifest.json`, 'utf8')) as Record<string, { height: number; flyHeight: number; attackStyle: string; attackDuration: number; clips: string[] }>;
const STYLES = ['bite', 'punch', 'slam', 'cast', 'breath', 'explode', 'throw', 'wing', 'spin', 'splash', 'beam', 'kick'];

function gltfJson(name: string) {
  const buf = readFileSync(`${DIR}${name}.glb`);
  expect(buf.toString('ascii', 0, 4)).toBe('glTF');
  const len = buf.readUInt32LE(12);
  expect(buf.toString('ascii', 16, 20)).toBe('JSON');
  return JSON.parse(buf.toString('utf8', 20, 20 + len)) as {
    animations?: Array<{ name: string; channels: unknown[] }>;
    nodes: Array<{ name?: string }>;
    skins?: Array<{ joints: number[] }>;
    materials?: Array<{ name: string; emissiveFactor?: number[] }>;
    meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
  };
}

describe('character models', () => {
  it('the manifest lists exactly the characters the game uses', () => {
    expect(Object.keys(manifest).sort()).toEqual([...RIG_NAMES].sort());
  });

  it('every card, evolved form and starter has a model', () => {
    const rigs = new Set<string>(RIG_NAMES);
    for (const id of [...CARD_IDS, ...Object.keys(FORMS), ...STARTER_IDS]) expect(rigs.has(id), id).toBe(true);
  });

  it.each([...RIG_NAMES])('%s is a skinned, vertex-coloured model with its clips and muzzle', (name) => {
    const info = manifest[name]!;
    const j = gltfJson(name);
    const clips = (j.animations ?? []).map((a) => a.name);
    for (const required of ['idle', 'walk', 'attack', 'faint']) expect(clips).toContain(required);
    expect(clips.sort()).toEqual([...info.clips].sort());
    for (const a of j.animations ?? []) expect(a.channels.length).toBeGreaterThan(0);
    expect(j.nodes.some((n) => n.name === 'muzzle')).toBe(true);
    expect(j.nodes.some((n) => n.name === 'root')).toBe(true);
    expect(j.skins?.[0]?.joints.length).toBeGreaterThan(0);
    for (const p of j.meshes.flatMap((m) => m.primitives)) {
      expect(Object.keys(p.attributes)).toEqual(expect.arrayContaining(['POSITION', 'NORMAL', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']));
    }
    // Lit parts carry their colour in the emissive factor so the client can scale it.
    for (const m of j.materials ?? []) if (/^(glow|charge)_/.test(m.name)) expect(m.emissiveFactor?.some((v) => v > 0)).toBe(true);
    expect(STYLES).toContain(info.attackStyle);
    expect(info.height).toBeGreaterThan(0.5);
    expect(info.attackDuration).toBeGreaterThan(0);
  });

  it('leapers, chargers, healers and trainers carry their extra clips', () => {
    expect(manifest.rapidash!.clips).toContain('leap');
    expect(manifest.hitmonlee!.clips).toContain('leap');
    expect(manifest.tauros!.clips).toContain('charge');
    expect(manifest.arcanine!.clips).toContain('charge');
    expect(manifest.chansey!.clips).toContain('special');
    expect(manifest.magikarp!.clips).toContain('special');
    expect(manifest.red!.clips).toContain('dormant');
    expect(manifest.blue!.clips).toContain('dormant');
  });
});
