# blades.io

> A TikTok-game-style multiplayer `.io` brawler in a neon cyberpunk arena.
> Wrap yourself in spinning blade rings, throw blades as projectiles, and shred everyone else.

**Stack:** TypeScript · Colyseus (authoritative server, 20 Hz) · Three.js · Vite

---

## Concept

You are a glider in a circular arena. Around you orbit rings of blades that grow denser and faster the more you collect. Push your blades into another player's blades to break theirs; touch their body and they die. When you die, half of your hoard scatters as loot.

It plays like the kind of arena clash you see on TikTok feeds — short matches, instant replay, satisfying snowball — but rendered in real-time WebGL with a neon cyberpunk skin.

### Core mechanics

| Mechanic | Behavior |
|---|---|
| **Orbit rings** | More blades → denser rings, faster rotation, thicker shield |
| **Tier system** | 0 (arrows) → 1 (swords) → 2 (scythes), with hitbox/visual scaling |
| **Throw blade** | Detach your outermost blade and launch it as a projectile (Space / right-click / mobile button), 0.5 s cooldown |
| **Pierce by rarity** | Common/Rare: 1 hit · Epic: 2 hits · Legendary: 3 hits |
| **Power-ups** | Speed, Spin, Magnet, Shield, +Blades — duration scales with rarity |
| **Loot crates** | Shoot or orbit them to crack them open and dump weighted-rare loot |
| **Glitch bushes** | Step in to vanish from other players' screens and minimaps |
| **Border** | Touching the kill zone is instant death — no clamp |

### Bots

When the room has fewer than 15 players, bots fill in (capped at 10). Each bot picks one of four personalities at spawn:

- **Aggressive** — picks fights even at parity, loose throw cone, low blade threshold
- **Hunter** — precise throws, narrow cone, even-fight aggression
- **Farmer** — collects ground blades and crates, chips at crates with throws
- **Camper** — sits on power-ups and bushes, conservative

Their decision-making runs through a multi-factor scoring system (flee · chase · farm · power-up · crate · wander · avoid-wall) and they react with imperfect timing, aim jitter, perpendicular evasion, target prediction and anti-double-aggro.

---

## Architecture

```
shared/   Types and constants — single source of truth for game design
server/   Authoritative Colyseus room (20 Hz tick, 60 player cap)
client/   Vite + Three.js + Colyseus.js
```

The server runs the entire simulation (positions, collisions, kills, drops, projectiles). The client sends only `dx, dy, boost, throw` and renders interpolated server snapshots with a 100 ms buffer plus client-side prediction + reconciliation for the local player.

### Performance highlights

- **Spatial hash** (5-unit cells) for pickup and broad-phase collisions
- **Owner-bucket broad phase** for blade-vs-blade — pairs of players are tested by center distance before touching individual blades
- **InstancedMesh** rendering — one mesh per (rarity × tier), up to 800 instances each
- **Quality presets** (auto/high/medium/low) — bloom, particles, decor density adapt for mobile
- **Anti-cheat** — server validates `|dx|, |dy| ≤ 1`, caps inputs at 40/s, kicks after 3 violations

### Audio

100 % procedural — Tone.js synths for hits, pickups, deaths, throws, the boost noise. The only external audio asset is the looping cyberpunk track served from `client/public/`.

---

## Run locally

Prereqs: **Node 20+**.

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
```

---

## Controls

| Action | Keyboard | Mouse | Touch |
|---|---|---|---|
| Move | WASD or Arrow keys | follow cursor | virtual joystick (left) |
| Boost | Shift | hold left-click | BOOST button (right) |
| **Throw blade** | Space | right-click | THROW button (next to BOOST) |

Input mode is auto-detected. Keyboard takes priority over mouse if both are active.

### Gameplay tips

- Spawn with 3 Common blades. Rings 0 caps at 16 blades; ring 1 at 24; ring 2 at 32; etc.
- Boost drains 1 blade every 0.5 s — costly and worth saving for closes/escapes.
- Throwing eats your **outermost** blade, so a Legendary on the outside ring is a 3-pierce missile.
- Shield power-up halves incoming blade damage; combine with Spin for an oppressive wall.
- Bushes hide you AND your blades on the map for opponents — perfect for ambushes.

---

## Accounts & leaderboard (Supabase setup)

The game can persist scores per-user and surface an all-time top-100
leaderboard. It uses [Supabase](https://supabase.com) for auth (email +
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

Open the **SQL editor** in your Supabase dashboard, paste the contents of
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql),
and run it. This creates:

- `profiles` table — usernames, 1-to-1 with `auth.users`
- `matches` table — one row per finished game (server-only writes via service role)
- `leaderboard_top` view — best score per user, joined with profile
- Row-level security policies + a trigger that auto-creates a profile on signup

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
- Play a game to the death — the result should appear in `matches` (Table editor in Supabase).
- The right rail of the login screen ("TOP OPS") populates from `/api/leaderboard`.

### Mode invité

Players can keep playing without an account. The CALLSIGN field stays
editable when signed-out and the death screen explicitly says scores
aren't saved. Authentication is purely opt-in.

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

The server listens on **2567**, serves the client at `/`, and exposes `/api` and `/healthz`.

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

### 3. Docker

```bash
docker build -t bladeio-server .
docker run -p 2567:2567 bladeio-server
```

Server env vars: `PORT` (default `2567`).

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

server/src/
  rooms/ArenaRoom.ts   # tick loop, message handling, drop logic
  state/               # Colyseus schemas (Player, Blade, Crate, PowerUp)
  systems/             # movement, collisions, throws, pickup, bots, …
  utils/spatialHash.ts

client/src/
  main.ts              # game loop, rendering, networking glue
  net/Connection.ts    # Colyseus client + reconnect logic
  scene/               # camera, ground, decor, post-processing
  entities/            # PlayerView, BladeView, CrateView, PowerUpView
  fx/                  # particles, screen shake
  input/               # keyboard, mouse, touch joystick + throw button
  ui/                  # HUD, login, death, leaderboard, minimap, settings
  audio/SoundManager   # Tone.js procedural SFX + music player
```

`PLAN.md` is a living spec — checkboxes get ticked as features land.

---

## Credits & licence

All in-game assets are generated by code: geometry, shaders, particles, audio synthesis. No external assets, no attributions.

Released under the **MIT licence** — do whatever you want with it.
