#!/usr/bin/env -S bun run
// korzh runner — adapts korzh's facts.jsonl + retrieval surface to the bench.
//
// What this MEASURES (and what it does NOT):
//   This runner pre-filters facts per question category using the same
//   structured-query logic korzh's MCP list_facts_about wraps. The LLM is
//   given ONLY the filtered candidate set, not the full corpus. By comparing
//   korzh.ts F1 vs raw-llm.ts F1, you see what korzh's retrieval *contributes
//   above and beyond what a smart LLM can do over the raw corpus*.
//
// Honest caveats:
//   - At 30-fact corpus size this differential is small (both runners receive
//     similar contexts). The retrieval architecture only starts to matter
//     when the corpus exceeds the LLM context window — see bench README.
//   - For the "vocabulary" category, no retrieval architecture can help —
//     the question grades knowledge that isn't in the corpus. Both runners
//     score on prompt fluency for vocabulary questions.
//
// History:
//   - v0.1.0 (2026-06-06): retrieveCandidates was a no-op for most categories
//     ("returned allFacts"), making this indistinguishable from raw-llm. Fixed
//     in v0.1.1 to actually implement per-category retrieval.

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

const MAX_FACTS_TO_LLM = 60; // hard cap — past this the LLM context costs spike + signal degrades

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

// Build subject/object indices so per-question retrieval is fast even at 1000s of facts.
function buildIndex(facts: Fact[]) {
  const byId = new Map<string, Fact>();
  const bySubject = new Map<string, Fact[]>();
  const byObject = new Map<string, Fact[]>();
  const byPredicate = new Map<string, Fact[]>();
  for (const f of facts) {
    byId.set(f.id, f);
    if (!bySubject.has(f.subject)) bySubject.set(f.subject, []);
    bySubject.get(f.subject)!.push(f);
    if (!byObject.has(f.object)) byObject.set(f.object, []);
    byObject.get(f.object)!.push(f);
    if (!byPredicate.has(f.predicate)) byPredicate.set(f.predicate, []);
    byPredicate.get(f.predicate)!.push(f);
  }
  return { byId, bySubject, byObject, byPredicate };
}

type Idx = ReturnType<typeof buildIndex>;

// Identify subjects/objects mentioned in question text by lowercase substring of slug-tail.
// Crude — a real retrieval layer uses gbrain BM25 — but for the synthetic corpus this is sufficient.
function entitiesMentionedIn(question: string, idx: Idx): Set<string> {
  const q = question.toLowerCase();
  const hits = new Set<string>();
  for (const key of [...idx.bySubject.keys(), ...idx.byObject.keys()]) {
    const tail = key.split('/').pop() ?? '';
    if (tail.length < 3) continue;
    if (q.includes(tail.toLowerCase())) hits.add(key);
  }
  return hits;
}

