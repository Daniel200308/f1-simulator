# QA Inventory — Safety Car, Weather, Broadcast Topbar

## Safety Car procedure

- SC badge visibly releases from the pit lane before joining the circuit.
- Deployment is capped by a seeded one/two-tour schedule and cannot wait forever for `fieldBunched`.
- A one- or two-lap-down car is assigned to wave-by rather than an unreachable same-lap queue target.
- `LAPPED CARS MAY NOW OVERTAKE` appears on the lap before SC ending.
- Wave-by cars recover no more than one lap and all other active track cars have a queue target or safe SC fallback.
- `SC ENDING` starts in Silverstone sector 3; the SC enters at the late-sector-three pit entry.
- P1 controls pace after the SC enters the pits; GREEN appears only after P1 crosses the timing line.
- Retired/finished cars are excluded, pit rejoiners cannot fall through to green-flag speed, and PER is explicitly covered.

## Weather and radio

- Repeated new games use a fresh persisted seed while a running replay remains deterministic.
- 256-seed sample includes drizzle, passing showers, building rain, sudden downpour, patchy cells, and two-wave rain.
- Cell starts cover early, middle, and late race windows; movement includes all four direction quadrants.
- Local rain reaches sectors in varied orders and surface wetness/drainage remain bounded.
- First drops, rapid intensification, local showers, easing rain, and aquaplaning produce contextual driver reports.
- Weather transition radio is debounced and names the car's actual sector without fixed contradictory corner names.

## Broadcast topbar

- Dominant status text is restricted to GREEN, YELLOW, VSC, SC, SC ENDING, or RED FLAG.
- PIT OPEN/CLOSED is secondary; the obsolete TRACK FLAG caption is absent.
- ROUND 09 / RACE is horizontally and vertically centered.
- SC → SC ENDING → GREEN changes trigger the transition flash; reduced-motion disables it.
- FIA headline/detail wrap without clipping at 1280×720 and 1600×900.
- No horizontal document overflow and all topbar regions remain within viewport bounds.

## Off-happy-path checks

- No lapped cars: one/two-tour seeded schedule still exits in sector 3.
- Multiple lapped cars: each has an independent one-lap target and none blocks withdrawal.
- Car in PIT_EXIT during deployment: safe pace applies until it receives a queue entry.
- SC ending with an uncompleted wave-by: no rollback/teleport and no third SC tour.
- Heavy rain arrives suddenly after a dry start; radio changes urgency without repeating every second.
