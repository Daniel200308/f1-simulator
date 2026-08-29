# Black / charcoal theme QA inventory

## Scope

This pass is color-only. Layout, copy, controls, motion, and simulation behavior must remain unchanged.

## User-visible claims to verify

| Claim | Check | Evidence |
| --- | --- | --- |
| General UI is black and dark charcoal | Inspect team selection, weekend hub and Q1 | Surfaces, borders, glows and neutral controls are subdued |
| Race signals remain understandable | Inspect flags, tyre states and driver status | Semantic red/green/yellow signals remain distinct but muted |
| Layout is unchanged | Compare 1440×900 and 390×844 bounds | Major regions retain their existing geometry; no clipping or horizontal overflow |
| Critical controls still work | Enter weekend, advance to Q1, select tyre, release car | Existing state transitions and labels remain functional |

## Exploratory checks

- Inspect a dense Q1 state with cars on track and live driver telemetry.
- Open the system-tools menu and confirm it stays dark without moving its placement.

## Final checks

- `npm run typecheck`, `npm run lint`, `npm run build`, and the qualifying traffic test pass.
- Browser console has no warnings or errors.
