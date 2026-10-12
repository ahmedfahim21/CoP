import * as THREE from 'three';
import { STARTER_IDS, type StarterPick } from '@cop/shared';
import { buildArena, towerScenePositions } from './arena.js';
import { Fx } from './fx.js';
import { Stage } from './stage.js';
import { TowerView, type FrameCtx } from './views.js';

/**
 * The menu's arena showcase: the real arena and towers with your starters on your side,
 * idling under a slowly swaying camera.
 */
export function createDiorama(host: HTMLElement, starters: StarterPick): { dispose(): void } {
  const stage = new Stage(host, { team: 0, framing: 'diorama', shadows: true });
  const arena = buildArena();
  const fx = new Fx();
  stage.scene.add(arena.group, fx.group);
  const rival = STARTER_IDS.filter((s) => !starters.includes(s));
  const enemyPick: StarterPick = [rival[0] ?? 'bulbasaur', starters[0]];
  const towers: TowerView[] = [];
  for (const team of [0, 1] as const) {
    const pos = towerScenePositions(team);
    const pick = team === 0 ? starters : enemyPick;
    const specs = [['king', 'trainer', pos.king], ['princess', pick[0], pos.left], ['princess', pick[1], pos.right]] as const;
    for (const [kind, defId, p] of specs) {
      const t = new TowerView(`d${team}${defId}${kind}`, team, kind, defId, team === 0, p.x, p.z, 1, 1, kind !== 'king');
      towers.push(t);
      stage.scene.add(t.model.group);
    }
  }
  const ctx: FrameCtx = { renderTime: 0, dt: 0, t: 0, fx, positionOf: () => null };
  let nextShot = 1.5;
  stage.onFrame((dt, t) => {
    ctx.dt = dt;
    ctx.t = t;
    arena.update(dt, t);
    for (const tw of towers) tw.update(ctx);
    fx.setViewport(host.clientHeight, stage.camera.fov);
    fx.update(dt);
    // Starters show off their moves now and then.
    if (t > nextShot) {
      nextShot = t + 2.2 + Math.random() * 1.5;
      const tw = towers.filter((x) => x.kind === 'princess')[Math.floor(Math.random() * 4)]!;
      tw.attack('none');
      const m = tw.muzzleWorld();
      fx.mote(m, tw.defId === 'charmander' ? 0xff8a2a : tw.defId === 'squirtle' ? 0x8fd4ff : 0x9be86a, 0.9, 0.3, new THREE.Vector3(0, 0.6, 0));
    }
  });
  stage.start();
  return { dispose: () => stage.dispose() };
}
