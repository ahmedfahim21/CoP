# Clash of Pokémons

A Clash Royale–style 1v1 browser game. Your king tower is a trainer, your two side towers are starter Pokémon you pick before the match, and every card is a Pokémon. Real-time multiplayer with an authoritative server.

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
pnpm test        # shared rules + server room tests
pnpm typecheck
```

- `packages/shared/src/*.test.ts`: type chart, deploy zones, elixir, targeting, bridges, splash, kamikaze, towers/crowns, overtime/tiebreak, forfeit, and a bot-vs-bot soak test.
- `apps/server/test/BattleRoom.test.ts`: matchmaking (quick + private), join validation, play validation with before/after state snapshots, private hands, disconnect → forfeit, trainer sprite proxy.

## How it plays

- Pick 2 of Bulbasaur / Charmander / Squirtle for your left and right towers. Their attacks are typed (Razor Leaf, Ember, Water Gun).
- Drag a card onto your half, or tap a card and then tap the arena.
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
apps/client       Vite + Phaser 4. DOM menus, battle scene rendering server state.
```

The server runs `packages/shared/src/sim.ts`; the client never simulates, it renders interpolated server state and sends `play { slot, x, y }` in its own perspective (each player sees their side at the bottom).

## Notes

- Pokémon sprites load at runtime from the [PokeAPI sprites](https://github.com/PokeAPI/sprites) repo; trainer sprites come from Pokémon Showdown through the server proxy because Showdown doesn't send CORS headers. No Pokémon assets are committed. This is a non-commercial fan project; Pokémon is © Nintendo / Game Freak / The Pokémon Company.
- `.npmrc` uses `node-linker=hoisted`: Colyseus packages have circular peer dependencies, and pnpm's default layout loads several copies of `@colyseus/core`, which makes every join fail with "seat reservation expired".
- Server logs every join, play (and rejected play), drop, and match result with the room id.
