#!/usr/bin/env -S bun run
// korzh runner — adapts korzh's facts.jsonl + retrieval surface to the bench.
//
// Wires:
//   - Load corpus/seed_facts.jsonl into a transient facts.jsonl-like store
//     (this runner DOESN'T touch the real korzh vault — it builds an
//     independent in-memory facts store for the benchmark)
//   - For each question, runs the same bi-temporal filtering + supersession
//     + provenance + confidence logic korzh uses, then either:
//       - returns the matching fact ids directly (for grading=exact / contains)
//       - asks an LLM with korzh-style scaffolding (for grading=semantic)
//
// v0.1 ships a STUB that returns empty results. Real implementation lands
// when the architectural shift is verified live against the API key.
//
// Usage:
//   bun run runners/korzh.ts < questions/bi-temporal.jsonl > results/korzh-v0.2.1.json

import { readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

interface Fact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  t_valid: string | null;
  t_invalid: string | null;
  confidence: number;
  source: string;
  supersedes?: string | null;
  saga_id?: string | null;
}

interface Question {
  id: string;
  question: string;
  as_of_date?: string;
  category: string;
}

interface RunResult {
  id: string;
  answer: string;
  facts_used: string[];
}

function loadCorpus(): Fact[] {
  const factsPath = join(ROOT, 'corpus', 'seed_facts.jsonl');
  const out: Fact[] = [];
  for (const line of readFileSync(factsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as Fact); } catch { /* skip */ }
  }
  return out;
}

function isValidAsOf(f: Fact, date: string | undefined): boolean {
  if (!date) return f.t_invalid === null; // "current truth"
  if (f.t_valid && f.t_valid > date) return false;
  if (f.t_invalid && f.t_invalid <= date) return false;
  return true;
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const c of process.stdin) chunks.push(c.toString());
  return chunks.join('');
}

function answerWithFacts(_q: Question, _facts: Fact[]): RunResult {
  // v0.1 stub: return empty. The real korzh runner needs the live korzh-api
  // running with the seeded corpus + the API key for LLM-driven question
  // answering. Phase 2 of pbb development.
  return { id: _q.id, answer: '(korzh runner stub — v0.1)', facts_used: [] };
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error('usage: bun run runners/korzh.ts < questions/<file>.jsonl');
    process.exit(2);
  }
  const facts = loadCorpus();
  const questions: Question[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { questions.push(JSON.parse(line) as Question); } catch { /* skip */ }
  }
  for (const q of questions) {
    const candidates = facts.filter((f) => isValidAsOf(f, q.as_of_date));
    const result = answerWithFacts(q, candidates);
    console.log(JSON.stringify(result));
  }
}

main();
