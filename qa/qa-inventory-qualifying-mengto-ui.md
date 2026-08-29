# Qualifying MengTo UI QA inventory

## User-visible claims

- The qualifying screen keeps the leaderboard, live circuit and driver command rail visible together.
- The leaderboard is easier to scan, with a labelled advancement cut and readable best/gap/sector data.
- The circuit is the visual anchor, with sector labels and callout lines that never cover the racing or pit line.
- The right rail makes the current driver, next action, spacious four-corner tyre temperatures and selected tyre set immediately legible.
- Pit Release exposes one prominent Release Car action with no Hold or Wait control.
- Qualifying ERS is read-only and automatic: charge on every non-push phase, qualifying deployment on a flying lap.
- Every compound badge remains circular, while the physical-set life row uses less vertical space and clearer gaps.
- Existing qualifying controls and single-canvas traffic rendering remain functional.

## Functional coverage

- Driver tabs: switch LEC → HAM → LEC and verify the identity, position and control state update.
- Tyres: choose a compound and a physical set; verify the active-set card, set number and life.
- Garage controls: one Release Car action after starting Q1, fuel plan and setup selectors; no Hold or Wait action.
- On-track controls: out-lap pace, flying attack and available lap actions.
- Battery strategy: verify the automatic status is non-interactive, reports Charge on an out/in/cool/pit lap and Qualifying Deployment on a flying lap.
- Transport: 1×/16×, pause/resume and skip remain present and interactive.
- Rendering: exactly one static circuit SVG and one `SINGLE_CANVAS`; no DOM marker per car.

## Visual coverage

- READY/garage state at 1280×720, 1440×900 and 1920×1080.
- Running state after tyre selection and release at 1440×900.
- Verify topbar, leaderboard, map and command rail bounds fit the viewport.
- Verify no visible clipped labels in driver identity, tyre temperature, compound counts, active set, controls or circuit legend.
- Verify all four temperature cards use equal bounds and internal padding, and every compound tyre badge has a 1:1 aspect ratio.
- Sample all three sector label rectangles against the SVG racing and pit paths and verify positive clearance.
- Verify `TOP 16 ADVANCE` sits on the cut line and does not cover timing values.
- Verify sector colours, timing tones and team colours retain sufficient contrast.

## Exploratory checks

- Change drivers after selecting a tyre set and confirm each car retains its own selection.
- Pause during a flying lap and confirm map/phase pulses do not continue visually.
- Run at 16× with dense traffic for at least 30 seconds and check console errors, label stability and viewport fit.
