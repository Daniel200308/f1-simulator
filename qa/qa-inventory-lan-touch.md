# LAN and touch-entry QA inventory

## User-visible claims

- The app loads from `http://192.168.0.7:3000` on another device on the same Wi-Fi.
- Team cards react to a real touch tap.
- `ENTER WEEKEND` advances from team selection to the FP1 weekend screen.
- `RUN FP1` reacts after the remote-device transition.
- No transparent overlay intercepts the selected team or confirm button.
- The entry flow works at phone portrait, tablet landscape, and desktop viewport sizes.

## Functional checks

- Load the LAN URL and collect console, page, request, and hydration errors.
- Use Playwright `tap()` with `hasTouch: true`, not DOM `click()` or `evaluate()`.
- Select a non-default team and verify `aria-selected` changes.
- Scroll `ENTER WEEKEND` into view, verify the hit-tested element is the button, then tap it.
- Verify the team-selection dialog disappears and `[data-weekend-session="FP1"]` appears.
- Tap `RUN FP1` and verify the FP1 report dialog appears.

## Visual checks

- Capture the team selection before interaction and the FP1 screen after interaction.
- Verify the confirm button is visible, has a practical touch target, and is not clipped.
- Verify there is no unexpected horizontal overflow in the entry surface.

## Exploratory checks

- Reload the LAN URL and repeat the flow with a second team.
- Repeat at 390×844 portrait, 1024×768 landscape, and 1440×900 desktop.
