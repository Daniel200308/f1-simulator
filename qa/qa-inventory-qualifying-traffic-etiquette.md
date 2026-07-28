# Qualifying traffic etiquette and circuit-map QA inventory

## User-visible claims

| Claim | Functional check | Visual check / evidence |
| --- | --- | --- |
| Flying-lap cars receive priority | Unit-test a flying car approaching a cool-down car from 3–5 seconds behind | Dense live Q1 screenshot includes the amber YIELD treatment without hiding flying markers |
| Yielding begins early, tracks one car and ends after a 2–3 second safe gap | Unit-test approach, pass and recovery states plus the anti-repeat cooldown | Inspect `YIELD` label, amber ring and off-line marker position |
| Unsafe pit merges are held | Unit-test a projected pit-exit merge against a flying car; verify `mergeSafe=false` | Release status displays `HOLD · FLYING CAR` when applicable |
| Cars do not visually occupy the same racing-line point | Inspect Canvas overlap diagnostics during dense 16× running | Dense-field screenshots at 1280×720 and 1440×900 |
| S1, S2 and S3 are drawn directly on the circuit | Verify three sector paths and three large labels | Both desktop screenshots show restrained sector colour changes |
| Sector boundaries, start/finish, pit entry and pit exit are clear | Verify two sector lines, one start line and all three labels | Inspect the full centre map at both sizes |
| Every driver abbreviation is larger, white and stable | Verify Canvas label metadata and persistent anchors | Watch the dense map, then inspect screenshots for legibility and label plates |
| Live markers communicate Flying, Out, In, Cool Down, Yielding and Player | Verify the seven legend entries and active marker diagnostics | Compare legend symbols with the live Canvas state |
| Animation remains isolated from React frame updates | Verify one static SVG plus one transparent Canvas and ref interpolation | Confirm no console errors or viewport overflow during 16× running |

## Interactive controls and state changes

- Release Now: garage → pit lane → out lap.
- Wait for Gap: queues release until the merge window is safe.
- Simulation speed 1× → 16× → pause: creates a dense traffic state while preserving a stable rendered frame when paused.
- Driver tab switch: changes the controlled driver without recreating the map layer.

## Exploratory scenarios

- Run deep into the final minutes at 16× and confirm denser traffic does not create persistent marker stacks or a permanently yielding car.
- Pause while one or more cars are yielding and confirm the amber pulse and all marker positions stop without moving labels to a different side.
