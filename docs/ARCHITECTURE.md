# Architecture decisions

- TypeScript pnpm workspace: `apps/client`, `apps/server`, `packages/shared`, `packages/engine`, `packages/content`.
- React/Vite UI with HTML country tiles and SVG road connections. The desktop perimeter and mobile serpentine route preserve the same node identities and rules. Rules never wait for animation completion.
- Node.js 24 and Colyseus authoritative rooms. HTTP serves the production client and room endpoints from the same origin.
- Pure, serializable engine: explicit decision phases, injected randomness and clock, integer money, controlled card effects and graph-based maps.
- Each player receives a filtered view and private legal actions; spectators see public information only.
- Application-level player recovery credentials survive server restarts. Colyseus session tokens alone do not.
- SQLite WAL stores room identity, seats, state snapshots, events and command results. A command transaction commits before publishing state or acknowledgment.
- Synchronous room handlers and SQLite transactions serialize mutations; command IDs prevent duplicate retries. Socket identity and connection generations reject replaced clients; each synchronous bot tick checks the current seat and decision before acting.
- Node.js + systemd deployment, Caddy HTTPS/WSS proxy, persistent data outside the release directory, backups and explicit schema compatibility checks.
- Single instance in v1. No Redis, hosted Sites registration or account service. Optional server-only LLM decisions use filtered views and legal candidate indices; gameplay continues through rule-based fallback when the provider is unavailable.

Public player views include server-calculated cash, savings, net assets, property recovery value, building totals and debt. Property views include actual rent, viewer-specific payable rent and construction cost. Private hands and predetermined dice remain viewer-only. Decision and takeover durations come from the server configuration.

LLM requests are outside the pure engine. An asynchronous decision is bound to game identity, revision, seat and control epoch; the room rechecks them before applying and persisting the action. Concurrency, request time and response size are bounded; shutdown cancels pending requests. Public AI status contains configuration readiness and fixed status text only.

Board geometry (2026-10-12): `BOARD` in `packages/content` defines the 36-square ring, corner indices, salary, bail and jail escape face. Map shortcuts (metro forks, trade gates, ferry ports) are data on the map, not hard-coded indices. The `jail` phase sits between turns and rolling; `pot` collects bank-bound payments. Game snapshots are version 2. On startup the store retires version-1 games (the 28-square board) to the lobby and persists that change rather than refusing to start.

Read paths: the store keeps committed records in memory. `get()` returns a transactional copy; `peek()`, `peekAll()` and `size` are read-only and are used by views, listings, health checks and the idle tick test. A tick deep-copies only when there is work (bot, takeover, timeout, trade expiry or finish). `viewFor` copies only small mutable state, sends the latest 48 events plus each player's last notable action, and spectators share one game view per broadcast.

Client board: one square HTML grid sized with container query units, so the same board scales from 360px phones to desktops. Pawns sit on a separate layer, move with transforms only, and each has its own step queue. Countdown text subscribes to one shared one-second clock instead of re-rendering the page.
