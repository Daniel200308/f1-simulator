# QA Inventory — Strategy, Setup, Battery and Retirements

## User-visible claims

- Player car battery is a large battery-shaped live infographic, blue while charging and red while deploying.
- Tyres beyond their optimal temperature window are visibly red.
- Every Leader Board row shows tyre life for every team without horizontal overflow.
- Race Operations is no longer available; Strategy is the single strategy workspace.
- Strategy shows three complete tyre plans from the current lap to lap 52, with compounds and pit laps.
- Each race targets two to six retirements and never plans more than six.
- Practice setup exposes six adjustment areas and telemetry-supported ranges after FP1, FP2 and FP3.
- Driver and engineer debrief copy is darker-weight, concise and fully visible at supported desktop heights.

## Functional checks

- Enter weekend, run FP1 and verify all six setup controls are operable.
- Verify no recommendation bands before FP1; verify broad FP1 ranges after the report; verify narrower ranges after FP2 and FP3.
- Start the race and observe battery percentage changing during normal running.
- Observe at least one charging and one deploying battery state, with blue/red state styling.
- Open Strategy, switch Plan A/B/C, and verify each timeline starts on the current tyre and ends at lap 52.
- Verify Race Operations launcher and dialog are absent.
- Verify all 22 timing rows contain tyre life.
- Run deterministic retirement unit checks for the 2–6 bounds and a due retirement transition.

## Visual checks

- 1600×900 race HUD: circuit, Leader Board, both car panels, battery and control dock fit without page overflow.
- 1280×720 race HUD: no horizontal overflow or clipped battery/thermal readings.
- 1600×900 and 1280×720 Strategy dialog: all three plan rows visible and scenario area remains usable.
- 1600×900 and 1280×720 Weekend Hub: six controls, range annotations and four feedback blocks remain legible.
- Session report at 1280×720: both cars and both report types fit without internal scrolling.

## Exploratory cases

- Open Strategy on lap 1 and after tyre wear has fallen below 50%; compare pit windows.
- Inspect a wet-weather plan and confirm the timeline recommends Intermediate or Wet tyres.
- Select a retired timing row and verify command controls remain unavailable without breaking layout.
