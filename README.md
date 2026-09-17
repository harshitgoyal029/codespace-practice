# Perk Counter

Perk Counter is a small full-stack rewards counter for cafe staff. It keeps member balances exact while making the counter workflow fast: find a regular by phone, record a purchase, and redeem an item from the live balance.

## Product

The landing page is the first screen for the product. It explains the target audience (cafe counter teams), the key workflow, the value of exact balances, Bronze/Silver/Gold earning, and three next features: a member mobile wallet, quiet-hour campaigns, and multi-location reporting.

The counter workspace requires staff registration or login. Members are searchable by name, phone, or email. Results support pagination and sorting by recent activity, name, points balance, or lifetime points.

Points are awarded per whole dollar spent:

- Bronze: 1 point per dollar
- Silver: 2 points per dollar after 500 lifetime points
- Gold: 3 points per dollar after 1,500 lifetime points
- Platinum: 0.3 points per rupee after 5,000 lifetime points

Available rewards are a crafted drink for 100 points, a bakery treat for 250 points, and lunch for 500 points. Purchase and redemption writes are atomic SQLite transactions, so a failed redemption cannot reduce the balance.

## Stack

- Node.js and Express REST server
- SQLite via `better-sqlite3` with foreign keys and WAL mode
- bcrypt password hashing and signed JWT staff sessions
- Vanilla HTML, CSS, and JavaScript UI

## Setup

Requirements: Node.js 20+ and npm.

```bash
npm install
npm start
```

Open http://localhost:3000. Create a staff account from **Staff login**, then add a member.

For development with automatic server restart:

```bash
npm run dev
```

Optional environment variables:

```bash
PORT=3000
DB_FILE=./perk-counter.db
JWT_SECRET=replace-this-in-production
```

The SQLite database is created automatically on first start. The first staff account creates 18 sample members across all three tiers when the database has fewer than 10 members, making search, sorting, and pagination immediately testable. Existing members are never overwritten or deleted. The database is intentionally ignored by git. To debug it directly, use `sqlite3 perk-counter.db` and inspect `staff_users`, `members`, and `transactions`.

## REST API

All member and reward routes require `Authorization: Bearer <token>`. JSON request bodies use `Content-Type: application/json`.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/auth/register` | Register a staff account (`name`, `email`, `password`) |
| `POST` | `/api/auth/login` | Log in and receive a JWT (`email`, `password`) |
| `GET` | `/api/auth/me` | Read the current staff session |
| `GET` | `/api/rewards` | List redeemable rewards and point costs |
| `GET` | `/api/members?search=&page=1&limit=10&sort=recent&direction=desc` | Search, paginate, and sort members |
| `POST` | `/api/members` | Create a member (`name`, `phone`, optional `email`) |
| `GET` | `/api/members/:id` | Read member balance, tier, and recent activity |
| `GET` | `/api/members/:id/transactions` | Read up to 100 member ledger entries |
| `POST` | `/api/members/:id/purchases` | Record purchase (`amount` in dollars, optional `note`) and earn points |
| `POST` | `/api/members/:id/redemptions` | Redeem (`rewardId`: `coffee`, `pastry`, or `lunch`) |
| `POST` | `/clock` | Run the expiry job; optionally pass `{ "now": "2026-12-17T00:00:00.000Z" }` for deterministic tests |
| `GET` | `/outbox` | Read tier-crossing notification events emitted by the notification service |

Example purchase:

```bash
curl -X POST http://localhost:3000/api/members/1/purchases \
	-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
	-d '{"amount": 12.50}'
```

## Debugging and tests

Syntax and serving checks:

```bash
node --check server.js
node --check public/app.js
curl http://localhost:3000/
```

The core invariant to test is that an insufficient redemption returns `400` and leaves `members.points_balance` unchanged. A successful purchase returns the new member, earned point count, and tier; a successful redemption returns the new member and redeemed reward.

There is no third-party API or seed account. Use registration in the UI or the auth endpoint to create a local staff account.

Each purchase creates a 90-day point lot. `POST /clock` expires unused lots due at the supplied time and reduces live balances without changing lifetime points. Crossing Bronze→Silver, Silver→Gold, or Gold→Platinum writes a `tier.crossed` event to `/outbox` in the same purchase transaction.

The browser controls use one listener per action; the stale pre-role listener block was removed after the role/navigation update. This prevents duplicate logout, auth, member, and sort requests.

## Test Platinum, notifications, and expiry

Use these commands against a running local server. Replace `TOKEN` with the token returned by staff login and replace `ID` with the new member ID.

```bash
# 1. Create an empty test member
curl -X POST http://localhost:3000/api/members \
	-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
	-d '{"name":"Twist Test","phone":"5550199000"}'

