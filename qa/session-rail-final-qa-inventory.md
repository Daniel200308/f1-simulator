# Session rail final QA inventory

## User requirements

- Remove the visible number badges from the upper-left corner of every session.
- Center each session icon and name within its tab and keep the labels high-contrast and readable.
- Replace the angled tab silhouette with rounded rectangles.
- Preserve the current-session emphasis and the darker green completed-session state.

## Implemented features to verify

- Session order remains available to assistive technology through `aria-posinset` and `aria-setsize`.
- Current, completed, and upcoming states continue to render from the existing weekend state.
- The rail remains usable at desktop width and horizontally scrollable on narrow screens.

## Final claims

- No visible numeric or check badge remains in the session tabs.
- Session content is centered within each rounded tab without clipping.
- State colors and active-session glow remain distinct.

## Exploratory scenarios

1. Complete FP1 so the rail renders the dark-green completed state while FP2 becomes current.
2. Resize to a 390px viewport and verify the tabs preserve their readable minimum width and horizontal scroll behavior.
3. Inspect the session tab DOM and computed styles for text overflow, rounded corners, and the absence of the former badge element.
