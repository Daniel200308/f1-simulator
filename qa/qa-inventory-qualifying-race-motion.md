# Qualifying / Race Motion QA Inventory

## User-visible claims

- Qualifying uses the same snapshot extrapolation and frame smoothing formula as the race map.
- A dense qualifying field remains responsive at 1× and accelerated simulation rates.
- Driver markers remain on the shared Silverstone race/pit geometry through out-lap, flying-lap, cooldown and in-lap transitions.
- The race leaderboard always shows the official three-letter driver abbreviation, never a full name.

## Functional checks

- Progress FP1–FP3 and start Q1 through normal UI controls.
- Let AI traffic populate the circuit and release the two player cars.
- Exercise 1×, 8× and 16×; verify pause/resume still freezes and restarts the marker loop.
- Inspect marker diagnostics for the shared interpolation model, bounded snapshot age and finite positions.
- Start a race and confirm every leaderboard row renders a three-letter code while retaining the full name in its accessible label/title.

## Visual checks

- 1440×900 Q1 dense state: markers animate without visible stop-and-jump cadence or route detachment.
- 1280×720 Q1 dense state: map, timing tower and controls remain visible without new clipping.
- Race timing tower: three-letter codes align consistently in all visible rows.

## Exploratory checks

- Observe pit-exit and pit-entry route hand-offs at accelerated speed.
- Allow several AI cars to enter the same section and confirm the map does not slow down as field density rises.

## Expected evidence

- Browser screenshots for dense Q1 and race timing tower.
- Animation diagnostics captured from the map host.
- Browser console error check.
- Unit tests, typecheck, lint and production build results.

## Results

- 1440×900 Q1: 22 visible cars at 16×, shared motion model active, 17.4 ms average frame interval, 17.6 ms p95, finite marker coordinates.
- 1280×720 Q1: 20 visible cars captured with every required region inside the viewport and no document overflow.
- Pause/resume: selected-car distance remained fixed while paused and advanced after resume.
- Race leaderboard: 22/22 visible driver labels were three characters; full names remained available only through title/accessibility text.
- Runtime: no page errors during dense Q1 and race checks.
- Automated: 33 test files passed, 340 tests passed, 1 test skipped; typecheck, lint and production build passed.
