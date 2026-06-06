# Scoreboard

Public scores for personal-brain-bench. Add your system via PR to `results/`.

> **v0.1 (2026-06-06):** no live scores yet. Runners ship as stubs pending API-key-driven runs. First public scores expected with v0.2 (2026-07).

## How to add a row

1. Run your runner against `questions/*.jsonl`, write output to `results/<system>-<version>.json`
2. Run `bun run grade results/<system>-<version>.json` and append the markdown table output
3. Open a PR with both files

## v0.1 expected categories (when scores arrive)

| System | bi-temporal | supersession | provenance | confidence | cross-fact | vocabulary | F1 overall |
|---|---|---|---|---|---|---|---|
| _baseline (raw-llm Claude Haiku)_ | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| _korzh v0.2.1_ | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## v1.0 target

By 2026-Q4:
- 3+ vendor systems scored
- 200 public questions + 50 held-out
- LLM-judge rubric peer-reviewed
- Methodology paper on arXiv
