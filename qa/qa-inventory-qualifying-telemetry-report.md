# Qualifying telemetry and report QA inventory

Target viewports: 1600×900 and 1280×720. The qualifying command surface must remain fully usable without page scrolling.

## User-visible claims and checks

| Claim / state | Functional check | Visual check | Evidence |
| --- | --- | --- | --- |
| Leader Board is narrower and keeps P, DRIVER, TYRE, TIME, GAP readable | Open Q1 and inspect every timing row | Tower consumes less horizontal space; driver-to-tyre gap is compact; S/M/H/I/W is visible | Q1 ready/live screenshots and region bounds |
| Vehicle status no longer contains the battery gauge | Inspect both player status cards | No BATTERY label/bar; thermal car and tyre summary use the reclaimed height | Q1 live screenshot + text query |
| Silverstone race telemetry controls qualifying speed | Release a car, run a flying lap, sample speed through the lap | Speed visibly rises on straights and falls near 100–130 km/h in slow corners | Live telemetry samples + screenshot |
| Tyres follow blanket → out lap → flying → cool-down phases | Release a car and advance through all phases | Four tyre values begin near 82°C, warm independently, peak under push, then cool | Phase samples + live screenshot |
| AI release strategies are staggered | Start Q1 and observe field exits | Cars leave in different windows rather than as a single group | Simulation unit test + live map |
| Pit lane is a short straight lane with merge ends | Observe out-lap and in-lap markers | Central pit route is straight and does not form the previous pointed V | Live map screenshot |
| Track evolution copy is removed | Inspect top qualifying control message | No “Track evolution” text is visible | Text query + screenshot |
| Q1/Q2 reports show classification and eliminated drivers | Complete Q1/Q2 | Cut position and eliminated drivers are visually separated | Q1 result screenshot |
| Result action starts the next qualifying session | Click START Q2 / START Q3 | Report closes and next session starts with a live timer | Real click and state assertion |

## Controls and transitions

- `START Q1`: READY → RUNNING.
- `Release Now`: GARAGE → OUT LAP.
- simulation rate `16×`: active rate changes and timer advances quickly.
- out-lap pace and flying attack controls preserve their selected state.
- `START Q2`: Q1 result dialog → Q2 RUNNING.
- driver selector: selected status card and map marker remain synchronized.

## Exploratory checks

1. Let AI traffic become dense at 16× and verify the narrower timing rows do not clip or overlap at 22 cars.
2. Inspect 1280×720 during a live push lap and then in the Q1 report; confirm map, status cards, command dock, result classification, and CTA remain inside the viewport.
3. Observe a player car crossing from pit route to track route; verify no marker teleport or visible route discontinuity.
