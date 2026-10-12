# Clash of Pokémons

A Clash Royale–style 1v1 browser game in 3D. Your king tower is a trainer, your two side towers are starter Pokémon you pick before the match, and every card is a Pokémon. Real-time multiplayer with an authoritative server.

## Run it

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev
```

- Game: http://localhost:5173 (game server on :2567)
- Open two browser windows to play against yourself, or share the invite link from **Create private room**.
- Phones on the same network can join via the "Network" URL Vite prints. The client talks to `<page host>:2567`; set `VITE_SERVER_URL` to point it elsewhere.

## Test

```bash
pnpm test        # shared rules, server room and client maths tests
pnpm typecheck
```

- `packages/shared/src/*.test.ts`: type chart, deploy zones, elixir, targeting, bridges, splash, kamikaze, attack events, towers/crowns, overtime/tiebreak, forfeit, and a bot-vs-bot soak test.
- `apps/server/test/BattleRoom.test.ts`: matchmaking (quick + private), join validation and trainer names, play validation with before/after state snapshots, private hands, projectile sync, disconnect → forfeit, trainer sprite proxy.
- `apps/client/src/three/*.test.ts`: snapshot interpolation and scene coordinate maths.

## How it plays

- **Towers** tab: pick which of Bulbasaur / Charmander / Squirtle guards your left and right towers. Their attacks are typed (Razor Leaf, Ember, Water Gun).
- **Cards** tab: build your 8-card Battle Deck from the 19-card collection (tap a card → **Use** → tap the deck card to replace). Each card shows its stats and speciality.
- **Battle** tab: quick match, or a friendly battle by room code / invite link. Tap the pencil to set your trainer name.
- In battle, drag a card onto your half (a translucent preview shows where it lands), or tap a card and then tap the arena.
- Elixir: start 5, max 10, +1 every 2.8s, doubled in the last minute and overtime.
- Destroying a side tower gives 1 crown and lets you deploy deeper in that lane. Destroying the trainer wins outright.
- 3:00 match. Tied → 1:00 sudden-death overtime → still tied: the side whose weakest tower is healthier wins.
- Type effectiveness uses the real chart, softened for balance: super effective ×1.5, not very effective ×0.75, immune ×0.5.

Every card is a Pokémon; most carry a speciality that borrows a Clash Royale mechanic:

| Card | Cost | Speciality | Clash Royale cousin |
|---|---|---|---|
| Rattata ×4 | 2 | Swarm | Skeleton Army-ish |
| Zubat ×3 | 2 | Flying swarm | Minions |
| Voltorb | 2 | Self-Destruct on first hit | Fire Spirit |
| Pikachu | 3 | Thunderbolt, hits air | Musketeer |
| Machop | 3 | Sturdy melee | Knight |
| Magikarp | 3 | **Evolve**: Splash does nothing; survive 7s and it becomes Gyarados | Card Evolutions |
| Geodude | 3 | **Explosion**: tower-seeking tank that blows up when it faints | Giant Skeleton |
| Dugtrio | 3 | **Dig**: deploy anywhere, tunnels in untargetable | Miner |
| Gengar | 3 | **Shadow**: invisible except when striking | Royal Ghost |
| Lapras | 4 | Ranged tank, hits air | — |
| Chansey | 4 | **Soft-Boiled**: heals nearby troops | Battle Healer |
| Scyther | 4 | **Fury Cutter**: 360° spin hits everything around | Valkyrie |
| Jolteon | 4 | **Thunder Wave**: hits paralyze | Electro Wizard |
| Rapidash | 4 | **River Leap**: fast, towers only, jumps the river | Hog Rider |
| Charizard | 5 | Flying splash | Baby Dragon |
| Tauros | 5 | **Take Down**: charges after a run, double-damage hit | Prince |
| Articuno | 5 | **Freeze**: icy splash slows (legendary) | Ice Wizard |
| Moltres | 5 | **Fire Spin**: beam that ramps up on one target (legendary) | Inferno Dragon |
| Snorlax | 6 | Tank that only attacks towers (legendary) | Giant |

Abilities are data on each card (`packages/shared/src/cards.ts`) and mechanics in the simulation (`sim.ts`), tested one by one in `abilities.test.ts`.

## Animation sandbox

With `pnpm dev` running, open http://localhost:5173/sandbox.html. It runs the real simulation locally and renders it with the real battle view, with one button per speciality (Evolve, Shadow, Dig, River Leap, …), **Replay**, and a **Side** toggle to watch from either camera. Scenes live in `apps/client/src/sandbox/scenarios.ts`; add one to stage any fight. This is the quickest loop for tuning a rig's movement: edit its species file and the sandbox hot-reloads.

## Layout

```
packages/shared   Game rules (pure, deterministic simulation), card/starter data, type chart,
                  network schema and message types. Used by both server and client.
apps/server       Colyseus room: matchmaking, 20 Hz authoritative tick, private hands,
                  20s reconnect window, /sprites/trainer/:name proxy.
apps/client       Vite + three.js battle, DOM menus and HUD.
  src/three/        stage (renderer, camera, lights), arena, towers, fx (particles), views,
                    battle (state mirroring), interp (snapshot buffer), diorama (menu arena)
  src/three/rigs/   kit (rig builder), motion (gaits, gallop, attack curves), species/* (one file per model)
  src/ui/           home (tabs, deck builder), hud (battle overlay + input), cards, overlays, style.css
  src/sandbox/      local-simulation animation sandbox (sandbox.html)
```

The server runs `packages/shared/src/sim.ts`; the client never simulates. It renders server state ~100 ms in the past, blending between real snapshots, and replays server events (attacks, hits, deaths) on that same delayed clock so animations and impacts line up. Plays are sent as `play { slot, x, y }` in the player's own perspective (each player sees their side at the bottom).

### Characters

Every Pokémon and both trainers are built from primitives (`src/three/rigs/species/*.ts`) as a hierarchy of named joints — legs, arms, head, ears, tail, wings, jaw — so each part animates on its own. All rigs animate from a single `Pose` (time, speed, stride phase, attack/hit/land/faint progress), with shared gaits in `motion.ts` (biped, quadruped, wing flap, attack wind-up curve) and species-specific touches (Pikachu's charging cheeks, Charizard's tail flame, Snorlax's waddle and body slam, Voltorb's swell, Scyther's pirouette, Rapidash's burning mane and tucked-leg leap, Tauros' head-down charge, Gyarados' travelling body wave). Speciality visuals live in `views.ts` (tunnelling mound, cloak fade, paralysis freeze and crackle, frost tint and slow motion, evolution glow and model swap) and `battle.ts` (heal rings, Fire Spin beam, Explosion). To tweak a model, edit its species file; to add one, write a builder and register it in `rigs/registry.ts`.

## Notes

- In-battle models are procedural, so no Pokémon art ships with the game. Card portraits load at runtime from the [PokeAPI sprites](https://github.com/PokeAPI/sprites) repo's official artwork; trainer portraits come from Pokémon Showdown through the server proxy because Showdown doesn't send CORS headers. This is a non-commercial fan project; Pokémon is © Nintendo / Game Freak / The Pokémon Company.
- `.npmrc` uses `node-linker=hoisted`: Colyseus packages have circular peer dependencies, and pnpm's default layout loads several copies of `@colyseus/core`, which makes every join fail with "seat reservation expired".
- Server logs every join, play (and rejected play), drop, and match result with the room id.
