import Phaser from 'phaser';
import {
  ARENA_W, BRIDGE_HALF_WIDTH, BRIDGE_XS, CARDS, DEPLOY_MIN_Y, POCKET_MIN_Y, RIVER_BOTTOM, RIVER_TOP,
  isValidDeploy, openPocketsFrom, statsOf,
  type CardId, type Entity, type ErrorMessage, type GameEvent, type HandMessage, type Point, type Team,
} from '@cop/shared';
import type { EntityState, ProjectileState } from '@cop/shared/schema';
import type { Session } from '../net.js';
import {
  ARENA_PX_H, ARENA_PX_W, BOTTOM_HUD, COLORS, GAME_W, TILE, TOP_HUD, TYPE_COLORS, inArena, screenToLocal, toScreen,
} from '../layout.js';
import {
  POKE_BALL_KEY, POKE_BALL_URL, allPokemonDex, dexOf, pokemonKey, pokemonSpriteUrl, trainerKey, trainerSpriteUrl,
} from '../sprites.js';

export interface BattleData {
  session: Session;
  onEnded(): void;
}

const DISPLAY_FONT = '"Press Start 2P", monospace';
const BODY_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const SMOOTHING = 14;

interface View {
  kind: Entity['kind'];
  team: Team;
  defId: string;
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text | null;
  lastHp: number;
  flying: boolean;
  /** Target screen position from the latest patch. */
  tx: number;
  ty: number;
}

interface CardSlot {
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Graphics;
  sprite: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  cost: Phaser.GameObjects.Text;
  baseY: number;
  card: CardId | null;
}

const ERROR_TEXT: Record<ErrorMessage['error'], string> = {
  'not-enough-elixir': 'Not enough elixir',
  'bad-position': "Can't deploy there",
  'not-playing': 'Wait for the battle to start',
  'bad-slot': 'That play was rejected',
  'bad-message': 'That play was rejected',
};

export class BattleScene extends Phaser.Scene {
  private session!: Session;
  private onEnded!: () => void;
  private team!: Team;

  private views = new Map<string, View>();
  private projectiles = new Map<string, { obj: Phaser.GameObjects.Arc | Phaser.GameObjects.Image; tx: number; ty: number }>();
  private loadErrors: string[] = [];
  private lastLabelAt = new Map<string, number>();

  private cards: CardSlot[] = [];
  private nextCard!: CardSlot;
  private selected: number | null = null;
  private dragging = false;
  /**
   * Slots with a play in flight, oldest first. The server answers every play with exactly one
   * `hand` (success) or `error` message, in order, so each reply settles the oldest entry.
   */
  private inFlight: number[] = [];
  private zone!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Image;

  private timerText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;
  private myCrowns!: Phaser.GameObjects.Text;
  private enemyCrowns!: Phaser.GameObjects.Text;
  private elixirBar!: Phaser.GameObjects.Graphics;
  private elixirText!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private endedNotified = false;

  constructor() {
    super('battle');
  }

  /** Scenes are reused across matches, so all per-match state is reset here. */
  init(data: BattleData) {
    this.session = data.session;
    this.onEnded = data.onEnded;
    const team = data.session.team;
    if (team === undefined) throw new Error('Battle started before the player was assigned a team');
    this.team = team;
    this.views = new Map();
    this.projectiles = new Map();
    this.loadErrors = [];
    this.lastLabelAt = new Map();
    this.cards = [];
    this.selected = null;
    this.dragging = false;
    this.inFlight = [];
    this.endedNotified = false;
  }

