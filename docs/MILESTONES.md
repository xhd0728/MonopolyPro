# Delivery milestones

Each completed milestone is committed locally with Conventional Commits. A commit is not a deployment. Public deployment and two-network acceptance are performed by the owner after release delivery.

| Stage | Acceptance                                                             | Status                                      |
| ----- | ---------------------------------------------------------------------- | ------------------------------------------- |
| P0    | Research, architecture, repository conventions                         | Complete                                    |
| P1    | Workspace, typed contracts, create/join/ready lobby                    | Complete                                    |
| P2    | Complete authoritative match, economy, bots, bankruptcy, settlement    | Complete                                    |
| P3    | Idempotence, disconnect takeover, refresh and process restart recovery | Complete                                    |
| P4    | Four maps, six characters, 30 cards, team mode, simulations            | Complete                                    |
| P5    | Responsive game UI, tutorial, atlas, feedback, connection states       | Complete                                    |
| P6    | Deployment package, systemd/Caddy, backup/rollback, 30-minute load run | Complete; owner's public deployment pending |

Verification: engine rules and invariants; 2/4/6-seat network flows; privacy; duplicate/unauthorized commands; recovery at purchase, auction, path and trade decisions; browser walkthroughs at desktop/mobile sizes; 20 rooms/120 seats for 30 minutes with environment/results recorded.

P1: Node 24.21.0 / pnpm 11.25.0; typecheck, production build and real 2/4/6-seat socket lobby tests passed. Browser teaching-room creation, bot addition, readiness and match start observed. Engine/content foundations included so this commit is runnable.

P2: purchase/build/rent, mortgage/redemption, auction, atomic trades, debt/bankruptcy and timed/team settlement verified. All 30 card definitions executed with valid targets. 48 seeded complete bot matches (46,243 accepted engine actions) passed invariants; build/typecheck passed.

P3: transactional snapshot/event/command storage, one-use connection grants, persistent seat credentials and duplicate-runtime rejection verified. Service tests restore trade/auction/path snapshots; socket test SIGKILLs and restarts the server, resumes the exact seat and replays the old command without a second mutation. 15-second handover boundary verified with controlled time.

P4: catalog identity, map connectivity and coordinate uniqueness checks passed. Four distinct route mechanics, six character passives/abilities, all 30 effects and balanced 2v2/3v3 settlement are covered by the complete-match simulation suite.

P5: Chromium desktop 1440x1000 and mobile 390x844 flows passed: two independent browser contexts, readiness, card target dialog, purchase/build, trade, refresh, offline takeover/recovery, atlas, mobile drawer and settlement. Teaching can be skipped/restarted. No page errors or mobile horizontal overflow. This initial release used Three.js scenes; the subsequent country-board revision replaces them with responsive HTML/SVG boards. Screenshots are in ignored artifacts/ui/.

P6: 16 automated tests and all three browser flows passed; mobile neon forks, auction bidding and plain-text chat rendering are also verified. The 20-room/120-seat run lasted 1,801.61 seconds, with 138,496 accepted actions, no disconnections/crashes and six audited stale-version refusals. A final-server 120-second supplement passed with 9,439 actions and no refusals/disconnections. Independent production-only release installation, startup and online backup restoration passed. See VALIDATION.md for environment and limits. Linux systemd/Caddy startup, domain TLS and two-network public acceptance remain for the owner.

Country-board revision: four real-country catalogs, readable 2D routes, six-seat financial cards and public detail dialogs, custom bank amounts, contextual validation and mobile decision drawers. Auction exits and stale connection callbacks were repaired. All 18 automated tests and four Chromium UI flows pass at 1440x1000, 390x844 and 360x844. The updated server completed a 20-room/120-seat/120-second load supplement without refusals or disconnections. See REVIEW.md and VALIDATION.md.

2026-10-12: One-screen game UI, prominent server dice, opponent-action announcements and phase explanations. Optional private LLM bots with provider configuration, legal choices, timeout fallback and stale-result protection. 22 tests, five UI flows and a fresh 20-room/120-seat short load run passed; real configured model completed a persisted decision. See AI.md and VALIDATION.md.