# 2. Put that test member one point below Platinum (local test database only)
sqlite3 perk-counter.db "UPDATE members SET lifetime_points=4999, points_balance=0 WHERE id=ID;"

# 3. This purchase crosses into Platinum and writes tier.crossed to the outbox
curl -X POST http://localhost:3000/api/members/ID/purchases \
	-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
	-d '{"amount":1}'
curl http://localhost:3000/outbox

# 4. A Platinum purchase earns 0.3 points per dollar/rupee unit
curl -X POST http://localhost:3000/api/members/ID/purchases \
	-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
	-d '{"amount":100}'

# 5. Move the clock beyond 90 days and expire the unused lots
curl -X POST http://localhost:3000/clock \
	-H "Content-Type: application/json" \
	-d '{"now":"2027-01-01T00:00:00.000Z"}'
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/members/ID
```

The clock response reports expired member and point totals. Calling it again with the same timestamp is idempotent because expired lots have zero remaining points. The local Keshav account was also repaired to point to Keshav's member record rather than Rahul's; Keshav's own history is kept intact.

## Documentation maintenance

For each subsequent product instruction, update `README.md`, `REASONING.md`, and `AI_LOGS.md` together so setup details, implementation decisions, and the conversation record stay aligned.

## UI troubleshooting

If the page appears dimmed while the member form is missing, refresh the deployed page with `Ctrl+Shift+R`. The modal positioning correction is loaded from `public/overrides.css`, after the base stylesheet, so the backdrop and form render as separate fixed layers.

To run the server again after it has been stopped, use `npm start` from the project folder. Exit code `130` means the previous process was interrupted; it is not an application error.

## Quick start now

From `/workspaces/codespace-practice`:

```bash
npm install
npm start
```

Open `http://localhost:3000`. Stop the server with `Ctrl+C`. If port 3000 is busy, use `PORT=3001 npm start` and open `http://localhost:3001`.

The public site includes an interactive newsletter footer. The authenticated ledger has its own sticky operations header, live member count, lookup status, shift clock, directory range, support link, and operations footer. The public shell is hidden while the ledger is active so the landing footer cannot appear above the member workspace.

Both public and authenticated pages now use a larger contact footer with `hello@perkcounter.cafe`, `+1 (555) 010-2020`, and an Instagram link at `instagram.com/perkcounter`, alongside navigation and newsletter signup.

The final readability pass increases button, navigation, member, search, and footer text sizes without adding large empty gaps. Footer contact links have visible separators and remain readable on narrow screens.

Header readability is also increased: desktop branding is 28px, primary navigation is 18px, and account/role/logout controls are 17px, with responsive reductions for mobile.

The latest header pass explicitly sets `Ledger`, `Rewards guide`, and `Support` to 20px on desktop with larger line height and click padding; mobile uses 16px. The selectors use higher specificity so the navigation does not collapse back to the smaller base font.

The repository history is organized into focused feature commits covering setup, persistence, APIs, public UI, authenticated UI, styling, overrides, and required documentation.

Public navigation now includes separate Home, About, Rewards guide, and Contact views. Each view keeps the shared header and interactive footer visible, uses a sliding page transition, and has larger body/form text for readability. Contact includes a local feedback form; it confirms the message in the UI without pretending to send email from the server.

## Roles and member portal

Registration supports `staff` and `member` accounts. Staff can operate the ledger; the first local account is promoted to `admin` for identification. A member account must provide the phone number already stored on a member record, then receives a points-only portal with their live balance, tier, lifetime points, reward progress, and recent activity. Member accounts cannot access the staff directory, create members, record purchases, or redeem on behalf of someone else.

After staff login, **Rewards guide** and **Support** open as separate in-app pages. The directory sort menu has explicit `Name A–Z` and `Name Z–A` options, plus recent, points, and lifetime-point sorting.
