# Qualifying soft circuit and tyre telemetry — QA inventory

| User-visible claim | Functional check | Visual state and evidence |
| --- | --- | --- |
| Circuit keeps blue, teal, and purple sector identity without a harsh neon tube | Load an active Q1 circuit and count all three sector paths | Desktop circuit viewport, sector lines and side labels visible |
| Sector side labels retain their matching colours | Inspect the three `data-sector-label` elements and their label tones | Desktop circuit viewport |
| The stray blue line above each tyre value is absent | Inspect all four tyre meters for a `::after` line and take a close capture | Control rail telemetry viewport |
| COLD/HOT state text is not displayed | Inspect all four tyre meters for visible state copy; retain accessible state in labels | Control rail telemetry viewport |
| Temperature remains the prominent neon reading | Verify each meter has a wheel position and one `°C` value | Control rail telemetry viewport |
| Refinement remains responsive | Check circuit and tyre telemetry at 1440×900 and 390×844 with no horizontal overflow | Desktop and mobile captures |
