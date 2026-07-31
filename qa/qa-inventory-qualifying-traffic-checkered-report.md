# QA Inventory — Qualifying traffic, reports, and chequered flag

## Functional coverage

- Two cars within one second on flying laps both continue; neither is automatically put into `ABORTED`.
- The following car receives a realistic traffic-time loss, while a small bounded slipstream benefit can still offset part of that loss.
- A player-triggered Abort remains available and returns the car through the normal in-lap and pit sequence.
- AI garage releases avoid predicted flying-lap conflicts early and accept more traffic pressure only near the end of Q1/Q2/Q3.
- Qualifying results show a full-width classification with readable position, driver, lap time, gap, advancement, and elimination state.
- Qualifying results contain driver reactions only; no engineer-report block is rendered.
- Advanced and eliminated drivers receive different, emotional, state-aware reactions.
- Long driver reactions wrap completely without ellipsis or clipped text.
- Qualifying chequered state uses an animated chequerboard flag panel and an unclipped two-line control message.
- Race chequered state begins when the first classified finisher crosses and remains visible while the remaining runners finish.

## Viewport and interaction coverage

- 1280×720: topbar and result copy remain readable without horizontal clipping.
- 1440×900: result columns use the available width and driver reactions are fully visible.
- 1920×1080: classification spacing expands without leaving a narrow timing cluster.
- Browser zoom 125%: chequered label and result text remain visible.
- Reduced-motion mode: chequered state remains visually identifiable without relying on animation.

## Negative and edge cases

- No-time and invalid-lap drivers never receive an advancement-positive reaction.
- A close trailing car never gains a net advantage from traffic plus slipstream.
- Cars in garage, on out laps, or on in laps do not receive flying-lap traffic loss.
- Qualifying control copy does not report the elimination line once the chequered flag is active.
- Retired cars do not delay the race chequered/finished lifecycle.
