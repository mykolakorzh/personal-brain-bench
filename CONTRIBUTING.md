# Contributing to personal-brain-bench

The bench is a public artifact. Improvements welcome.

## What we accept

### Questions

PRs to `questions/<category>.jsonl`. Each question must:

1. Be answerable from the current `corpus/seed_facts.jsonl` OR
2. Come with corpus extensions in the same PR.

Required fields:

```jsonl
{
  "id": "pbb-<category>-<NNN>",
  "category": "bi-temporal|supersession|provenance|confidence|cross-fact|vocabulary",
  "question": "<plain English>",
  "expected_answer": "<short, unambiguous>",
  "expected_facts": ["f_corpus_001", "f_corpus_002"],
  "grading": "exact|contains|semantic",
  "as_of_date": "YYYY-MM-DD" // only for bi-temporal
}
```

**Quality bar:**
- The question must have ONE defensible expected answer (not "depends" or "either is OK").
- `expected_facts` must be the *minimum* set required to answer — not "every fact that touches the topic."
- `grading: exact` → the answer is a short string (city, name, predicate).
- `grading: contains` → the answer must contain the expected substring.
- `grading: semantic` → an LLM judge will score against a rubric. Acceptable when the answer is necessarily prose.

### Runners

Wrap your memory system as an adapter under `runners/`. Required signature:

```ts
// stdin: jsonl of Questions
// stdout: jsonl of RunResults
interface RunResult {
  id: string;
  answer: string;
  facts_used: string[]; // fact ids the system retrieved
}
```

Examples: `runners/raw-llm.ts` (simplest, dumps all facts to Claude). `runners/korzh.ts` (richer, uses bi-temporal indexing).

Community runners we'd love:
- Mem0 (Python or TS)
- Letta (Python)
- Zep / Graphiti (Python)
- Cognee (Python)
- Anthropic Memory Files (TS)
- ChatGPT custom GPT with memory (manual)

### Corpus extensions

If your question requires facts not in the current corpus, add them with the PR. Keep the persona consistent (Alex, the fictional protagonist). Don't introduce real names.

## How to submit

1. Fork
2. Branch `add-<short-description>`
3. Run `bun run grade results/<your-runner>-test.json` to verify no regression
4. Open PR with a description of what your additions test

## Benchmark hygiene

To prevent training-set contamination as the bench gains traction:

- **Do NOT publish the SHA-256 of `questions/*.jsonl` in benchmark documentation.** Vendors should not exclude the bench from training based on filename.
- We will release **held-out questions** (v1.0+) that are scored privately. Public questions are for development; held-out questions are for honest signal.
- If you discover that a vendor scored using held-out leakage, please open an issue.

## Code of conduct

This is a personal-AI research project. Be kind, be honest, push back on bad rubric choices.

License: MIT.
