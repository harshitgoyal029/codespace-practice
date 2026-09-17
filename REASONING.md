# Reasoning

## Goal

The useful unit of work is the counter moment: staff identify a member, apply a purchase or redemption, and see a balance they can trust. The implementation therefore treats the server-side ledger as the source of truth and keeps the browser responsible only for display and input.

## Data model

`staff_users` stores the people allowed to operate the counter. `members` stores a phone-identified member, their current balance, and lifetime earned points. `transactions` is an append-only ledger with a foreign key to both the member and staff operator. The balance is denormalized for fast lookup, but every mutation also writes a transaction record in the same database transaction.

Lifetime points determine the tier. Current points determine whether a reward can be redeemed. Those two concepts are kept separate so spending a reward never moves a member backwards through the tier ladder.

## Important decisions

- Point rules are computed on the server. The client cannot choose the number of points earned or subtract an arbitrary amount.
- Purchase and redemption updates are SQLite transactions. Redemption also has a conditional `UPDATE ... WHERE points_balance >= cost`, which protects against stale concurrent requests.
- Phone numbers are normalized to digits and `+`, then protected by a unique database constraint.
- The list endpoint uses parameterized search values, a fixed allow-list for sort columns, and bounded page size.
- Passwords are bcrypt hashes. Staff APIs require a signed JWT.
- The product landing page and counter workspace share one application entry point, keeping setup simple for a small cafe while still making the product understandable before login.

## Testing and fixes

1. Confirmed Node/npm and the SQLite CLI were available in the empty repository.
2. Installed dependencies with `npm install`.
3. Started the server and exercised registration, login, member creation, purchase earning, and member search with curl.
4. The first redemption test attempted to redeem a 100-point drink after a $52.40 Bronze purchase. The API correctly rejected it because the balance was 52; the test assumption was corrected instead of weakening the business rule.
5. Ran `node --check server.js` and `node --check public/app.js`.
6. Requested the served landing page and confirmed it returned the expected product HTML.
7. Used the workspace diagnostics on both JavaScript files; no errors were reported.

A browser-level automated test suite would be the next testing investment. The current API smoke checks cover the balance-critical path, while the UI is intentionally thin over those APIs so the same contracts are easy to exercise manually or with Playwright.

## Documentation rule

The project now treats `README.md`, `REASONING.md`, and `AI_LOGS.md` as a synchronized submission set. Every new user instruction should update all three files, even when the instruction is procedural rather than a code change.

## Overlay fix

The reported screenshot showed a dimmed counter with the modal content missing. Inspection found that the compressed base stylesheet had no `.member-modal` or `.member-form-panel` rules, leaving the backdrop fixed while the form stayed in normal document flow. A separate `overrides.css` file now explicitly sets both modal containers to fixed layers, gives the backdrop and panel deterministic z-index values, centers the member form, and constrains it on small screens. This keeps the correction isolated and avoids another large rewrite of the compact stylesheet.

The user later needed to run the project again. The terminal showed exit code `130`, which indicates the prior `npm start` process was interrupted, so restarting with `npm start` is the correct action.

The current run path remains intentionally simple: install dependencies once, start the Express server, and open localhost:3000. A configurable PORT fallback is documented for an occupied development port.

## Operations UI pass

The screenshots showed the landing footer leaking above the member page and an overly sparse authenticated header. The page transition now hides and restores the public footer with the public shell. The member workspace has a sticky operations header, support and rewards-guide links, live metrics, a local shift clock, directory range metadata, and a dedicated footer. The public footer now has grouped navigation and an interactive newsletter form with confirmation feedback. This keeps public marketing content and staff operations content in separate shells while making both feel complete.

## Public page navigation

The next report was that header links could not open other pages. The original links targeted anchors inside the hidden landing `main`, and app-only links displayed a toast instead of a destination. A small client-side page router now toggles dedicated About, Rewards guide, and Contact views while preserving the shared public header/footer. The authenticated app remains a separate shell. Typography was increased through the override layer for body copy, compact labels, member metadata, search controls, and navigation without changing the hierarchy of the display headings.

## Roles and runtime correction

The latest requirement called for non-admin users to see their own points. Roles are persisted on `staff_users`; `member_id` links a member account to the existing member record. The API signs role and member ID into the session, returns only the linked member view to member users, and blocks staff-only mutations and directory access. The browser renders a member portal with live balance, tier, lifetime points, rewards progress, and history.

