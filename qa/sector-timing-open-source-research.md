# Qualifying sector timing research

Research date: 2026-07-19

No external implementation was copied into Project Pitwall. The repositories below were used to validate data-flow concepts, terminology, and edge cases before a new TypeScript implementation was written for the existing weekend engine.

## Nicxe/f1_sensor

- Repository: https://github.com/Nicxe/f1_sensor
- Relevant files:
  - `custom_components/f1_sensor/tests/test_sector_times.py`
  - `custom_components/f1_sensor/tests/test_qualifying_segments.py`
  - `custom_components/f1_sensor/www/f1-sensor-live-data-card/f1-sensor-live-data-card.js`
- License: MIT.
- Stack: Python/Home Assistant coordinator plus a bundled JavaScript live-data web component; React/Docusaurus is used for documentation.
- Principles reviewed:
  - keep current sectors grouped by driver and lap;
  - clear stale current sectors at a new lap while retaining personal bests;
  - preserve best sectors when SC begins but ignore SC/VSC sector updates;
  - reset segment bests when `SessionPart` changes from Q1 to Q2 or Q2 to Q3;
  - carry explicit `OverallFastest` and `PersonalFastest` flags into the card and keep previous-lap values visually neutral.

## theOehrly/Fast-F1

- Repository: https://github.com/theOehrly/Fast-F1
- Relevant files and docs:
  - `fastf1/core.py`
  - https://docs.fastf1.dev/core.html
- License: MIT.
- Stack: Python and pandas DataFrames.
- Principles reviewed:
  - store lap time, three sector times, pit-in/out markers, track status, `IsPersonalBest`, `Deleted`, and `DeletedReason` on each lap row;
  - split qualifying data into Q1/Q2/Q3 before calculating classifications;
  - exclude deleted laps from qualifying best-lap calculation;
  - treat in/out laps and SC/VSC-affected laps as unsuitable for accurate competitive timing;
  - verify that sector sums agree with lap time within a small millisecond tolerance.

## br-g/openf1

- Repository: https://github.com/br-g/openf1
- Relevant files and docs:
  - `src/openf1/services/ingestor_livetiming/core/processing/collections/laps.py`
  - https://openf1.org/docs/
- License finding: the repository `LICENSE` is CC BY-NC-SA 4.0, GitHub reports `NOASSERTION`, while `pyproject.toml` still declares MIT. Because those signals conflict and the repository license is non-commercial/share-alike, no OpenF1 source code was copied.
- Stack: Python ingestion/query services with MongoDB-backed data.
- Principles reviewed only:
  - identify a lap by session, driver, and lap number;
  - store S1/S2/S3 and mini-sector status arrays independently;
  - tolerate late/out-of-order sector messages;
  - infer a lap duration from all three sectors and round to milliseconds;
  - explicitly mark pit-out laps.

## adn8naiagent/F1ReplayTiming

- Repository: https://github.com/adn8naiagent/F1ReplayTiming
- Relevant file: `frontend/src/lib/lapTiming.tsx`.
- License: no license was declared in GitHub repository metadata, so the code is not reusable.
- Stack: TypeScript, React, Next.js, Tailwind and a Python backend.
- Principle reviewed only: centralize lap/sector presentation logic so the timing tower and other qualifying surfaces cannot disagree about colors.

## subinium/awesome-f1

- Repository: https://github.com/subinium/awesome-f1
- License finding: the repository is a curated link list and explicitly says every linked project retains its own terms. GitHub does not report a top-level SPDX license.
- Use: discovery only, including FastF1, OpenF1, f1_sensor and replay/live-timing dashboard references.

## Project Pitwall implementation decision

- New comparison logic lives in `src/simulation/sector-timing.ts` and is integrated directly into `src/simulation/weekend.ts`.
- A sector is classified before any personal/session record is mutated.
- Competitive sector values remain provisional until the lap is complete and valid.
- Track-limit invalidation changes recorded cells to `INVALID` and leaves committed records untouched.
- A 0.001-second tolerance prevents ties from replacing the existing holder.
- Each new Q segment creates a fresh live sector record set; completed Q1/Q2/Q3 best laps remain preserved in weekend results.
- The comparison types/functions are sector-count agnostic in behavior and can be reused by a future mini-sector layer.
