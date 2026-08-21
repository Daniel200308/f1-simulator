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

---

# Race Rainfall UI Design QA

## Source and implementation

- Source reference: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-4ead0c8b-c3f5-49b5-b3d0-a5440e2c2271.png`
- Full implementation capture: `qa/race-rainfall-1440x900.png`
- Focused implementation capture: `qa/race-rainfall-panel-1440x900.png`
- Combined comparison: `qa/race-rainfall-design-comparison.png`

## Verification setup

- Desktop viewport: 1440 × 900 CSS pixels at 1× device scale.
- Compact desktop viewport: 1280 × 720 CSS pixels at 1× device scale.
- State: Ferrari race session, lap 1, dry local surface, race simulation running.
- Full-screen comparison verifies placement within the circuit intelligence rail.
- Focused comparison verifies the reference hierarchy: weather eyebrow, rainfall title and state, continuous cyan sector curve, S1/S2/S3 readings, and forecast footer.

## Findings and iteration history

- The graph panel remains completely inside the intelligence rail at both viewports.
- Measured panel overflow is zero at both sizes: `scrollWidth === clientWidth` and `scrollHeight === clientHeight`.
- S1, S2, and S3 use aligned, tabular percentages and remain readable at 1280 × 720.
- The reference's large standalone presentation was adapted to the existing compact race-map rail without covering the circuit.
- A static three-box surface display was replaced by one continuous canvas curve with sector guide lines and softly glowing nodes.
- The curve correctly sits at the zero baseline in the verified dry state; non-zero sector values deform the curve continuously.
- The canvas animation uses refs and `requestAnimationFrame`, so the graph does not force a React render on every visual frame.
- No P1 or P2 visual defects remain in the verified states.

## Final result

passed

---

# Qualifying single-view control rail, circuit indices, and tyre telemetry — Design QA

## Source and implementation

- Source control reference: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-c28acf6d-be30-482d-98c9-2d53566c0d47.png`
- Source circuit reference: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-9e3546b1-c79e-4a8d-9722-c5a8ec30ab9d.png`
- Source tyre telemetry reference: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-7f973455-c033-45b9-a7b0-6d43be0c7f3b.png`
- Full implementation: `qa/qualifying-control-circuit-final-paused-1440x900.png`
- Focused control implementation: `qa/qualifying-control-rail-final-1440x900.png`
- Focused circuit implementation: `qa/qualifying-circuit-final-1440x900.png`
- Mobile control implementation: `qa/qualifying-control-rail-final-mobile-390x844.png`

## Verification setup

- Desktop viewports: 1440 × 900 and 1280 × 720 CSS pixels at 1× scale.
- Mobile viewport: 390 × 844 CSS pixels; the page remains vertically scrollable without horizontal overflow.
- Interaction path: enter weekend → run FP1 → acknowledge report → run FP2 → acknowledge report → run FP3 → start Q1 → select the second driver → pause and resume qualifying.
- Source and focused implementation captures were opened in the same visual review pass for side-by-side comparison of the control rail, circuit indices, pit labels, and tyre telemetry.

## Findings and resolution

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | None | — |
| P1 | The right qualifying rail was vertically crowded by the Fuel Plan section and clipped its lower controls in the supplied reference. | Removed the Fuel Plan UI and its player-facing handler; the remaining release, pace, attack, lap-action, and tyre controls now fit without an internal scroll at 1440 × 900 and 1280 × 720. |
| P1 | Start/finish, pit entry, and pit exit labels competed with the circuit geometry. | Kept the physical start/finish line, removed its text index, and moved pit labels to explicit exterior positions with leader lines anchored to the pit lane. |
| P2 | Sector callouts were short and visually close to the racing line. | Rebuilt all three as longer transparent capsules with color-coded borders, exterior docking, and clear-space leader routing. |
| P2 | Tyre dials read as isolated rings without a shared telemetry surface. | Added a translucent glass treatment, state colors for cold/optimal/hot, stronger text hierarchy, and a small live-status marker while preserving the meter semantics. |

## Accessibility and regression checks

- `Fuel Plan` is absent from the accessibility snapshot and DOM; legacy fuel data remains only for save compatibility.
- At 1440 × 900, the control stack reports `scrollHeight === clientHeight` and no horizontal overflow.
- At 1280 × 720, the control stack reports `scrollHeight === clientHeight` and all five control groups plus tyre selection remain visible.
- At 390 × 844, the document and control rail remain horizontally contained.
- `[data-map-label="START_FINISH"]` is absent while `[data-start-finish="true"]` remains present; both pit labels and both pit leader lines are present; three sector labels and four tyre meters are present.
- Playwright console review: 0 errors and 0 warnings.
- Impeccable layout detector: no findings (`[]`).
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `git diff --check` passed.

