# Qualifying physical-return QA inventory

## Claims and checks

| Claim / state | Functional check | Visual check / evidence |
| --- | --- | --- |
| Right telemetry omits the ERS readout | Inspect the selected-driver telemetry labels | 1280×720 live Q1 screenshot shows only Speed and Traffic in the live-dial row |
| FL/FR/RL/RR remain visible with their full wheel names | Inspect all four tyre cells and their text | 1280×720 and 1440×900 screenshots show all four labelled temperatures without clipping |
| A normal single-attempt run uses OUT → FLYING → IN → PIT ENTRY → GARAGE | Deterministic simulation test records every phase transition | Live browser inspection checks the status beacon and moving-map counters |
| Abort does not teleport | Release a player car, reach a flying lap, click Abort, and verify INLAP before GARAGE | In-transition screenshot/DOM check keeps the car on the Canvas |
| Return does not teleport | Release a player car, click Return, and verify INLAP before PIT ENTRY and GARAGE | Canvas active-car count remains non-zero during the return |
| Returning cars use a straight pit lane to the pit box | Unit test verifies separate track and pit targets; inspect the live map | Screenshot shows entry merge, straight lane, box marker, and exit merge |
| Circuit stroke is proportionate to markers | Inspect full live map at two desktop sizes | Track remains readable while markers and labels are visually dominant |
| No essential panel clips at supported desktop sizes | Check panel bounding boxes and horizontal/vertical overflow | 1280×720 and 1440×900 screenshots |

## Exploratory checks

- Trigger Return immediately after release while the car is still leaving the garage; it must continue forward rather than reverse or disappear.
- Run at 16× through the IN LAP → PIT ENTRY boundary; the marker must stay continuous and the UI must not overflow.
