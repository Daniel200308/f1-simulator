# QA Inventory — Timing Workstation + Race Preparation

## Qualifying

- Team selection opens the weekend hub.
- FP1, FP2 and FP3 can be run and their reports acknowledged.
- Q1 opens the qualifying workstation.
- No live circuit/map canvas is rendered in qualifying.
- The central sector wall shows every active driver in two columns with only S1, S2 and S3.
- Purple, green, yellow, invalid and neutral sector states remain distinguishable by colour and accessible labels.
- Mini-sector timing state and its 528-cell live DOM are absent.
- The qualifying leaderboard uses a compact grey `Driver / Tyre / Gap / Best` header and does not show tyre life.
- Gap and Best remain tightly aligned without clipped header labels.
- The elimination cut line remains visible.
- Traffic Response is absent.
- Driver Release removes the Low Traffic / Flying / Finish forecast strip while preserving Release, Wait Gap and Hold.
- Driver Release, Out Lap Pace, Flying Lap Attack, Fuel Plan and Lap Action remain operable, with a visible icon centered in every command node.
- Both player driver selectors remain selectable and visually centered.
- All four tyre temperatures use centered numeric gauges with cold, window and hot states.
- OUT LAP S1, S2 and S3 arrive in sequence as slower neutral records and never alter competitive bests.
- Start, pause/resume, speed and skip-session controls remain operable.

## Race preparation

- The full 22-car starting grid is visible as 11 paired rows.
- Every grid car shows its planned starting compound.
- Player cars are visually highlighted.
- Both player cars have graphical five-compound selectors, fresh-set counts, stint window and strategy rationale.
- Changing a player compound updates the selected tyre and grid preview.
- The AI field plan is deterministic for the same seed and is not an alternating S/M pattern.
- Start Race remains operable.

## Race

- UI Scale control is absent.
- Track temperature and weather are visible as icon-led condition instruments.
- The full `TRACK TEMP` label remains inside the condition instrument at 1280 × 720 and 1440 × 900.
- The leaderboard is narrower, uses three-letter driver codes and has tight driver/tyre spacing.
- Pace labels are not clipped.
- Next Tyre shows all five tyre buttons and Stay Out without overlap.
- Team Radio clearly distinguishes DRIVER and ENGINEER messages without tabs.
- Long radio messages scroll inside the radio region and never move, overlap or clip Local Surface.

## Viewports

- 1920 × 1080 at browser zoom 100% for qualifying.
- 1440 × 900 at browser zoom 100%.
- 1280 × 720 at browser zoom 100%.

## Regression checks

- No horizontal page overflow at either viewport.
- No clipped control labels or tyre temperatures.
- Race/qualifying simulation controls still update state.
- Console contains no uncaught errors or React warnings.
