# Qualifying broadcast redesign QA inventory

## Source and visual target

- Source reference: `/var/folders/cl/4yz51gk95g31__5d5df66s440000gn/T/codex-clipboard-7b3552d6-e75a-4a34-b4be-cb4329e0ab82.png`
- Target state: Q1 live at 1280×720 and 1440×900, dark desktop timing interface.

## Product claims

- The timing tower follows the reference hierarchy: position, three-letter driver code, interval/status, lap time, live mini sectors, and tyre.
- Each flying lap exposes 24 live mini sectors grouped into S1, S2, and S3.
- Mini-sector colours use neutral, purple session best, green personal best, yellow slower, and red invalid states.
- The elimination boundary is a full-width red line after the cut position, not a small CUT badge.
- Drivers below the line remain full white while the qualifying session is running and only become grey after elimination is locked.
- Status copy uses `OUTLAP`, `FLYING LAP`, `COOL DOWN`, `INLAP`, or `GARAGE`; it never abbreviates a live out lap to `OUT`.
- The redundant circuit-title row above the map is removed.
- The control surface uses rounded connected mode nodes, icons, and state rails instead of rectangular button tiles.
- Both player-car status strips use larger type and show FL, FR, RL, RR live tyre temperatures in one row.
- Track markers remain continuous at 1× and 16× without route rewinds or abrupt overlap-separation jumps.

## Interaction and state checks

- Start, pause/resume, speed selection, session skip, reset.
- Player driver switch and selected status-strip highlight.
- Release, wait for gap, and hold states.
- Out-lap pace, flying-lap attack, traffic response, and fuel plan selected states.
- Abort, cool down, and return-to-pits disabled/enabled states.
- Mini sectors progressively populate during a flying lap and reset for the next competitive lap.
- Track-limits invalidation turns completed mini sectors red and does not commit them as bests.

## Layout checks

- No viewport overflow at 1280×720 or 1440×900 at 100% browser zoom.
- Timing rows remain readable and vertically scroll without clipping the tyre column.
- Map is the first workspace row and remains above controls.
- Control labels and status typography are at least 10–14px depending on hierarchy and do not clip.
- Four tyre temperatures fit on one line in each player-car strip.
- Reference and implementation timing-tower regions are combined into one comparison image for design QA.

## Motion checks

- Sample selected marker position each animation frame at 1× and 16×.
- Same-route distance must not move backward between frames.
- Pause must hold session timer and marker position.
- Dense traffic should ease separation offsets instead of jumping by an entire car gap in one frame.