// Real per-category retrieval. Each branch should produce the SMALLEST candidate
// set that still contains the expected_facts for the question. The LLM then does
// the final reasoning over a focused context, not the full corpus.
function retrieveCandidates(q: Question, allFacts: Fact[], idx: Idx): Fact[] {
  const mentioned = entitiesMentionedIn(q.question, idx);

  // Helper: union of all facts touching any mentioned entity (subject OR object)
  const facetsByEntity = (): Fact[] => {
    if (mentioned.size === 0) return [];
    const seen = new Set<string>();
    const out: Fact[] = [];
    for (const e of mentioned) {
      for (const f of [...(idx.bySubject.get(e) ?? []), ...(idx.byObject.get(e) ?? [])]) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        out.push(f);
      }
    }
    return out;
  };

  switch (q.category) {
    case 'bi-temporal': {
      // Per as_of_date validity + restrict to facts touching the question's entities
      const validAtDate = allFacts.filter((f) => isValidAsOf(f, q.as_of_date));
      const eFacts = facetsByEntity();
      if (eFacts.length > 0) {
        const eIds = new Set(eFacts.map(f => f.id));
        return validAtDate.filter(f => eIds.has(f.id));
      }
      return validAtDate;
    }
    case 'supersession': {
      // For each entity in question, walk supersedes chains: include the fact + ALL
      // facts it supersedes (and that supersede it). This is the value-add over raw-llm.
      const eFacts = facetsByEntity();
      if (eFacts.length === 0) {
        // Fallback: surface every fact that participates in a supersedes chain
        return allFacts.filter(f => f.supersedes || allFacts.some(o => o.supersedes === f.id));
      }
      const chain = new Set<string>();
      for (const f of eFacts) chain.add(f.id);
      // Walk forward (find facts that supersede each chain member)
      let frontier = [...chain];
      while (frontier.length) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const f of allFacts) {
            if (f.supersedes === id && !chain.has(f.id)) {
              chain.add(f.id);
              next.push(f.id);
            }
          }
        }
        frontier = next;
      }
      // Walk backward (find facts each chain member supersedes)
      frontier = [...chain];
      while (frontier.length) {
        const next: string[] = [];
        for (const id of frontier) {
          const f = idx.byId.get(id);
          if (f?.supersedes && !chain.has(f.supersedes)) {
            chain.add(f.supersedes);
            next.push(f.supersedes);
          }
        }
        frontier = next;
      }
      return allFacts.filter(f => chain.has(f.id));
    }
    case 'provenance': {
      // Source-keyed retrieval: facts touching mentioned entities + sources surfacing them
      const eFacts = facetsByEntity();
      if (eFacts.length === 0) return allFacts;
      // Include ALL facts sharing a source with any entity-fact (provenance trail)
      const sources = new Set(eFacts.map(f => f.source));
      const out = new Set(eFacts.map(f => f.id));
      for (const f of allFacts) if (sources.has(f.source)) out.add(f.id);
      return allFacts.filter(f => out.has(f.id));
    }
    case 'confidence': {
      // Facts touching mentioned entities, sorted desc-by-confidence
      const eFacts = facetsByEntity();
      const pool = eFacts.length > 0 ? eFacts : allFacts;
      return [...pool].sort((a, b) => b.confidence - a.confidence);
    }
    case 'cross-fact': {
      // Graph traversal: 1-hop expansion from entities mentioned in question
      const eFacts = facetsByEntity();
      if (eFacts.length === 0) return allFacts;
      // Collect neighbors via predicates linking subjects to objects
      const seedEntities = new Set<string>(mentioned);
      const neighbors = new Set<string>(seedEntities);
      for (const f of eFacts) {
        if (seedEntities.has(f.subject)) neighbors.add(f.object);
        if (seedEntities.has(f.object)) neighbors.add(f.subject);
      }
      const result: Fact[] = [];
      const seen = new Set<string>();
      for (const f of allFacts) {
        if ((neighbors.has(f.subject) || neighbors.has(f.object)) && !seen.has(f.id)) {
          seen.add(f.id);
          result.push(f);
        }
      }
      return result;
    }
    case 'vocabulary':
      // No retrieval can help here — the question grades vocabulary discipline that
      // isn't in the corpus. Pass an empty set so the LLM is forced to score on
      // intrinsic predicate-knowledge rather than corpus search. Documented in README.
      return [];
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

  // Cap context — preserves signal at small corpora and prevents context blow-up at scale
  const capped = candidates.slice(0, MAX_FACTS_TO_LLM);
  const truncated = candidates.length > MAX_FACTS_TO_LLM;
  const corpusJsonl = capped.map((f) => JSON.stringify(f)).join('\n');

  const sys = [
    'You are korzh, a personal AI second brain.',
    'You answer questions strictly from the PRE-RETRIEVED facts below.',
    'Facts are bi-temporal: t_valid (when it became true), t_invalid (when it stopped being true, null = still true).',
    'A fact is true at date D iff t_valid <= D AND (t_invalid is null OR D < t_invalid).',
    'Facts have id, subject, predicate, object, t_valid, t_invalid, confidence, source, supersedes (id of the fact this revises), saga_id (rollup group).',
    'When asked about supersession, follow the supersedes chain (a fact with id X being superseded means some other fact has supersedes:X).',
    'Provenance answers come from the source field.',
    'Always return JSON: {"answer": "<concise answer>", "facts_used": ["<id1>", "<id2>"]}.',
    'Be precise. Use fact IDs you actually retrieved.',
    truncated ? '(NOTE: candidate set was truncated to fit context; some matches may be missing.)' : '',
  ].filter(Boolean).join(' ');

  const userMsg = [
    `# Facts (pre-filtered candidate set after retrieval)`,
    corpusJsonl || '(empty — retrieval returned no candidates for this category)',
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
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) text = fenceMatch[1];
  text = text.trim();
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
  const idx = buildIndex(facts);
  const questions: Question[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { questions.push(JSON.parse(line) as Question); } catch { /* skip */ }
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('warning: ANTHROPIC_API_KEY not set; emitting stub results');
  }
  for (const q of questions) {
    const candidates = retrieveCandidates(q, facts, idx);
    const r = await callLlm(q, candidates);
    console.log(JSON.stringify(r));
  }
}

main();
