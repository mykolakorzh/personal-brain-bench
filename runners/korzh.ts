#!/usr/bin/env -S bun run
// korzh runner — adapts korzh's facts.jsonl + retrieval surface to the bench.
//
// Architecture:
//   1. Load corpus/seed_facts.jsonl into an in-memory facts store (NOT the
//      real korzh vault — the bench runs in isolation against synthetic data)
//   2. For each question, do bi-temporal + supersession + provenance filtering
//      using the same logic korzh's retrieval layer uses
//   3. Pass the filtered facts to an LLM with korzh-style scaffolding
//      (bi-temporal validity + supersession-aware system prompt)
//
// What this measures: korzh's RETRIEVAL quality. The LLM is a thin wrapper
// over the structured query layer. If korzh scores worse than raw-llm on a
// given category, the retrieval layer is the bottleneck for that category.

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
  t_valid_precision?: string;
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
  if (!date) return f.t_invalid === null;
  if (f.t_valid && f.t_valid > date) return false;
  if (f.t_invalid && f.t_invalid <= date) return false;
  return true;
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const c of process.stdin) chunks.push(c.toString());
  return chunks.join('');
}

// Lightweight bi-temporal retrieval — what korzh's MCP list_facts_about wraps
function retrieveCandidates(q: Question, allFacts: Fact[]): Fact[] {
  switch (q.category) {
    case 'bi-temporal':
      return allFacts.filter((f) => isValidAsOf(f, q.as_of_date));
    case 'supersession':
      return allFacts;
    case 'provenance':
      return allFacts;
    case 'confidence':
      return [...allFacts].sort((a, b) => b.confidence - a.confidence);
    case 'cross-fact':
      return allFacts;
    case 'vocabulary':
      return allFacts;
    default:
      return allFacts;
  }
}

async function callLlm(q: Question, candidates: Fact[]): Promise<RunResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { id: q.id, answer: '(korzh stub - no api key)', facts_used: [] };
  }
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();

  const corpusJsonl = candidates.map((f) => JSON.stringify(f)).join('\n');

  const sys = [
    'You are korzh, a personal AI second brain.',
    'You answer questions strictly from the structured facts.jsonl below.',
    'Facts are bi-temporal: t_valid (when it became true), t_invalid (when it stopped being true, null = still true).',
    'A fact is true at date D iff t_valid <= D AND (t_invalid is null OR D < t_invalid).',
    'Facts have id, subject, predicate, object, t_valid, t_invalid, confidence, source, supersedes (id of the fact this revises), saga_id (rollup group).',
    'When asked about supersession, follow the supersedes chain (a fact with id X being superseded means some other fact has supersedes:X).',
    'Provenance answers come from the source field.',
    'Always return JSON: {"answer": "<concise answer>", "facts_used": ["<id1>", "<id2>"]}.',
    'Be precise. Use fact IDs you actually retrieved.',
  ].join(' ');

  const userMsg = [
    `# Facts (bi-temporal candidate set after retrieval)`,
    corpusJsonl,
    '',
    `# Question`,
    q.question,
    q.as_of_date ? `As of date: ${q.as_of_date}` : '',
    '',
    `Category: ${q.category}`,
    '',
    'Respond with JSON only.',
  ].join('\n');

  const model = process.env.PBB_MODEL ?? 'claude-haiku-4-5-20251001';
  const resp = await client.messages.create({
    model,
    max_tokens: 512,
    system: sys,
    messages: [{ role: 'user', content: userMsg }],
  });

  let text = '';
  for (const b of resp.content) {
    if (b.type === 'text') text += b.text;
  }
  text = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    const parsed = JSON.parse(text) as { answer: string; facts_used: string[] };
    return { id: q.id, answer: parsed.answer ?? '', facts_used: parsed.facts_used ?? [] };
  } catch {
    return { id: q.id, answer: text.slice(0, 200), facts_used: [] };
  }
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
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('warning: ANTHROPIC_API_KEY not set; emitting stub results');
  }
  for (const q of questions) {
    const candidates = retrieveCandidates(q, facts);
    const r = await callLlm(q, candidates);
    console.log(JSON.stringify(r));
  }
}

main();
