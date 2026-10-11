# MonopolyPro

- All game decisions are authoritative on the server. Never trust client dice, balances, targets, or ownership.
- Keep the engine free of browser, transport, persistence, and rendering dependencies.
- Preserve player privacy in views, events, logs, and spectator messages.
- Accepted commands must be persisted atomically with snapshots, events, and deduplication results before acknowledgment.
- Use Conventional Commits (`type(scope): description`). Commit each accepted milestone locally; do not push without explicit authorization.
- Run type checking, relevant tests, and a production build before milestone commits. Exercise browser flows for UI changes.
- Never commit secrets, databases, release archives, screenshots, test artifacts, or node_modules.
- Build original code and content; upstream projects are references, not copied source.

