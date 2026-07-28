# Qualifying smooth-motion and controls QA inventory

## Product claims to verify

- Qualifying cars move continuously on the Silverstone race line at 1× and 16× without snapshot rewinds.
- Same-route markers keep a readable minimum visual gap instead of remaining fully overlapped.
- The desktop hierarchy is leaderboard, large circuit map, command console, then a horizontal two-car status strip.
- The qualifying header has an icon-only pause/resume control, no visible `PAUSED` label, and no UI Scale control.
- Q1, Q2, and Q3 each expose a working session skip action.
- The leaderboard uses three-letter driver codes only.
- Qualifying car status does not render a car silhouette or four-wheel temperature map.
- All six management groups are present and usable: release, out-lap pace, flying-lap attack, lap action, traffic response, and fuel plan.

## Controls and expected state transitions

- `START Q1` → session status changes from `READY` to `RUNNING`.
- Pause icon → timer and selected marker stop; resume icon → both continue.
- `1× / 2× / 4× / 8× / 16×` → selected rate reports `aria-pressed=true`; 1× consumes one simulated second per wall second.
- `SKIP Q1` → Q1 report/classification and Q2 prepared; equivalent behavior for Q2 and Q3.
- Player driver selector → matching horizontal car strip is selected.
- `RELEASE NOW` → selected car moves from `GARAGE` to `OUT LAP`.
- `WAIT FOR GAP` → release request arms; `HOLD` cancels it.
- Out-lap pace selection → `Gentle`, `Balanced`, or `Aggressive Warm-up` becomes pressed.
- Flying-lap attack selection → `Safe`, `Push`, `Attack`, or `Maximum` becomes pressed.
- Traffic response selection → one of four response modes becomes pressed.
- Fuel plan selection in garage → one-, two-, or two-lap margin plan becomes pressed and changes fuel plan summary.
- `ABORT LAP` / `COOL DOWN` / `RETURN TO PITS` are enabled only in applicable phases and transition to recovery/garage.

## Layout and clipping checks

- 1280×720 and 1440×900 at browser zoom 100%.
- Circuit bounds are above command-console bounds; console is above car-status-strip bounds.
- No right-side vehicle status column remains.
- No horizontal viewport overflow at desktop sizes.
- Button labels are not clipped; tooltips/titles preserve full copy where compact labels are necessary.
- Leaderboard rows retain position, three-letter driver code, tyre, time, gap, and sector colors.

## Exploratory scenarios

- Run Q1 at 16× with a dense field for at least 15 wall seconds; monitor maximum frame step and minimum same-route marker gap.
- Pause mid-out-lap, hold for two wall seconds, then resume at 16×; verify no marker teleport or timer jump.
- Arm `WAIT FOR GAP`, cancel with `HOLD`, then release manually.
- Select the two-flying-lap fuel plan and verify the car performs push → cool down → push before returning.
- Skip a running rather than ready session and confirm the next-session report flow remains valid.