## Required fidelity surfaces

- Typography: compact mono broadcast labels with larger, high-contrast temperature values and control values.
- Spacing/layout rhythm: single-screen desktop rail; responsive stacked rail on mobile; exterior circuit labels remain separated from the track.
- Colors/tokens: cyan/blue/purple sector accents, pit-label glass surfaces, and cold/optimal/hot tyre state colors.
- Image quality/assets: no image assets added; the circuit and telemetry remain code-native.
- Copy/content: Fuel Plan copy removed; pit and sector labels remain explicit; start/finish text index removed.

## Final result

passed

---

# Qualifying Top-Right System Tools — Design QA

## Source and implementation

- Source reference: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-cb06c502-a44e-4d03-bf98-8cf44e963cd9.png`
- Closed desktop capture: `qa/qualifying-system-tools-final-1440x900.png`
- Open desktop capture: `qa/qualifying-system-tools-open-1440x900.png`
- Open mobile capture: `qa/qualifying-system-tools-open-390x844.png`
- Reference intent: retain RESET in the qualifying playback area and expose SAVE / SEASON / SETTINGS from a compact control below it.

## Findings and resolution

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | None | — |
| P1 | SAVE / SEASON / SETTINGS lived in the qualifying bottom dock instead of beside the top-right reset control. | Added a two-level top-right stack: RESET on top, TOOLS below, with a three-action tray revealed from TOOLS. Removed the duplicate qualifying bottom dock. |
| P1 | The compact controls needed a clear visual hierarchy without competing with SIM RATE and SKIP Q1. | Kept RESET as the quiet circular action, gave TOOLS a cyan active state, and assigned distinct cyan / gold / violet accents to the three tray actions. |
| P2 | An open tray could be left stranded or clipped during keyboard and small-viewport use. | Added Escape and outside-pointer dismissal, focus-visible states, reduced-motion handling, and a bounded 236px responsive tray. |

## Verification

- Real browser flow: enter weekend → complete FP1 / FP2 / FP3 → start Q1 → open the top-right TOOLS tray.
- SAVE opened the existing `Save & restore` dialog and closed the tray.
- SEASON opened the existing `Championship operations` dialog and closed the tray.
- SETTINGS opened the existing `Pitwall settings` dialog and closed the tray.
- Escape and outside-pointer dismissal both collapsed the tray; focus returned to the TOOLS button after Escape.
- Desktop 1440 × 900: panel measured 236 × 80 and remained inside the viewport.
- Mobile 390 × 844: panel measured x=146, y=388, right=382, bottom=468; `document.scrollWidth` equaled `clientWidth` at 390px.
- Browser console: 0 errors and 0 warnings.
- Automated checks: `npm run typecheck`, `npm run lint`, `npm test` (485 passed, 1 skipped), `git diff --check`, and the mechanical UI detector all passed.

## Final result

passed

---

# Session Rail — Rounded, Number-Free Navigation QA

## Source and implementation

- Source reference: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-7eb9cda5-9686-4f8e-a2a7-0012ae9e9f7b.png`
- Current-state implementation: `qa/session-rail-final-1440x900.png`
- Completed-state implementation: `qa/session-rail-completed-state-1440x900.png`
- Mobile start/end captures: `qa/session-rail-final-390x844.png`, `qa/session-rail-final-mobile-end-390x844.png`

## Findings and resolution

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | None | — |
| P1 | Each session had a visible number/check badge in the upper-left corner. | Removed the visual badge element while preserving the ordered session position through `aria-posinset` and `aria-setsize`. |
| P1 | The reference's slanted silhouettes made the rail read as separate chevrons instead of clear session controls. | Replaced the clipped polygon shape with consistent 14px rounded rectangles and a contained status rule. |
| P1 | Session names were visually offset by the badge and the previous two-line layout. | Centered the icon-and-name group inside every tab and kept the session name large, high-contrast and single-line. |
| P2 | Narrow screens could make the seven-session sequence compete for width. | Kept each tab at a readable 112px minimum and verified horizontal scrolling through RACE at 390px. |

## Verification

