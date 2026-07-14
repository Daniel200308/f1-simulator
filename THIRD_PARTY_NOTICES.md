# Third-party notices

## Silverstone telemetry profile

The distance/speed reference in `src/simulation/silverstone-telemetry.ts` is sampled from
`src/examples/03_formula_1_sim/data/f1_silverstone_lap.csv` in
[zvanjak/MML](https://github.com/zvanjak/MML).

MIT License

Copyright (c) 2026 Zvonimir Vanjak

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

## OpenF1 race-control schema reference

The field names and category semantics used by `src/simulation/race-control-feed.ts`
were designed with reference to the public `race_control` endpoint documentation and
the `RaceControlMessages` ingestion model in [br-g/openf1](https://github.com/br-g/openf1).
No OpenF1 live feed, historical dataset, or Python source file is bundled in this
repository. The game implementation is an original, deterministic TypeScript model
that produces OpenF1-shaped local simulation messages.

OpenF1 is licensed under the
[Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/).
OpenF1 and the OpenF1 contributors are credited here as the schema reference. This
project's adaptations include local category mapping, fallback status messages, UI
priority metadata, and deterministic race-state integration.

## FastF1 timing-data model reference

The wet-weather strategy model in `src/simulation/ai-strategy.ts` was designed with
reference to FastF1's documented lap fields, including `Compound`, `TyreLife`, `Stint`,
`FreshTyre`, `PitInTime`, and `PitOutTime`. No FastF1 Python package or session dataset is
bundled or executed by the game. The strategy scoring and track-surface aggregation are
original TypeScript simulation logic.

[FastF1](https://github.com/theOehrly/Fast-F1) is provided under the MIT License:

MIT License

Copyright (c) 2026 Philipp Schäfer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
