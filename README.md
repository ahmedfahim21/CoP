# Clash of Pokémons

A Clash Royale–style 1v1 browser game in 3D. Your king tower is a trainer, your two side towers are starter Pokémon you pick before the match, and every card is a Pokémon. Real-time multiplayer with an authoritative server.

## Run it

Requires Node 22+, pnpm 10 and a Supabase project (see [Database](#database)).

```bash
pnpm install
pnpm dev
```

- Game: http://localhost:5173 (game server on :2567)
- No sign-up: the first visit creates a trainer profile and keeps its credential in the browser's localStorage. **Profile → restore code** moves it to another browser or device.
- To play ranked against yourself, use two browser profiles (or one normal and one private window): each gets its own trainer profile. Two tabs of the same profile can still be matched, but the battle is unrated. **Create room** gives a friendly invite link.
- Phones on the same network can join via the "Network" URL Vite prints. The client talks to `<page host>:2567`; set `VITE_SERVER_URL` to point it elsewhere.

## Database

Profiles, trophies and match history live in Supabase. Only the game server touches them, through the `cop_*` SQL functions in `supabase/migrations/`. Row-level security is on and those functions are granted to `service_role` only, so the publishable key can read nothing.

1. Apply the migration: paste `supabase/migrations/20261014120000_profiles.sql` into the Supabase SQL editor, or run `supabase db push` with the CLI linked to your project.
2. Add the server's settings to the root `.env` (gitignored), from Project Settings → API Keys:

   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   ```

   `NEXT_PUBLIC_SUPABASE_URL` works in place of `SUPABASE_URL`. The secret key stays on the server; the client never sees it. The server refuses to start without both.

Tests don't need Supabase: they apply the same migration to an in-memory Postgres (PGlite).

## Test

```bash
pnpm test        # shared rules, server room and client maths tests
pnpm typecheck
```

- `packages/shared/src/*.test.ts`: type chart, deploy zones, elixir, targeting, bridges, splash, kamikaze, attack events, towers/crowns, overtime/tiebreak, forfeit, a bot-vs-bot soak test, trophy maths and arenas, and the training bot (legal plays only, beats idle and random players, defends pushes).
- `apps/server/test/BattleRoom.test.ts`: rooms (quick + private), join validation and trainer names, play validation with before/after state snapshots, private hands, projectile sync, disconnect → forfeit, trainer sprite proxy.
- `apps/server/test/store.test.ts`, `matchmaking.test.ts`: profile storage, credentials, ladder order and ranks, rated vs unrated battles, match history; queue pairing (trophy windows, wait-time widening, no instant rematches, same-profile last resort).
- `apps/server/test/ladder.test.ts`: the profile API, ranked queue → battle → trophies and leaderboard, forfeits, bot fallback, no-show opponents, training, rematches.
- `apps/client/src/three/*.test.ts`: snapshot interpolation and scene coordinate maths.

## How it plays

- **Towers** tab: pick which of Bulbasaur / Charmander / Squirtle guards your left and right towers. Their attacks are typed (Razor Leaf, Ember, Water Gun).
- **Cards** tab: build your 8-card Battle Deck from the 19-card collection (tap a card → **Use** → tap the deck card to replace). Each card shows its stats and speciality.
- **Battle** tab: **Battle** joins the ranked queue; **Train** plays the bot; **Friendly battle** by room code / invite link. Tap the pencil to set your trainer name.
- **Ranks** tab: the trophy leaderboard (top 50 and your own rank). Tap a trainer to see their profile and recent battles.
- **Profile** tab: trophies, arena progress, win rate, streaks, three-crown wins, battle log, and your **restore code**.
- In battle, drag a card onto your half (a translucent preview shows where it lands), or tap a card and then tap the arena.
- Elixir: start 5, max 10, +1 every 2.8s, doubled in the last minute and overtime.
- Destroying a side tower gives 1 crown and lets you deploy deeper in that lane. Destroying the trainer wins outright.
- 3:00 match. Tied → 1:00 sudden-death overtime → still tied: the side whose weakest tower is healthier wins.
- Type effectiveness uses the real chart, softened for balance: super effective ×1.5, not very effective ×0.75, immune ×0.5.

### Profiles, trophies and matchmaking

- On first launch the client creates a trainer profile on the server and keeps its credential (`<tag>.<secret>`) in localStorage. Name, deck and tower picks sync to the profile, so they follow you to any device where you enter the **restore code** (Profile tab). The server stores only a hash of the secret.
- **Ranked** battles move trophies Elo-style (K = 60: an even match is ±30; a win is always worth at least +5; you never drop below 0). Ten Kanto arenas mark progress, from Pallet Town (0) to Indigo Plateau (4000). Friendly, training and same-profile battles are recorded in the battle log but never rated.
- **Matchmaking**: everyone searching sits in one queue room that pairs players once a second. Each player accepts a trophy gap of ±100 at first, widening by 40 per second, and any gap after 20 s. Longest-waiting players pick first and get the closest opponent in range; the queue avoids pairing you with last battle's rival, or with your own profile, unless nobody else fits. Nobody waits forever: after 30 s, or if the paired opponent never takes their seat, you battle the bot instead.
- **Training bot**: a server-side opponent (`packages/shared/src/bot.ts`) that sends the same plays a player would. It defends with counters (type matchups, splash against swarms, a turret against tower-seekers), commits to one lane, leads pushes with a tank and backs it up.
- After every battle the result screen shows trophies won or lost and per-player stats (cards played, elixir spent, tower damage, troops defeated). Friendly and training battles offer a **Rematch**, which starts once both trainers ask; ranked offers **Battle again**.

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
apps/server       Colyseus rooms and HTTP API.
  BattleRoom        20 Hz authoritative tick, private hands, 20s reconnect window, modes
                    (ranked / friendly / training / casual), bot seat, result recording, rematch
  QueueRoom         ranked queue; pairing rules in matchmaking.ts
  store.ts          profiles, ladder and match history (Supabase RPC; db.ts is the client)
  api.ts            /api/profiles, /api/profiles/me, /api/profiles/:tag, /api/leaderboard
  sprites.ts        /sprites/trainer/:name proxy
apps/client       Vite + three.js battle, DOM menus and HUD.
  src/three/        stage (renderer, camera, lights), arena, towers, fx (particles), views,
                    battle (state mirroring), interp (snapshot buffer), diorama (menu arena)
  src/three/rigs/   models (glTF loader + Pose-driven clip blending), registry, names
  src/ui/           boot (loading + title screen), home (tabs, deck builder, card details), ladder
                    (ranks, profile), hud (battle overlay + input), cards, overlays (matchmaking,
                    result), icons (Hugeicons + custom), style.css (RetroUI-style tokens)
  src/profile.ts    trainer profile session: credential, server sync, restore
  src/sandbox/      local-simulation animation sandbox (sandbox.html)
```

The server runs `packages/shared/src/sim.ts`; the client never simulates. It renders server state ~100 ms in the past, blending between real snapshots, and replays server events (attacks, hits, deaths) on that same delayed clock so animations and impacts line up. Plays are sent as `play { slot, x, y }` in the player's own perspective (each player sees their side at the bottom).

### Characters

Every Pokémon and both trainers are modelled in Blender by script: `tools/blender/rig.py` builds smooth metaball bodies, snaps rigid details (eyes, claws, flames) onto the surface, skins them to a simple rig and bakes the clips (idle, walk, attack, faint, plus special, leap, charge or dormant where a species has them) from Python motion functions. `tools/blender/species/*.py` holds one file per model. Output is Draco-compressed glTF in `apps/client/public/models/` with a `manifest.json`, all committed so the game doesn't need Blender to run.

```bash
pnpm models                 # rebuild every model (needs Blender; set BLENDER=/path/to/blender if not in /Applications)
pnpm models pikachu gengar  # rebuild only these
```

The client blends the baked clips from the same `Pose` the battle always drove (stride phase, attack/hit/faint progress), with procedural squash, rage tremble and glowing parts on top. `gallery.html` shows every model side by side with mode buttons (idle, walk, attack, special, faint); `sandbox.html` runs a local simulation for animation work. Speciality visuals live in `views.ts` and `battle.ts`.

### Look

The arena follows the concept art: pale stone towers with team-coloured corner cushions and a Poké Ball emblem, the starter (or trainer) sitting in the tower top, a turquoise river with lily pads, plank bridges, cobbled lanes, log palisades, and Poké Ball banners, torches and boulders at each end, with forest all round (`three/arena.ts`, `three/towers.ts`; heavy scenery is instanced).

Rendering is cel-shaded with clean ink outlines, after the sister project sadak (`three/style/`):

- `toon.ts`: every lit surface is a `MeshToonMaterial` with a 2–4 band ramp, patched so shadow bands lean cool instead of just darker. Use `litMat()` wherever you'd reach for `MeshStandardMaterial`; character glTF materials go through `toToon()`.
- `gba.ts`: the scene renders at one virtual pixel per CSS pixel; one full-screen pass adds outlines from a second difference of reciprocal depth (flat ground never inks, silhouettes always do), a soft highlight shoulder, split tone and saturation, then a reduced palette with a fine ordered dither.

The ramps, shadow-tint patch, ink and split tone are adapted from [sakura-crossing](https://github.com/Kenton-GMI/sakura-crossing) (MIT, © 2026 Kenton Wang) via sadak.

### Sound

`src/audio/`: every effect is original 8-bit synthesis in WebAudio (`synth.ts`: square/triangle voices and Game Boy–style stepped noise), with a move sound per type, hit sounds by effectiveness, faint, explosions, tower collapses, heal, paralysis, evolution, countdown, crowns, the last-ten-seconds tick and short victory/defeat jingles. Pokémon cries (Gen I) stream at runtime from the [PokeAPI cries](https://github.com/PokeAPI/cries) repo when a Pokémon is deployed, evolves or its card is opened; nothing is committed. A voice limiter (`limiter.ts`) caps simultaneous sounds and drops rapid repeats, sounds pan by screen position, and the speaker button mutes everything (remembered per browser). Audio starts on the title screen's tap, as browsers require.

### Card details

`packages/shared/src/cardInfo.ts` derives what the card screen shows from the simulation's own numbers: roles, DPS, a trait line per ability, type matchups (only types that exist in the game) and multipliers against each starter tower. The loading screen's tips come from the same place.

## Notes

- In-battle models are generated by the Blender scripts in this repo, so no Pokémon art ships with the game. Card portraits load at runtime from the [PokeAPI sprites](https://github.com/PokeAPI/sprites) repo's official artwork and the loading screen's Gen III sprites from the same repo; trainer portraits come from Pokémon Showdown through the server proxy because Showdown doesn't send CORS headers. This is a non-commercial fan project; Pokémon is © Nintendo / Game Freak / The Pokémon Company.
- Icons are [Hugeicons](https://hugeicons.com) stroke-rounded (MIT) plus a few drawn to match in `src/ui/icons.ts` (Poké Ball, elixir, Normal/Psychic/Dragon type marks).
- `.npmrc` uses `node-linker=hoisted`: Colyseus packages have circular peer dependencies, and pnpm's default layout loads several copies of `@colyseus/core`, which makes every join fail with "seat reservation expired".
- Server logs every join, play (and rejected play), drop, and match result with the room id, plus queue pairings.
- Rooms the server creates itself (ranked rooms from the queue, rematch rooms) carry a per-process secret in their options (`trust.ts`), so a client can't create a ranked room or claim someone else's profile through a seat reservation.
