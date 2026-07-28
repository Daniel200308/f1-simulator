# Practice setup and classification QA inventory

## User-visible claims

- Every car setup slider runs from `-50` to `50` in integer steps.
- Telemetry recommendation bands narrow after each practice session without becoming a near-exact answer.
- FP1, FP2, and FP3 recommendation widths remain 40, 30, and 22 setup points respectively.
- Classification position, driver, compound, best lap, and gap values are visibly larger; GAP has the strongest numeric emphasis.
- The practice workspace remains usable without page-level clipping at 1600×900 and 1280×720.

## Functional checks

- Start a weekend, inspect all 12 player-car range inputs, and assert `min=-50`, `max=50`, and `step=1`.
- Move the first setup slider to both endpoints and back to zero using user input, confirming the displayed value follows.
- Run FP1, close the report, and confirm the classification contains 22 rows and a three-decimal GAP value.
- Advance through FP2 and FP3, reading the visible recommendation legend after each session.

## Visual checks

- Capture the baseline practice setup at 1600×900.
- Capture FP2 preparation with Classification populated at 1600×900.
- Repeat the populated Classification state at 1280×720.
- Inspect the slider value labels, recommendation band, classification headings, row values, scrollbar, and footer action.

## Exploratory checks

- Verify negative, zero, and positive setup values do not clip or shift the control grid.
- Verify a smaller desktop viewport does not create document-level horizontal or vertical scrolling and that fixed-shell regions remain inside the viewport.
