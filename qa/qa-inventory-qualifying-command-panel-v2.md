# QA Inventory — Qualifying command panel v2

## Required UI changes

- No `ACTIVE SET` status card is rendered; tyre life remains visible on the compound/set selectors.
- No `BATTERY STRATEGY` control or status is rendered.
- No `NEXT ACTION` strip is rendered.
- Speed uses a circular live gauge with an exact numeric km/h value and a responsive progress arc.
- FL, FR, RL, and RR tyre temperatures each use equally sized circular gauges with exact temperatures and visible position labels.
- The release action is compact, circular/infographic-led, and remains a clear single action with safe/blocked state feedback.
- Tyre selection occupies the bottom of the right rail and receives materially more vertical space than before.
- Existing Out Lap Pace, Flying Attack, Fuel Plan, Abort, Cool Down, Return, driver switching, and tyre-set selection remain operable.
- Sector 1/2/3 labels and callout leaders do not intersect the visible racing line, especially Sector 2.

## Responsive coverage

- 1280×720: right rail remains fully inside the viewport; no priority label or control text clips.
- 1440×900: tyre selector uses the full bottom region and all physical tyre sets remain legible.
- 1920×1080: gauges scale without oversized empty areas or distorted circles.
- The four tyre gauges and speed gauge retain a 1:1 aspect ratio.

## State and accessibility coverage

- Garage/ready, garage/running, out lap, flying lap, cool-down, and pit-return states show correct disabled controls.
- Cold, optimal, and hot tyre states remain distinguishable by text as well as colour.
- Speed and tyre gauges expose descriptive accessible labels and tabular numeric values.
- Release button retains a visible focus state and a sufficiently large click target.
- Reduced-motion mode removes decorative pulsing while preserving every state cue.

## Exploratory findings covered

- The initial 720p release target measured only 39px high; it was raised to 44px and rechecked.
- Six physical tyre sets at desktop width initially shortened `100%`; card padding and responsive numerals were adjusted, then clipping checks were expanded to include button `strong` values.
- A live 16× run was paused after out-lap/flying-lap transitions to verify that the five gauges remain present and the enlarged tyre area stays inside the fixed shell.

## V3 compact tyre selector and centred controls

- Exactly five compact tyre buttons appear at the bottom of the right rail: S, M, H, I, W.
- Each tyre button combines compound, actual physical set number/status, available set count, and remaining life; no separate life-button row remains.
- Selecting a different compound chooses a real available set. Clicking the already selected compound cycles its usable physical sets instead of exposing a second row of buttons.
- Unavailable compounds remain visible but disabled and show no invented life value.
- The merged tyre buttons stay close to the former life-button height and do not stretch vertically at 1920×1080.
- Release, Fuel, Out Lap Pace, Flying Attack, and Lap Action live in one vertically centred control cluster.
- Release and the central selectors have bounded widths and are centred; no action button stretches across the full right rail.
- Existing disabled states, selection states, driver switching, release flow, lap actions, and tyre inventory mutation remain functional.
- Visual/functional QA covers garage-ready, selected-set cycling, driver switching, out-lap, and paused flying-lap states at 1280×720, 1440×900, and 1920×1080.
- Exploratory risks: a compound with zero usable sets, and six Soft sets cycling without text clipping or layout growth.

## V4 physical sets, late release, and responsive controls

- The five compact compound controls remain visible, but the selected compound now exposes every usable physical set in a second compact row.
- Each physical-set control combines set number, NEW/USED state, and exact remaining life; a previously used set is directly selectable without repeatedly cycling a hidden list.
- Exactly one real `Release` button is rendered. Decorative rings cannot resemble or overlap a second action.
- Release stays enabled for a garage car with a valid set while the qualifying clock is running, even when the forecast says the flying lap cannot be completed.
- A car released too late completes its out lap physically, receives the chequered state at the timing line, and does not create a flying-lap time.
- Out Lap Pace and Flying Attack remain parallel and receive equal width; Fuel, Release, and Lap Action use the available vertical control area without stretched full-width buttons.
- Operational controls are rounded and colour-coded, with visible hover, active, disabled, traffic-risk, and late-release states.
- Tyre temperature status text remains inside all four circular gauges at 1280×720, 1440×900, and 1920×1080.
- The fastest-sector readout is one horizontal row with larger tabular sector times, driver codes, and no overlap with the circuit.
- Exploratory risks: six used Soft sets at 720p, a compound with no set, switching drivers after selecting a used set, and releasing with less than one out-lap remaining.
