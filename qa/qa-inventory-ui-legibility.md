# Race and qualifying UI legibility QA inventory

## User-visible claims

- Race and qualifying primary text remains readable at 1280×720, 1440×900 and 1920×1080.
- Driver names, team/status copy, lap times and sector times no longer clip vertically or escape their panels.
- Long one-line content ellipsizes and exposes the full value through a native title tooltip.
- Numeric timing columns use tabular numerals and maintain stable alignment.
- UI Scale offers 90%, 100%, 110% and 125%, persists the choice, and changes type/row/spacing variables without `transform: scale()`.
- 1200px and 1000px breakpoints remove secondary information before shrinking primary data.
- Qualifying keeps the track and driver controls usable when the right telemetry column is removed at narrow widths.

## Functional controls and state changes

| Control | Initial state | Changed state | Return check |
| --- | --- | --- | --- |
| UI Scale select | 100% or persisted value | 90%, 110%, 125% | Return to 100% |
| Qualifying start | Q1 ready | Q1 running | Pause and resume |
| Qualifying speed | 1× | 4× | Return to 1× |
| Driver selector | First player driver | Second player driver | Selected telemetry and control link update |

## Visual evidence matrix

| Surface | Viewport / zoom | Required evidence |
| --- | --- | --- |
| Qualifying ready and live | 1280×720, 1440×900, 1920×1080 | Header, tower, circuit, command controls and car status fit; no clipped labels |
| Race live | 1280×720, 1440×900, 1920×1080 | Header, leaderboard, circuit controls, both car cards fit; gaps align |
| Both | Browser 125% | Priority columns hide/reflow without horizontal page overflow |
| Both | UI Scale 90/100/110/125 | Text and row rhythm visibly change; canvas and track geometry do not scale |

## Exploratory scenarios

- Inspect a long FIA detail and long radio message while the UI Scale is 125%.
- Inspect the longest driver/team names at the narrowest desktop width and verify title tooltips exist on ellipsized text.
- Run a dense qualifying classification with S1/S2/S3 populated, then resize below 1000px and confirm sector detail hides before primary TIME/GAP data.
- Select the second team car at 125% scale and confirm the car card plus command controls remain fully reachable.
