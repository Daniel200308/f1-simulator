# Qualifying system tools QA inventory

## User requirements

- Move SAVE, SEASON and SETTINGS out of the qualifying bottom dock into the upper-right reset area.
- Use a two-tier control: RESET on top and a lower trigger that reveals the three system tools.
- Keep the system tools readable, visually distinct and inside the viewport.

## Implemented features and controls

- RESET button remains a direct action and returns to team selection.
- TOOLS button toggles the SAVE / SEASON / SETTINGS tray.
- SAVE opens the existing save manager and is disabled when save state is not ready.
- SEASON opens the existing championship hub and preserves the grid-penalty badge.
- SETTINGS opens the existing display and audio preferences panel.
- Escape and outside pointer press close the tray; reduced-motion mode removes the tray entrance animation.

## State and visual checks

- Q1 ready, Q1 live and menu tray-open states at 1440 × 900.
- Tray closed/open, button bounding boxes, no viewport overflow and no duplicate bottom system dock.
- 390 × 844 mobile state with the tray open.
- Keyboard focus and Escape dismissal.

## Exploratory scenarios

1. Open TOOLS, click SETTINGS, confirm the tray closes and the preferences dialog opens.
2. Open TOOLS, press Escape, then reopen and click outside the tray; confirm both dismissal paths work.
3. Resize to a narrow phone while the tray is open and confirm the three actions remain inside the viewport.
