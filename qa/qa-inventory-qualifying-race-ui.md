# Qualifying Race UI QA inventory

## User-visible claims

- FP1, FP2 and FP3 keep the existing garage/setup workspace.
- Q1, Q2 and Q3 use the race-page three-column layout: enlarged leaderboard, the exact race Pixi map, and two-car status.
- The qualifying map reuses the race centerline, all 18 corner labels, pit entry/lane/exit, and Straight Mode/Overtake markings.
- Qualifying uses best lap, leader gap, cut line, session clock, and track evolution rather than race laps and race interval.
- Driver commands follow Garage -> Out Lap -> Push Lap -> In Lap -> Garage.
- Race pace controls are replaced by out-lap preparation, qualifying energy, tyre, and run-release controls using the race command-console styling without scale transforms.
- Qualifying simulation speed exactly matches race controls: 1x, 2x, 4x, 8x, and 16x.
- The session timer is a large primary readout in the top broadcast bar.
- Qualifying remains dry; no rain or wet-surface UI is rendered.
- The complete primary surface fits at 1600x900 and 1280x720 without page scrolling or clipped primary panels.

## Functional checks

1. Choose Ferrari and confirm FP1 shows `GARAGE TELEMETRY`, setup sliders, and `RUN FP1`.
2. Complete FP1, FP2 and FP3 with the visible run buttons and acknowledge each report.
3. Verify Q1 opens with `Leader Board`, `Silverstone Circuit`, two vehicle status cards, `RUN CYCLE`, and `START Q1`.
4. Start Q1, choose a player driver, change run tyre, out-lap preparation, energy mode, and every race-identical simulation speed.
5. Send the selected car out and observe its race marker leave through the pit lane, then follow OUT LAP -> PUSH LAP -> IN LAP on the exact track centerline before returning to the pit.
6. Verify best time and gap update after the push lap.
7. Off-happy-path: recall the car during OUT LAP and verify it returns to GARAGE.
8. Off-happy-path: verify non-player leaderboard rows cannot issue driver commands.

## Visual checks

- Q1 READY at 1600x900: topbar, full leaderboard, map, status column, and command dock.
- Q1 live OUT LAP/PUSH LAP at 1600x900: marker and phase state are visually consistent.
- Q1 map close inspection: 18 corners and the pit lane are visible, with no qualifying SVG fallback.
- Q1 READY at 1280x720: all primary regions remain visible and readable without document scrolling.
- FP1 at 1600x900: no qualifying/race layout leaks into practice.

## Expected evidence

- `qa/qualifying-race-q1-ready-1600x900.png`
- `qa/qualifying-race-q1-live-1600x900.png`
- `qa/qualifying-race-q1-ready-1280x720.png`
- `qa/qualifying-race-q3-ready-1600x900.png`
- `qa/qualifying-race-fp1-1600x900.png`
- `qa/qualifying-race-playwright-results.json`
