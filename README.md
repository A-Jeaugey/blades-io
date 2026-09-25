# blades.io

> A TikTok-game-style multiplayer `.io` brawler in a neon cyberpunk arena.
> Wrap yourself in spinning blade rings, throw blades as projectiles, and shred everyone else.

**Stack:** TypeScript · Colyseus (authoritative server, 60 Hz) · Three.js · Vite

---

## Concept

You are a glider in a circular arena. Around you orbit rings of blades that grow denser and faster the more you collect. Push your blades into another player's blades to break theirs; touch their body and they die. When you die, 70 % of your orbiting blades scatter as loot, plus the blades you lost in clashes during the last 10 seconds (up to 12). Dropped blades blink, then vanish after 15 s.

It plays like the kind of arena clash you see on TikTok feeds — short matches, instant replay, satisfying snowball — but rendered in real-time WebGL with a neon cyberpunk skin.

### Core mechanics

| Mechanic | Behavior |
|---|---|
| **Orbit rings** | More blades → denser rings, faster rotation, thicker shield |
| **Tier system** | 0 (arrows) → 1 (swords, 10+ blades) → 2 (scythes, 20+ blades), with hitbox/visual scaling |
| **Throw blade** | Detach your outermost blade and launch it as a projectile toward your aim (mouse cursor, or drag from the THROW button on mobile), independently of where you walk; keyboard-only throws and a THROW tap follow your movement. 0.5 s cooldown; a dashed line on the ground shows the path while the throw is ready |
| **Pierce by rarity** | Common/Rare: 1 hit · Epic: 2 hits · Legendary: 3 hits |
| **Clash impact** | Each clash knocks both players back (capped at a tier-2 knockback, applied in full after the freeze) and freezes their movement for 50–100 ms by tier; orbits keep spinning, and after a freeze a player gets 250 ms before the next one, so a fight never locks you in place |
| **Power-ups** | Speed, Spin, Magnet, Shield, +Blades — duration scales with rarity |
| **Loot crates** | Shoot or orbit them to crack them open and dump weighted-rare loot |
| **Glitch bushes** | Step in to vanish from other players' screens and minimaps |
| **Border** | Touching the kill zone is instant death — no clamp. Your outer blades are shredded first. The last 25 u are announced by a red vignette, an alarm and the arena edge on the minimap |
| **Score** | kills × 15 + peak blade count of the life + 1 per 10 s alive + crates × 3 + power-ups × 2. In public rooms, it is credited as trophées at the end of each life (death or leaving) |
| **Private rooms** | Join by code, 2.5× loot density, unranked and without trophées |

### Bots

When the room has fewer than 15 players, bots fill in (capped at 10). Each bot picks one of four personalities at spawn:

- **Aggressive** — picks fights even at parity, loose aim, low blade threshold, throws back at pursuers
- **Hunter** — precise throws, even-fight aggression, throws back at pursuers
- **Farmer** — collects ground blades and crates, chips at crates with throws
- **Camper** — sits on power-ups and bushes, conservative

Their decision-making runs through a multi-factor scoring system (flee · chase · farm · power-up · crate · wander · avoid-wall) and they react with imperfect timing, aim jitter, perpendicular evasion, target prediction and anti-double-aggro. They aim like players: a throw goes at the predicted intercept of their target, whatever direction they are walking.

---

## Architecture

```
shared/   Types and constants — single source of truth for game design
server/   Authoritative Colyseus room (60 Hz tick and patches, 60 player cap)
client/   Vite + Three.js + Colyseus.js
```

The server runs the entire simulation (positions, collisions, kills, drops, projectiles). The client sends only `dx, dy, boost, throw` (plus the aim direction of a throw) and renders remote entities 80 ms in the past (interpolation between snapshots) plus client-side prediction + reconciliation for the local player. Blade orbits are derived from a per-player orbit clock synced by the server, and combat events carry the server tick they happened on, so clients draw blades exactly where the server collides them and play each clash on the frame where the blades touch.

### Performance highlights

- **Spatial hash** (5-unit cells) for pickup and broad-phase collisions
- **Owner-bucket broad phase** for blade-vs-blade — pairs of players are tested by center distance before touching individual blades
- **InstancedMesh** rendering — one mesh per (rarity × tier), up to 800 instances each
- **Quality presets** (high/medium/low/ultra, auto-detected; `ultra` is the lightest) — bloom, particles and decor density adapt. An FPS monitor lowers the resolution first, then the preset; a lower preset picked mid-match applies back at the menu, never during a game
- **Anti-cheat** — server clamps `|dx|, |dy| ≤ 1`, ignores inputs above 80/s and disconnects a client that stays above that cap for 3 consecutive seconds

### Audio

Sound effects are 100 % procedural — Tone.js synths for pickups, throws, the boost noise, and one distinct sound per combat event: a metallic tink for a clash, a bright shatter when an enemy blade breaks, two falling tones when you lose one of yours, a rising chime for an elimination, a crunch for a crate, a heavy hit for your death. Clashing blades flash white, a red arc at the screen edge points at whoever is breaking your blades, and a "+1" pops where you eliminate someone. The only audio files are the music tracks: one lobby and one battle track per theme, stored in `assets/music/` and copied into `client/public/` at build time (`sync-music` script).

---

