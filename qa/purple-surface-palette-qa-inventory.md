# Purple surface palette — QA inventory

| User-visible claim | Functional / visual check | Evidence |
| --- | --- | --- |
| Dark game canvas uses the supplied black / indigo / purple ramp | Inspect team setup, weekend hub, qualifying and race views at desktop size | Focused desktop screenshots of setup, qualifying and race |
| Major panels, modal surfaces and control trays are no longer blue-black | Inspect their computed backgrounds and screenshot all primary surfaces | CSS token inspection and desktop screenshots |
| Red, yellow and green retain their racing meaning | Trigger or inspect semantic state controls, flag/status widgets, tyre compounds and alerts | Q1/Race interaction snapshot |
| The palette remains readable on narrow screens | Check 390×844 view for horizontal overflow, text clipping and contrast | Mobile screenshot and viewport metrics |
| Existing core controls still work | Enter a weekend, start Q1, choose a tyre and release a car | Visible Q1 state change |
| Exploratory scenarios | Inspect a dense live view and an overlay/modal after the palette update | Live qualifying and system modal snapshots |
