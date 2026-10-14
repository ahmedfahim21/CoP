import * as THREE from 'three';

/**
 * The illustrated look: the scene renders at one virtual pixel per CSS pixel (an integer
 * scale of the drawing buffer, so pixels stay square and edges stay crisp), then one
 * full-screen pass draws it back up snapped to that grid with:
 *
 *   ink outlines -> exposure + soft shoulder -> split tone -> saturation
 *   -> linear->sRGB -> posterize with an ordered dither on the virtual pixel grid
 *
 * Ink comes from the second difference of *reciprocal* depth, which is exactly zero across
 * any plane however oblique, so the ground never inks and only real silhouettes and creases
 * do — clean, bold outlines like GBA sprite art. The ink, shoulder and
 * split tone follow the sadak engine's `fx/celShader.ts`, itself adapted from sakura-crossing
 * (https://github.com/Kenton-GMI/sakura-crossing), MIT License, Copyright (c) 2026 Kenton Wang.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  #include <packing>

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform float uScale;
  uniform float cameraNear;
  uniform float cameraFar;

  uniform vec3 uInkColor;
  uniform float uInkSens;
  uniform float uInkWidth;
  uniform float uInkConcave;
  uniform float uInkFadeStart;
  uniform float uInkFadeEnd;

  uniform float uExposure;
  uniform float uKnee;
  uniform vec3 uSplitShadow;
  uniform vec3 uSplitLight;
  uniform float uSaturation;
  uniform float uLevels;
  uniform float uDither;

  // 2x2 -> 4x4 Bayer thresholds in [0, 1), closed form (no lookup texture).
  float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

  float viewDepth(vec2 uv) {
    return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
  }

  vec3 linearToSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0031308)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    // The virtual pixel this screen pixel belongs to, and that pixel's centre.
    vec2 px = floor(gl_FragCoord.xy / uScale);
    vec2 texel = 1.0 / uRes;
    vec2 uv = (px + 0.5) * texel;

    vec3 col = texture2D(tColor, uv).rgb;
    float raw = texture2D(tDepth, uv).x;
    float edge = 0.0;
    if (raw < 0.9999) {
      float dc = viewDepth(uv);
      float wc = 1.0 / dc;
      vec2 t = texel * uInkWidth;
      float wl = 1.0 / viewDepth(uv - vec2(t.x, 0.0));
      float wr = 1.0 / viewDepth(uv + vec2(t.x, 0.0));
      float wu = 1.0 / viewDepth(uv + vec2(0.0, t.y));
      float wd = 1.0 / viewDepth(uv - vec2(0.0, t.y));
      // Positive where the neighbours are farther: the near side of a silhouette.
      float sx = (2.0 * wc - wl - wr) / wc;
      float sy = (2.0 * wc - wu - wd) / wc;
      float convex = max(0.0, sx) + max(0.0, sy);
      float concave = max(0.0, -sx) + max(0.0, -sy);
      edge = max(step(uInkSens, convex), step(uInkConcave, concave) * 0.55);
      edge *= 1.0 - smoothstep(uInkFadeStart, uInkFadeEnd, dc);
    }

    // Exposure, then a soft shoulder so hot sun bands roll off instead of clipping.
    col *= uExposure;
    vec3 over = max(col - uKnee, 0.0);
    float span = 1.0 - uKnee;
    col = min(col, vec3(uKnee)) + span * (1.0 - exp(-over / span));

    // Split tone: cool in the darks, warm in the lights.
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col *= mix(uSplitShadow, uSplitLight, smoothstep(0.02, 0.55, l));
    l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, uSaturation);

    col = linearToSRGB(clamp(col, 0.0, 1.0));

    // A reduced palette with a fine ordered dither: flat, clean colour fields.
    float steps = uLevels - 1.0;
    col = floor(col * steps + 0.5 + (bayer4(px) - 0.5) * uDither) / steps;

    // Outlines are a dark shade of what they outline, as in GBA sprites, not flat black.
    vec3 line = mix(uInkColor, col * 0.32, 0.45);
    col = mix(col, line, edge);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class GbaPass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly uniforms = {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uScale: { value: 1 },
    cameraNear: { value: 0.5 },
    cameraFar: { value: 200 },
    uInkColor: { value: new THREE.Color(0x14102a) },
    uInkSens: { value: 0.012 },
    /** Outline width in virtual pixels. */
    uInkWidth: { value: 1.5 },
    uInkConcave: { value: 0.05 },
    uInkFadeStart: { value: 80 },
    uInkFadeEnd: { value: 130 },
    uExposure: { value: 0.96 },
    uKnee: { value: 0.8 },
    uSplitShadow: { value: new THREE.Vector3(0.84, 0.86, 1.0) },
    uSplitLight: { value: new THREE.Vector3(1.03, 1.0, 0.94) },
    uSaturation: { value: 1.12 },
    uLevels: { value: 24 },
    uDither: { value: 0.6 },
  };

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.uniforms.tColor.value = this.target.texture;
    this.uniforms.tDepth.value = this.target.depthTexture;
    const material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** `width`/`height` in device pixels (the canvas's drawing buffer); one virtual pixel per CSS pixel. */
  setSize(width: number, height: number, pixelRatio: number) {
    const scale = Math.max(1, Math.round(pixelRatio));
    const w = Math.ceil(width / scale);
    const h = Math.ceil(height / scale);
    this.target.setSize(w, h);
    this.uniforms.uRes.value.set(w, h);
    this.uniforms.uScale.value = scale;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.uniforms.cameraNear.value = camera.near;
    this.uniforms.cameraFar.value = camera.far;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
