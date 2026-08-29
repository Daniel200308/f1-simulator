# Pit, strategy and Safety Car QA inventory

## User-visible claims

- A player-car pit stop exposes live stationary tyre-change time and total pit-lane time.
- A clean stop is calibrated from the official 2025 DHL fastest-stop event-winner mean (2.082 s), with team and deterministic execution variance.
- The completed tyre change remains visible briefly and pulses green before returning to the normal race view.
- Routine team radio is sparse; incidents, Race Control, pit and thermal warnings remain event-driven.
- Silverstone Straight Mode / wing-open sections are labelled SM1-SM4 on the circuit.
- Energy strategy controls form one ordered rail from HARVEST to OVERTAKE.
- Rival teams can choose distinct tyre compounds and undercut, overcut, extension, cheap-stop and weather intents.
- A single incident can animate as a slide/spin, damage/debris event, or roadside retirement; the responsible driver varies by seed and cooldown.
- Yellow, VSC and Safety Car causes are carried into Race Control messages.
- Exactly one Safety Car deployment occurs per race: a natural severe incident may consume it, otherwise a seeded point between laps 8-38 guarantees it.
- Safety Car deployment closes the pit initially, bunches a unique queue, prohibits overtaking, enters the pit and returns control at the restart line.
- Race completion waits for the final non-retired driver; all driver markers clear once the classified field has finished.

## Interactions and functional checks

- Schedule each available tyre compound, cancel it, then box and observe PIT ENTRY -> PIT LANE -> PIT STOP -> PIT EXIT -> TRACK.
- Confirm the tyre timer increments only while stationary and the total timer spans the whole pit lane.
- Confirm the completion pulse announces `TYRE CHANGE COMPLETE` and retains the final time.
- Select all six energy tendencies and confirm OVERTAKE remains disabled outside its entitlement window.
- Observe rival pit decisions in dry, crossover rain and VSC/SC cheap-stop conditions.
- Trigger/observe spin, damaged and retired states; verify the map animation matches the state and driver label stays legible.
- Observe Safety Car phase changes and confirm field spacing converges without overtakes.

## Visual states and viewports

- Baseline race view at 1600x900 and 1280x720.
- Pit overlay while approaching, stopped, tyre-complete pulse and released.
- Four cyan Straight Mode labels without covering driver labels or radio.
- Energy rail selected, disabled and hover/focus states.
- Green, yellow, VSC, Safety Car and red Race Control treatments.
- Spin motion, damaged debris and retired roadside marker.

## Off-happy-path checks

- Pit lane closed, no fresh tyre set, double stack, wheel-gun delay and slow release.
- Repeated incident suppression during the 180 s field cooldown and 1,200 s per-driver cooldown.
- A completed Safety Car allocation cannot deploy a second Safety Car in the same race.
- Retired drivers do not hold the finish open, while the last classified runner still must cross the line.
- Wet crossover selects intermediates/wets only when coverage and forecast justify it.
- Radio text wraps without clipping and does not flood the overlay at accelerated speeds.

## Automated coverage

- TypeScript, ESLint and full Vitest suite.
- Targeted pit-operation, AI-strategy, Race Control, track and engine tests.
- Multi-viewport browser screenshots plus overflow/console-error assertions.
- Seeded full-race incident-frequency sample with incident-type, Safety Car and unique-driver counts.
