# Qualifying premium UI and elimination QA inventory

## Visible claims

- The complete qualifying workstation fits at 1280×720, 1440×900 and 1920×1080 without clipped labels or hidden primary controls.
- The circuit remains the visual focus, with readable driver labels, vivid sector styling, session-best sector information and stable phase feedback.
- The right rail retains driver selection, release, out-lap, attack, fuel, energy, lap-action and physical tyre-set controls in a denser hierarchy.
- Active, disabled and selected controls are visually distinct; tyre temperature and energy status remain readable.
- Eliminated player drivers stay visibly marked but cannot receive release controls in Q2 or Q3.

## Functional checks

- Start Q1; pause/resume; change simulation rate and return to 1×.
- Select each player driver and switch back.
- Select compound and physical tyre set; exercise Hold, Wait Gap and Release Now availability.
- Change Out Lap Pace, Flying Attack, Fuel Plan and Energy Mode through a full selection cycle.
- Exercise available Lap Action controls during an on-track run.
- Skip Q1, start Q2, skip Q2 and verify the session entry lists contain only prior-session qualifiers.
- Unit scenarios: Q1 with 15 valid times and seven no/invalid times; Q2 with nine valid times; tied times; invalid laps; elimination persistence; session-specific timing reset.

## Visual states and evidence

- Q1 ready at 1280×720: full shell fit and no tyre/control clipping.
- Q1 running at 1440×900: dense traffic, animated map, selected modes and readable labels.
- Q2 ready/running at 1920×1080: reduced entry list, reset sector timing and eliminated driver status where applicable.
- Captures: `qualifying-ai-tyres-1280x720.png`, `qualifying-premium-1440x900.png`, `qualifying-premium-q2-1920x1080.png`.

## Exploratory checks

- Select a driver who was eliminated while the teammate advanced; the active teammate must remain the controlled car.
- Finish a segment with both player cars eliminated; the right rail must show a non-interactive team elimination state rather than disappearing or exposing stale controls.
- Run with many simultaneous track labels for at least 30 seconds and check overlap stability, clipping and frame-safe map feedback.
