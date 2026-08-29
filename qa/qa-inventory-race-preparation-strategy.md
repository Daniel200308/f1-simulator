# QA Inventory — Race Preparation Strategy + Race HUD

## Race Preparation

- The full 22-car grid is rendered and P22 is visible inside the grid panel.
- Both player start-tyre cards are visible without clipping.
- Soft, Medium, Hard, Intermediate and Wet are selectable for both cars.
- Each selected compound exposes a separate NEW and QUALI USED choice when inventory exists.
- The selected set reports its set number, estimated life and prior laps.
- Plan A, Plan B and Plan C are all visible as full-width 52-lap stint timelines.
- Every plan reports stop count, pit lap markers, risk and projected delta.
- Plans use at least two different dry compounds for a dry race.
- START RACE remains visible and operable.

## Race HUD

- Leader Board column labels P / DRIVER / TYRE / LIFE / GAP are fully visible.
- FREE / HOLD / SWAP each show a centered icon and label.
- Team Radio gives the latest driver message priority.
- Engineer radio appears as a compact response after a user strategy command.
- Long driver copy remains reachable by scrolling and never pushes Local Surface.
- Blue engineer metadata wraps or fits without horizontal clipping.

## Viewports

- 1440 × 900 at browser zoom 100%.
- 1280 × 720 at browser zoom 100%.
- No document-level horizontal or vertical overflow.
- P22, the second tyre card, Plan C and START RACE are inside their owning panels.

## Simulation regression

- An exact qualifying-used tyre set reaches the race engine with its life and age.
- FIA standard allocation is H2 / M3 / S8 / I5 / W2.
- Used qualifying tyres remain selectable when no new set remains.
- Across fixed qualifying seeds Audi records no poles and does not routinely fill Q3, while VER retains a strong Q3 rate.
