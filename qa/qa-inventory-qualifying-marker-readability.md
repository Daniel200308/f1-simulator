# Qualifying marker readability QA inventory

## User-visible states

- Q1 ready: static Silverstone circuit remains the visual focus.
- Q1 live / out lap: every active car has a solid, readable marker and three-letter driver code.
- Q1 live / flying lap: the outer pulse animates while the solid car marker remains continuously visible.
- Q1 live / in lap, pit entry, and cool down: muted state colours remain opaque enough to read against the track.
- Player cars: larger marker, team-colour ring, larger driver code.
- Opponent cars: compact but readable marker and driver code.
- Paused session: marker positions and labels remain visible while pulse animation stops.

## Interaction and functional checks

- Enter the race weekend and advance through FP1, FP2, and FP3 into Q1.
- Release both player cars and run at 16x long enough to exercise multiple car phases.
- Confirm all active cars are labelled on the single Canvas renderer.
- Confirm marker and label metadata matches the intended minimum sizes and full-opacity core treatment.
- Pause and resume qualifying without losing markers.

## Layout and visual checks

- 1280×720: markers and codes remain legible without covering the circuit.
- 1440×900: mixed AI/player traffic remains clear at browser zoom 100%.
- 1920×1080: player emphasis remains proportionate and opponent codes do not look undersized.
- Inspect the live screenshot for invisible/dimmed cars, clipped labels, and excessive overlap.

## Regression checks

- Canvas remains the only animated car layer.
- Circuit SVG remains static.
- No runtime console errors.
- No change to qualifying simulation timing or traffic logic.
