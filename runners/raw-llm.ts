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

async function callLlm(question: Question, corpus: string): Promise<RunResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Stub mode — return empty answer for now. Real LLM mode unlocks when key arrives.
    return { id: question.id, answer: '(stub — no api key)', facts_used: [] };
  }
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();

  const sys = [
    'You are answering a question about a fictional person (Alex) based ONLY on the facts.jsonl shown.',
    'Each fact has an id, subject, predicate, object, t_valid, t_invalid, confidence.',
    'A fact is "true as of date D" iff t_valid <= D AND (t_invalid is null OR D < t_invalid).',
    'Return JSON: {"answer": "<short answer>", "facts_used": ["<id1>", "<id2>"]}.',
    'Cite fact ids you used. Be precise. If as_of_date is given, respect bi-temporal validity.',
  ].join(' ');

  const userMsg = [
    `# Facts (jsonl)`,
    corpus,
    '',
    `# Question`,
    question.question,
    question.as_of_date ? `As of date: ${question.as_of_date}` : '',
    '',
    'Respond with JSON only.',
  ].join('\n');

  const resp = await client.messages.create({
    model: process.env.PBB_MODEL ?? 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: sys,
    messages: [{ role: 'user', content: userMsg }],
  });

  let text = '';
  for (const b of resp.content) {
    if (b.type === 'text') text += b.text;
  }
  // strip code fences if present
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
  for (const q of questions) {
    const r = await callLlm(q, corpus);
    console.log(JSON.stringify(r));
  }
}

main();