- 1440 × 900 current state: FP1 is centered and highlighted; no numbers are visible.
- 1440 × 900 completed state: FP1 becomes a dark-green completed tab and FP2 becomes the current light tab.
- 390 × 844 start/end scroll positions: all seven sessions retain 112px tab widths and readable centered labels.
- Computed style check: all seven tabs report `border-radius: 14px`, `clip-path: none`, `overflow: hidden`; every tab has zero `.sessionIndex` elements.
- Centering check: the session-content center matches its tab center for all seven tabs; label `scrollWidth` equals rendered width for FP1–RACE.
- Browser console: 0 errors and 0 warnings during the tested session flow.
- Automated checks: `npm run typecheck` passed; `npm run lint` passed.
- The mechanical detector reported five pre-existing side-tab warnings elsewhere in `weekend-hub.module.css`; none targets the edited session rail rules.

## Final result

passed

---

# Session Progress Ribbon — Typography and Completion State QA

## Source and implementation

- Source reference: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-6b47fc74-6332-4f16-9f65-1ed54e2ed2e0.png`
- Current-state capture: `qa/session-rail-large-centered-1440x900.png`
- Completed-state capture: `qa/session-rail-large-centered-completed-1440x900.png`
- Mobile capture: `qa/session-rail-large-centered-mobile-390x844.png`

## Findings and resolution

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | None | — |
| P1 | Session names were visually undersized and offset by the secondary group label. | Removed the visible `PRACTICE / QUALIFYING / RACE` line and increased the session-name scale with centered icon-and-label alignment. |
| P1 | Completed sessions read as an outline state rather than a finished state. | Added a deeper green tab surface, brighter green check badge, icon, border and completion rule. |
| P2 | The compact layout could compress the larger labels. | Added a smaller but still prominent responsive label size while retaining horizontal scrolling at 390 px. |

## State and accessibility checks

- FP1 current and FP1 completed / FP2 current were verified through the real session flow.
- Each tab remains an ordered-list item with an accessible state label; the current session keeps `aria-current="step"`.
- Visible secondary detail text is removed while the group remains available in the accessibility label.
- 1440 × 900, 1280 × 800 and 390 × 844 captures show no clipping inside the session ribbon.
- Mechanical layout scan, typecheck, lint and whitespace checks passed after the change.

## Final result

passed

---

# Race Rainfall Labels and Retired Driver State — Design QA

## Source and implementation

- Source visual truth: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-f5d84949-19af-4a23-866d-316ae64ec95c.png`
- Source pixels: 754 × 1390.
- Intended implementation viewport: existing desktop race session at 1440 × 900 CSS pixels and 1× density.
- Implementation screenshot: unavailable because the selected in-app browser rejected the local URL under its URL safety policy.
- State requested: race-session sector rainfall panel plus a player-driver card in the `RETIRED` state.

## Full and focused comparison evidence

- The source image was opened at original resolution and used to identify the current top-aligned retirement treatment.
- A browser-rendered full-view and focused post-change capture could not be produced, so normalized side-by-side comparison was not possible.

## Findings and implementation history

- [P2] Rainfall sector labels visually touched the zero-rainfall nodes. The graph baseline now reserves four additional pixels above the label lane, and sector typography was reduced by roughly one pixel.
- [P2] The retirement state was left-aligned and visually muted by card-wide grayscale and opacity. The out-of-race grid now reserves the full remaining card height, centres its contents on both axes, removes the muting filter, and uses a saturated deep-red state treatment.
- TypeScript, ESLint, whitespace checks, weather tests, and retirement-plan tests passed.
- Post-fix visual evidence remains unavailable because browser capture is blocked.

## Required fidelity surfaces

- Typography: adjusted in code; visual confirmation blocked.
- Spacing/layout rhythm: adjusted in code; visual confirmation blocked.
- Colors/tokens: retired state changed to saturated deep red; visual confirmation blocked.
- Image quality/assets: no image assets were added or replaced.
- Copy/content: existing `RETIRED`, reason, lap, and team content is preserved.

## Final result

blocked

---

# Session Progress Ribbon — Design QA

## Source and implementation

