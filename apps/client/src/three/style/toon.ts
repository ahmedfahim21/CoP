import * as THREE from 'three';

/**
 * Cel shading, after the sadak engine's `fx/toon.ts`. Every lit surface is a MeshToonMaterial
 * with a hand-authored gradient ramp, so sunlight falls in two to four flat bands, and the
 * toon BRDF is patched so the darker bands shift toward a cool tint instead of just going
 * darker — most of what makes 3D read as illustrated.
 *
 * Ramp values and the shadow-tint patch are adapted from sakura-crossing
 * (https://github.com/Kenton-GMI/sakura-crossing), MIT License, Copyright (c) 2026 Kenton Wang.
 */

export type RampName = 'two' | 'three' | 'four' | 'soft';

const RAMPS: Record<RampName, number[]> = {
  two: [110, 255],
  three: [96, 182, 255],
  four: [84, 146, 206, 255],
  // High-key: pale masses (foliage, cloth, skin) that must stay light on the shadow side.
  soft: [170, 216, 255],
};

const rampCache = new Map<RampName, THREE.DataTexture>();

export function gradientMap(name: RampName): THREE.DataTexture {
  const hit = rampCache.get(name);
  if (hit) return hit;
  const stops = RAMPS[name];
  const data = new Uint8Array(stops.length * 4);
  stops.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const tex = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  // Nearest, or the bands blur back into a smooth falloff.
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache.set(name, tex);
  return tex;
}

const TOON_CHUNK = 'lights_toon_pars_fragment';
const TOON_LINE = 'vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;';
const TOON_PATCH = `
	vec3 celBand = getGradientIrradiance( geometryNormal, directLight.direction );
	vec3 irradiance = celBand * mix( uShadowTint, vec3( 1.0 ), celBand ) * directLight.color;`;

let chunk: string | null = null;

/** The patched chunk. Fails loudly if a three.js upgrade moved the line we hook. */
function patchedChunk(): string {
  if (chunk) return chunk;
  const src = THREE.ShaderChunk[TOON_CHUNK as keyof typeof THREE.ShaderChunk] as string | undefined;
  if (!src || !src.includes(TOON_LINE)) {
    throw new Error(`[toon] three.js ${THREE.REVISION} changed ${TOON_CHUNK}; update TOON_LINE in style/toon.ts`);
  }
  chunk = `uniform vec3 uShadowTint;\n${src.replace(TOON_LINE, TOON_PATCH)}`;
  return chunk;
}

/** Cool violet-blue the shadow bands lean toward, shared by every material. */
export const shadowTint = { value: new THREE.Color(0x7d84c8) };

function patch(mat: THREE.MeshToonMaterial): THREE.MeshToonMaterial {
  const src = patchedChunk();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShadowTint = shadowTint;
    shader.fragmentShader = shader.fragmentShader.replace(`#include <${TOON_CHUNK}>`, src);
  };
  mat.customProgramCacheKey = () => 'celTint';
  return mat;
}

export type LitParams = Omit<THREE.MeshStandardMaterialParameters, 'roughness' | 'metalness' | 'roughnessMap' | 'metalnessMap' | 'envMap'> & {
  roughness?: number;
  metalness?: number;
  ramp?: RampName;
  /** Faceted normals: crisp light/shadow splits on rocks, foliage and bevels. Default true. */
  flat?: boolean;
};

/** The game's lit material: a cel-shaded stand-in for MeshStandardMaterial. */
export function litMat(params: LitParams = {}): THREE.MeshToonMaterial {
  const { roughness: _r, metalness: _m, ramp = 'three', flat = true, ...rest } = params;
  const mat = new THREE.MeshToonMaterial({ ...rest, gradientMap: gradientMap(ramp) });
  // WebGLPrograms honours flatShading on every material; the typings just don't declare it here.
  Object.assign(mat, { flatShading: flat });
  return patch(mat);
}

/** A glTF material (characters) as a cel material, keeping colour, maps, vertex colours and glow. */
export function toToon(src: THREE.MeshStandardMaterial): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    name: src.name,
    color: src.color.clone(),
    map: src.map,
    gradientMap: gradientMap('soft'),
    emissive: src.emissive.clone(),
    emissiveIntensity: src.emissiveIntensity,
    emissiveMap: src.emissiveMap,
    alphaMap: src.alphaMap,
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    side: src.side,
    vertexColors: src.vertexColors,
  });
  return patch(mat);
}
