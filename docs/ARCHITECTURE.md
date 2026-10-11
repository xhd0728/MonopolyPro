# Architecture decisions

- TypeScript pnpm workspace: `apps/client`, `apps/server`, `packages/shared`, `packages/engine`, `packages/content`.
- React/Vite UI and Three.js fixed isometric board. Rules never wait for animation completion.
- Node.js 24 and Colyseus authoritative rooms. HTTP serves the production client and room endpoints from the same origin.
- Pure, serializable engine: explicit decision phases, injected randomness and clock, integer money, controlled card effects and graph-based maps.
- Each player receives a filtered view and private legal actions; spectators see public information only.
- Application-level player recovery credentials survive server restarts. Colyseus session tokens alone do not.
- SQLite WAL stores room identity, seats, state snapshots, events and command results. A command transaction commits before publishing state or acknowledgment.
- A serialized per-room command queue and command IDs protect simultaneous transactions and retries. A control epoch prevents stale bot actions after reconnect.
- Node.js + systemd deployment, Caddy HTTPS/WSS proxy, persistent data outside the release directory, backups and explicit schema compatibility checks.
- Single instance in v1. No Redis, hosted Sites registration, account service or third-party AI dependency.

