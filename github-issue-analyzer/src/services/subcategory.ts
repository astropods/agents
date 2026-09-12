/**
 * Corpus-derived subcategory vocabulary.
 *
 * The fixed taxonomy in ./priority answers "what area", which misses
 * cross-cutting concerns like error handling or accessibility. Those terms
 * cannot be guessed up front, so they are derived from the ingested issue
 * titles once and persisted, then reused as a closed vocabulary. Re-deriving
 * every run would make subcategories incomparable between runs.
 */

import type { Session } from 'neo4j-driver';
import OpenAI from 'openai';
import { getDriver } from './neo4j';

export interface SubcategoryTerm {
  name: string;
  definition: string;
}

const MIN_TERMS = 10;
const MAX_TERMS = 24;

const VOCAB_SCHEMA = {
  type: 'object' as const,
  properties: {
    terms: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string' as const,
            description: 'kebab-case slug, 1-3 words',
          },
          definition: {
            type: 'string' as const,
            description: 'One line describing what belongs here',
          },
        },
        required: ['name', 'definition'] as const,
        additionalProperties: false,
      },
    },
  },
  required: ['terms'] as const,
  additionalProperties: false,
};

export async function loadVocabulary(session: Session): Promise<SubcategoryTerm[]> {
  const result = await session.run(
    'MATCH (s:Subcategory) RETURN s.name AS name, s.definition AS definition ORDER BY s.name',
  );
  return result.records.map((r) => ({
    name: r.get('name') as string,
    definition: (r.get('definition') as string) ?? '',
  }));
}

export async function saveVocabulary(
  session: Session,
  terms: SubcategoryTerm[],
  derivedAt: string,
): Promise<void> {
  await session.run('MATCH (s:Subcategory) DETACH DELETE s');
  for (const term of terms) {
    await session.run(
      `MERGE (s:Subcategory {name: $name})
       SET s.definition = $definition, s.derivedAt = $derivedAt`,
      { name: term.name, definition: term.definition, derivedAt },
    );
  }
}

async function fetchIssueTitles(session: Session): Promise<string[]> {
  const result = await session.run(
    `MATCH (i:Issue)
     OPTIONAL MATCH (i)-[:HAS_LABEL]->(l:Label)
     RETURN i.number AS number, i.title AS title, collect(l.name) AS labels
     ORDER BY number`,
  );
  return result.records.map((r) => {
    const labels = (r.get('labels') as string[]).filter(Boolean);
    const title = r.get('title') as string;
    return labels.length > 0 ? `${title}  [${labels.join(', ')}]` : title;
  });
}

export async function deriveVocabulary(titles: string[]): Promise<SubcategoryTerm[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `
Below are the titles of every issue in one repository, each followed by its
labels in brackets.

Propose between ${MIN_TERMS} and ${MAX_TERMS} subcategory terms that capture the
recurring concerns and work types actually present in this corpus. These sit
alongside a separate area taxonomy (frontend, backend, cli, infra, docs,
security, observability, tooling), so do NOT propose terms that merely restate
an area.

Good terms name a concern or a kind of work: feature-request, error-handling,
accessibility, performance, flaky-test, breaking-change, ux-polish.

Rules:
- Ground every term in the corpus below; do not invent concerns that are absent
- Each term must fit at least three issues
- kebab-case, 1-3 words
- Terms must be mutually distinguishable, not synonyms of each other

Issues (${titles.length}):
${titles.map((t) => `- ${t}`).join('\n')}
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You derive a compact, mutually exclusive vocabulary from a corpus. Ground every term in the supplied text.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'subcategory_vocabulary', schema: VOCAB_SCHEMA, strict: true },
    },
    temperature: 0.2,
  });

  const parsed = JSON.parse(completion.choices[0].message.content!) as {
    terms: SubcategoryTerm[];
  };
  return parsed.terms.slice(0, MAX_TERMS);
}

/**
 * Returns the persisted vocabulary, deriving and saving it first when absent.
 * Returns an empty list if the corpus is too small to derive from, which
 * leaves subcategory classification disabled rather than inventing terms.
 */
export async function ensureVocabulary(
  refresh: boolean,
  derivedAt: string,
): Promise<SubcategoryTerm[]> {
  const session = getDriver().session();
  try {
    if (!refresh) {
      const existing = await loadVocabulary(session);
      if (existing.length > 0) {
        console.log(`  Reusing ${existing.length} persisted subcategory terms`);
        return existing;
      }
    }

    const titles = await fetchIssueTitles(session);
    if (titles.length < MIN_TERMS) {
      console.warn(
        `  Corpus too small to derive subcategories (${titles.length} issues), skipping`,
      );
      return [];
    }

    console.log(`  Deriving subcategory vocabulary from ${titles.length} issue titles...`);
    const terms = await deriveVocabulary(titles);
    await saveVocabulary(session, terms, derivedAt);
    console.log(
      `  Derived ${terms.length} subcategory terms: ${terms.map((t) => t.name).join(', ')}`,
    );
    return terms;
  } finally {
    await session.close();
  }
}
