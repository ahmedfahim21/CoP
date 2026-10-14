import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GbaPass } from './gba.js';
import { gradientMap, litMat, shadowTint, toToon } from './toon.js';

/** Runs a material's onBeforeCompile against the real toon fragment shader source. */
function compiled(mat: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    fragmentShader: THREE.ShaderLib.toon.fragmentShader,
    vertexShader: THREE.ShaderLib.toon.vertexShader,
  };
  mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

describe('cel materials', () => {
  it('litMat is a toon material with a nearest-filtered ramp, flat by default', () => {
    const m = litMat({ color: 0x336699, roughness: 0.4, metalness: 0.2 });
    expect(m).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(m.color.getHex()).toBe(0x336699);
    expect(m.gradientMap).toBe(gradientMap('three'));
    expect(m.gradientMap!.magFilter).toBe(THREE.NearestFilter);
    expect((m as unknown as { flatShading: boolean }).flatShading).toBe(true);
    expect((litMat({ flat: false }) as unknown as { flatShading: boolean }).flatShading).toBe(false);
  });

  it('patches the toon lighting with the shared shadow tint (fails loudly if three moves the hook)', () => {
    const shader = compiled(litMat());
    expect(shader.uniforms.uShadowTint).toBe(shadowTint);
    // The include is replaced by the patched chunk, which tints the darker bands.
    expect(shader.fragmentShader).not.toContain('#include <lights_toon_pars_fragment>');
    const lights = THREE.ShaderChunk.lights_toon_pars_fragment;
    expect(lights).toContain('getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color');
  });

  it('converts glTF materials keeping colour, vertex colours and emissive glow, on the soft ramp', () => {
    const src = new THREE.MeshStandardMaterial({ name: 'glow_cheeks', color: 0xffcc00, emissive: 0xff2200, emissiveIntensity: 1.5, vertexColors: true });
    const m = toToon(src);
    expect(m).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(m.name).toBe('glow_cheeks');
    expect(m.color.getHex()).toBe(0xffcc00);
    expect(m.emissive.getHex()).toBe(0xff2200);
    expect(m.emissiveIntensity).toBe(1.5);
    expect(m.vertexColors).toBe(true);
    expect(m.gradientMap).toBe(gradientMap('soft'));
    // A fresh material per call: rigs flash and fade their own copies.
    expect(toToon(src)).not.toBe(m);
  });
});

describe('GBA pass', () => {
  it('renders one virtual pixel per CSS pixel at an integer scale', () => {
    const pass = new GbaPass();
    pass.setSize(916, 1208, 2);
    expect(pass.uniforms.uScale.value).toBe(2);
    expect(pass.uniforms.uRes.value.toArray()).toEqual([458, 604]);
    // Fractional ratios round, and odd buffers round up so the grid always covers the canvas.
    pass.setSize(1001, 751, 1.5);
    expect(pass.uniforms.uScale.value).toBe(2);
    expect(pass.uniforms.uRes.value.toArray()).toEqual([501, 376]);
    pass.setSize(800, 600, 1);
    expect(pass.uniforms.uScale.value).toBe(1);
    expect(pass.uniforms.uRes.value.toArray()).toEqual([800, 600]);
    pass.dispose();
  });
});
