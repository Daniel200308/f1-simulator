# Slate / blue / yellow telemetry theme QA inventory

## Scope

This pass is color-only. Layout, copy, interactions, motion, and race semantics must remain unchanged.

## User-visible claims to verify

| Claim | Check | Evidence |
| --- | --- | --- |
| Surfaces match the supplied telemetry palette | Open team selection, weekend hub and Q1 live | Graphite/slate surfaces, black workspaces, white data hierarchy |
| Blue carries live telemetry and primary focus | Inspect active controls and live circuit | Electric-blue active/focus treatment is visible and consistent |
| Yellow carries caution/secondary telemetry | Inspect tyre/control and race-status surfaces | Yellow remains distinct and does not replace red/green safety meanings |
| Layout is unchanged | Compare desktop and mobile bounding boxes | Same major regions, no clipping or unexpected reflow |
| Critical interaction remains intact | Enter weekend, advance to Q1, select tyre, release car | Existing controls and state transitions still work |

## Exploratory checks

- Inspect a dense Q1 live state with multiple cars and active driver telemetry.
- Open the system tools menu and verify its controls use the new neutral/blue treatment without changing its placement.

## Final checks

- `npm run typecheck`, `npm run lint`, `npm run build`, and the qualifying traffic test pass.
- Browser console has no warnings or errors.
