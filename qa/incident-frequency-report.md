# Seeded incident frequency report

Run: `INCIDENT_FREQUENCY_QA=1 npx vitest run src/simulation/incident-frequency.sample.test.ts --reporter=verbose`

Date: 2026-07-15
Circuit: Silverstone, eight complete 52-lap races
Seeds: 20250701-20250708

## Result

| Metric | Result |
| --- | ---: |
| Incidents | 29 total / 3.63 per race |
| Spins | 24 total / 3.00 per race |
| Damaged cars | 4 total / 0.50 per race |
| Retirements | 1 total / 0.13 per race |
| Local-yellow periods | 14 total / 1.75 per race |
| VSC deployments | 7 total / 0.88 per race |
| Safety Car deployments | 8 total / exactly 1.00 per race |
| Unique incident drivers | 17 of 22 |
| Minimum field cooldown | 180 seconds |
| Minimum same-driver cooldown | 1,200 seconds |

The deterministic sample ranged from two to six incidents per race. Every race completed with exactly one Safety Car deployment. The seeded trigger varied by race, the 180-second field cooldown prevented incident clusters, and the rotating exposure spread 29 incidents across 17 drivers instead of repeatedly selecting one car.

Scheduled fallback points for the eight seeds were L8 49%, L13 33%, L29 81%, L10 40%, L23 41%, L16 47%, L21 25%, and L27 78%. A qualifying natural severe incident can consume the single allocation earlier; after one deployment the fallback is cancelled.
