import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Fx } from './fx.js';
import { Arc, LiveTube, moveVisual, type MoveLook } from './moves.js';
import { moveLookOf } from './views.js';

describe('move looks', () => {
  it('maps every projectile source to the look of its move', () => {
    expect(moveLookOf('trainer')).toBe('pokeball');
    expect(moveLookOf('squirtle')).toBe('water');
    expect(moveLookOf('gyarados')).toBe('water');
    expect(moveLookOf('charmander')).toBe('fire');
    expect(moveLookOf('bulbasaur')).toBe('grass');
    expect(moveLookOf('pikachu')).toBe('electric');
    expect(moveLookOf('jolteon')).toBe('electric');
    expect(moveLookOf('lapras')).toBe('ice');
    expect(moveLookOf('articuno')).toBe('ice');
    expect(moveLookOf('mrmime')).toBe('psychic');
    expect(moveLookOf('starmie')).toBe('stars'); // Swift is Normal-type, but it's stars
    expect(moveLookOf('golem')).toBe('boulder');
    expect(moveLookOf('nobody')).toBe('plain');
  });

  it('every look builds, flies, hits and cleans up', () => {
    const looks: MoveLook[] = ['water', 'electric', 'fire', 'grass', 'ice', 'psychic', 'stars', 'pokeball', 'boulder', 'plain'];
    const fx = new Fx();
    for (const look of looks) {
      const v = moveVisual(look, look === 'water');
      const root = new THREE.Group().add(v.head, v.span);
      for (let i = 0; i <= 10; i++) {
        v.update({ origin: new THREE.Vector3(0, 2, 0), head: new THREE.Vector3(i * 0.4, 1, -i * 0.3), progress: i / 10, dt: 1 / 60, t: i / 60, fx });
      }
      expect(() => v.impact(fx, new THREE.Vector3(4, 1, -3))).not.toThrow();
      v.dispose();
      expect(v.head.parent).toBeNull();
      expect(root.children).toHaveLength(0);
    }
    // Impact effects (arcs into the ground) run themselves out and are removed.
    for (let i = 0; i < 60; i++) fx.update(1 / 30);
  });
});

describe('LiveTube', () => {
  it('rewrites a finite tube in place around the given line', () => {
    const tube = new LiveTube(6, new THREE.MeshBasicMaterial());
    const pos = tube.mesh.geometry.getAttribute('position');
    const before = pos.array;
    tube.set((i, out) => out.set(i, 0, 0), () => 0.2);
    expect(pos.array).toBe(before); // no reallocation
    for (const v of pos.array as Float32Array) expect(Number.isFinite(v)).toBe(true);
    // Every ring sits 0.2 from its centre point.
    for (let i = 0; i < pos.count; i++) {
      const c = Math.floor(i / 7);
      const d = Math.hypot(pos.getX(i) - c, pos.getY(i), pos.getZ(i));
      expect(d).toBeCloseTo(0.2, 5);
    }
    tube.dispose();
  });

  it('electric arcs stay pinned to both ends while they crackle', () => {
    const arc = new Arc();
    const a = new THREE.Vector3(0, 1, 0);
    const b = new THREE.Vector3(5, 1, 0);
    arc.update(a, b, 0.1, 0.3);
    const core = arc.group.children[1] as THREE.Mesh;
    const pos = core.geometry.getAttribute('position');
    const centre = (ring: number) => {
      const c = new THREE.Vector3();
      for (let j = 0; j < 7; j++) c.add(new THREE.Vector3(pos.getX(ring * 7 + j), pos.getY(ring * 7 + j), pos.getZ(ring * 7 + j)));
      return c.multiplyScalar(1 / 7);
    };
    expect(centre(0).distanceTo(a)).toBeLessThan(1e-4);
    expect(centre(17).distanceTo(b)).toBeLessThan(1e-4);
    arc.dispose();
  });
});
