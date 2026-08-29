# Aubergine / black / lavender theme QA inventory

## User-visible claims to verify

| Claim | Functional check | Visual evidence |
| --- | --- | --- |
| Dark game surfaces use the supplied palette | Open the weekend hub and start qualifying | Aubergine panels, black canvas, lavender elevation/selection treatment |
| Race meanings remain readable | Start Q1 and release a selected car | Green race-control state, tyre compound and team colours remain distinct from neutral materials |
| Primary controls remain clear | Select a tyre and release the car | Lavender control emphasis is visible without obscuring the selected tyre or release state |
| Desktop layout remains intact | Inspect 1440×900 qualifying layout | Header, leaderboard, circuit and driver rail are simultaneously visible and unclipped |
| Mobile layout remains intact | Inspect 390×844 qualifying layout | No horizontal page overflow; status and controls remain readable |

## Exploratory checks

- Open the system-tools menu while Q1 is active and confirm the utility controls still contrast with the darker header.
- Inspect the dense live qualifying state after a car is released, including sector labels, timing rows and the tyre-control rail.

## Expected final validation

- `npm run typecheck`, `npm run lint`, `npm run build`, and the qualifying traffic view test pass.
- Browser console has no warnings or errors.