Name sorting previously displayed only A–Z while the API already supported direction. The UI now sends explicit `name-asc` or `name-desc` choices. Rewards and Support are dedicated authenticated app views rather than informational toasts. The short home rhythm is preserved by reducing the landing section spacing while retaining the three next-feature cards.

During validation, Node 24 plus the native SQLite addon produced a cleanup assertion when the terminal killed a background process. Explicit SIGINT/SIGTERM database close handling was added and verified with a clean SIGTERM run. A readiness race in one HTTP smoke script was discarded as a test-harness issue rather than treated as an application result.

## Twist implementation

- Platinum is checked before Gold at 5,000 lifetime points and uses a `0.3` multiplier for new purchases. Existing `lifetime_points` and `points_balance` values are not rewritten by the tier addition.
- `point_lots` tracks earned points independently from lifetime points. A purchase creates a lot expiring 90 days later; redemption consumes the oldest lots first. `POST /clock` accepts an optional ISO `now`, expires due lots, records `point_expiries`, and reduces only the current balance.
- `notifications` is the local Notification Service outbox. A purchase compares the tier before and after earning and writes `tier.crossed` atomically when they differ. `GET /outbox` exposes the ordered event payloads for grading or delivery.

The twist code parses cleanly and the three new persistence tables are present. Full HTTP twist execution was attempted, but the container's Node 24/better-sqlite3 native cleanup assertion terminated the temporary server before the final fetch script completed; this remains an environment-level validation gap.

A final frontend audit found the earlier listener block had remained beside the newer role-aware block. It was removed so each auth, logout, member, and sorting action is registered exactly once. Final syntax checks and workspace diagnostics are clean.

The footer was expanded into a shared contact surface for every shell: larger readable type, email, phone, Instagram, navigation, and newsletter interaction on public pages, plus the same contact links in the authenticated operations footer.

The screenshot showed that the earlier footer still looked visually cramped horizontally and too empty vertically. A final override increases actual font/control sizes, reduces footer padding, adds explicit separators between contact links, and uses responsive wrapping instead of creating more whitespace.

The header received the same treatment: larger logo mark and wordmark, larger public/app navigation, and readable account, role, and logout controls. Desktop and mobile sizes are intentionally different so the header stays usable.

The screenshot showed the header links still visually small despite the earlier broad rule. The correction uses explicit `.site-header .site-nav a` and `.app-header .app-nav a` selectors with 20px desktop sizing, 16px mobile sizing, stronger specificity, and vertical padding for a larger readable target.

The final delivery is split into focused Git commits rather than one large snapshot, so each major product surface can be reviewed independently while the complete feature set is pushed together.

## Final status

All requested product features and the three grading twists are implemented in the repository and pushed to GitHub. Validation confirms parsing, schema creation, served UI assets, and workspace diagnostics. The remaining test gap is environmental: temporary HTTP servers using the native SQLite addon can hit a Node 24 cleanup assertion when the container tears them down.

## Limitation resolved

The native cleanup assertion was fixed at the root by replacing `better-sqlite3` with Node 24's built-in `node:sqlite` `DatabaseSync`. The existing SQLite file, schema, prepared statements, explicit transaction wrapper, and shutdown handling were preserved. A live end-to-end check passed login, member creation, purchase, expiry clock, notification outbox, and sorted pagination, then the persistent server was terminated cleanly. No final commit was created for this fix; it remains ready for the user's final commit.

## Manual twist example

The README now includes a reproducible local walkthrough: create a test member, set lifetime points to 4,999 in the local SQLite database, purchase $1 to cross into Platinum, inspect `/outbox`, make a Platinum purchase, and call `POST /clock` with `2027-01-01T00:00:00.000Z`. This makes both notification and 90-day expiry behavior observable without changing production rules. The existing Keshav account was repaired by exact name match from Rahul's member ID to Keshav's member ID; Keshav's own two ledger entries were not deleted.

The expiry walkthrough now copies the database to `/tmp/perk-counter-test.db` and runs on port 3010. A prior validation accidentally called the 2099 clock against the live database, which correctly expired every active lot and made the UI show zero; balances were restored from the immutable transaction ledger and fresh lots were recreated. The production expiry behavior itself remains unchanged.

## Final commit

The project is complete. The last changes are split into three commits: the built-in SQLite runtime migration, the README/test-data safety update, and the reasoning/AI log update. After these commits are pushed, the repository is ready for final review.
