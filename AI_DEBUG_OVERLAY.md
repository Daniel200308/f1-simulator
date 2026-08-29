# AI Debug Overlay

The development-only AI Debug Overlay is hidden by default. Press `⌘ + '` to open it and press `⌘ + '` again to close it. The shortcut is ignored while focus is in an input, textarea, select, or contenteditable element.

The panel is read-only and shows the live race snapshot for every active driver: identity, position, lap, control state, current decision, mode, target when available, tyre and life, pit status, strategy intent, fuel, energy, traffic, gaps, weather context, Safety Car context, and the current simulation tick. It is scrollable so the full field can be inspected without covering the race command dock.

The overlay reuses existing `RaceSnapshot` and `RaceCarState` data. `aiDecision` now persists intent, objective, target, pit reason, planned stop lap, confidence, decision timestamp, and the model's main reasons. Active-aero state, weather response, and Safety Car queue response are shown from the same live snapshot. The displayed AI control state is derived from team ownership and the existing `energyAutoEnabled` flag; the overlay never alters simulation state.
