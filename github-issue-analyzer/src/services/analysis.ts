/**
 * Analysis ingestion — stores OpenAI analysis results back into Neo4j.
 *
 * Analysis nodes: Solution, Workaround, Competitor, Category, Keyword
 * Relationships: HAS_SOLUTION, HAS_WORKAROUND, MENTIONS_COMPETITOR,
 *                BELONGS_TO_CATEGORY, HAS_KEYWORD
 */

import type { Session } from 'neo4j-driver';
import { getDriver } from './neo4j';
import type { IssueAnalysis, SolutionAnalysis, WorkaroundAnalysis, CompetitorAnalysis } from './openai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalysisData {
  issueNumber: number;
  title?: string;
  analysis: IssueAnalysis | null;
}

interface AnalysisStats {
  solutions: number;
  workarounds: number;
  competitors: number;
  categories: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearExistingAnalysis(session: Session, issueNumber: number): Promise<void> {
  // Delete solutions/workarounds and their keywords
  await session.run(
    `MATCH (i:Issue {number: $n})
     OPTIONAL MATCH (i)-[:HAS_SOLUTION]->(s:Solution)
     OPTIONAL MATCH (s)-[:HAS_KEYWORD]->(sk:Keyword)
     DETACH DELETE s, sk
     WITH i
     OPTIONAL MATCH (i)-[:HAS_WORKAROUND]->(w:Workaround)
     OPTIONAL MATCH (w)-[:HAS_KEYWORD]->(wk:Keyword)
     DETACH DELETE w, wk
     WITH i
     OPTIONAL MATCH (i)-[:HAS_COMMENT]->(c:Comment)
     OPTIONAL MATCH (c)-[:HAS_SOLUTION]->(cs:Solution)
     OPTIONAL MATCH (cs)-[:HAS_KEYWORD]->(csk:Keyword)
     DETACH DELETE cs, csk
     WITH i, c
     OPTIONAL MATCH (c)-[:HAS_WORKAROUND]->(cw:Workaround)
     OPTIONAL MATCH (cw)-[:HAS_KEYWORD]->(cwk:Keyword)
     DETACH DELETE cw, cwk`,
    { n: issueNumber },
  );

  // Clean up orphaned competitors/categories
  await session.run(
    `MATCH (i:Issue {number: $n})
     OPTIONAL MATCH (i)-[r1:MENTIONS_COMPETITOR]->(comp:Competitor) DELETE r1
     WITH i
     OPTIONAL MATCH (i)-[r2:BELONGS_TO_CATEGORY]->(cat:Category) DELETE r2
     WITH i
     MATCH (comp:Competitor) WHERE NOT (comp)<-[:MENTIONS_COMPETITOR]-() DELETE comp
     WITH i
     MATCH (cat:Category) WHERE NOT (cat)<-[:BELONGS_TO_CATEGORY]-() DELETE cat`,
    { n: issueNumber },
  );
}

async function ingestSolution(session: Session, solution: SolutionAnalysis): Promise<void> {
  await session.run(
    `MERGE (s:Solution {solutionText: $text})
     SET s.embedding = []
     WITH s
     MATCH (c:Comment {commentId: $source})
     MERGE (c)-[:HAS_SOLUTION]->(s)
     WITH s, c
     MATCH (c)<-[:HAS_COMMENT]-(i:Issue)
     MERGE (i)-[:HAS_SOLUTION]->(s)
     WITH s
     UNWIND $keywords AS kw
     MERGE (k:Keyword {name: kw})
     MERGE (s)-[:HAS_KEYWORD]->(k)`,
    { text: solution.solutionText, source: solution.source, keywords: solution.keywords ?? [] },
  );
}

async function ingestWorkaround(session: Session, workaround: WorkaroundAnalysis): Promise<void> {
  await session.run(
    `MERGE (w:Workaround {workaroundText: $text})
     SET w.embedding = []
     WITH w
     MATCH (c:Comment {commentId: $source})
     MERGE (c)-[:HAS_WORKAROUND]->(w)
     WITH w, c
     MATCH (c)<-[:HAS_COMMENT]-(i:Issue)
     MERGE (i)-[:HAS_WORKAROUND]->(w)
     WITH w
     UNWIND $keywords AS kw
     MERGE (k:Keyword {name: kw})
     MERGE (w)-[:HAS_KEYWORD]->(k)`,
    { text: workaround.workaroundText, source: workaround.source, keywords: workaround.keywords ?? [] },
  );
}

async function ingestCompetitors(session: Session, competitors: CompetitorAnalysis[], issueNumber: number): Promise<number> {
  if (competitors.length === 0) return 0;

  const result = await session.run(
    `MATCH (i:Issue {number: $n})
     UNWIND $competitors AS comp
     MERGE (c:Competitor {name: comp.name})
     MERGE (i)-[:MENTIONS_COMPETITOR]->(c)
     WITH c, comp
     MATCH (cmt:Comment {commentId: comp.source})
     MERGE (cmt)-[:MENTIONS_COMPETITOR]->(c)
     RETURN count(c) AS cnt`,
    { n: issueNumber, competitors },
  );
  return result.records[0]?.get('cnt')?.toNumber?.() ?? 0;
}

async function ingestCategories(session: Session, categories: string[], issueNumber: number): Promise<number> {
  if (categories.length === 0) return 0;

  const result = await session.run(
    `MATCH (i:Issue {number: $n})
     UNWIND $categories AS name
     MERGE (cat:Category {name: name})
     MERGE (i)-[:BELONGS_TO_CATEGORY]->(cat)
     RETURN count(cat) AS cnt`,
    { n: issueNumber, categories },
  );
  return result.records[0]?.get('cnt')?.toNumber?.() ?? 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function processIssueAnalysis(session: Session, data: AnalysisData): Promise<AnalysisStats> {
  const { issueNumber, analysis } = data;
  if (!analysis) return { solutions: 0, workarounds: 0, competitors: 0, categories: 0 };

  console.log(`  Clearing previous analysis for issue #${issueNumber}...`);
  await clearExistingAnalysis(session, issueNumber);

  const stats: AnalysisStats = { solutions: 0, workarounds: 0, competitors: 0, categories: 0 };

  for (const s of analysis.solutions ?? []) {
    await ingestSolution(session, s);
    stats.solutions++;
  }
  for (const w of analysis.workarounds ?? []) {
    await ingestWorkaround(session, w);
    stats.workarounds++;
  }
  stats.competitors = await ingestCompetitors(session, analysis.competitors ?? [], issueNumber);
  stats.categories = await ingestCategories(session, analysis.categories ?? [], issueNumber);

  return stats;
}

export async function ingestAnalysisResults(analysisData: AnalysisData[]): Promise<{
  results: { issueNumber: number; stats: AnalysisStats }[];
  errors: { issueNumber: number; error: string }[];
}> {
  const session = getDriver().session();
  const results: { issueNumber: number; stats: AnalysisStats }[] = [];
  const errors: { issueNumber: number; error: string }[] = [];

  try {
    for (let i = 0; i < analysisData.length; i++) {
      const data = analysisData[i];
      try {
        console.log(`[${i + 1}/${analysisData.length}] Ingesting analysis for issue #${data.issueNumber}...`);
        const stats = await processIssueAnalysis(session, data);
        results.push({ issueNumber: data.issueNumber, stats });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Failed analysis for #${data.issueNumber}: ${msg}`);
        errors.push({ issueNumber: data.issueNumber, error: msg });
      }
    }
  } finally {
    await session.close();
  }

  return { results, errors };
}
