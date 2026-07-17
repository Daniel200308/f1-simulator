# QA Inventory — Race Circuit Layout & Contextual Radio V2

## Sign-off claims

| Claim | Functional check | Visual state | Evidence |
| --- | --- | --- | --- |
| The complete Silverstone circuit is visible | Enter a live race and compare canvas, track viewport and information-rail bounds | 1280×720, 1440×900, 1600×900, native desktop window | Bounds assertions and viewport screenshots |
| Radio and surface information never cover the circuit | Populate a driver-radio message and inspect reserved layout regions | Dense live-radio state with local weather visible | Non-overlap assertions and focused screenshot |
| Driver-radio copy is not truncated | Wait for the longest generated live message and inspect overflow/line clamp | Live race with a multi-line message | DOM overflow assertions and screenshot |
| Radio reacts to rain and vehicle state | Exercise deterministic radio generation for dry, rain, crossover, wet grip and aquaplaning states | Automated message-library coverage | Unit tests and live wet-state inspection where reachable |
| More than 100 meaningful radio reports are available | Generate broad deterministic samples across situations | Automated test | Uniqueness and context assertions |
| The entire LIVE CALL lower bar is removed | Inspect the Race workspace after start | Live race | DOM absence assertion and screenshot |
| Removing the lower bar gives space back to the circuit | Compare pre/post map height at the same viewport | 1280×720 and 1600×900 | Bounds comparison |
| Essential race controls remain usable | Select both drivers; change pace, energy, tyre management and next tyre | Live race | Normal Playwright clicks and visible selected states |

## User-facing controls and state changes

- Constructor selection → selected two-car weekend.
- FP1–Q3 run and report acknowledgement → race grid.
- Start Race → lights sequence → live circuit.
- Simulation rate → live message and telemetry density.
- Driver selection → selected map marker, controls and corresponding telemetry.
- Pace / Energy / Tyre Management / Next Tyre → active command state.
- Weather and tyre state → contextual driver-radio situation and copy.

## Exploratory scenarios

1. Run a non-Ferrari constructor at 1280×720 with a long radio message and confirm no track, text or telemetry clipping.
2. Inspect a tall 1440×900 viewport and a wide 1600×900 viewport to catch aspect-ratio-specific overlap.
3. Run at 16× long enough for changing gaps, tyre temperatures and radio updates; verify that message growth does not shift or hide the circuit.
4. Validate a native-window browser pass so host display scaling does not reintroduce clipping.

## Execution record

- Baseline at 1280×720 reproduced both defects: `LOCAL SURFACE` overlaid a `126×178` region of the circuit, and radio copy exposed only `41px` of `68px` content because of line clamping.
- The removed LIVE CALL/strategy timeline occupied `230px` vertically at 1280×720. The new command-only area uses `170px`, increasing the circuit from `310px` to `370px` high.
- Final 1280×720: circuit host/canvas `694×370`, reserved information rail `230×370`, radio text `71/71px`, centerline error `0.000000px`, no page scrolling.
- Final 1440×900: circuit host/canvas `854×540`, radio text `78/78px`, no horizontal or vertical page scrolling.
- Final 1600×900: circuit host/canvas `998×594`, command controls collapse to one `126px` row, radio text `78/78px`, no page scrolling.
- Native macOS pass: browser viewport `1470×783` on a `1470×956` screen at DPR 2; circuit host/canvas `884×433`, radio text `94/94px`, no page scrolling.
- Normal input exercised both driver selectors, Pace, Energy, Tyre Management, Next Tyre and Stay Out, including return to the original state.
- The live exploratory run reached an actual rain-onset state. HAM reported drops through Maggotts and requested the wettest-sector update; the full `94px` message remained visible.
- Automated radio coverage now includes rain onset, sustained rain, wet grip on dry tyres, aquaplaning, drying line and intermediate crossover. Deterministic generation exceeds 100 distinct weather reports.
