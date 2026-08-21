# Qualifying control, circuit labels, and tyre telemetry QA inventory

## Requirements

- The qualifying driver rail fits in the desktop viewport without an internal vertical scroll at 1440×900 and 1280×720.
- The qualifying driver rail does not render a Fuel Plan heading, value, buttons, or fuel-plan action labels.
- The live circuit keeps the physical start/finish line but removes the `START / FINISH` text index.
- Pit Entry and Pit Exit labels are connected to the pit lane and sit outside the racing line.
- Sector 01, Sector 02, and Sector 03 are long, readable exterior callouts with leaders that do not cross another circuit line.
- Tyre temperature dials remain readable at compact desktop density and expose cold, optimal, and hot color states through the glass telemetry treatment.
- Qualifying remains usable on a narrow viewport without horizontal overflow.

## States and viewports

| State | Viewport | Evidence |
| --- | --- | --- |
| Q1 running, selected player car in garage | 1440×900 | full page + control rail screenshot |
| Q1 running, selected player car in garage | 1280×720 | compact density, no rail scroll |
| Q1 running, selected player car in garage | 390×844 | mobile layout, no horizontal overflow |
| Q1 running, circuit markers visible | 1440×900 | focused circuit screenshot |

## Interactions

- Enter Q1 from a fresh weekend and confirm the circuit and driver rail render.
- Inspect the selected driver's tyre temperature meters and state labels.
- Select the second player car and confirm the rail remains bounded.
- Release a car when the release control is ready; confirm the controls remain visible as the phase changes.
- Change simulation speed and pause/resume; confirm the rail does not jump or gain horizontal overflow.

## Browser assertions

- `Fuel Plan` does not appear in the accessibility snapshot.
- The rail's scroll height is no greater than its client height at the two desktop viewports.
- `[data-map-label="START_FINISH"]` is absent while `[data-start-finish="true"]` remains present.
- `[data-map-label="PIT_ENTRY"]` and `[data-map-label="PIT_EXIT"]` are present, and each has a leader.
- Three `[data-sector-label]` groups are present and their bounding boxes stay inside the circuit visual.
- Console errors and warnings are empty after navigation and Q1 entry.
