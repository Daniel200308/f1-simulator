# Qualifying Broadcast Redesign — Design QA

## Sources and state

- Reference: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-7b3552d6-e75a-4a34-b4be-cb4329e0ab82.png`
- Final live implementation: `qa/qualifying-broadcast-live-final-1440x900.png`
- Compact implementation: `qa/qualifying-broadcast-1280x720-v3.png`
- Combined timing-tower comparison: `qa/qualifying-tower-comparison.png`
- Tested states: Q1 ready, Q1/Q2 running with a visible elimination line, Q2/Q3 segment transition, Q3 live flying lap with provisional mini sectors.

## QA inventory

- Timing tower: position, three-letter driver code, interval/lap state, current and best lap time, 24 live mini sectors, three sector values, compound and tyre condition.
- Elimination: one full-width red rule after the advancing position; rows remain active white during the segment and lock grey only after elimination.
- Circuit: no duplicated event/circuit title row; racing-line, pit-lane and live driver markers remain visible.
- Driver controls: release, out-lap pace, flying-lap attack, traffic response, fuel plan and lap actions use icon-led pill/rail controls.
- Player status: both driver strips sit below the controls and expose FL/FR/RL/RR temperatures on one horizontal thermal rail.
- Motion: qualifying and race markers share the same 0.2-second snapshot extrapolation and frame-distance interpolation model.

## Visual comparison findings

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | None | — |
| P1 | Initial 1440 px tower clipped DRIVER, INTERVAL and TYRE content. | Expanded the tower and guaranteed minimum widths for all six columns. |
| P1 | Compact player thermal cells clipped the temperature value. | Moved the four tyres to a full-width row and tightened the icon/value grid. |
| P1 | Qualifying became less responsive as the field filled because classification and pairwise separation were recomputed every frame. | Moved classification to state updates, removed the per-frame pairwise pass and reused the race interpolation function. |
| P2 | Compact control headers competed with their current-value labels. | Preserved the full control title and moved traffic context into the release forecast. |
| P2 | The first timing layout repeated OUTLAP/FLYING LAP in both interval lines. | Reduced no-time rows to one prominent live state label. |
| P3 | The integrated tower is denser than the standalone reference at 1280 px. | Accepted to preserve the live circuit and two-car control surface without horizontal scrolling. |

## Verification

- 1440×900: no document overflow; timing tower, circuit, controls and both player strips remain visible.
- 1280×720: no document overflow; all tower column labels remain readable and the four tyre temperatures remain visible.
- Live timing: 24 mini-sector cells per driver update provisionally with neutral, purple, green, yellow and invalid states.
- Motion: the shared race interpolation model remains finite and responsive with 22 qualifying cars at 16×; route transitions use the common pit/track endpoints.
- Browser console: no errors during Q1–Q3 progression.
- Automated checks: 33 test files passed, 340 tests passed, 1 file/test skipped; typecheck, lint and production build passed.

## Iteration history

1. Rebuilt the qualifying tower and command/status hierarchy from the supplied broadcast reference.
2. Expanded the desktop tower after the first 1440 px comparison exposed clipped headings.
3. Reflowed the thermal rail and compact control headers after the 1280×720 comparison.
4. Replaced the qualifying-only separation loop with the race map's interpolation model after dense-field profiling.
5. Re-ran live Q3 capture, automated tests and production build.

final result: passed
