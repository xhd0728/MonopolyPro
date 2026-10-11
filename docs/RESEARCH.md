# Research and product decisions

Research date: 2026-10-11. Sources were inspected during planning; commercial games were not playtested. Review counts and GitHub stars are snapshots, not a current popularity ranking.

| Reference | Lessons | Source |
| --- | --- | --- |
| Richman 11 | Characters, cards, branching paths, map mechanisms, configurable sessions | https://store.steampowered.com/app/2074800/ |
| MONOPOLY GO! | Short feedback loops, contextual guidance, social event presentation | https://www.scopely.com/en/news/sensor-tower-scopelys-monopoly-go-hit-6-billion-revenue-milestone-in-2025-in-record-time |
| Business Tour | Lobby, ready states, cosmetics, accessible group play | https://store.steampowered.com/app/397900/ |
| Rento | Private rooms, bots, auctions, configurable maps | https://store.steampowered.com/app/663390/ |
| 100% Orange Juice | Character/card combinations, spectators, expandable content | https://store.steampowered.com/app/282800/ |
| Pummel Party | Distinct board mechanisms, readable hazards, item interactions | https://store.steampowered.com/app/880940/ |
| MineMonopoly (GPL-3.0) | Content configuration, map editor, phases and modifiers; host-authoritative P2P is a different continuity model | https://github.com/FatPaper-1874/mine-monopoly |
| Poorup (MIT) | Server authority, reconnect recovery, browser and load test organization | https://github.com/jeremy341/Poorup |
| intrepidcoder/monopoly (MIT) | Economic rules and auctions | https://github.com/intrepidcoder/monopoly |
| Colyseus (MIT) | Rooms and multiplayer transport; persistence remains application-owned | https://docs.colyseus.io/room/reconnection |
| boardgame.io (MIT) | Turn/phase modeling; do not stack two authoritative networking frameworks | https://github.com/boardgameio/boardgame.io |

Local reference: KatanPro at `/Users/hx/WorkBuddy/2026-09-23-16-15-22/catan`. Inspected its HTTP/WebSocket server, rules, deployment documentation, and tests. Adopt its behavior patterns: password rooms, spectators, seat recovery, temporary bot takeover, privacy and complete-game testing. Improve on its documented in-memory-only storage by durable SQLite recovery. No source or artwork is copied.

First release: browser-first Chinese strategy/party game; 2–6 seats including rule bots; four mechanically distinct maps, six characters, 30 cards, free-for-all/quick/team modes. Separate stock markets, minigames, public matchmaking, accounts and user scripts from v1.

