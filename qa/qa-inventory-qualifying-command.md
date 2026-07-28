# Qualifying Command 2.0 QA inventory

## User-visible claims

- Q1, Q2, and Q3 are live timed sessions rather than one-click result generators.
- The player controls both cars through garage, out-lap, push-lap, cooldown, and return-to-garage states.
- AI cars release automatically, use varied dry compounds in Q1, and record laps as the track evolves.
- Live Classification shows the advancing cut line, timed laps, gaps, current compound, and player-car emphasis.
- Tyre temperature, condition, battery energy, traffic loss/tow, and track evolution influence qualifying laps.
- Car setup is locked under parc fermé once Q1 begins.
- The full command surface fits 1600×900 and 1280×720 without page-level overflow or clipped primary controls.

## Functional controls and state checks

- Enter the weekend and complete FP1, FP2, and FP3 through visible buttons.
- Cycle 1×, 6×, and 30× simulation rates and confirm selected state.
- Cycle S, M, and H on a garage car and return to S.
- Start Q1 and confirm the READY state becomes SESSION LIVE.
- Send both player cars; recall one during its out-lap; send it again.
- Observe at least one PUSH LAP and one completed timed lap through normal elapsed time.
- Confirm live GAP values, the P16 cut marker, changing track evolution, and AI timed laps.
- Run Q1 to the checkered flag, acknowledge the Q1 report, and confirm Q2 opens with 16 entrants and a P10 cut.

## Visual states

- Q1 READY at 1600×900.
- Q1 LIVE with populated classification at 1600×900.
- Q1 READY at 1280×720.
- Q2 READY after the live Q1 completion.

## Exploratory checks

- Attempt SEND OUT before starting the session and verify it remains disabled.
- Recall during an out-lap and verify no timed lap is incorrectly recorded.
- Inspect the dense state with multiple AI cars on track for overflow, stale labels, or hidden primary actions.
- Verify internal Classification scrolling does not cause document-level scrolling.
