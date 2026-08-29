# QA inventory · race director and command UI

## Functional states

- Race launch and lights-out transition.
- Both player-driver selectors remain usable and show driver code, number and position.
- FREE, HOLD and SWAP team orders are readable and change the pressed state.
- HAR, CON, BAL, ATK and BST remain baseline energy tendencies.
- OVT is not a user command; T17 detection within 1.000s automatically enables it in the T18 activation zone.
- Local Surface updates all three sector wetness values and radar status.
- Team Radio clearly identifies the speaking driver or pit engineer.
- Red flag suspension, tyre/limited-repair service, restart formation and restart countdown.
- Track-limit penalties, blue-flag compliance and live Leader Board status.

## Interaction checks

- Start a race, switch between both drivers, select HOLD then FREE, and change energy tendency.
- Reserve a next tyre and cancel the call.
- Run at accelerated speed and confirm live timing/radio/surface updates.
- Confirm right-side car cards remain selectable after removing the detailed energy-flow footer.

## Visual checks

- Desktop 1600×900 and compact desktop 1280×720.
- Full Silverstone circuit remains visible; radio and surface rail do not obscure the driving line.
- No page-level horizontal/vertical overflow, clipped radio copy or hidden command labels.
- Driver selector is compact; FREE/HOLD/SWAP and surface percentages meet the existing readable type scale.
- Vehicle thermal diagram expands into the space formerly used by detailed energy telemetry.

## Regression checks

- Browser console, uncaught exceptions and failed local resources.
- ESLint, TypeScript, 204 unit tests and production build.
