# Roadmap final QA inventory

## User-visible claims

| Claim | Functional check | Visual state / evidence |
| --- | --- | --- |
| Three circuits share one simulation and renderer | Inspect the championship schedule; advance to qualifying; verify the live map carries the current circuit metadata | Desktop qualifying map screenshot with circuit-specific title, full map, timing tower and command rail |
| A complete weekend and season can be saved and restored | Save from the system toolbar, alter the view, restore, and verify the same team/session returns; validate exported state in unit tests | Save manager screenshot with autosave ready |
| A three-round mini championship records results and exposes standings | Open Season after entering a weekend; verify three-round rail, standings and reliability workspace | Championship operations screenshot |
| Reliability affects pace, can fail deterministically, and can produce a grid drop | Unit tests verify derate, seeded failure event/radio and stable two-car grid drop; browser verifies condition/risk UI | Reliability panel and pending-penalty treatment where applicable |
| Rival AI exposes intent, personality and reasons while player ERS remains automatic | Open the AI overlay; verify personality, reasons and PLAYER · AUTO ENERGY; change player battery usage and confirm the command persists | AI telemetry and live energy-ring state |
| Alert audio, reduced motion and high contrast are configurable | Toggle audio off/on, volume, reduced motion and high contrast; verify root data attributes; return toggles to defaults | Settings dialog screenshot in high-contrast/reduced-motion state |
| First-weekend help is replayable | Open Settings, choose Replay quick start, advance all guide steps | Quick-start modal screenshot |
| The 100% desktop race UI fits without clipped controls | Check viewport/document and required region bounds at 1440×900 and 1280×800 | Desktop race screenshot after lights out |
| The responsive layout remains usable on a phone | Check 390×844 for horizontal overflow, reachable controls and readable settings | Mobile settings/initial screen screenshot |

## Control and state coverage

- Team selection: choose constructor, enter weekend.
- System tools: Save, Season, Settings.
- Save manager: Save now, Restore, close; export/import remain covered by schema/unit tests to avoid browser-download side effects.
- Settings: audio enabled, volume, reduced motion, high contrast, replay tour, Escape close.
- Tour: Next, final Enter pitwall, Escape skip.
- Weekend: run FP1/FP2/FP3, acknowledge reports, enter Q1.
- Qualifying: start Q1, pause/resume, select player car, release if available, simulation rate, skip session.
- Race preparation: choose starting tyres, start race, inspect lights-out state.
- Race controls: pace, battery usage, tyre management, strategy/report launchers.
- Development overlay: keyboard toggle and read-only AI fields.
- Championship: open/close, round rail, reliability action availability.

## Exploratory / off-happy-path checks

1. Open Settings above another full-screen session, press Escape, reopen, and verify focus returns without a render loop or stale backdrop.
2. Reload with an autosave present, restore it, then verify circuit/team/session identity and that no console error is emitted.
3. Switch between 1440×900, 1280×800 and 390×844 and look for fixed-shell clipping, horizontal overflow, obscured floating tools or unreadable controls.
4. Leave qualifying running briefly at accelerated rate and verify moving car markers remain on the selected circuit and the UI stays responsive.

## Automated gates

- `npm run lint` — passed
- `npm run typecheck` — passed
- `npm test -- --reporter=dot` — 55 files passed, 1 skipped; 484 tests passed, 1 skipped
- `npm run build` — passed (Next.js production build)
- `git diff --check` — passed
- Impeccable detector — completed once on changed UI targets; layout transitions and bounce easing removed, semantic race-status accents retained
- Playwright production E2E — passed in fresh context with zero page/console errors

## Final browser evidence

| Pass | Result |
| --- | --- |
| 1440×900 race | document 1440×900; no viewport-out buttons; 22 map markers; embedded Save/Season/Settings/Strategy/Report controls |
| 1280×800 race | document 1280×800; no viewport-out buttons; command dock has 17px bottom safety gap and both status panels fit |
| 390×844 race | document width 390; no horizontal overflow or horizontally clipped buttons; one 390px active-car telemetry card and 2162px intentional vertical flow |
| Automatic ERS | BALANCED policy persisted while live flow changed HARVESTING (green) → NEUTRAL (cyan) → DEPLOYING (red) |
| Save/restore | schema v1 restored Silverstone/FP1/paused state in a fresh browser context; zero console errors |
| Championship | Silverstone/Monza/Suzuka rail, reliability risk and locked between-round maintenance shown |
| Accessibility | hidden background race surface removed from the accessibility tree; settings and three-step guide keyboard-operable |

An independent finish review initially flagged the mobile telemetry height, the 1280px command-dock edge and championship modal semantics. All three were corrected and the same reviewer returned `RELEASE BLOCKED: NO` after reinspection.

The native-window risk relevant to the original bug is covered by CSS-pixel viewport passes at 100% browser zoom (1440×900 and 1280×800). Device-scale-factor-specific rendering does not alter the layout breakpoints because the shell sizes in CSS pixels.
