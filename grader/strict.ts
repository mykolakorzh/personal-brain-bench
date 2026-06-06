#!/usr/bin/env -S bun run
// Strict grader — compares the system's returned fact ids against the
// expected_facts set per question. Reports precision and recall.
//
// Usage:
//   bun run grader/strict.ts results/korzh-v0.2.1.json
//
// Result file format (one JSON object per question line, or a single JSON array):
//   { "id": "pbb-bi-001", "answer": "sf", "facts_used": ["f_corpus_001"] }

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

interface Question {
  id: string;
  category: string;
  question: string;
  expected_answer: string;
  expected_facts: string[];
  grading: 'exact' | 'contains' | 'semantic';
  as_of_date?: string;
}

interface RunResult {
  id: string;
  answer: string;
  facts_used: string[];
}

interface QuestionScore {
  id: string;
  category: string;
  expected_facts: string[];
  actual_facts: string[];
  precision: number; // |intersection| / |actual|
  recall: number;    // |intersection| / |expected|
  f1: number;
  grading: string;
}

function loadAllQuestions(): Map<string, Question> {
  const out = new Map<string, Question>();
  const dir = join(ROOT, 'questions');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const q = JSON.parse(line) as Question;
      out.set(q.id, q);
    }
  }
  return out;
}

function loadResults(path: string): RunResult[] {
  const raw = readFileSync(path, 'utf8').trim();
  if (raw.startsWith('[')) {
    return JSON.parse(raw) as RunResult[];
  }
  return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as RunResult);
}

function scoreFactSet(expected: string[], actual: string[]): { precision: number; recall: number; f1: number } {
  if (expected.length === 0 && actual.length === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  let hits = 0;
  for (const a of actualSet) if (expectedSet.has(a)) hits++;
  const precision = actualSet.size ? hits / actualSet.size : 0;
  const recall = expectedSet.size ? hits / expectedSet.size : 0;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function main() {
  const resultsPath = process.argv[2];
  if (!resultsPath) {
    console.error('usage: bun run grader/strict.ts <results.json>');
    process.exit(2);
  }
  if (!existsSync(resultsPath)) {
    console.error(`file not found: ${resultsPath}`);
    process.exit(2);
  }

  const questions = loadAllQuestions();
  const results = loadResults(resultsPath);
  const scores: QuestionScore[] = [];

  for (const r of results) {
    const q = questions.get(r.id);
    if (!q) {
      console.error(`skip: unknown question id ${r.id}`);
      continue;
    }
    // Strict grader only evaluates fact-id alignment. Semantic-graded
    // questions are still included but their facts-only scores are reported.
    const sub = scoreFactSet(q.expected_facts, r.facts_used);
    scores.push({
      id: q.id,
      category: q.category,
      expected_facts: q.expected_facts,
      actual_facts: r.facts_used,
      precision: sub.precision,
      recall: sub.recall,
      f1: sub.f1,
      grading: q.grading,
    });
  }

  // Aggregate
  const byCat = new Map<string, QuestionScore[]>();
  for (const s of scores) {
    if (!byCat.has(s.category)) byCat.set(s.category, []);
    byCat.get(s.category)!.push(s);
  }
  const totalF1 = scores.reduce((a, b) => a + b.f1, 0) / (scores.length || 1);

  console.log('# personal-brain-bench strict grade');
  console.log(`Results from: ${resultsPath}`);
  console.log(`Questions evaluated: ${scores.length} / ${questions.size}`);
  console.log(`Overall F1 (fact-id retrieval): ${(totalF1 * 100).toFixed(1)}%`);
  console.log('');
  console.log('## By category');
  console.log('');
  console.log('| Category | N | Precision | Recall | F1 |');
  console.log('|---|---|---|---|---|');
  for (const [cat, list] of byCat) {
    const p = list.reduce((a, b) => a + b.precision, 0) / list.length;
    const r = list.reduce((a, b) => a + b.recall, 0) / list.length;
    const f = list.reduce((a, b) => a + b.f1, 0) / list.length;
    console.log(`| ${cat} | ${list.length} | ${(p * 100).toFixed(1)}% | ${(r * 100).toFixed(1)}% | ${(f * 100).toFixed(1)}% |`);
  }
}

main();