- Source reference: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-2a30f869-a26f-4a6a-a591-2cc1520cebf0.png`
- Live implementation: `qa/session-rail-final-1440x900.png`
- Focused implementation: `qa/session-rail-final-element-1440x900.png`
- Side-by-side comparison: `qa/session-rail-design-comparison.png`
- State coverage: FP1 current; FP1 completed with FP2 current.

## Verification setup

- Desktop viewports: 1440 × 900 and 1280 × 800 CSS pixels at 1× scale.
- Mobile viewport: 390 × 844 CSS pixels; the seven-tab rail remains horizontally scrollable without clipping its own labels.
- Interaction path: enter weekend → run FP1 → acknowledge report → verify FP1 completed / FP2 current.

## Findings and resolution

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | None | — |
| P1 | The former circular rail did not match the supplied slanted-tab reference and used too little of the header width. | Rebuilt the rail as seven full-width skewed tabs with numbered badges, session icons, status copy and a clear active panel. |
| P1 | Current and completed sessions were visually close to upcoming sessions. | Added explicit `current`, `completed` and `upcoming` state styling; current uses a high-contrast light panel, completed uses green check/rail treatment. |
| P2 | Small viewports could compress the seven-session sequence into unreadable cells. | Added a bounded horizontal rail at mobile widths while retaining the ordered list and accessible labels. |
| P2 | Motion could become distracting in a persistent navigation surface. | Limited motion to one restrained current-tab glow and disabled it under `prefers-reduced-motion`. |

## Accessibility and regression checks

- The progress remains an ordered list with the existing `Race weekend progress` label.
- Each session exposes its name, group and state to the accessibility tree; the active session exposes `aria-current="step"`.
- No session labels overflow at 1440 × 900 or 1280 × 800 in the verified current and completed states.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and whitespace checks passed.
- The compact hub's pre-existing non-rail column layout was observed at 390 px and intentionally left outside this scoped ribbon change; the ribbon itself stays contained and readable via horizontal scrolling.

## Final result

passed

---

# Race Controls and Sector Rainfall — Design QA

## Source and implementation

- Source visual truth: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-78f9f708-6193-4491-9e70-25da6f750267.png` (1104 × 610 px).
- Desktop event implementation: `qa/race-controls-weather-final-1440x900.png` (1440 × 900 CSS px, 1×).
- Desktop clean implementation: `qa/race-controls-weather-clean-1440x900.png` (1440 × 900 CSS px, 1×).
- Mobile implementation: `qa/race-controls-weather-clean-mobile-390x844.png` (390 × 844 CSS px, 1×).
- Focused event comparison was captured together with the supplied source; the standalone reference is adapted into the existing Silverstone circuit rail by design.

## State and interactions tested

- Entered the weekend through the visible UI, ran FP1/FP2/FP3, progressed through Q1/Q2/Q3, and started the Race session.
- Advanced the Race session to a real Safety Car deployment at 16× simulation speed.
- Verified the newest control notice appears first: `SAFETY CAR IN TRACK SECTOR 2`; the previous `PIT LANE CLOSED … SECTOR 2` notice appears below it.
- Verified the Blue Flag checkbox toggles its filter state and returns to the enabled default.
- Verified the feed scrolls: desktop `scrollHeight 205 > clientHeight 153` in the event state; mobile `scrollHeight 198 > clientHeight 89`.
- Verified Weather contains exactly three sector nodes, sectors 1/2/3, and only rainfall values; no surface, wetness, forecast, or global weather value remains in that panel.

## Required fidelity surfaces

- Typography: existing mono/Geist pitwall hierarchy is retained; Race Controls has a clear title, event title, timestamp, message pill and sector caption. Long titles wrap instead of clipping.
- Spacing and layout rhythm: the rail now has three bounded rows (team radio, Race Controls, sector rainfall); the controls feed has an internal scroll area and the rail width is reserved in the track viewport calculation.
- Colors and tokens: green clear, yellow/orange caution, red urgent, blue flag and cyan neutral states use semantic vivid accents on the existing black race surface.
- Image quality/assets: no raster or handcrafted icon assets were introduced; existing `lucide-react` icons are used for flags, clock, radio and control states.
- Copy/content: all sector references are clamped to the requested three sectors only; newest events are sorted by elapsed simulation time descending.

## Findings and resolution

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | None | — |
| P1 | The first event-state pass made long `SAFETY CAR` headings compete with the timestamp in the narrow map rail. | Widened the race intelligence rail and changed the event meta row to a wrap-safe grid. |
| P2 | The previous weather panel mixed rainfall with surface/wetness/action/forecast data. | Reduced it to one rainfall graph and three sector rainfall values only. |
| P2 | The enlarged rail needed map-space coordination. | Updated the map viewport reserve, legend and pit overlay offsets to match the new rail width. |
| P3 | The supplied reference is a large standalone panel while the app uses an embedded circuit rail. | Kept the requested visual language and adapted the scale to preserve the live circuit and player telemetry. |

## Verification

- Desktop document overflow: `scrollWidth === clientWidth === 1440`.
- Mobile document overflow: `scrollWidth === clientWidth === 390`.
- Fresh browser navigation after the hot-reload iteration: 0 console errors and 0 warnings.
- Automated checks: Race Control feed/transitions tests 23/23 passed; typecheck, lint, `git diff --check`, and production build passed.
- The development console briefly recorded a stale HMR reference while the weather calculation was being removed; fresh navigation after the final source state was clean and the production build compiled successfully.

## Final result

passed
