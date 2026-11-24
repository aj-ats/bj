# Free BJ

Practice blackjack in the browser. Every session starts with **$100,000** in fake chips. Nothing on the table is redeemable. The leaderboard ranks sessions by the most money they ran up: the peak stack after a settled hand, not a house comp.

The brief said “100000k usd”. This build reads that as one hundred thousand dollars (`10_000_000` cents). Say so if it should be $100,000,000 instead.

The game engine is plain TypeScript with no Node imports. The running product is a Node server plus two Postgres databases. See [Deploy](#deploy) for GitHub and Cloudflare.

## PvP

Heads-up USDC blackjack is specified and not built. The work is nine pieces in [docs/pvp/README.md](docs/pvp/README.md). Start at the top of that list. The practice table stays on fake chips.

Rock-paper-scissors is a separate local contract on Anvil. The rules are in [docs/rps/README.md](docs/rps/README.md). `npm run chain:e2e` starts a chain on port 8545, deploys the game, and plays a win, a tie, a timeout, and a pause. That port has to be free. The browser table and the static-hosting notes are in [docs/rps/ui.md](docs/rps/ui.md). `npm run rps:dev` serves that page and does not need Postgres.

## House rules

- Six-deck shoe. A new shoe is shuffled when fewer than 78 cards remain, between hands.
- Dealer stands on soft 17. Blackjack pays 3 to 2. Dealer peeks.
- Insurance is half the original bet and pays 2 to 1. Blackjack against an ace can take even money.
- Double any first two cards, including after a split. Split equal ranks into at most four hands. Split aces take one card and stand.
- No surrender. Forfeit is only an escape hatch: the bet stays with the house.
- Bets are whole dollars. There is no table minimum or maximum. A bet cannot be larger than the stack.
- A session is an HttpOnly cookie. Chips, the shoe, and the peak belong to that cookie.

## Run it

Docker Compose starts Postgres and the app. The database publishes on host port **54329** so it does not collide with a local Postgres. The table is on port **8080**.

```bash
docker compose up --build
```

Open http://localhost:8080. The house console is http://localhost:8080/admin.

Set `ADMIN_PASSWORD` before exposing the service. The local default is `admin` / `changeme`, and the process logs a warning when that password is still in use. Compose passes `ADMIN_PASSWORD` through from the environment when it is set.

```bash
ADMIN_PASSWORD='a-real-password' docker compose up --build
```

Two databases share one Postgres 16 server and use different logins:

| Database | Role | What it holds |
| --- | --- | --- |
| `freebj_leaderboard` | `leaderboard_user` | Sessions, hands, the public board |
| `freebj_admin` | `admin_user` | Operator account, sessions, audit log, table rules |

`leaderboard_user` cannot connect to the admin database.

### Local development

```bash
docker compose up db
cp .env.example .env
npm install
npm run dev
```

The API listens on port 8080. Vite serves the pages on port 5173 and proxies `/api` and `/admin/api`.

## Postgres

The Compose service is `db` (Postgres 16). Money columns are integer cents. Divide by 100 for dollars.

Open a shell in the container:

```bash
docker compose exec db sh
```

Open `psql` from the host. Connections over the container's local socket do not ask for a password:

```bash
docker compose exec db psql -U leaderboard_user -d freebj_leaderboard
docker compose exec db psql -U admin_user -d freebj_admin
docker compose exec db psql -U postgres
```

With the `db` ports block still in `docker-compose.yml`, the same databases are on host port `54329`:

```bash
psql "postgres://leaderboard_user:leaderboard_pass@127.0.0.1:54329/freebj_leaderboard"
psql "postgres://admin_user:admin_pass@127.0.0.1:54329/freebj_admin"
```

Run one statement and exit:

```bash
docker compose exec db psql -U leaderboard_user -d freebj_leaderboard -c '\dt'
```

Inside `psql`: `\dt` lists tables, `\d sessions` describes a table, `\x` toggles expanded rows, `\l` lists databases, `\du` lists roles, `\q` quits. `\c freebj_admin admin_user` switches database and role.

### Leaderboard (`freebj_leaderboard`)

Public board, in the same order the site uses:

```sql
SELECT display_name,
       peak_bankroll_cents / 100.0 AS peak_usd,
       bankroll_cents / 100.0 AS stack_usd,
       net_cents / 100.0 AS net_usd,
       hands_played
FROM sessions
WHERE hidden_from_board = FALSE AND hands_played > 0
ORDER BY peak_bankroll_cents DESC, net_cents DESC, created_at ASC, id ASC
LIMIT 20;
```

Totals. Player net and house net are the same figure with opposite signs:

```sql
SELECT count(*) AS sessions,
       count(*) FILTER (WHERE hands_played > 0) AS played,
       count(*) FILTER (WHERE banned) AS banned,
       coalesce(sum(hands_played), 0) AS hands,
       coalesce(sum(total_wagered_cents), 0) / 100.0 AS wagered_usd,
       coalesce(sum(net_cents), 0) / 100.0 AS player_net_usd
FROM sessions;
```

Find a name:

```sql
SELECT id, display_name,
       bankroll_cents / 100.0 AS stack_usd,
       hands_played, banned, hidden_from_board, updated_at
FROM sessions
WHERE display_name ILIKE '%ada%'
ORDER BY updated_at DESC;
```

Hand history. `detail` holds the cards and the result:

```sql
SELECT created_at,
       wager_cents / 100.0 AS wager_usd,
       net_cents / 100.0 AS net_usd,
       description,
       detail
FROM hands
WHERE session_id = 'PASTE-UUID'
ORDER BY created_at DESC
LIMIT 30;
```

The house console is the place to ban, hide, or adjust chips, because those actions write `audit_log`. The same flags can be set in SQL, and that write is not audited:

```sql
UPDATE sessions
SET hidden_from_board = TRUE, updated_at = now()
WHERE id = 'PASTE-UUID';

UPDATE sessions
SET banned = TRUE, ban_reason = 'reason', updated_at = now()
WHERE id = 'PASTE-UUID';
```

### House (`freebj_admin`)

Rules used for the next new shoe and the next new session:

```sql
SELECT decks, hit_soft_17,
       starting_bankroll_cents / 100.0 AS starting_usd,
       updated_at, updated_by
FROM table_settings
WHERE id = 1;
```

Recent operator actions:

```sql
SELECT created_at, admin_username, action, session_id, detail
FROM audit_log
ORDER BY created_at DESC
LIMIT 40;
```

Open operator cookies, and a way to drop them so the next request must sign in again:

```sql
SELECT username, created_at, expires_at
FROM admin_sessions
WHERE expires_at > now();

DELETE FROM admin_sessions;
```

### Backup

```bash
docker compose exec -T db pg_dump -U leaderboard_user -d freebj_leaderboard --no-owner > leaderboard.sql
docker compose exec -T db pg_dump -U admin_user -d freebj_admin --no-owner > admin.sql
```

`-T` keeps `exec` from allocating a TTY, so the dump file stays clean. Restore with the matching role:

```bash
docker compose exec -T db psql -U leaderboard_user -d freebj_leaderboard < leaderboard.sql
```

Rows live in the `pgdata` volume. `docker compose down` keeps the volume. `docker compose down -v` deletes it.

## Tests

`npm test` starts a disposable Postgres, runs the engine and HTTP tests, builds the pages, and plays a hand in Chromium.

```bash
npx playwright install chromium
npm test
npm run typecheck
```

## House console

One operator. The username and password come from `ADMIN_USERNAME` and `ADMIN_PASSWORD`. On boot the app stores a scrypt hash and removes any other operator, so the environment is the source of truth. Sign-in sets an HttpOnly cookie for 12 hours. Failed sign-ins are rate-limited.

The operator can:

- Read session, hand, and money totals. Player net and house net are the same figure with opposite signs.
- Change the rules for future hands: one to eight decks, hit or stand on soft 17, and the starting stack for new sessions. There is no table minimum or maximum. A hand already in progress keeps the rules it was dealt under.
- Open any session, including the dealer hole card and the hand history.
- Add or remove chips. A reason of 3 to 200 characters is required. The stack cannot go negative. A comp does not raise the peak. The peak moves only when a later settled hand leaves the player above it. Hide a gifted session if it should not rank.
- Ban a session so it cannot play, and hide or show it on the public board.
- Read the audit log. Hands are not deleted.

The public board shows the top 20 visible sessions that have played at least one hand, ordered by peak, then net, then who sat down first. A session outside that list still sees its own rank.

## Deploy

Push this repo to GitHub. Leave `.env` untracked. Passwords and database URLs belong on the host, not in the repository.

### What to pay for

One machine runs the app container and both databases. Prices below are the published monthly caps checked in November 2026.

| Choice | Monthly cost | What you get | Use it when |
| --- | --- | --- | --- |
| DigitalOcean Basic, 1 GiB | $6 | 1 shared vCPU, 25 GiB disk | You already have a DigitalOcean account. This is the size to start with. |
| DigitalOcean Basic, 512 MiB | $4 | 1 shared vCPU, 10 GiB disk | You want the lowest DigitalOcean bill and will add swap. Postgres and Docker are tight in 512 MiB. |
| Hetzner CX23 | about €5.49 plus an IPv4 fee | 2 vCPU, 4 GiB RAM, 40 GiB | You want more RAM for about the same money and do not mind a second host. |
| Oracle Cloud Always Free Ampere | $0 | Up to 2 OCPU and 12 GiB, when the region has capacity | You accept signup friction and the chance the free shape is out of stock. Confirm the current allowance on Oracle's site. |
| DigitalOcean App Platform or a managed database | well above $6 | Someone else runs the process | Skip it. This Compose file is the cheap deploy. |
| Cloudflare Containers plus an outside database | Workers Paid ($5) plus the database | The Node image on Cloudflare, Postgres elsewhere | More money and a wrapper this repo does not have yet. |

Weekly Droplet backups add 20% ($1.20 on the $6 plan). Fake-chip history is the only data worth keeping, so a weekly backup is enough.

### DigitalOcean

Create a Droplet:

- Image: Ubuntu 24.04 LTS
- Size: Basic, Regular, **1 GiB / 1 vCPU / $6**
- Datacenter near the players
- SSH key, not a password
- Skip the paid monitoring add-ons

On a 512 MiB Droplet, add swap before Compose starts:

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Install Docker, then close every port except SSH. The site will be reached through a Cloudflare Tunnel, so the Droplet does not need a public web port.

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"
sudo ufw allow OpenSSH
sudo ufw enable
```

Log out and back in so the `docker` group applies. Clone the repo and edit `docker-compose.yml` on the Droplet:

- Delete the `ports` block under `db`. `54329` is only for local `npm run dev`.
- Under `app.environment`, add `COOKIE_SECURE: "true"`.

Start it:

```bash
git clone <your-github-url> free-bj
cd free-bj
# edit docker-compose.yml as above
ADMIN_PASSWORD='a-real-password' docker compose up --build -d
curl -fsS http://127.0.0.1:8080/api/health
```

The health check should print `{"ok":true}`.

In the Cloudflare dashboard, create a tunnel and point the hostname at `http://localhost:8080` on this Droplet. The steps are in [Create a tunnel](https://developers.cloudflare.com/tunnel/get-started/). After it connects, open `https://your-host/api/health`, then `https://your-host/admin`.

A new commit is a pull and a rebuild. The password is reapplied on boot:

```bash
git pull
ADMIN_PASSWORD='a-real-password' docker compose up --build -d
```

Changing `ADMIN_PASSWORD` and running that command replaces the stored house password. Cloudflare Access can sit in front of `/admin` as a second door. The app password still applies after Access.

### Cloudflare alone

This repository cannot be deployed on Cloudflare by itself.

The process uses Node, the `pg` driver, and two Postgres databases with separate logins. Cloudflare's managed SQL database is [D1](https://developers.cloudflare.com/d1/), which is SQLite. There is no Cloudflare Postgres. Container disk is [ephemeral](https://developers.cloudflare.com/containers/faq/), so Postgres inside a Cloudflare Container would lose the leaderboard when the instance sleeps.

A Workers deploy also needs a different server. This one listens with `@hono/node-server`, reads static files off disk, and opens Postgres pools at startup. Connecting the GitHub repo to [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) today would try to treat it as a Worker. It has no Wrangler config and no D1 bindings, so that connection is the wrong button.

Two later shapes are real:

| Shape | What moves to Cloudflare | What stays outside |
| --- | --- | --- |
| Container for the app | The existing image, behind a Worker on the [Workers Paid plan](https://developers.cloudflare.com/containers/). GitHub deploys through Workers Builds with `npx wrangler deploy` on the production branch. | A durable Postgres host. The container needs internet access and both database URLs. |
| Worker plus D1 | The HTTP app and two D1 databases, one for the board and one for the house. | Nothing, after the SQL and the Node-only startup are ported. |

Neither wrapper is in this repo. The engine can move. The database layer is the part that has to be rewritten for an all-Cloudflare version.
