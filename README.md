# Project Pitwall

First playable engineering slice for a real-time open-wheel race management simulation. The prototype runs the current 2026 Formula 1 driver grid around Silverstone using a deterministic fixed-timestep simulation in a Web Worker.

## Run

```bash
npm install
npm run dev
```

**[The link isn’t public yet. Just hang on a little longer!]**

## Controls

- The race starts automatically at 1×. Use the transport button in the top-right to pause or resume.
- Select 1×, 2×, 4×, 8×, or 16× simulation speed.
- Click a car marker or timing-tower row to inspect it.
- Select either Mercedes driver and issue Pace or Tyre Management commands from the strategy dock.
- Reset restores seed `20260712` and the original grid.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The footer exposes the fixed tick, seed, and deterministic state hash.

## Current scope

Included: the 11-team/22-driver 2026 grid, Silverstone's 5.891 km Grand Prix layout and 52-lap race distance, continuously extrapolated curved-centreline movement, lap/position/gaps, tyre life and temperature, fuel burn, Pace and Tyre Management commands, PixiJS live map, timing tower, two player-car cards, fixed tick, speed controls, deterministic reset, and debug data.

Intentionally deferred: tyre-set changes and pit stops, 2026 energy deployment, active-aero rules beyond zone visualization, battle resolution, weather, safety car, qualifying, and team management. These are sequenced in `F1_2026_GAME_DESIGN.md`.

## Data sources

- Driver names, teams, three-letter abbreviations, and numbers: [Formula 1 official 2026 drivers](https://www.formula1.com/en/drivers), [2026 driver standings](https://www.formula1.com/en/results/2026/drivers), and [official 2026 driver numbers](https://www.formula1.com/en/latest/article/all-the-2026-f1-driver-numbers-confirmed-in-full.5rh7o9mPntG7NerzVk9onc).
- Silverstone length, corners, laps, and 2026 Straight Mode information: [Formula 1 official Silverstone circuit guide](https://www.formula1.com/en/latest/article/circuit-guide-everything-you-need-to-know-about-silverstone-2026.5Sl0O8g393enBWVIkjRzOr).
- Silverstone centreline geometry: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License. The raw raceway ways were normalized and converted into a closed Catmull–Rom curve for this prototype.
