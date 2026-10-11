# Delivery milestones

Each completed milestone is committed locally with Conventional Commits. A commit is not a deployment. Public deployment and two-network acceptance are performed by the owner after release delivery.

| Stage | Acceptance | Status |
| --- | --- | --- |
| P0 | Research, architecture, repository conventions | Complete |
| P1 | Workspace, typed contracts, create/join/ready lobby | Complete |
| P2 | Complete authoritative match, economy, bots, bankruptcy, settlement | Complete |
| P3 | Idempotence, disconnect takeover, refresh and process restart recovery | Complete |
| P4 | Four maps, six characters, 30 cards, team mode, simulations | Pending |
| P5 | Responsive game UI, tutorial, atlas, feedback, connection states | Pending |
| P6 | Deployment package, systemd/Caddy, backup/rollback, 30-minute load run | Pending |

Verification: engine rules and invariants; 2/4/6-seat network flows; privacy; duplicate/unauthorized commands; recovery at purchase, auction, path and trade decisions; browser walkthroughs at desktop/mobile sizes; 20 rooms/120 seats for 30 minutes with environment/results recorded.


P1: Node 24.21.0 / pnpm 11.25.0; typecheck, production build and real 2/4/6-seat socket lobby tests passed. Browser teaching-room creation, bot addition, readiness and match start observed. Engine/content foundations included so this commit is runnable.

P2: purchase/build/rent, mortgage/redemption, auction, atomic trades, debt/bankruptcy and timed/team settlement verified. All 30 card definitions executed with valid targets. 48 seeded complete bot matches (46,243 accepted engine actions) passed invariants; build/typecheck passed.

P3: transactional snapshot/event/command storage, one-use connection grants, persistent seat credentials and duplicate-runtime rejection verified. Service tests restore trade/auction/path snapshots; socket test SIGKILLs and restarts the server, resumes the exact seat and replays the old command without a second mutation. 15-second handover boundary verified with controlled time.
