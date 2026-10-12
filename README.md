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
- **Cards** tab: your deck; tap a card for its stats and move.
- **Battle** tab: quick match, or a friendly battle by room code / invite link. Tap the pencil to set your trainer name.
- In battle, drag a card onto your half (a translucent preview shows where it lands), or tap a card and then tap the arena.
- Elixir: start 5, max 10, +1 every 2.8s, doubled in the last minute and overtime.
- Destroying a side tower gives 1 crown and lets you deploy deeper in that lane. Destroying the trainer wins outright.
- 3:00 match. Tied → 1:00 sudden-death overtime → still tied: the side whose weakest tower is healthier wins.
- Type effectiveness uses the real chart, softened for balance: super effective ×1.5, not very effective ×0.75, immune ×0.5.

| Card | Cost | Role |
|---|---|---|
| Rattata ×4 | 2 | fast melee swarm |
| Zubat ×3 | 2 | flying swarm |
| Voltorb | 2 | self-destructs, splash |
| Pikachu | 3 | ranged, hits air |
| Machop | 3 | sturdy melee |
| Lapras | 4 | ranged tank, hits air |
| Charizard | 5 | flying splash |
| Snorlax | 6 | tank, only attacks towers |

## Layout

```
packages/shared   Game rules (pure, deterministic simulation), card/starter data, type chart,
                  network schema and message types. Used by both server and client.
apps/server       Colyseus room: matchmaking, 20 Hz authoritative tick, private hands,
                  20s reconnect window, /sprites/trainer/:name proxy.
apps/client       Vite + three.js battle, DOM menus and HUD.
  src/three/        stage (renderer, camera, lights), arena, towers, fx (particles), views,
                    battle (state mirroring), interp (snapshot buffer), diorama (menu arena)
  src/three/rigs/   kit (rig builder), motion (gaits, attack curves), species/* (one file per model)
  src/ui/           home (tabs), hud (battle overlay + input), cards, overlays, style.css
```

The server runs `packages/shared/src/sim.ts`; the client never simulates. It renders server state ~100 ms in the past, blending between real snapshots, and replays server events (attacks, hits, deaths) on that same delayed clock so animations and impacts line up. Plays are sent as `play { slot, x, y }` in the player's own perspective (each player sees their side at the bottom).

### Characters

Every Pokémon and both trainers are built from primitives (`src/three/rigs/species/*.ts`) as a hierarchy of named joints — legs, arms, head, ears, tail, wings, jaw — so each part animates on its own. All rigs animate from a single `Pose` (time, speed, stride phase, attack/hit/land/faint progress), with shared gaits in `motion.ts` (biped, quadruped, wing flap, attack wind-up curve) and species-specific touches (Pikachu's charging cheeks, Charizard's tail flame, Snorlax's waddle and body slam, Voltorb's swell before it blows). To tweak one, edit its species file; to add one, write a builder and register it in `rigs/registry.ts`.

## Notes

- In-battle models are procedural, so no Pokémon art ships with the game. Card portraits load at runtime from the [PokeAPI sprites](https://github.com/PokeAPI/sprites) repo's official artwork; trainer portraits come from Pokémon Showdown through the server proxy because Showdown doesn't send CORS headers. This is a non-commercial fan project; Pokémon is © Nintendo / Game Freak / The Pokémon Company.
- `.npmrc` uses `node-linker=hoisted`: Colyseus packages have circular peer dependencies, and pnpm's default layout loads several copies of `@colyseus/core`, which makes every join fail with "seat reservation expired".
- Server logs every join, play (and rejected play), drop, and match result with the room id.
