# QA inventory · automatic energy, Silverstone detection and car identity

## Functional states

- Race launch and lights-out transition.
- Player energy tendencies: HAR, CON, BAL, ATK, BST; OVT unavailable without entitlement.
- Automatic energy flow: deployment on straights and recovery through braking/corners.
- Long-run lap boundary: SOC, lap deploy/recovery totals and mode remain live after multiple laps.
- Silverstone 2026 Overtake Mode: T17 detection line, following-lap T18/Hamilton Straight entitlement.
- Car status header: large position at left, full driver name only, car number at right.
- Mercedes remains competitive without a large static team-performance advantage.

## Interactions

- Start race, select both player drivers, change energy tendencies.
- Increase speed to 16x and observe both DEPLOY and HARVEST flow states.
- Verify OVT is disabled outside an entitled activation window.
- Resize to 1600×900 and 1280×720 and verify the track, labels and status cards remain visible.

## Visual checks

- `2026 ENERGY` is absent.
- Yellow `DET` line after T17 and magenta `OVT` line before T18 are legible without masking corner numbers.
- Legend includes `OVERTAKE DET.`.
- Position is the dominant header value; full driver name is not clipped; number occupies the former position column.
- No horizontal or page-level overflow at the target desktop viewports.

## Regression checks

- Full Vitest suite.
- ESLint, TypeScript and production build.
- Browser console errors, uncaught exceptions and failed local resources.
