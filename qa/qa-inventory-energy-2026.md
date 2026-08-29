# QA Inventory · 2026 Electrical Energy System

## Visual thesis

One continuous electrical flow links SOC, MGU-K and the rear wheels; green/teal means usable flow, yellow means target pressure and red is reserved for clipping or thermal protection.

## Intended initial race view

At desktop widths the full fixed-shell race workspace must show the circuit, both player-car status panels, both 2026 energy telemetry strips and the complete command dock without page scrolling or clipped controls.

## User-visible claims and checks

| Claim | Functional check | Visual state | Evidence |
| --- | --- | --- | --- |
| CAR NOMINAL and LAP % are removed | Inspect both player car panels | Live race | Desktop screenshot |
| Each player car shows independent SOC, MJ, deploy/harvest kW, pack temperature, prediction and target | Compare both car telemetry labels and accessible descriptions | Live race after 10+ seconds | Desktop screenshot + DOM text |
| Power flows Battery → MGU-K → Rear Wheels while deploying | Select ATTACK and run | ATTACK on a straight | Screenshot + `data-flow=deploy` |
| Power reverses during recovery | Select HARVEST and run | HARVEST in braking/technical section | Screenshot + `data-flow=harvest` |
| Six 2026 modes are usable | Click HARVEST, CONSERVE, BALANCED, ATTACK, BOOST; verify pressed state; inspect disabled OVERTAKE outside its window | Live command dock | Pressed-state assertions |
| OVERTAKE is conditional | If the opening field provides a valid sub-one-second straight window, activate it; otherwise confirm the unavailable explanation. Unit coverage checks both states. | Normal live race | Conditional UI assertion + unit test |
| Clipping and thermal protection are legible without relying on colour alone | Use `?energyDebug=1` clipping/heat actions | CLIPPING and CRITICAL | Focused debug/telemetry screenshot |
| Player-team timing rows show compact energy state only | Inspect player rows versus field rows | Live race | Desktop screenshot |
| Track energy plan is visible | Inspect twelve-segment line under both energy strips | Any live state | Focused screenshot |
| Layout remains usable at smaller desktop size | Repeat full pass at 1280×720 | Live race | 1280×720 screenshot + bounds |
| Native desktop window does not clip the circuit, energy strips or commands | Run native-window pass | Live race | Native screenshot + bounds |

## Controls and state cycles

- Team selection → weekend → run FP1/FP2/FP3/Q1/Q2/Q3 → starting tyres → start lights → race.
- Driver selector: car 1 → car 2 → car 1.
- Energy mode: BALANCED → HARVEST → CONSERVE → ATTACK → BOOST → OVERTAKE when eligible → BALANCED.
- Race transport: pause → play; 1× → 4× → 1×.
- Energy debug (development query only): SOC full, SOC low, heat, clipping, Boost, Overtake, AI toggle.

## Simulation checks

- SOC decreases under deployment and increases under braking/recovery.
- Stored energy remains within 0–capacity and results are deltaTime-stable.
- Low SOC and high/low temperature limit electrical output.
- Attack is faster and consumes more energy than Harvest.
- Safety Car/VSC recovers energy; final lap lowers the reserve target.
- All 22 cars own independent state and AI uses the same energy update function.
- Lap counters reset while totals persist.
- Version 2 save round-trip preserves energy; legacy `batteryPercent` migrates.

## Exploratory scenarios

1. Switch rapidly between HARVEST, BOOST and BALANCED while changing driver selection; verify each car retains its independent state and no command is sent to the wrong car.
2. Run 16× into low SOC, then pause and switch to HARVEST; verify clipping clears only after recovery and no negative/over-100 SOC appears.
3. Open the development energy panel at 1280×720 and trigger heat/clipping; verify production layout is unaffected when the query is absent.
