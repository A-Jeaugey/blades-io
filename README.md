# blades.io

> A TikTok-game-style multiplayer `.io` brawler in a neon cyberpunk arena.
> Wrap yourself in spinning blade rings, throw blades as projectiles, and shred everyone else.

**Stack:** TypeScript · Colyseus (authoritative server, 60 Hz) · Three.js · Vite

---

## Concept

You are a glider in a circular arena. Around you orbit rings of blades that grow denser and faster the more you collect. Push your blades into another player's blades to break theirs; touch their body and they die. When you die, 70 % of your orbiting blades scatter as loot, plus every blade you lost in clashes during the last 10 seconds. Your killer's loot is reserved for them for 3 s and flies straight into their orbit, wherever they killed you from (edge of a huge orbit, a throw). Dropped blades blink, then vanish after 15 s.

It plays like the kind of arena clash you see on TikTok feeds — short matches, instant replay, satisfying snowball — but rendered in real-time WebGL with a neon cyberpunk skin.

### Core mechanics

| Mechanic | Behavior |
|---|---|
| **Orbit rings** | More blades → denser rings, faster rotation, thicker shield |
| **Tier system** | Six tiers, each with its own blade shape: dagger (1+ blades), sword (10+), scythe (20+), saw (35+), runic blade (55+), aura blade (80+). Clash hitbox, orbit speed, knockback and hitlag grow up to the scythe and stop there: higher tiers change the shape and size of the blades (bigger clash hitboxes up there doubled the early deaths of newcomers in the survival bench). A body dies wherever it touches a blade as drawn, from its ring to its tip: a big legendary blade reaches as far as it looks. Players closing in on a target get a little extra reach, the distance they cover in 100 ms (they see others 80 ms in the past); bots don't need it. Thresholds come from the blade counts measured in bot rooms (median 9, 80+ in fewer than 1 % of lives) |
| **Throw blade** | Detach your outermost blade and launch it as a projectile toward your aim (mouse cursor, or drag from the THROW button on mobile), independently of where you walk; keyboard-only throws and a THROW tap follow your movement. 0.5 s cooldown; a dashed line on the ground shows the path while the throw is ready. A thrown blade hits whatever it touches along its whole path, blades as drawn included; an orbiting blade it breaks lets it fly on (epic and legendary throws pierce) to the next blade or the body behind, one that holds stops it |
| **Pierce by rarity** | Common/Rare: 1 hit · Epic: 2 hits · Legendary: 3 hits |
| **Clash impact** | Each clash knocks both players back (capped at a tier-2 knockback, applied in full after the freeze) and freezes their movement for 50–100 ms by tier; orbits keep spinning, and after a freeze a player gets 250 ms before the next one, so a fight never locks you in place |
| **Power-ups** | Speed, Spin, Magnet and Shield last 8, 12, 18 or 25 s depending on rarity (picking up the same type again extends to the later end, never beyond 25 s); Blades instantly adds 2 or 3 blades of its own rarity. Each type has its own shape: double chevron, circular arrow, horseshoe, crest, shuriken |
| **Loot crates** | Shoot or orbit them to crack them open and dump weighted-rare loot |
| **Glitch bushes** | Step in to vanish from other players' screens, minimaps and from bots. Enforced by the server: nobody receives your position until your orbits could touch (then you see each other, so nobody fights invisible blades). Each bush is a low glitching dome (scanlines, corrupted pixels, pulsing halo, rising pixels; a mist veil with fireflies in the spirit themes) that turns see-through while you are inside, with a burst and a static crackle as you step in or out |
| **Map structures** | 25 landmarks laid out symmetrically within the usual arena: holographic billboards, neon arches you walk through, server racks with blinking LEDs, drone pads and floating data shards (stone gates, glyph steles and orbs in the spirit themes). Billboards, arch pillars and racks block movement; nothing blocks spawns, loot or bots |
| **Safe spawn** | You (re)spawn within 150 u of the center, away from other players (further from bigger ones), where loose blades lie. For 10 s, bots leave you alone: they don't chase you, throw at you or farm next to you. Over the next 40 s only easy bots go after you, and only up close (15 u, growing back to their usual range; shorter in a smaller arena, where bots are denser). Both end as soon as you throw or your blades hit someone (a bot hunting you doesn't count). In your first game, bots can't kill you during those 10 s, and only a throw or an elimination ends the protection. The first 2.5 s are also invulnerable |
| **Border** | Touching the kill zone is instant death — no clamp. Your outer blades are shredded first. The last 25 u are announced by a red vignette, an alarm and the arena edge on the minimap |
| **Score** | kills × 15 + peak blade count of the life + 1 per 10 s alive + crates × 3 + power-ups × 2, plus bounties and underdog bonuses (below). In public rooms, it is credited as trophées at the end of each life (death or leaving) |
| **Champions** | Once a seasoned player is in the room, one bot (two when that player passes 100 blades) spawns with a big orbit sized to them (40 to 300 blades), a ★ before its name. Champions only hunt prey worth their size, leave newcomers alone, and their loot goes to whoever brings them down |
| **Leader bounty** | The leader (best score among living players) wears a crown showing their bounty: a quarter of their score, from 10 to 150 trophées, paid to whoever kills them, and they drop all of their blades instead of 70 %. No bounty below 30 points |
| **Underdog** | Killing a player who had at least twice your blades at the start of the fight (and at least 10 of them) pays double: +15 on top of the kill. On death, the rarest blades drop first |
| **Private rooms** | Join by code, 2.5× loot density, unranked and without trophées |
| **Game modes** | Chosen in the lobby, for quick play (each mode has its own public queue) or a private room. ARENA: the endless original. ROUNDS: 5-minute rounds whose arena shrinks during the last minute, down to 80 u from the center (red timer, announced; the border, its danger band and the minimap follow it). Your points add up over all your lives in the round; then a 15-second podium (top 3, your rank and stats) and the next round starts by itself, everyone back in with fresh blades. In public rounds, the top 3 also earn 150, 100 and 50 trophées. Team modes, in private rooms (bots optional, they fill the teams): two teams that spawn on opposite sides, never hurt each other (blades, bodies and throws pass through allies) and see each other in bushes; your team wears your own ring color and a ◆ mark (diamonds around the ring, names, minimap, leaderboard). TEAM DEATHMATCH: first team to 30 kills, or the best after 5 minutes. LAST TEAM STANDING: no respawn, 3-minute rounds whose arena shrinks in the last minute; once out, you watch a teammate until the next round. CAPTURE THE FLAG: take the other flag and bring it to your base while yours is home; a carrier who dies drops it (the other team picks it up again, its own team touches it to send it home, or it goes back by itself after 20 s), and carriers cannot hide in bushes; 3 captures, or the best after 8 minutes. The end screen shows victory or defeat, both team scores, the MVP and each team's players |
| **Adaptive arena** | The arena's radius follows its population, bots included: about 155 u with 3 players, 171 u for one human and their ten bots, the full 250 u map at 60. More players: the wall moves back at once (faster when many arrive together). Fewer: the shrink is announced 10 s ahead (banner, dashed line on the ground and on the minimap), then the wall closes in at 1.5 u/s, far slower than a player. Spawns and loot stay inside; team modes keep the full map |
| **Map events** | In the arena, rounds and team deathmatch, every 90 to 120 s once a human is in the room, one event with a banner and a minimap marker: a **blade rain** (28 blades, rarer than usual, fall on a zone announced 5 s before; dashed circle), a **legendary crate** (ten times sturdier than a crate, holds a legendary and a pile of rare blades; ★, gone after 90 s if nobody breaks it) or a **golden zone** in the center (double circle): for 30 s, every point earned inside counts double (POINTS ×2 badge). Bots go for them too. Each finished event records how many players came to it (`map_events`) |
| **Chat & moderation** | Enter (or the bubble on mobile) to chat, dead or alive. French and English insults and slurs are masked by the server (accents, leetspeak, stretched or spaced letters included, without flagging "computer" or "Niger"); three masked messages in two minutes mute the sender for two minutes. Commands: `/me <action>`, `/mute <name>` and `/unmute` (for you only, this game), `/report <name> [reason]`, `/help`. Test cheat, when the server runs with `CHEATS=1`: `/blades [count] [rarity]` adds blades (50 by default) in private rooms, where nothing counts. Names with insults, reserved words (admin, moderator…) or mixed Latin and Cyrillic or Greek letters (look-alike impersonation) are refused in the lobby and replaced in game |
| **Play with friends** | INVITE A FRIEND (settings, in game) and SHARE on the death card send a link to your arena: whoever opens it lands in the same public arena (another one if it closed or filled up), or in your private room (`?room=CODE`; the ROOM badge does the same). On phones, the system share sheet opens; elsewhere the link is copied. Shared links show a preview: the server writes the Open Graph tags (absolute URLs, the visitor's language, the invitation's text) and the image, `og.jpg`, is drawn at build time from the default theme (`client/tools/ogImage.ts`), like everything else in the game |
| **Challenges** | Three daily challenges (easy, medium, hard: throw 20 blades, reach 40 blades in one life, take down the leader…) and one weekly, the same for everyone, renewed at midnight Paris time (Monday for the weekly). Every life in a public room counts, for accounts and guests with a trophy wallet; rewards are trophées (so XP). They show in PROFILE (with the count done today on its button) and a banner pops in game when one is completed |
| **Leaderboards & seasons** | Best score per account over the day, the week, the season and all time (public rooms only), in the lobby's right rail and in PROFILE (the rail is hidden on phones), with your own rank when signed in. A season lasts six weeks, from Monday midnight Paris time (season 1 starts on 28 September 2026); when it ends, the top 10 earn trophées, so XP: 1,000, 750, 500, then 250 |
| **Levels** | Trophées earned in public rooms are also XP (spending them does not lower it): your level shows next to your name in other players' nametags, in the lobby, on the death card (with level-ups) and in your profile. Level 2 after a life or two, 10 after ~2 000, 50 after ~30 000; titles at levels 5, 10, 20, 30, 50, 75 and 100. Bots have no level |
| **Cosmetics** | Seen by everyone, and never changing what you see or what hits: 9 character skins (colors, head shape and an accessory: headband, visor, antenna, hood, horns, ears or crest), 5 blade styles (a light pattern that leaves rarity colors and tier shapes alone), 4 trails and 3 elimination effects. Half unlock with your level (2 to 30, announced on the death card), the rest are sold for trophées in the BOUTIQUE (SKINS, BLADES and EFFECTS tabs, signed-in players). FEATURED, the tab the BOUTIQUE opens on, puts three of them at -20 % each day (a skin and two other kinds, the same for everyone, renewed at midnight Paris time, never the previous day's), and a 3D preview tries on whatever card you tap: your character walking with its trail, its blades and an elimination burst, in your map theme's colors (CSS previews only in potato quality). Equipped items apply from your next game, without reloading; the server checks each one when you join. Your ground ring and spawn shield never change |
| **HUD** | Top left: your rank, blades, life score and personal best (public rooms), and the real cost of boost (2 blades/s, with the time left while boosting; on the BOOST button on mobile). Top right: minimap (centered on you, scaled to the current arena, so it zooms in as the arena shrinks), compact leaderboard (top 5 + you) and a kill feed (last 4 eliminations, with their cause). Trophy gains float where they happen (kill, crate, power-up). FPS and ping bottom right |
| **Death** | The camera glides to your killer for 2.5 s with their blade count (click, tap or Space to skip), then a recap card: score, personal best, trophées (kept on your device as a guest until you sign in), the cause of death in plain words and a tip matching it |
| **Map themes** | Four looks for the arena: Original Neon (free), Spirit Sanctuary, Vermilion Forge and Frozen Depths (BOUTIQUE), seen only by whoever equips them. Same map, same framing and the same rarity colors on every theme (white, blue, violet, gold). Each theme passes a readability check, run in CI (`npm run check:themes`): dark ground, no ground or ambient color that looks like a blade or a threat, a red kill zone |
| **Combat effects** | A shockwave at every clash (a small ring at blade height, bigger when a blade breaks) and every elimination (a wide ring on the ground); a broken blade bursts into shards of its rarity color; an eliminated player dissolves in 0.6 s (pieces fading out, head first, with a white-hot edge, in the killer's elimination effect color); a column of light follows a player for a second when they reach a new tier; thrown blades leave a ribbon trail, and loose blades a thin one as they are sucked into a player's orbit; boosting players are wrapped in speed lines. Each effect has a version for every quality level (fewer instances and facets, a block dissolve in potato), follows the flashes setting, and only adds light on top of the scene for a moment: nothing hides a blade or a threat |
| **Camera** | Same framing for every theme (a cosmetic never changes what you see). It pulls back smoothly as your orbit grows, up to twice its distance so that even a 2,000-blade orbit (the cap) fits on screen, and narrow screens get pulled back until they show at least ~80 % of a 16:9 screen's width (portrait phones see more depth, at a smaller scale) |

### Bots

When the room has fewer than 15 players, bots fill in (capped at 10). Each bot picks one of four personalities at spawn:

- **Aggressive** — picks fights even at parity, loose aim, low blade threshold, throws back at pursuers
- **Hunter** — precise throws, even-fight aggression, throws back at pursuers
- **Farmer** — collects ground blades and crates, chips at crates with throws
- **Camper** — sits on power-ups and bushes, conservative

Their decision-making runs through a multi-factor scoring system (flee · chase · farm · power-up · crate · wander · avoid-wall) and they react with imperfect timing, aim jitter, perpendicular evasion, target prediction and anti-double-aggro. They aim like players: a throw goes at the predicted intercept of their target, whatever direction they are walking.

Each bot also gets a skill level at spawn, which sets how it goes after human players (against other bots, they all fight the same way):

- **Easy** — only chases up close (45 u), without boosting, and gives up after 6 s; loose aim and a 3 s pause after each throw
- **Normal** — the behavior described above
- **Hard** — tighter aim, spots players from further away (95 u)

Usually 30 % easy, 40 % normal and 30 % hard. While a beginner (first game on that device) is in the room, new bots are 60 % easy and never hard, and hard bots already there leave beginners alone. A newcomer (a beginner, or anyone in the 50 s after spawning) is chased by one bot at a time. Bots keep their silly names and are marked **BOT** in the leaderboard.

---

## Architecture

```
shared/   Types and constants — single source of truth for game design
server/   Authoritative Colyseus room (60 Hz tick and patches, 60 player cap)
client/   Vite + Three.js + Colyseus SDK
```

The server runs the entire simulation (positions, collisions, kills, drops, projectiles). The client sends one input every 1/60 s (`dx, dy, boost, throw`, plus the aim direction of a throw); the server applies each input as one movement step, in order, and acknowledges the last one applied. The local player is predicted with input replay: on each server state, the client re-applies its unacknowledged inputs with the same step function as the server (`shared/src/movement.ts`), so it reacts instantly at any latency and is only corrected by what it cannot foresee (a clash knockback, a push from another player). Remote entities are rendered 80 ms in the past (interpolation between snapshots). Blade orbits are derived from a per-player orbit clock synced by the server, and combat events carry the server tick they happened on, so clients draw blades exactly where the server collides them and play each clash on the frame where the blades touch.

Each client only receives what is near it (interest management with Colyseus `StateView`): players and blades within the ground area its screen actually shows (the client reports it; 50 u on a 16:9 screen, ~136 u for a phone in portrait, up to ~196 u for a giant orbit, whose camera pulls further back; the server caps it from the player's own blade count, so a modified client gets no more), never a player hidden in a bush unless their orbits could touch. Combat events go only to the clients that can see them. The leaderboard and the minimap come from a 2 Hz room summary that leaves hidden players out. Fields only your own client needs (your walking direction, knockback, last acknowledged input, effect timers, life stats) are sent to you alone. About 17 KB/s per client in a full room, 21 KB/s with 60 clients connected (95 KB/s before interest management), and a modified client cannot see through bushes.

### Performance highlights

- **Spatial hash** (5-unit cells) for pickup and broad-phase collisions
- **Owner-bucket broad phase** for blade-vs-blade — pairs of players are tested by center distance before touching individual blades, then only the blades where the two orbits overlap (two 2,000-blade orbits in contact cost ~5 ms per tick)
- **InstancedMesh** rendering — one mesh per (rarity × tier), growing as needed (no cap), O(1) removal; round additive particles (point-sprite shader) and a time-sampled ribbon trail; combat effects drawn in one call each (instanced rings, shards, light columns and speed lines, every blade trail in a single ribbon mesh), their shaders compiled on the first frame rather than on the first clash
- **Light first load** — the page first loads only the lobby (about 175 KB of JavaScript, 55 KB gzipped, against 1.5 MB before); the game engine (three.js, Colyseus, rendering) loads in parallel while you pick a name, the sound engine on your first click, the account library only when you sign in or resume a session, the shop when you open it. Libraries have their own files and build assets are cached for good (fingerprinted names): a game update does not re-download three.js
- **French and English** — the language follows the browser (English otherwise) and can be changed live in the settings; all UI text lives in `client/src/i18n/`
- **Quality presets** (high/medium/low/ultra, auto-detected; `ultra` is the lightest) — bloom, particles and decor density adapt. Any dedicated GPU (even entry-level), Apple Silicon, Intel Arc and recent AMD integrated GPUs start in high: below it the neon loses its glow. An FPS monitor lowers the resolution first (down to 0.6 in high, without reallocating anything when post-processing is on), and the preset only after 6 s under 30 FPS at that floor; if lowering the resolution gains nothing (a screen or browser capped at 30 FPS, battery saver), it restores full resolution and stops. An automatic lowering lasts until the next version of the game, never touches a quality chosen in the settings (only the resolution adapts), and older ones (saved as if the player had chosen them) are dropped; mid-match, a lower preset only switches off bloom, screen effects and MSAA (no shader recompiles) and fully applies back at the menu, never during a game. Every shader is compiled in the lobby, so nothing new on screen (a player, a crate, a power-up) stalls the game
- **Anti-cheat** — server clamps `|dx|, |dy| ≤ 1`, ignores inputs above 80/s and disconnects a client that stays above that cap for 3 consecutive seconds

### Audio

Sound effects are 100 % procedural — Tone.js synths for pickups, throws, the boost noise, and one distinct sound per combat event: a metallic tink for a clash, a bright shatter when an enemy blade breaks, two falling tones when you lose one of yours, a rising chime for an elimination, a crunch for a crate, a heavy hit for your death. Each power-up type has its own pickup sound, pitched up with rarity: three rising notes for Speed, a trill for Spin, two low notes for Magnet, a gong for Shield, metallic tings for Blades. Clashing blades flash white, a red arc at the screen edge points at whoever is breaking your blades, and a "+1" pops where you eliminate someone. The only audio files are the music tracks: one lobby and one battle track per theme, stored in `assets/music/` and copied into `client/public/` at build time (`sync-music` script).

---

## Run locally

Prereqs: **Node 22** or later (required by Colyseus 0.18; `npm install` refuses older versions, see `.npmrc`).

```bash
npm install
npm run dev
```

This starts:

- the Colyseus server on `ws://localhost:2567`
- the Vite dev client on `http://localhost:5173`

Open several tabs to test multiplayer.

> **Without Supabase configured**, the game runs in guest-only mode: anyone
> can play, but scores aren't saved and the leaderboards stay empty.
> See **[Accounts & leaderboard (Supabase setup)](#accounts--leaderboard-supabase-setup)** below.

### Useful scripts

```bash
npm run build:shared       # rebuild shared types only
npm run build              # full prod build (shared + server + client)
npm start                  # run the prod server (serves the built client)
npm test                   # server system tests (node:test, simulated clock)
node tools/bench-server.js 60 120   # server bench: 60 bots, 120 simulated seconds
BENCH_VIEWERS=60 node tools/bench-server.js 60 120   # same with 60 connected clients (per-client views)
node tools/bench-survival.js        # newcomer survival against bots (after npm test)
node tools/bench-survival.js first  # time before a newcomer's first death (random walker)
BENCH_RETURNING=1 node tools/bench-survival.js first  # same for a returning player (bots don't spare them)
node tools/bench-snowball.js        # bot rooms: leader reign length, underdog kills (after npm test)
```

Add `?debug=hitbox` to the game URL to overlay the server-side hitboxes of nearby orbiting blades and display the measured client/server drift. Add `?debug=perf` to display frame pacing (FPS, median, p95 and worst frame time), the render scale, draw calls and the number of shaders compiled since the match started (it should stay at +0: every shader is compiled in the lobby).

Every push and pull request runs the same build in GitHub Actions (`.github/workflows/ci.yml`): shared, server (full `tsc`) and client (`tsc` + `vite build`), then the server tests.

---

## Controls

| Action | Keyboard | Mouse | Touch |
|---|---|---|---|
| Move | WASD or Arrow keys | follow cursor | virtual joystick (left) |
| Boost | Shift | hold left-click | BOOST button (right) |
| Aim | mouse cursor, or none (throws follow your movement) | cursor | drag from the THROW button |
| **Throw blade** | Space | right-click | release the THROW button (a tap throws along your movement) |

The input mode follows the last device you used: touching the screen shows the touch controls, the keyboard or mouse hides them. Movement keys take over from the mouse until you left-click again; while moving with the keyboard, moving the mouse makes the cursor your aim (WASD + mouse), so you can throw behind you while running away. Direction and aim are measured on the ground from your character: the cursor points exactly where you go or throw, despite the tilted camera. On mobile, dragging from THROW and bringing your finger back to the button cancels the throw.

On phones, the interface keeps clear of notches and rounded corners, every button is at least 44 px, and the in-game leaderboard starts collapsed (tap it to expand; the choice is remembered). Hits taken, kills and death trigger short vibrations where the browser supports them (Android; not iOS Safari), which can be turned off in Settings.

Accessibility settings: screen shake (0–100 %, off by default when the system asks for reduced motion), flashes (0–100 %: white flash of clashing blades, particle bursts, combat effects, pulse of the border warning) and a colorblind palette (rarity and threat colors that stay apart under protanopia, deuteranopia and tritanopia, on every theme; applies after a reload). Nothing relies on color alone: each power-up has its own shape (readable in grayscale), rarer blades are bigger, and nametags mark threat with ▲/▼.

New players get a controls card (matching their device) when they first enter a game, then one-time contextual tips (throw when an enemy is in range, boost cost, deadly edge, bushes), remembered in `localStorage` (`blade.onboarding`). The HOW TO PLAY page in the lobby repeats the rules and can show the tips again.

### Gameplay tips

- Spawn with 3 Common blades. Ring 0 caps at 16 blades; ring 1 at 24; ring 2 at 32; etc.
- Boost drains 1 blade every 0.5 s, cheapest first, and drops it behind you, slither.io style, for anyone to grab, you included. It lands out of your magnet's reach: stopping after a sprint doesn't refund it, you have to turn back. Fleeing on boost feeds whoever chases you; chase a booster along their line and the chase pays for itself. Dropped blades count toward the loose-blade cap, so the map fills less elsewhere when trails pile up.
- Throwing eats your **outermost** blade, so a Legendary on the outside ring is a 3-pierce missile.
- Shield power-up halves incoming blade damage; combine with Spin for an oppressive wall.
- Bushes hide you AND your blades from opponents and bots until they get within orbit range — perfect for ambushes.

---

## Accounts & leaderboard (Supabase setup)

The game can persist scores per-user and surface leaderboards of the day,
the week, the season and all time (public rooms only). It uses [Supabase](https://supabase.com) for auth (email +
Discord + Google OAuth) and Postgres. Without it, the game falls back to
guest-only mode.

### 1. Create the project

1. Sign up on [supabase.com](https://supabase.com), create a new project.
2. From **Project Settings → API**, copy:
   - `Project URL` → `SUPABASE_URL` (and `VITE_SUPABASE_URL`)
   - `anon public` key → `SUPABASE_ANON_KEY` (and `VITE_SUPABASE_ANON_KEY`)
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only — **never** expose this in client code)

### 2. Configure environment

```bash
cp .env.example .env
# fill in the keys you just copied
```

### 3. Apply the schema

Open the **SQL editor** in your Supabase dashboard and run every file of
[`supabase/migrations/`](supabase/migrations/) in order:

- `0001_init.sql` — `profiles` (usernames, 1-to-1 with `auth.users`), `matches` (one row per finished game, server-only writes via service role), the `leaderboard_top` view, row-level security and a trigger that creates a profile on signup
- `0002_trophies.sql` — `wallets` and `guest_wallets` (trophées), plus the credit and guest-claim RPCs
- `0003_inventory.sql` — `inventory` and the atomic `purchase_item` RPC used by the shop
- `0004_leaderboard_public_only.sql` — the leaderboard ignores private-room games
- `0005_life_stats.sql` — gameplay telemetry (below)
- `0006_life_stats_snowball.sql` — telemetry of the leader bounty and underdog kills
- `0007_player_stats.sql` — the `player_stats` view behind the lobby's PROFILE panel (cumulated public games per account), revoked from clients
- `0008_challenges.sql` — daily and weekly challenge progress per account or guest wallet, and the `advance_challenges` function that also credits rewards (server only)
- `0009_seasons.sql` — leaderboards of a period (`leaderboard_since`, `player_rank_since`) and `close_season`, which rewards the top 10 of a finished season once (`seasons_closed`, `season_results`); server only
- `0010_reports.sql` — player reports from the chat (`/report`), with the reported player's last messages, and the `reports_by_target` view (most reported players over 30 days); server only, read them from the SQL editor: `select * from reports_by_target;`
- `0011_game_modes.sql` — the game mode of each recorded game and life (`game_mode`, `'ffa'` for the endless arena), the `match_end` cause (a life cut short by the end of a match) and the `life_stats_by_mode` view to compare modes; until it is applied, the endless arena keeps recording its games
- `0012_map_events.sql` — one row per finished map event (rain, legendary crate, golden zone): players present and players who came to it, and the `map_events_summary` view (share of players drawn in, per kind, public games, last 7 days); until it is applied, events still run and only their record is missing (a warning a minute in the logs)

#### Gameplay telemetry

The game server writes one row to `life_stats` at the end of every human life (bots are not recorded): duration, how it ended (`blades`, `throw`, `wall`, or `quit`, `disconnect`, `restart` for a life that ended alive), the killer's kind and tier, the balance of power at the start of the fight, peak blades and tier, kills, throws and throws that hit, boost time, whether the spawn grace was still on, the room's population, public or private, whether it was the player's first life of the session and first game on that device, and for the anti-snowball rules: whether the life ended as leader, the time spent as leader, the bounty paid and whether the killer was an underdog. Guests are anonymous; signed-in players are linked by `user_id`. Clients can neither read nor write the table, and the views are revoked from `anon` and `authenticated`: query them from the SQL editor. They cover the last 7 days of public games (30 days for the daily view):

```sql
select first_lives_under_20s_pct, top_death_cause, underdog_kills_pct, median_leader_s from life_stats_summary;
select * from life_stats_causes;   -- how lives end, median duration, deaths to bots
select * from life_stats_daily;    -- daily trend: median life, wall deaths, throw accuracy…
```

### 4. Enable OAuth providers

In **Authentication → Providers**, enable:

- **Discord** — create an app on [discord.com/developers](https://discord.com/developers), add the redirect URL Supabase shows (`https://<project>.supabase.co/auth/v1/callback`), paste client ID + secret.
- **Google** — create OAuth credentials on [Google Cloud Console](https://console.cloud.google.com), same redirect URL.

For email auth, the default settings work out of the box. Configure SMTP
or use Supabase's built-in email if you want verification mails styled.

### 5. Verify

Restart the dev server (`npm run dev`) and:

- The login screen shows an `// AUTH` panel with sign-in / sign-up tabs.
- After signing up, choose a username (3–16 chars).
- Play a public game to the death — the result should appear in `matches` (Table editor in Supabase), and the life in `life_stats`.
- The right rail of the login screen ("TOP TROPHÉES") populates from `/api/leaderboard?period=day|week|season|all` (with your rank when signed in). The game server closes finished seasons by itself, on start and every hour: `select * from seasons_closed;` lists them, `season_results` their top 10.
- PROFILE also lists today's challenges from `/api/challenges` (with `?guest=<token>` for a guest).
- The BOUTIQUE's FEATURED tab reads today's items and prices from `/api/shop` (no database needed); a purchase is charged that day's price.
- PROFILE in the lobby shows your account's stats from `/api/profile/stats` (games, eliminations, best score and all-time rank, survival, last 10 games). Guests see the same stats for the public games played on their device, kept in `localStorage` (`blade.stats`).

### Guest mode

Players can keep playing without an account. The server hands each guest a
signed token (stored in the browser) and credits their trophées to a guest
wallet; signing in later moves that balance to the account. Guest games
don't appear on the leaderboards, which list accounts only. Authentication
is purely opt-in.

---

## Deployment

You have three sensible options. Production runs on a shared seedbox without root (see [Seedbox without root](#seedbox-without-root) below).

### 1. Self-host (recommended)

One process, one port. The Node server serves the client as static files. Perfect for a VPS or a home server.

```bash
curl -fsSL https://raw.githubusercontent.com/A-Jeaugey/blades-io/main/deploy.sh | bash
```

The script:

- installs Node 22 and pm2 if missing (Node 22 or later is required)
- clones / pulls the repo into `~/bladeio`
- builds, tests and starts the first release with `auto-deploy.sh` (below)
- enables pm2 auto-start at boot

The server listens on **2567**, serves the client at `/`, and exposes `/api` and `/healthz` (`503` while a restart is announced). Server settings (Supabase keys, `SERVER_GUEST_SECRET`, `TRUST_PROXY`, `ALLOWED_ORIGINS`, and optionally `PUBLIC_URL` for link previews) go in `~/bladeio/.env`, linked into every release; see `.env.example`.

#### Updates: graceful deploys

`auto-deploy.sh` deploys the latest `main` without cutting matches short:

1. **Separate build.** The commit is built in its own release directory, `~/bladeio-releases/<commit>`: `npm ci`, full build, tests. The live version is not touched until all of that succeeds. A version that failed is not retried until a new commit lands (or with `--force`). On a machine still running Node 20, `npm ci` stops right away (`engine-strict` in `.npmrc`): the live version stays up until Node 22 is installed.
2. **Atomic switch.** `~/bladeio-current` is switched to the new release, then pm2 restarts the server (`ecosystem.config.js`). The running server announces the restart: players see a 60 s countdown and new players are refused. The server closes when the last player leaves or the countdown ends, and it saves every match on the way out. Clients wait for the new version to answer, then return to the menu.
3. **Health check.** The script polls `/healthz` and rolls back to the previous release if the new one does not answer.

The systemd timer in `systemd/` runs the script every day at 05:00 (server time), when few players are online. To deploy right away, run `sudo systemctl start bladeio-autodeploy.service` or `~/bladeio/auto-deploy.sh`. Everything is logged to `~/bladeio-releases/deploy.log`. The 3 latest releases are kept, about 300 MB each. Check that CI is green before pushing to `main`.

#### HTTPS via Caddy

You really want TLS for WebSocket traffic. Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Copy the provided `Caddyfile` into `/etc/caddy/Caddyfile`, replace the domain, and restart:

```bash
sudo cp ~/bladeio/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # edit the domain
sudo systemctl restart caddy
```

Prereqs: an A record pointing your domain at the server, and ports 80/443 open. Caddy takes care of the Let's Encrypt cert automatically.

> **No public IP?** [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) routes traffic out from your box without any port forwarding.

#### Seedbox without root

Production runs on a shared seedbox (Whatbox): no root, no systemd, no pm2, but Node through nvm, cron, and an HTTPS proxy managed by the provider. The game lives in a single checkout of `main`, updated in place.

- **Start.** A small script, run by cron at boot and every 10 minutes, starts the server if it is not running:

  ```bash
  #!/bin/bash
  # ~/start-blades.sh — crontab: "@reboot ~/start-blades.sh" and "*/10 * * * * ~/start-blades.sh"
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 > /dev/null
  pgrep -f "server/dist/index.js" > /dev/null && exit 0
  cd ~/blades && nohup node server/dist/index.js >> ~/blades.log 2>&1 &
  ```

- **HTTPS.** The provider's proxy (Whatbox "managed links", WebSockets enabled) points the domain at the server's `PORT` and forwards `X-Forwarded-For`, so the default `TRUST_PROXY=1` is right.
- **`.env`.** Besides the Supabase keys and `SERVER_GUEST_SECRET`: `PORT` (the port the proxy points at), `PUBLIC_URL` (link previews), and `RESTART_NOTICE_MS=60000`, so that stopping the server gives players a 60 s countdown instead of cutting their match.

**Update** (nothing is deployed automatically):

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
cd ~/blades
git pull --ff-only origin main
npm ci && npm run build && npm test     # stop here if anything fails: the running server is untouched
pid=$(pgrep -f "node server/dist/index.js")
kill $pid; while kill -0 $pid 2>/dev/null; do sleep 1; done   # up to 60 s with players online
~/start-blades.sh
curl -s "http://localhost:$(sed -n 's/^PORT=//p' .env | tr -d '"\r ')/healthz"; echo
```

Roll back with `git reset --hard <previous commit>`, then the same build and restart.

### 2. Cloud free tier (Render + Vercel)

**Server on Render** — push the repo to GitHub, hit *New → Blueprint* on [render.com](https://render.com), pick the repo. The included `render.yaml` and `Dockerfile` do the rest. You'll end up with `wss://bladeio-server-XXXX.onrender.com`.

> Render's free tier sleeps after 15 min of inactivity, so first connection takes ~30–50 s of cold start.

**Client on Vercel** — *New Project* on [vercel.com](https://vercel.com), import the repo, set `VITE_SERVER_URL=wss://bladeio-server-XXXX.onrender.com` in env vars, deploy.

> **Known limitation:** the client calls `/api` on its own origin and `vercel.json` has no rewrite, so on this setup accounts, trophées, the shop and the leaderboard don't work (task T.8 in `PLAN.md`). The game itself works.

### 3. Docker

```bash
docker build -t bladeio-server .
docker run -p 2567:2567 bladeio-server
```

Server env vars: `PORT` (default `2567`) and the ones listed in `.env.example`.

To build a client pointed at a specific server:

```bash
VITE_SERVER_URL=wss://example.com npm run build --workspace=@bladeio/client
```

---

## Project layout

```
shared/src/
  constants.ts         # game tunables — start tweaking here
  types.ts             # message + event shapes
  orbits.ts            # ring radius / capacity / angular velocity helpers
  tiers.ts             # tier-derived multipliers (hitbox, rotation, scale)
  decor.ts             # static decor colliders
  shop.ts              # shop catalogue and daily featured items — the only source of item prices
  cosmetics.ts         # cosmetics: slots, level unlocks, loadout validation
  modes.ts             # game modes: registry, quick play and private room offers, match phases, teams
  arena.ts             # adaptive arena: radius from the population, wall speeds and shrink notice

server/src/
  index.ts             # Express + Colyseus bootstrap, /api/stats, static client
  shutdown.ts          # graceful restart: notice to players, pending writes
  telemetry.ts         # one life_stats row per human life (Supabase)
  rooms/ArenaRoom.ts   # tick loop, message handling, drop logic, match lifecycle
  modes/               # game mode rules as hooks (arena, rounds, team modes, flags): spawn, respawn, standings, end of match, bot goals
  state/               # Colyseus schemas (Player, Blade, Crate, PowerUp)
  systems/             # movement, collisions, throws, pickup, bots, map events, arena size, …
  auth/                # Supabase, wallets, guest tokens, /api routes
  http/rateLimit.ts    # per-IP rate limiting
  utils/spatialHash.ts

client/src/
  boot.ts              # entry point: lobby first, the engine (main.ts) loads in parallel
  main.ts              # game loop, rendering, networking glue
  net/Connection.ts    # Colyseus client + reconnect logic
  scene/               # camera, ground, decor, post-processing
  entities/            # PlayerView, BladeView, CrateView, PowerUpView, AimIndicator
  fx/                  # particles, combat effects (shockwaves, shards, light columns, blade trails, speed lines), screen shake
  input/               # keyboard, mouse (projected on the ground), touch joystick + throw button with drag aim
  ui/                  # HUD, login, death, leaderboard, minimap, settings, chat, combat feedback, onboarding
  i18n/                # French and English dictionaries, t(), data-i18n attributes
  themes/              # cosmetic themes (palette, ground shader, decor, music)
  cosmetics/           # cosmetic looks (data) and the device's loadout
  boutique/            # shop: featured items, map themes, skins, blade styles, trails, elimination effects, 3D try-on
  audio/SoundManager   # Tone.js procedural SFX (loaded on the first click) + music player

tools/bench-server.js  # headless server benchmark (tick time, bandwidth)
tools/bench-survival.js # newcomer survival bench: deaths in the first 30 s, time before the first death
tools/bench-snowball.js # snowball bench: leader reign length, underdog kills
tools/check-themes.mjs # theme readability check (rarity colors, ground, reserved colors), run in CI

deploy.sh              # first install on a server
auto-deploy.sh         # graceful deploys: separate build, switch, health check, rollback
ecosystem.config.js    # pm2 settings (restart notice, kill timeout)
systemd/               # daily deploy timer
```

Project docs:

- [`docs/AUDIT-2026-09.md`](docs/AUDIT-2026-09.md) — full audit of the game (French), with reference measurements
- [`PLAN.md`](PLAN.md) — the improvement plan that follows from it (French); checkboxes get ticked as tasks land
- [`CLAUDE.md`](CLAUDE.md) — guide for AI assistants: architecture, theme system, conventions

---

## Credits & licence

All in-game visuals and sound effects are generated by code: geometry, shaders, particles, audio synthesis. The only asset files are the music tracks in `assets/music/`.

Released under the **MIT licence** — do whatever you want with it.
