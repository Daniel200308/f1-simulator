# Qualifying Operations QA Inventory

## User-visible claims

- The qualifying leaderboard uses race-like compact TYRE / TIME / GAP spacing, keeps 22 rows visible, and clips no timing text.
- Every visible car follows the shared Silverstone race centerline or the shared pit lane.
- Car markers move continuously between simulation updates and do not jump backward at OUT LAP / FLYING LAP / COOL DOWN / IN LAP transitions.
- Both player cars can be released independently with `Release Now` or `Wait for Gap`.
- Release forecasting shows track-car count, traffic, flying-lap ETA, and whether the lap can finish before the chequered flag.
- Out-lap pace exposes Slow / Balanced / Fast Preparation.
- Flying-lap attack exposes Safe / Normal / Attack / Maximum.
- A live flying lap can be aborted into a cool-down lap.
- Tyre temperature, battery, traffic and current lap status remain visible for both player cars.
- Qualifying remains dry and reuses the race map, pit lane, corner labels and 1x / 2x / 4x / 8x / 16x transport.

## Functional checks

- Enter Q1 through normal FP buttons and start the session through the visible topbar button.
- Change out-lap pace and flying-lap attack, then verify their pressed states.
- Exercise `Wait for Gap` for one player car and `Release Now` for the second car.
- Observe OUT LAP and FLYING LAP on the shared map; abort the flying lap and verify COOL DOWN.
- Exercise every simulation-speed button.
- Confirm battery recovery after aborting to COOL DOWN.
- Confirm a garage car cannot be released before the session starts and Abort is disabled outside FLYING LAP.

## Motion checks

- Sample the selected marker every animation frame at 16x.
- Require movement on most sampled frames instead of one jump per simulation tick.
- Require no large per-frame jump at lap or pit-route transitions.
- Require zero centerline error while on the TRACK route.
- Observe OUT LAP -> FLYING LAP -> COOL DOWN without backward travel.

## Visual checks

- Review 1600x900 ready and live screenshots.
- Review 1280x720 ready screenshot.
- Confirm map, tower, both car panels and the complete command surface fit without clipping.
- Confirm all leaderboard cells have `scrollWidth <= clientWidth` and the final row remains inside the tower.
- Confirm the command surface uses the existing race visual controls without CSS transform or scale compression.

## Exploratory checks

- Release both player cars close together and watch marker stability as AI traffic joins the circuit.
- Switch from 1x to 16x during an out lap and inspect the pit-exit-to-centerline transition for a jump.
