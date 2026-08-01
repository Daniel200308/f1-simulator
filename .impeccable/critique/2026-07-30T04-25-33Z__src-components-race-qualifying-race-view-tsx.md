---
target: Qualifying Session UI
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-07-30T04-25-33Z
slug: src-components-race-qualifying-race-view-tsx
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 4 | Clock, flag, phase, risk, traffic and selection state are continuously visible. |
| 2 | Match System / Real World | 4 | Circuit, tyre, pit-release and timing language closely match an F1 pit wall. |
| 3 | User Control and Freedom | 3 | Pause, rate, skip, abort, cool-down and return are available; undo is limited. |
| 4 | Consistency and Standards | 3 | State colours are coherent, but tyre and action controls use competing visual grammars. |
| 5 | Error Prevention | 3 | Phase restrictions and tyre-set validation prevent most invalid actions. |
| 6 | Recognition Rather Than Recall | 2 | GTL, BAL, WARM, 1L, 2+ and ATK rely on recall or hover titles. |
| 7 | Flexibility and Efficiency | 2 | Sim-rate and skip help experts, but no keyboard accelerators are provided. |
| 8 | Aesthetic and Minimalist Design | 2 | The circuit is focused; the rail exposes too many equal-weight controls and nested rings. |
| 9 | Error Recovery | 2 | Disabled states help, but recovery guidance remains limited. |
| 10 | Help and Documentation | 1 | Hover titles exist, but compact terminology lacks persistent explanation. |
| **Total** | | **26/40** | **Acceptable — strong domain foundation, hierarchy and legibility need work.** |

## Design Specificity Verdict

The screen is unmistakably authored for an F1 qualifying workstation. Silverstone geometry, sector timing, the elimination line, physical tyre sets and release-risk language create strong specificity. The circuit is the distinctive anchor. The deterministic detector returned zero findings for `qualifying-race-view.tsx`, but the visual assessment found hierarchy and density problems that static rules cannot detect. Browser overlay injection was unavailable during the independent critique, so no overlay is claimed.

## Overall Impression

The live circuit and timing model are strong. The biggest opportunity is to make the right rail behave like a calm race-engineering instrument: large telemetry first, one clear current action, and comfortable controls rather than a matrix of equally weighted compact options.

## What's Working

- The live Silverstone circuit remains the largest and most product-specific visual region.
- Status communication is comprehensive: timing, phase, traffic, risk, tyre and elimination state are visible.
- Native buttons, labelled groups, meters, live regions, focus styles and reduced-motion support provide a good accessibility base.

## Priority Issues

1. **P1 — Weak phase hierarchy in the right rail.** Inactive and future controls compete with the current task. Promote the current phase and reduce decorative containment without removing functionality.
2. **P1 — Controls and labels are too small.** Segment buttons shrink to 25–32px and many labels sit at 6–10px. Raise primary targets to 44px and secondary targets to roughly 40px, with a consistent readable type scale.
3. **P1 — Narrow and zoom resilience depends on horizontal scrolling.** Preserve the desktop workstation, but allow the rail and major regions to reflow rather than clipping or shrinking below readability.
4. **P2 — The speed instrument is ornate but incomplete.** Replace the small nested dial with one restrained circular speed arc, large speed value and explicit gear.
5. **P2 — Repeated inner surfaces create a nested-card effect.** Use open groups, spacing and restrained separators as the primary structure.

## Persona Red Flags

- **Alex (Power User):** Must scan many disabled controls and has no keyboard accelerators for release, pause or driver switching.
- **Sam (Accessibility-Dependent):** Strong semantics are undermined by 6–10px labels and forced horizontal scrolling below 1100px or at high zoom.
- **Riley (Stress Tester):** Current English content passes desktop clipping checks, but localized labels and 200% zoom exceed acronym-sized controls.

## Minor Observations

- The eight-item circuit legend competes with the map at 1280px.
- The fastest-sector ribbon is useful but should remain subordinate to the circuit.
- The leaderboard's internal scrolling correctly stabilizes the overall shell.

## Questions to Consider

- What if telemetry, current-phase action and next-run setup formed three obvious reading bands?
- Could controls show their readable names while retaining compact domain codes as secondary data?
- Can the circuit retain priority at 1280×720 without compressing buttons below usable size?

Questions skipped: the user's requested sequence and target outcomes already resolve the priority, visual direction and scope.
