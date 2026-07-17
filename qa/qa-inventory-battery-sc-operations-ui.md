# QA Inventory · Battery, Safety Car Pit Order, Operations UI

## User-visible claims

- Right-side driver cards show a live circular battery percentage infographic.
- The racing-car thermal silhouette and four tyre temperatures remain visually aligned at 1600×900 and 1280×720.
- A Safety Car pit entry and pit exit immediately update live classification order.
- Selecting a Next Tyre no longer draws a stray white dot above the tyre button.
- Race Operations uses larger, scan-first infographics for vehicle, pit and tyre-set state.
- Strategy 3.0 text is readable without tiny labels or clipped projections.
- Replay is removed from the race toolbar and cannot be opened.

## Functional checks

1. Start Ferrari weekend and enter Race through FP1–Q3.
2. Verify battery percentage changes while the race runs and the circular ring follows it.
3. Select and cancel a Next Tyre; verify pressed state and absence of a detached white marker.
4. Open Race Operations, change selected driver, inspect tyre-set and pit projections, then close it.
5. Open Strategy 3.0, inspect scenario labels and apply/cancel a reversible recommendation where available.
6. Confirm Replay control and replay dialog are absent.
7. Run a deterministic Safety Car/pit-order regression in the simulation test suite.

## Visual checks

- Race view at 1600×900: complete right-side car cards, battery ring, aligned thermal map, no toolbar clipping.
- Race view at 1280×720: minimum desktop fit with no horizontal overflow or hidden essential controls.
- Race Operations dense state: infographic hierarchy, readable labels, no clipped tyre sets or pit data.
- Strategy 3.0 dense state: larger text, readable scenario comparison and no overlap.

## Exploratory checks

- Rapid Next Tyre selection followed by Stay Out does not leave stale selection decoration.
- Switching drivers while Race Operations is open keeps battery/thermal/pit data paired with the selected car.
- Safety Car pit stop involving two nearby cars does not freeze classification or duplicate positions.

## Completed results · 2026-07-17

- PASS · Full Ferrari path completed through FP1, FP2, FP3, Q1, Q2, Q3 and Race using the in-app browser.
- PASS · Live battery values changed from `45% / 44%` to `54% / 47%` while the race ran; both rings updated from the same live state.
- PASS · Thermal layout measured symmetrically at 1280×720: FL/FR `y=215`, RL/RR `y=316`, with the car centred at `x=1112`.
- PASS · Next Tyre pressed state has no generated marker (`::after content: none`); keyboard focus uses the cyan accent instead of a white ring.
- PASS · Replay is absent from the toolbar/DOM while Report remains available.
- PASS · Safety Car pit classification regression completed with unique positions throughout pit entry, stationary stop and rejoin.
- PASS · Timing gaps retain their one-second cadence but refresh immediately when `racePosition` or `pitStatus` changes.
- PASS · 1280×720 workspace bounds remain inside the viewport: timing `x=8..240`, map `x=248..944`, status `x=952..1272`.
- PASS · No browser console errors after the final race, Race Operations and Strategy 3.0 checks.

## Evidence

- `01-baseline-race-1600x900.png` → `04-final-race-1600x900.png`
- `02-baseline-race-operations-1600x900.png` → `05-final-race-operations-1600x900.png`
- `03-baseline-strategy-1600x900.png` → `06-final-strategy-1600x900.png`
- `04-final-race-1280x720.png`, `05-final-race-operations-1280x720.png`, `06-final-strategy-1280x720.png`