## Run locally

Prereqs: **Node 22** (the version CI uses; Node 20 still builds).

```bash
npm install
npm run dev
```

This starts:

- the Colyseus server on `ws://localhost:2567`
- the Vite dev client on `http://localhost:5173`

Open several tabs to test multiplayer.

> **Without Supabase configured**, the game runs in guest-only mode: anyone
> can play, but scores aren't saved and the all-time leaderboard stays empty.
> See **[Accounts & leaderboard (Supabase setup)](#accounts--leaderboard-supabase-setup)** below.

### Useful scripts

```bash
npm run build:shared       # rebuild shared types only
npm run build              # full prod build (shared + server + client)
npm start                  # run the prod server (serves the built client)
npm test                   # server system tests (node:test, simulated clock)
node tools/bench-server.js 60 120   # server bench: 60 bots, 120 simulated seconds
node tools/bench-survival.js        # newcomer survival against bots (after npm test)
```

Add `?debug=hitbox` to the game URL to overlay the server-side hitboxes of nearby orbiting blades and display the measured client/server drift.

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

### Gameplay tips

- Spawn with 3 Common blades. Ring 0 caps at 16 blades; ring 1 at 24; ring 2 at 32; etc.
- Boost drains 1 blade every 0.5 s — costly and worth saving for closes/escapes.
- Throwing eats your **outermost** blade, so a Legendary on the outside ring is a 3-pierce missile.
- Shield power-up halves incoming blade damage; combine with Spin for an oppressive wall.
- Bushes hide you AND your blades on the map for opponents — perfect for ambushes.

---

## Accounts & leaderboard (Supabase setup)

The game can persist scores per-user and surface an all-time top-100
leaderboard (public rooms only). It uses [Supabase](https://supabase.com) for auth (email +
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
- Play a public game to the death — the result should appear in `matches` (Table editor in Supabase).
- The right rail of the login screen ("TOP TROPHÉES") populates from `/api/leaderboard`.

### Guest mode

Players can keep playing without an account. The server hands each guest a
signed token (stored in the browser) and credits their trophées to a guest
wallet; signing in later moves that balance to the account. Guest games
don't appear on the leaderboard, which lists accounts only. Authentication
is purely opt-in.

---

## Deployment

You have three sensible options. Self-hosted is what production runs on.

### 1. Self-host (recommended)

One process, one port. The Node server serves the client as static files. Perfect for a VPS or a home server.

```bash
curl -fsSL https://raw.githubusercontent.com/A-Jeaugey/blades-io/main/deploy.sh | bash
```

The script:

- installs Node 20 and pm2 if missing
- clones / pulls the repo
- builds shared + server + client
- starts via pm2 with auto-start at boot

The server listens on **2567**, serves the client at `/`, and exposes `/api` and `/healthz`. Server settings (Supabase keys, `SERVER_GUEST_SECRET`, `TRUST_PROXY`, `ALLOWED_ORIGINS`) go in `.env`; see `.env.example`.

#### Auto-deploy

`auto-deploy.sh`, run every 30 s by the systemd timer in `systemd/`, deploys `main` as soon as it moves: `git reset --hard`, full build, `pm2 restart`. Every push to `main` therefore restarts the server and ends the matches in progress (graceful deploys are planned as task T.3 in `PLAN.md`). Check that CI is green before pushing to `main`.

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
  shop.ts              # shop catalogue — the only source of item prices

server/src/
  index.ts             # Express + Colyseus bootstrap, /api/stats, static client
  rooms/ArenaRoom.ts   # tick loop, message handling, drop logic
  state/               # Colyseus schemas (Player, Blade, Crate, PowerUp)
  systems/             # movement, collisions, throws, pickup, bots, …
  auth/                # Supabase, wallets, guest tokens, /api routes
  http/rateLimit.ts    # per-IP rate limiting
  utils/spatialHash.ts

client/src/
  main.ts              # game loop, rendering, networking glue
  net/Connection.ts    # Colyseus client + reconnect logic
  scene/               # camera, ground, decor, post-processing
  entities/            # PlayerView, BladeView, CrateView, PowerUpView, AimIndicator
  fx/                  # particles, screen shake
  input/               # keyboard, mouse (projected on the ground), touch joystick + throw button with drag aim
  ui/                  # HUD, login, death, leaderboard, minimap, settings, chat, combat feedback
  themes/              # cosmetic themes (palette, ground shader, decor, music)
  boutique/            # theme shop
  audio/SoundManager   # Tone.js procedural SFX + music player

tools/bench-server.js  # headless server benchmark (tick time, bandwidth)
tools/bench-survival.js # newcomer survival bench: deaths in the first 30 s against bots
```

Project docs:

- [`docs/AUDIT-2026-09.md`](docs/AUDIT-2026-09.md) — full audit of the game (French), with reference measurements
- [`PLAN.md`](PLAN.md) — the improvement plan that follows from it (French); checkboxes get ticked as tasks land
- [`CLAUDE.md`](CLAUDE.md) — guide for AI assistants: architecture, theme system, conventions

---

## Credits & licence

All in-game visuals and sound effects are generated by code: geometry, shaders, particles, audio synthesis. The only asset files are the music tracks in `assets/music/`.

Released under the **MIT licence** — do whatever you want with it.
