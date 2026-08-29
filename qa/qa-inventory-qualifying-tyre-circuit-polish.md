# Qualifying tyre console and circuit polish QA inventory

## Primary controls

- Select each available compound and confirm the compound card, physical set list, and Active Set card agree.
- Select a physical tyre set and confirm set number, NEW/USED status, condition label, and remaining life update.
- Confirm unavailable compounds and sets remain legible while disabled.
- Confirm Release Now and Hold are the only pit-release controls; Wait Gap is absent.
- Confirm Release Now remains locked until a valid tyre set is selected and the forecast allows release.
- Confirm Hold can be selected while the car is in the garage.

## Live telemetry and states

- Confirm FL, FR, RL, and RR temperatures show exact degrees Celsius and COLD/WINDOW/HOT text.
- Confirm temperature state is communicated by text and icon/tone, with no temperature bars.
- Confirm Energy Store telemetry is absent while the Energy Mode command remains available.
- Confirm the selected Active Set announcement updates politely and is not continuously announced.

## Circuit

- Confirm S1, S2, and S3 labels are all visible, connected to their track anchors, and do not overlap the circuit or top sector ribbon.
- Confirm the base rail, sector strokes, sector boundary ticks, and driver markers remain distinct.
- Confirm there is no continuously rotating/dashed circuit halo.
- Confirm live-car animation remains canvas based and does not introduce per-frame React state.

## Keyboard and accessibility

- Tab through driver tabs, release controls, setup controls, compounds, and tyre sets in a logical order.
- Confirm every interactive control has a visible focus indicator and a unique accessible name.
- Confirm compound, tyre condition, temperature, and sector meaning are not communicated by colour alone.
- Confirm reduced-motion mode suppresses decorative transforms and confirmation animation.

## Responsive and visual coverage

- Validate Q1 ready and running states at 1280x720, 1440x900, and 1920x1080.
- Confirm the right rail has no clipped labels, overlapping controls, accidental page scroll, or hidden Active Set information.
- Confirm the circuit stays the primary visual focus and the tyre workflow is visually prominent without changing the three-column application layout.
- Run an exploratory 30-90 second live session to check tyre updates, traffic, canvas motion, and layout stability.
