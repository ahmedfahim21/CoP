import * as THREE from 'three';
import type { Point, Team } from '@cop/shared';
import { fromScene } from './coords.js';

export interface StageOptions {
  /** Which side the camera sits behind. */
  team: Team;
  /** 'battle' frames the whole arena for play; 'diorama' is the menu's angled showcase. */
  framing: 'battle' | 'diorama';
  shadows: boolean;
}

type FrameFn = (dt: number, t: number) => void;

/**
 * Renderer, camera, lights and the frame loop. Owns nothing game-specific: the arena,
 * towers and units add themselves to `scene` and register per-frame callbacks.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  private readonly frameFns = new Set<FrameFn>();
  private readonly timer = new THREE.Timer();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly resizeObserver: ResizeObserver;
  private running = false;
  private shakeAmount = 0;
  private elapsed = 0;
  private orbit = 0;

  constructor(readonly host: HTMLElement, readonly opts: StageOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps the saturated, toy-like greens; ACES greys them out.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = opts.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.classList.add('stage-canvas');
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    host.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x4f8f37);
    // Only the far scenery fades; the field itself is always well inside the near distance.
    this.scene.fog = new THREE.Fog(0x4f8f37, 85, 150);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);

    const hemi = new THREE.HemisphereLight(0xdff1ff, 0x5d7a3a, 1.35);
    this.scene.add(hemi);
    // Sun upper-left and slightly behind the near side, so towers throw shadows down-right.
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.position.set(-10, 26, 12);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = opts.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 70;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  /** Kick the camera; strength decays over about half a second. */
  shake(amount: number) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  onFrame(fn: FrameFn): () => void {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  dispose() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.timer.dispose();
    this.frameFns.clear();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Ground point (world tiles) under a client-space pointer, or null if it misses the ground. */
  pickGround(clientX: number, clientY: number): Point | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return null;
    return fromScene(hit.x, hit.z);
  }

  /** Scene point → pixel position inside the host element; `visible` is false behind the camera. */
  project(p: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const v = p.clone().project(this.camera);
    return {
      x: ((v.x + 1) / 2) * this.host.clientWidth,
      y: ((1 - v.y) / 2) * this.host.clientHeight,
      visible: v.z < 1,
    };
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.frame();
  }

  /** Fits the arena to the viewport: width-limited on phones, height-limited on wide screens. */
  private frame() {
    const cam = this.camera;
    const side = this.opts.team === 0 ? 1 : -1;
    if (this.opts.framing === 'diorama') {
      cam.fov = 30;
      // Width-limited: the whole field plus a strip of houses either side stays in shot.
      const r = Math.max(52, 30 / cam.aspect);
      cam.position.set(Math.sin(this.orbit) * r * 0.45, r * 0.8, side * Math.cos(this.orbit) * r * 0.55);
      cam.lookAt(0, 0, side * 1.5);
      cam.updateProjectionMatrix();
      return;
    }
    // Pitched like Clash Royale: steep enough to read lanes, shallow enough to see tower faces.
    const pitch = THREE.MathUtils.degToRad(56);
    cam.fov = 30;
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    // Distance so the 19.5-tile-wide field (with walls) fills the width, or the 34-tile depth fits the height.
    const needW = 19.6 / (2 * Math.tan(vFov / 2) * cam.aspect);
    // Depth budget includes headroom for the far king tower and the HUD strip over it.
    const needH = (37 * Math.sin(pitch)) / (2 * Math.tan(vFov / 2)) + 3;
    const dist = Math.max(needW, needH);
    const look = new THREE.Vector3(0, 0, side * 0.2);
    cam.position.set(0, look.y + Math.sin(pitch) * dist, look.z + side * Math.cos(pitch) * dist);
    cam.lookAt(look);
    cam.updateProjectionMatrix();
  }

  private tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.elapsed += dt;
    if (this.opts.framing === 'diorama') {
      // A slow sway rather than a full orbit, so the hero angle never turns into a side view.
      this.orbit = Math.sin(this.elapsed * 0.18) * 0.35;
      this.frame();
    }
    for (const fn of this.frameFns) fn(dt, this.elapsed);
    // Shake is a render-only offset: applied, rendered, then undone, so framing never drifts.
    const cam = this.camera.position;
    const ox = (Math.random() - 0.5) * this.shakeAmount * 0.5;
    const oy = (Math.random() - 0.5) * this.shakeAmount * 0.5;
    cam.x += ox;
    cam.y += oy;
    this.renderer.render(this.scene, this.camera);
    cam.x -= ox;
    cam.y -= oy;
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.8);
  }
}
