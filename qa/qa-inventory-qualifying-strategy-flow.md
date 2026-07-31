# Qualifying strategy flow QA inventory

## User-visible claims

- AI cars spread their banker laps through the opening and middle of each segment.
- A driver without a valid time or sitting near/below the cut receives higher final-run urgency.
- A safely classified Q1 driver may reuse a healthy used soft; an at-risk or final-attempt driver receives a fresh set when available.
- Q1 and Q2 reports show the advancing cut, the first eliminated position, explicit advancement/elimination states, and no-time results.
- Q1 → Q2 → Q3 entry lists contain only drivers who set a valid time and qualified in the preceding segment.
- Eliminated drivers stay eliminated and cannot receive controls or generate later lap times.

## Functional controls and transitions

- Start Q1, change simulation speed, release either player car, pause/resume, and skip a segment.
- Complete Q1 and use `START Q2`; complete Q2 and use `START Q3`.
- Confirm the next segment has 16 then 10 active entrants.
- Confirm the report action advances to the correct ready session.

## Visual states

- Q1 live at 1440×900: leaderboard, circuit, and command rail fit without clipping.
- Q1 report at 1440×900: cut line, ADVANCED/ELIMINATED states, no-time state, and action button are legible.
- Q2 report at 1280×720: two-column classification and driver reports remain above the fold.
- Q3 ready at 1920×1080: only ten qualified entrants appear in the timing tower.

## Exploratory / off-happy-path checks

- Skip Q1 without releasing a player car: the player car is eliminated and absent from Q2 controls.
- Give a driver only an invalid lap: the driver does not advance despite having a recorded last-lap value.
- Leave an AI driver with no time near the final viable release window: it attempts a banker lap without violating pit-exit safety.
- Keep a safely classified Q1 AI car on a healthy used set: it avoids consuming a fresh set unnecessarily.

## Evidence

- Unit tests for AI run priority, fresh/used tyre preference, valid-time advancement, and persistent elimination.
- Playwright screenshots for live Q1, Q1 report, Q2 report, and Q3 ready.
- Browser console and viewport-bound checks.
