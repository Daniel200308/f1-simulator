# Qualifying AI, traffic, tyres and control rail QA inventory

## User-visible claims

- Flying laps have priority over every non-flying phase.
- A persistent sub-one-second flying-lap conflict aborts the following car without teleporting it.
- The map distinguishes Flying, Out, In, Cool Down, Yielding and Aborted states and keeps labels stable.
- A player car cannot be released without selecting one physical tyre set.
- The control rail shows all five compounds, new/used counts, per-set condition and a clear selected state.
- Q1 tyre use persists into Q2, Q3 and Race Preparation.
- The complete qualifying workspace fits at 1280×720 and 1440×900 without clipped essential controls.

## Functional checks

1. Enter Q1 through normal weekend controls.
2. Start Q1 and confirm Release Now and Wait Gap remain disabled before a set is selected.
3. Select a Soft physical set and confirm both release actions become available when the merge forecast is safe.
4. Switch through each compound and back to Soft; verify specific-set buttons and inventory counts.
5. Release the player car, verify the fitted set/status and observe live phase advancement.
6. Exercise Hold and Wait Gap selection states.
7. Run at 16× long enough to observe AI traffic, YIELD markers and no marker overlap.
8. Unit tests stage two flying cars below one second, verify the following car enters ABORTED LAP, then PIT ENTRY and GARAGE.
9. Unit tests verify exact set wear and ID survive Q1/Q2/Q3 and Race Preparation.

## Visual checks

- Selected driver tab is prominent and the second driver remains reachable.
- Release, pace, attack, fuel, action, energy and tyre sections are visible with no clipped labels.
- Compound sidewall colours, counts, set numbers, status and life are legible.
- Missing-tyre warning is visible before selection and disappears after selection.
- Active modes have a clear fill/glow/ring treatment.
- Map ABORT/YIELD language and legend use matching colours.
- Leaderboard, circuit and control rail remain inside the viewport.

## Exploratory checks

- Try Wait Gap while the merge is unsafe: it should remain queueable after a tyre is selected.
- Pause during animated map activity: vehicle and status animation must freeze.
- Select a used set after one completed run: the same set ID and reduced life must remain available.

## Evidence

- `qualifying-ai-tyres-1280x720.png`
- `qualifying-ai-tyres-1440x900.png`
- `qualifying-ai-tyres-playwright-results.json`
- Vitest full-suite output
