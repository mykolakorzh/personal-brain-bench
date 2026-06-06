# personal-brain-bench

A public benchmark for personal-AI memory systems. Measures what LoCoMo doesn't: **bi-temporal queries, supersession-aware retrieval, provenance tracking, and confidence-aware answers** on personal-life facts that evolve over years.

> v0.1 (2026-06-06). Authored by [Mykola Korzh](https://github.com/mykolakorzh). Open for contributions, community runners, and adversarial questions.

---

## Why this benchmark exists

The 2026 personal-AI category has three production-grade memory systems — [Mem0](https://mem0.ai), [Letta](https://letta.com), [Zep / Graphiti](https://www.getzep.com) — plus Anthropic's own [Memory Files](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) and OpenAI's ChatGPT Atlas memory. Every one of them benchmarks on **agent dialogue** (LoCoMo, LongMemEval, BEAM): "can the agent remember what was said in a long conversation?"

That's not what a *personal* second brain does.

A personal brain answers questions like:

- *"What did I believe about X on Jan 15?"* (bi-temporal — fact_validity_at(date))
- *"When did I last promise Mom anything?"* (recency on a typed predicate)
- *"Which decisions have I revised this year?"* (supersession trail)
- *"Where did I first learn about Y?"* (provenance, first-source)
- *"What's the most uncertain thing I know about Garry?"* (confidence-aware ranking)
- *"Show me everyone who advances goal/income"* (graph traversal)

None of these are captured by LoCoMo. None of the existing benchmarks evaluate them. This means:

1. **There's no public scoreboard** for personal-AI memory quality. Vendors can claim "industry-leading" without anyone able to verify.
2. **The architecture choices that matter for personal AI** — bi-temporal vs single-timestamp, supersession vs overwrite, structured vs unstructured — are invisible in the published evals.
3. **A new vendor** has no quick way to demonstrate quality.

personal-brain-bench fills that gap.

## What this measures (six categories)

| Category | What it tests | Example question |
|---|---|---|
| **bi-temporal** | The system understands `t_valid` / `t_invalid` and can answer "as of date X" | "What was Alex's employer on 2024-03-15?" |
| **supersession** | The system tracks `supersedes` pointers and can return prior beliefs | "What did Alex originally decide about the laptop, before revising?" |
| **provenance** | The system knows which source produced which fact | "Where did Alex first hear about Karpathy's LLM Wiki?" |
| **confidence** | The system ranks by confidence + flags uncertainty | "What's the most uncertain fact Alex holds about Jordan?" |
| **cross-fact** | The system can traverse the graph to combine facts | "Which goals does the notebook-app project advance?" |
| **vocabulary** | The system respects controlled-vocabulary distinctions | "Is `created` synonymous with `builds`? Why or why not?" |

## How it works (the methodology)

### 1. Seed corpus

The bench ships with a **fictional vault** under `corpus/`: ~30 facts about a fictional person Alex, their friends/family, their projects. Bi-temporal lifecycle (Alex moved cities, changed jobs, revised goals). Multiple sources per fact. Mixed confidence.

All systems start from the same seed. **No vendor-specific corpus advantage.**

### 2. Questions

200 questions (50 in v0.1) under `questions/<category>.jsonl`. Each row:

```jsonl
{
  "id": "pbb-bi-temporal-001",
  "category": "bi-temporal",
  "question": "What company employed Alex on 2024-03-15?",
  "expected_answer": "dayjob",
  "expected_facts": ["f_<id1>"],
  "as_of_date": "2024-03-15",
  "grading": "exact"
}
```

### 3. Runners

Each system implements an adapter under `runners/`. The adapter:
- Ingests the seed corpus (one-time per benchmark run)
- Receives a question + optional `as_of_date` parameter
- Returns: `{ answer: string, facts_used: string[] }`

v0.1 ships:
- `runners/korzh.ts` — adapter for [korzh](https://github.com/mykolakorzh/cortex)
- `runners/raw-llm.ts` — baseline: dump all facts into Claude / GPT context

Community welcome: Mem0, Letta, Zep, custom systems. PRs accepted.

### 4. Grader

Two grading modes per question:

- **strict**: compare `expected_facts` (set of fact ids retrieved). Precision + recall.
- **semantic**: LLM-judge `expected_answer` vs actual answer. Rubric-driven, scored 0-100.

Results land in `results/<system>-<version>.json` and aggregate to a scoreboard.

### 5. Scoreboard

A simple Markdown table in `results/SCOREBOARD.md`, updated with each run. Highest score = nothing other than what the rubric measures. Honest signal.

## What this is NOT

- **Not a marketing tool for korzh.** korzh is one of many runners. The bench is the artifact. If korzh scores low, the bench publishes that.
- **Not a substitute for LoCoMo or LongMemEval.** Personal-AI is a different shape than agent-dialogue memory. Both benchmarks should be cited.
- **Not closed.** Questions are open; corpus is open; rubric is open. Anyone can rerun, fork, or extend.
- **Not a leaderboard chase.** The questions exist to surface architecture choices, not to be optimized against. Benchmark hacking via memorization is detectable (we publish question hashes that vendors should NOT see at training time — see `CONTRIBUTING.md`).

## v0.1 scope

This first release is a **proof-of-concept**, not a complete benchmark:

- ✅ Methodology + category definitions
- ✅ 30-fact seed corpus
- ✅ ~40 questions across 6 categories (will grow to 200 by v1.0)
- ✅ Strict grader (machine-checkable)
- ⏳ Semantic grader scaffold (needs LLM API key to run)
- ⏳ Live korzh runner (waits for korzh API key unlock)
- ⏳ Community runners (Mem0, Letta, Zep) — PR welcome

By v1.0 (target 2026-Q4): 200 questions, scored runs from 3+ vendor systems, peer-reviewed methodology.

## How to run

```bash
# Clone
git clone https://github.com/mykolakorzh/personal-brain-bench.git
cd personal-brain-bench

# Install (bun, since most runners are TS)
bun install

# Run a single runner against all questions
bun run runners/korzh.ts < questions/*.jsonl > results/korzh-latest.json

# Or grade an existing result
bun run grader/strict.ts results/korzh-latest.json
```

Full docs in `docs/RUN.md`.

## Contributing

We need:

- **Questions** — submit via PR to `questions/<category>.jsonl`. Must be answerable from the seed corpus or extend it.
- **Runners** — wrap your memory system as a thin adapter. See `runners/raw-llm.ts` as the simplest example.
- **Rubric feedback** — the semantic-grading rubric will evolve. Push back on it.

See `CONTRIBUTING.md` for details.

## Citation

If you use this benchmark, please cite:

```bibtex
@misc{korzh2026personalbrainbench,
  title={personal-brain-bench: A benchmark for bi-temporal, provenance-aware personal-AI memory systems},
  author={Korzh, Mykola},
  year={2026},
  howpublished={\url{https://github.com/mykolakorzh/personal-brain-bench}}
}
```

## License

MIT. Use it, fork it, extend it. Build a better benchmark — that's the point.

---

*"Whoever defines the benchmark defines the category." — strategy doc 2026-06-04.*
