# QA Inventory — Race Layout and Weekend Feedback

## Intended sign-off claims

| Claim | Functional check | Visual state | Evidence |
| --- | --- | --- | --- |
| Silverstone circuit is fully visible | Enter race and inspect track image bounds | 1600×900 and 1280×720 live race | Full viewport screenshots + bounding boxes |
| Team/Driver Radio is on the circuit’s upper-right without covering the racing line | Run race until radio populates | Live race with a multi-line radio message | Full viewport and focused track screenshot |
| Cooling and Brake Bias controls are removed | Inspect Driver Control and accessibility tree | Live race, player driver selected | DOM assertions + screenshot |
| Vehicle status uses the freed right column | Inspect both player telemetry panels | Live race at desktop and smaller desktop | Bounding boxes + screenshot |
| Leader Board gaps are larger and white | Inspect non-leader rows after timing updates | Live race after start | Computed-style assertion + screenshot |
| Auto event-hold control is removed | Inspect playback controls | Live race | DOM assertion |
| Race Control metadata is simplified | Trigger/observe race-control panel | Green plus incident state | DOM assertion + screenshot |
| SC, VSC, yellow and red states include a visible reason | Exercise the feed builder and browser incident states | Each flag category | Unit tests + browser state checks where reachable |
| Current Practice/Qualifying session appears in the progress rail | Enter FP1, advance to FP2 and Q1 | Weekend hub | DOM assertion + screenshot |
| Session Plan is removed | Enter FP1 and inspect right-side region | FP1 ready | DOM assertion + screenshot |
| Debriefs are short, conversational and state-aware | Run FP1 and FP2, compare reports | Garage dock and report dialog | Text assertions + screenshots |
| Driver/engineer report library exceeds 100 meaningful variants | Generate broad deterministic samples | Automated test | Uniqueness and context tests |

## Controls and state changes

- Team selection → weekend hub for the selected constructor.
- `RUN FP1` / report acknowledgement → FP2 with updated classification, setup knowledge and debrief.
- Setup sliders → updated car setup values used by the next report.
- Race start sequence → live race HUD.
- Playback rate buttons → active simulation rate.
- Driver selection → corresponding expanded vehicle telemetry.

## Exploratory scenarios

1. Check a 1280×720 viewport after radio and Race Control messages both become dense; neither may hide the circuit or telemetry.
2. Select a non-Ferrari team and advance FP1 once; progress and report copy must use the correct two drivers with no hard-coded Ferrari dependency.
3. Let the live race run for 30–60 seconds at a higher simulation rate and inspect layout stability while gaps, radio and flag messages update.

## Execution record

- 1280×720 race: track host and canvas both measured `694×310`; calculated track viewport ended before the radio region and selected-car centerline error was `0.000000 px`.
- 1600×900 race: track host and canvas both measured `998×486`; radio began at local x `716.55` while the reserved track viewport width was `718.56`, with its internal padding keeping track graphics clear.
- Leader Board gap computed style: `rgb(244, 248, 249)`, `11px`, weight `950`.
- UI assertions: no Auto button, no Cooling mode group, no Brake Bias control, one Team/Driver Radio instance, no Race Control category/scope/lap metadata.
- Non-Ferrari scenario: McLaren progressed FP1–Q3 and entered the live race with NOR/PIA; no runtime error remained after the canvas-cleanup fix.
- FP1 report: both driver/engineer cards and acknowledgement action were visible together at 1280×720 without scrolling.
- Automated flag coverage verifies yellow, VSC, Safety Car and red-flag headlines/details, including active-incident causes.
