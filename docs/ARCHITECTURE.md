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
- Single instance in v1. No Redis, hosted Sites registration, account service or third-party AI dependency.

Public player views include server-calculated cash, savings, net assets, property recovery value, building totals and debt. Property views include actual rent, viewer-specific payable rent and construction cost. Private hands and predetermined dice remain viewer-only. Decision and takeover durations come from the server configuration.
