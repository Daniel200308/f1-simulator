# Vivid accent / black surface QA inventory

## Scope

- Keep body, panels, overlays, map wells, and tool menus black/charcoal.
- Restore vivid, legible colour for actions, team identity, tyre compounds, weather, flags, and race state.
- Preserve layout, copy, interaction, simulation behavior, and motion.

## Signoff claims

- The team-selection surface uses a black base while team accents remain visibly distinct.
- Q1 keeps a black circuit workspace while driver, tyre, and session signals remain readable and colorful.
- Desktop and mobile remain free of horizontal overflow.
- Selecting a tyre and releasing the car still updates the visible Q1 state.

## Exploratory checks

- Open and close the Q1 system-tools menu.
- Inspect a dense Q1 state after cars are circulating and the selected-car telemetry is active.

## Final checks

- Typecheck, lint, targeted qualifying-traffic test, diff check, and production build.
- Browser console contains no warnings or errors.
