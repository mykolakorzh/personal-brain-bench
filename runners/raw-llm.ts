#!/usr/bin/env -S bun run
// raw-llm runner — baseline. Dumps the entire corpus into a Claude / GPT
// prompt and asks the question. No retrieval, no graph, no bi-temporal
// reasoning beyond what the LLM can do over plaintext JSONL.
//
// This is the "untrained baseline" — what you get if you bolt an LLM
// onto a markdown vault without any memory architecture.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... bun run runners/raw-llm.ts \
//     < questions/bi-temporal.jsonl > results/raw-llm-claude-haiku.json
//
// Output: one JSON object per line on stdout. Pipe through grader/strict.ts.

import { readFileSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

interface Question {
  id: string;
  question: string;
  as_of_date?: string;
  category?: string;
}

interface RunResult {
  id: string;
  answer: string;
  facts_used: string[];
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const c of process.stdin) chunks.push(c.toString());
  return chunks.join('');
}

function loadCorpus(): string {
  const factsPath = join(ROOT, 'corpus', 'seed_facts.jsonl');
  return readFileSync(factsPath, 'utf8');
}

function loadSagas(): string {
  const sagasPath = join(ROOT, 'corpus', 'sagas.jsonl');
  try { return readFileSync(sagasPath, 'utf8'); } catch { return ''; }
}

async function callLlm(question: Question, corpus: string, sagas: string): Promise<RunResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { id: question.id, answer: '(stub - no api key)', facts_used: [] };
  }
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();

  const sys = [
    'You are answering a question about a fictional person (Alex) based ONLY on the facts.jsonl shown.',
    'Each fact has an id (e.g. f_corpus_001), subject, predicate, object, t_valid, t_invalid, confidence, source, supersedes (id of the fact this revises), saga_id (rollup group).',
    'A fact is "true as of date D" iff t_valid <= D AND (t_invalid is null OR D < t_invalid).',
    'If asked "what did X originally decide before revising" — follow the supersedes pointer chain (find a fact whose id appears as another fact\'s supersedes).',
    'If asked about provenance, the source field is authoritative.',
    'Return JSON: {"answer": "<short answer>", "facts_used": ["<id1>", "<id2>"]}.',
    'facts_used MUST contain the fact ids you actually used. Be precise. If as_of_date is given, respect bi-temporal validity strictly.',
  ].join(' ');

  const userMsg = [
    `# Facts (jsonl)`,
    corpus,
    sagas ? '\n# Sagas (rollup summaries)\n' + sagas : '',
    '',
    `# Question`,
    question.question,
    question.as_of_date ? `As of date: ${question.as_of_date}` : '',
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
    return { id: question.id, answer: parsed.answer ?? '', facts_used: parsed.facts_used ?? [] };
  } catch {
    return { id: question.id, answer: text.slice(0, 200), facts_used: [] };
  }
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error('usage: bun run runners/raw-llm.ts < questions/<file>.jsonl');
    process.exit(2);
  }
  const questions: Question[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { questions.push(JSON.parse(line) as Question); } catch { /* skip */ }
  }
  const corpus = loadCorpus();
  const sagas = loadSagas();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('warning: ANTHROPIC_API_KEY not set; emitting stub results');
  }
  for (const q of questions) {
    const r = await callLlm(q, corpus, sagas);
    console.log(JSON.stringify(r));
  }
}

main();