  preload() {
    this.load.setCORS('anonymous');
    const queue = (key: string, url: string) => {
      if (!this.textures.exists(key)) this.load.image(key, url);
    };
    for (const dex of allPokemonDex()) {
      queue(pokemonKey(dex, 'front'), pokemonSpriteUrl(dex, 'front'));
      queue(pokemonKey(dex, 'back'), pokemonSpriteUrl(dex, 'back'));
    }
    queue(trainerKey('red'), trainerSpriteUrl('red'));
    queue(trainerKey('blue'), trainerSpriteUrl('blue'));
    queue(POKE_BALL_KEY, POKE_BALL_URL);

    const label = this.add.text(GAME_W / 2, TOP_HUD + ARENA_PX_H / 2, 'Loading sprites…', { fontFamily: BODY_FONT, fontSize: '18px', color: '#f3f1ea' }).setOrigin(0.5).setResolution(2);
    this.load.on('progress', (v: number) => label.setText(`Loading sprites… ${Math.round(v * 100)}%`));
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.error(`Sprite failed to load: ${file.key} (${String(file.url)})`);
      this.loadErrors.push(file.key);
    });
    this.load.once('complete', () => label.destroy());
  }

  create() {
    for (const key of this.textures.getTextureKeys()) {
      if (key.startsWith('pkmn-') || key.startsWith('trainer-') || key === POKE_BALL_KEY) {
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
    this.drawArena();
    this.createTopHud();
    this.createBottomHud();

    this.zone = this.add.graphics().setDepth(5000).setVisible(false);
    this.ghost = this.add.image(0, 0, POKE_BALL_KEY).setAlpha(0.65).setDepth(5001).setVisible(false).setOrigin(0.5, 0.7);
    this.countdownText = this.text(GAME_W / 2, TOP_HUD + ARENA_PX_H / 2, '', 40, true).setOrigin(0.5).setDepth(6000).setStroke('#151a26', 8);
    this.toastText = this.text(GAME_W / 2, TOP_HUD + ARENA_PX_H - 48, '', 15).setOrigin(0.5).setDepth(6000).setAlpha(0)
      .setBackgroundColor('#151a26cc').setPadding(12, 8, 12, 8);

    if (this.loadErrors.length > 0) {
      this.text(GAME_W / 2, TOP_HUD + 8, `${this.loadErrors.length} sprite(s) failed to load — see console`, 13)
        .setOrigin(0.5, 0).setColor('#ff6b5e').setDepth(7000).setBackgroundColor('#151a26').setPadding(8, 4, 8, 4);
    }

    const unsubs = [
      this.session.on('hand', (m) => this.setHand(m)),
      this.session.on('fx', (events) => this.playFx(events)),
      this.session.on('error', (m) => {
        this.inFlight.shift();
        this.toast(ERROR_TEXT[m.error]);
      }),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => unsubs.forEach((u) => u()));

    this.setupInput();
    // The opening hand usually arrives while sprites are still loading.
    if (this.session.hand) this.setHand(this.session.hand);
  }

  update(_time: number, deltaMs: number) {
    const state = this.session.state;
    const k = Math.min(1, (deltaMs / 1000) * SMOOTHING);
    this.syncEntities(k);
    this.syncProjectiles(k);
    this.updateHud();
    if (state.phase === 'ended' && !this.endedNotified) {
      this.endedNotified = true;
      this.deselect();
      this.time.delayedCall(1200, () => this.onEnded());
    }
  }

  // --- Arena ---

  private drawArena() {
    const g = this.add.graphics().setDepth(-100);
    for (let y = 0; y < ARENA_PX_H / TILE; y++) {
      for (let x = 0; x < ARENA_W; x++) {
        g.fillStyle((x + y) % 2 === 0 ? COLORS.grassA : COLORS.grassB);
        g.fillRect(x * TILE, TOP_HUD + y * TILE, TILE, TILE);
      }
    }
    // Lanes from princess towers to the bridges.
    g.fillStyle(COLORS.path, 0.45);
    for (const bx of BRIDGE_XS) g.fillRect((bx - 0.5) * TILE, TOP_HUD + 6.5 * TILE, TILE, 19 * TILE);

    const riverY = TOP_HUD + RIVER_TOP * TILE;
    g.fillStyle(COLORS.river);
    g.fillRect(0, riverY, ARENA_PX_W, (RIVER_BOTTOM - RIVER_TOP) * TILE);
    g.fillStyle(COLORS.riverEdge);
    g.fillRect(0, riverY, ARENA_PX_W, 3);
    g.fillRect(0, riverY + (RIVER_BOTTOM - RIVER_TOP) * TILE - 3, ARENA_PX_W, 3);

    for (const bx of BRIDGE_XS) {
      const x = (bx - BRIDGE_HALF_WIDTH) * TILE;
      const w = BRIDGE_HALF_WIDTH * 2 * TILE;
      g.fillStyle(COLORS.bridge);
      g.fillRect(x, riverY - 8, w, (RIVER_BOTTOM - RIVER_TOP) * TILE + 16);
      g.fillStyle(COLORS.bridgePlank);
      for (let py = riverY - 8; py < riverY + (RIVER_BOTTOM - RIVER_TOP) * TILE + 8; py += 9) g.fillRect(x, py, w, 2);
    }
    g.lineStyle(4, COLORS.border);
    g.strokeRect(2, TOP_HUD + 2, ARENA_PX_W - 4, ARENA_PX_H - 4);
  }

  // --- Entities ---

  private syncEntities(k: number) {
    const seen = new Set<string>();
    this.session.state.entities.forEach((e: EntityState, id: string) => {
      seen.add(id);
      const p = toScreen(this.team, e);
      let view = this.views.get(id);
      if (!view) {
        view = e.kind === 'unit' ? this.createUnit(e, p) : this.createTower(e, p);
        this.views.set(id, view);
      }
      view.tx = p.x;
      view.ty = p.y;
      const c = view.container;
      c.x += (view.tx - c.x) * k;
      c.y += (view.ty - c.y) * k;
      c.setDepth(c.y + (view.flying ? 2000 : 0));
      if (view.kind === 'unit') c.setAlpha(e.deploying ? 0.55 : 1);
      if (e.hp !== view.lastHp) {
        view.lastHp = e.hp;
        this.drawHp(view, e.hp, e.maxHp);
      }
    });
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.views.delete(id);
      this.poof(view.container.x, view.container.y);
      if (view.kind === 'unit') view.container.destroy();
      else this.ruin(view);
    }
  }

  private createUnit(e: EntityState, p: Point): View {
    const mine = e.team === this.team;
    const stats = statsOf({ kind: 'unit', defId: e.defId as CardId });
    const size = TILE * (1.3 + stats.radius * 1.6);
    const ground = this.add.graphics();
    if (stats.flying) {
      ground.fillStyle(0x000000, 0.22).fillEllipse(0, 0, stats.radius * TILE * 2.2, stats.radius * TILE * 1.1);
    } else {
      ground.fillStyle(mine ? COLORS.mine : COLORS.enemy, 0.35).fillEllipse(0, 0, stats.radius * TILE * 2.6, stats.radius * TILE * 1.4);
      ground.lineStyle(2, mine ? COLORS.mine : COLORS.enemy, 0.9).strokeEllipse(0, 0, stats.radius * TILE * 2.6, stats.radius * TILE * 1.4);
    }
    const sprite = this.add.image(0, stats.flying ? -16 : 0, pokemonKey(dexOf(e.defId), mine ? 'back' : 'front'))
      .setOrigin(0.5, 0.72).setDisplaySize(size, size);
    const hpBar = this.add.graphics().setPosition(0, sprite.y - size * 0.62);
    const container = this.add.container(p.x, p.y, [ground, sprite, hpBar]);
    return { kind: 'unit', team: e.team as Team, defId: e.defId, container, sprite, hpBar, hpText: null, lastHp: e.hp, flying: stats.flying, tx: p.x, ty: p.y };
  }

  private createTower(e: EntityState, p: Point): View {
    const mine = e.team === this.team;
    const king = e.kind === 'king';
    const half = (king ? 2 : 1.5) * TILE;
    const base = this.add.graphics();
    base.fillStyle(COLORS.stoneDark).fillRoundedRect(-half, -half + 6, half * 2, half * 2, 12);
    base.fillStyle(COLORS.stone).fillRoundedRect(-half, -half, half * 2, half * 2, 12);
    base.lineStyle(4, mine ? COLORS.mine : COLORS.enemy).strokeRoundedRect(-half + 4, -half + 4, half * 2 - 8, half * 2 - 8, 9);

    const sprite = king
      ? this.add.image(0, -6, trainerKey(mine ? 'red' : 'blue')).setDisplaySize(half * 1.9, half * 1.9)
      : this.add.image(0, -6, pokemonKey(dexOf(e.defId), mine ? 'back' : 'front')).setDisplaySize(half * 2.7, half * 2.7);
    // HP sits on the river side so the enemy king's bar never hides under the top HUD.
    const barY = mine ? -half - 12 : half + 10;
    const hpBar = this.add.graphics().setPosition(0, barY);
    const hpText = this.text(0, mine ? barY - 12 : barY + 20, String(e.hp), 9, true).setOrigin(0.5, 0.5).setStroke('#151a26', 4);
    const container = this.add.container(p.x, p.y, [base, sprite, hpBar, hpText]);
    const view: View = { kind: e.kind as Entity['kind'], team: e.team as Team, defId: e.defId, container, sprite, hpBar, hpText, lastHp: e.hp, flying: false, tx: p.x, ty: p.y };
    this.drawHp(view, e.hp, e.maxHp);
    return view;
  }

  private drawHp(view: View, hp: number, maxHp: number) {
    const g = view.hpBar;
    g.clear();
    const tower = view.kind !== 'unit';
    if (!tower && hp >= maxHp) return;
    const w = tower ? (view.kind === 'king' ? 4 : 3) * TILE - 16 : 30;
    const h = tower ? 7 : 5;
    g.fillStyle(COLORS.hpBg).fillRect(-w / 2, 0, w, h);
    g.fillStyle(view.team === this.team ? COLORS.mine : COLORS.enemy).fillRect(-w / 2, 0, w * Math.max(0, hp / maxHp), h);
    view.hpText?.setText(String(hp));
  }

  /** A destroyed tower leaves rubble behind. */
  private ruin(view: View) {
    view.sprite.destroy();
    view.hpBar.destroy();
    view.hpText?.destroy();
    const half = (view.kind === 'king' ? 2 : 1.5) * TILE;
    const g = this.add.graphics();
    g.fillStyle(0x5d574d, 0.9).fillRoundedRect(-half, -half, half * 2, half * 2, 12);
    g.fillStyle(0x8a8273);
    for (const [x, y, r] of [[-0.4, -0.3, 0.32], [0.35, 0.1, 0.28], [-0.1, 0.4, 0.22], [0.3, -0.45, 0.18]] as const) {
      g.fillCircle(x * half, y * half, r * half);
    }
    view.container.add(g);
  }

  private syncProjectiles(k: number) {
    const seen = new Set<string>();
    this.session.state.projectiles.forEach((pr: ProjectileState, id: string) => {
      seen.add(id);
      const p = toScreen(this.team, pr);
      let view = this.projectiles.get(id);
      if (!view) {
        const obj = pr.sourceDefId === 'trainer'
          ? this.add.image(p.x, p.y, POKE_BALL_KEY).setScale(0.8)
          : this.add.circle(p.x, p.y, 5, TYPE_COLORS[this.moveTypeOf(pr.sourceDefId)] ?? 0xffffff).setStrokeStyle(2, 0x151a26, 0.6);
        obj.setDepth(4000);
        view = { obj, tx: p.x, ty: p.y };
        this.projectiles.set(id, view);
      }
      view.tx = p.x;
      view.ty = p.y;
      view.obj.x += (view.tx - view.obj.x) * Math.min(1, k * 1.5);
      view.obj.y += (view.ty - view.obj.y) * Math.min(1, k * 1.5);
    });
    for (const [id, view] of this.projectiles) {
      if (seen.has(id)) continue;
      view.obj.destroy();
      this.projectiles.delete(id);
    }
  }

  private moveTypeOf(defId: string): string {
    const kind = defId === 'trainer' ? 'king' : defId in CARDS ? 'unit' : 'princess';
    return statsOf({ kind, defId: defId as Entity['defId'] }).move.type;
  }

  // --- Effects ---

  private playFx(events: GameEvent[]) {
    for (const ev of events) {
      if (ev.type === 'hit') {
        const view = this.views.get(ev.targetId);
        if (view) this.flash(view.sprite);
        if (ev.effectiveness !== 'neutral') this.effectivenessLabel(ev.targetId, ev, ev.effectiveness);
      } else if (ev.type === 'spawn') {
        const p = toScreen(this.team, ev);
        const ring = this.add.circle(p.x, p.y, TILE * 0.8).setStrokeStyle(3, ev.team === this.team ? COLORS.mine : COLORS.enemy).setDepth(3000);
        this.tweens.add({ targets: ring, scale: 1.8, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
      }
    }
  }

  private flash(sprite: Phaser.GameObjects.Image) {
    if (!sprite.active) return;
    sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(70, () => {
      if (sprite.active) sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    });
  }

  private effectivenessLabel(targetId: string, at: Point, effectiveness: 'super' | 'weak' | 'immune') {
    const now = this.time.now;
    if ((this.lastLabelAt.get(targetId) ?? -Infinity) > now - 1500) return;
    this.lastLabelAt.set(targetId, now);
    const p = toScreen(this.team, at);
    const label = effectiveness === 'super' ? "It's super effective!" : effectiveness === 'weak' ? 'Not very effective…' : 'Barely any effect…';
    const t = this.text(p.x, p.y - 30, label, 12).setOrigin(0.5).setDepth(5500)
      .setColor(effectiveness === 'super' ? '#ffd93d' : '#d5d9e3').setStroke('#151a26', 4);
    this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, delay: 350, duration: 700, onComplete: () => t.destroy() });
  }

  private poof(x: number, y: number) {
    const c = this.add.circle(x, y, TILE * 0.5, 0xffffff, 0.8).setDepth(4500);
    this.tweens.add({ targets: c, scale: 2, alpha: 0, duration: 300, onComplete: () => c.destroy() });
  }

  private toast(message: string) {
    this.toastText.setText(message).setAlpha(1);
    this.tweens.killTweensOf(this.toastText);
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: 1100, duration: 300 });
  }

  // --- HUD ---

  private text(x: number, y: number, value: string, size: number, display = false) {
    return this.add.text(x, y, value, { fontFamily: display ? DISPLAY_FONT : BODY_FONT, fontSize: `${size}px`, color: '#f3f1ea' }).setResolution(2);
  }

  private createTopHud() {
    this.add.rectangle(0, 0, GAME_W, TOP_HUD, COLORS.hud).setOrigin(0).setDepth(8000);
    this.text(14, 12, 'Rival', 12).setDepth(8001).setColor('#9aa3b8');
    this.enemyCrowns = this.text(14, 32, '0 crowns', 12, true).setDepth(8001).setColor('#ff7a70');
    this.text(GAME_W - 14, 12, 'You', 12).setOrigin(1, 0).setDepth(8001).setColor('#9aa3b8');
    this.myCrowns = this.text(GAME_W - 14, 32, '0 crowns', 12, true).setOrigin(1, 0).setDepth(8001).setColor('#78a6ff');
    this.timerText = this.text(GAME_W / 2, 14, '3:00', 18, true).setOrigin(0.5, 0).setDepth(8001);
    this.phaseText = this.text(GAME_W / 2, 40, '', 12).setOrigin(0.5, 0).setDepth(8001).setColor('#ffcb3d');
  }

  private createBottomHud() {
    const y0 = TOP_HUD + ARENA_PX_H;
    this.add.rectangle(0, y0, GAME_W, BOTTOM_HUD, COLORS.hud).setOrigin(0).setDepth(8000);

    const left = 78;
    const gap = 6;
    const w = (GAME_W - left - 8 - gap * 3) / 4;
    const h = 136;
    for (let i = 0; i < 4; i++) {
      const slot = this.createCard(left + i * (w + gap), y0 + 14, w, h, false);
      const zone = this.add.zone(left + i * (w + gap), y0 + 14, w, h).setOrigin(0).setInteractive().setDepth(8100);
      zone.on('pointerdown', () => this.selectCard(i));
      this.cards.push(slot);
    }
    this.text(8 + 31, y0 + 20, 'Next', 11).setOrigin(0.5, 0).setDepth(8001).setColor('#9aa3b8');
    this.nextCard = this.createCard(8, y0 + 40, 62, 80, true);

    this.elixirBar = this.add.graphics().setDepth(8001);
    this.add.circle(39, y0 + 175, 20, COLORS.elixir).setDepth(8001).setStrokeStyle(3, 0xf3c8f5);
    this.elixirText = this.text(39, y0 + 176, '5', 14, true).setOrigin(0.5).setDepth(8002);
  }

  private createCard(x: number, y: number, w: number, h: number, mini: boolean): CardSlot {
    const frame = this.add.graphics();
    frame.fillStyle(COLORS.hudCard).fillRoundedRect(0, 0, w, h, 10);
    const spriteSize = mini ? 56 : 92;
    const sprite = this.add.image(w / 2, mini ? 34 : 56, POKE_BALL_KEY).setData('size', spriteSize).setVisible(false);
    const name = this.text(w / 2, h - (mini ? 14 : 20), '', mini ? 10 : 13).setOrigin(0.5);
    const costBg = this.add.circle(mini ? 12 : 16, mini ? 12 : 16, mini ? 10 : 13, COLORS.elixir).setStrokeStyle(2, 0xf3c8f5);
    const cost = this.text(costBg.x, costBg.y + 1, '', mini ? 8 : 11, true).setOrigin(0.5);
    const container = this.add.container(x, y, [frame, sprite, name, costBg, cost]).setDepth(8001);
    return { container, frame, sprite, name, cost, baseY: y, card: null };
  }

  private fillCard(slot: CardSlot, card: CardId, w: number, h: number) {
    const def = CARDS[card];
    slot.card = card;
    // Display size is a scale of the current frame, so it must be re-applied after a texture swap.
    const size = slot.sprite.getData('size') as number;
    slot.sprite.setTexture(pokemonKey(def.dex, 'front')).setDisplaySize(size, size).setVisible(true);
    slot.name.setText(def.count > 1 ? `${def.name} ×${def.count}` : def.name);
    slot.cost.setText(String(def.cost));
    slot.frame.clear().fillStyle(COLORS.hudCard).fillRoundedRect(0, 0, w, h, 10);
  }

  private setHand(m: HandMessage) {
    this.inFlight.shift();
    if (this.cards.length === 0) return; // create() will apply it
    // Keep a selection (or a drag in progress) unless its card was the one replaced.
    if (this.selected !== null && this.cards[this.selected]!.card !== m.hand[this.selected]) this.deselect();
    const w = (GAME_W - 78 - 8 - 18) / 4;
    m.hand.forEach((card, i) => this.fillCard(this.cards[i]!, card, w, 136));
    this.fillCard(this.nextCard, m.next, 62, 80);
  }

  private myElixir(): number {
    return this.session.state.players.get(this.session.room.sessionId)?.elixir ?? 0;
  }

  private updateHud() {
    const s = this.session.state;
    const t = Math.max(0, Math.ceil(s.timeLeft));
    this.timerText.setText(s.phase === 'countdown' ? '3:00' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    this.phaseText.setText(
      s.phase === 'overtime' ? 'Overtime · 2× elixir' : s.doubleElixir ? '2× elixir' : s.phase === 'ended' ? 'Battle over' : '',
    );
    this.countdownText.setText(s.phase === 'countdown' ? String(Math.max(1, t)) : '');

    s.players.forEach((p) => {
      const label = `${p.crowns} crown${p.crowns === 1 ? '' : 's'}`;
      (p.team === this.team ? this.myCrowns : this.enemyCrowns).setText(label);
    });

    const elixir = this.myElixir();
    this.elixirText.setText(String(Math.floor(elixir)));
    const y0 = TOP_HUD + ARENA_PX_H + 162;
    const x0 = 66;
    const w = GAME_W - x0 - 10;
    const g = this.elixirBar.clear();
    g.fillStyle(COLORS.elixirBg).fillRoundedRect(x0, y0, w, 26, 8);
    g.fillStyle(COLORS.elixir).fillRoundedRect(x0, y0, Math.max(8, (w * elixir) / 10), 26, 8);
    g.lineStyle(2, COLORS.hud, 0.8);
    for (let i = 1; i < 10; i++) g.lineBetween(x0 + (w * i) / 10, y0 + 2, x0 + (w * i) / 10, y0 + 24);

    const playing = s.phase === 'regular' || s.phase === 'overtime';
    this.cards.forEach((slot, i) => {
      const usable = playing && !this.inFlight.includes(i) && slot.card !== null && CARDS[slot.card].cost <= elixir;
      slot.container.setAlpha(usable ? 1 : 0.45);
      slot.container.y = slot.baseY - (this.selected === i ? 12 : 0);
    });
    if (this.selected !== null && !this.cardUsable(this.selected)) this.deselect();
  }

  private cardUsable(i: number): boolean {
    const s = this.session.state;
    const card = this.cards[i]?.card;
    return (s.phase === 'regular' || s.phase === 'overtime') && !this.inFlight.includes(i) && card != null && CARDS[card].cost <= this.myElixir();
  }

  // --- Input ---

  private setupInput() {
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveGhost(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      // Tap-to-place: card selected earlier, now tapping the arena.
      if (this.selected !== null && over.length === 0 && inArena(p)) this.tryPlay(p);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (inArena(p)) this.tryPlay(p);
      else this.ghost.setVisible(false); // released on the HUD: keep the card selected for tap-to-place
    });
  }

  private selectCard(i: number) {
    if (!this.cardUsable(i)) {
      const card = this.cards[i]?.card;
      if (card && !this.inFlight.includes(i) && this.session.state.phase !== 'countdown') this.toast('Not enough elixir');
      return;
    }
    this.selected = i;
    this.dragging = true;
    const card = this.cards[i]!.card!;
    const def = CARDS[card];
    const size = TILE * (1.3 + def.stats.radius * 1.6);
    this.ghost.setTexture(pokemonKey(def.dex, 'back')).setDisplaySize(size, size).setVisible(false);
    this.drawZone();
  }

  private deselect() {
    this.selected = null;
    this.dragging = false;
    this.ghost?.setVisible(false);
    this.zone?.setVisible(false);
  }

  private moveGhost(p: Phaser.Input.Pointer) {
    if (this.selected === null) return;
    const show = inArena(p);
    this.ghost.setVisible(show);
    if (show) {
      const valid = this.validAt(p);
      this.ghost.setPosition(p.x, p.y).setAlpha(valid ? 0.75 : 0.3);
    }
  }

  private validAt(p: Point): boolean {
    return isValidDeploy(screenToLocal(p), openPocketsFrom(this.session.state.entities.values(), this.team));
  }

  /** Shades where the selected card can't be deployed. */
  private drawZone() {
    const pockets = openPocketsFrom(this.session.state.entities.values(), this.team);
    const g = this.zone.clear().setVisible(true);
    g.fillStyle(0xd0342c, 0.22);
    g.fillRect(0, TOP_HUD, ARENA_PX_W, POCKET_MIN_Y * TILE);
    const half = ARENA_PX_W / 2;
    for (const lane of ['left', 'right'] as const) {
      if (pockets.has(lane)) continue;
      g.fillRect(lane === 'left' ? 0 : half, TOP_HUD + POCKET_MIN_Y * TILE, half, (DEPLOY_MIN_Y - POCKET_MIN_Y) * TILE);
    }
  }

  private tryPlay(p: Point) {
    const slot = this.selected;
    if (slot === null) return;
    if (!this.validAt(p)) {
      this.toast("Can't deploy there");
      this.ghost.setVisible(false);
      return;
    }
    const local = screenToLocal(p);
    this.inFlight.push(slot);
    this.session.play({ slot, x: local.x, y: local.y });
    this.deselect();
  }
}
