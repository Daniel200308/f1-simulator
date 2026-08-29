# Race Director and command UI · QA results

- Functional flow: team selection → FP1/FP2/FP3 → Q1/Q2/Q3 → race start passed.
- Commands: both Ferrari drivers, FREE/HOLD, ATK energy tendency, tyre reservation and cancellation passed.
- Automatic OVT: unit and engine integration tests confirm T17 ≤1.000s entitlement, automatic T18 activation and baseline-mode restoration.
- Runtime regression found and fixed: replay recorder now waits for the matching new-race seed before recording.
- 1600×900: no document or command-strip overflow; full circuit, radio, surface and both car cards visible.
- 1280×720: no document, command-strip or pit-control overflow; radio text and thermal diagrams visible.
- Browser console errors: 0 after the replay reset fix.
- Failed local resources: 0.
- Automated verification: ESLint passed, TypeScript passed, 204 tests passed (1 opt-in sample skipped), production build passed.

Screenshots:

- `race-director-command-ui-1600x900.jpg`
- `race-director-command-ui-1280x720.jpg`
