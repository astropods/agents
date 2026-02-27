/**
 * Neo4j read operations — fetches issue details from the knowledge graph.
 */

import { getDriver } from './neo4j';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbIssue {
  issueId: string;
  number: number;
  title: string;
  bodyText: string | null;
  createdAt: string;
  updatedAt: string;
  state: string;
  authorLogin: string | null;
  author: { login: string; name: string | null; company: string | null } | null;
}

export interface DbComment {
  commentId: string;
  bodyText: string | null;
  authorLogin?: string | null;
}

export interface DbIssueDetails {
  issue: DbIssue;
  labels: string[];
  comments: DbComment[];
  summary: { totalComments: number; totalLabels: number };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchIssueDetails(issueNumber: number): Promise<DbIssueDetails | null> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (i:Issue {number: $n})
       OPTIONAL MATCH (i)-[:HAS_LABEL]->(l:Label)
       OPTIONAL MATCH (i)-[:HAS_COMMENT]->(c:Comment)
       OPTIONAL MATCH (c)-[:AUTHORED_BY]->(ca:User)
       OPTIONAL MATCH (i)-[:AUTHORED_BY]->(ia:User)
       RETURN i, ia,
              collect(DISTINCT {name: l.name, description: l.description, color: l.color}) AS labels,
              collect(DISTINCT {
                commentId: c.commentId, bodyText: c.bodyText, createdAt: c.createdAt,
                authorLogin: c.authorLogin,
                author: CASE WHEN ca IS NOT NULL THEN {login: ca.login, name: ca.name, company: ca.company} ELSE null END
              }) AS comments`,
      { n: issueNumber },
    );

    if (result.records.length === 0) return null;

    const rec = result.records[0];
    const issue = rec.get('i');
    const issueAuthor = rec.get('ia');
    const labels = (rec.get('labels') as { name: string | null }[])
      .filter((l) => l.name !== null)
      .map((l) => l.name!);
    const comments = (rec.get('comments') as (DbComment & { createdAt?: string })[])
      .filter((c) => c.commentId !== null)
      .sort((a, b) => new Date(a.createdAt ?? '').getTime() - new Date(b.createdAt ?? '').getTime())
      .map((c) => ({ commentId: c.commentId, bodyText: c.bodyText, authorLogin: c.authorLogin }));

    const num = issue.properties.number;
    return {
      issue: {
        issueId: issue.properties.issueId,
        number: typeof num === 'object' && 'toNumber' in num ? num.toNumber() : num,
        title: issue.properties.title,
        bodyText: issue.properties.bodyText,
        createdAt: issue.properties.createdAt,
        updatedAt: issue.properties.updatedAt,
        state: issue.properties.state,
        authorLogin: issue.properties.authorLogin,
        author: issueAuthor
          ? { login: issueAuthor.properties.login, name: issueAuthor.properties.name, company: issueAuthor.properties.company }
          : null,
      },
      labels,
      comments,
      summary: { totalComments: comments.length, totalLabels: labels.length },
    };
  } finally {
    await session.close();
  }
}

export async function fetchMultipleIssueDetails(
  issueNumbers: number[],
): Promise<{ results: DbIssueDetails[]; errors: { issueNumber: number; error: string }[] }> {
  const results: DbIssueDetails[] = [];
  const errors: { issueNumber: number; error: string }[] = [];

  for (const num of issueNumbers) {
    try {
      const details = await fetchIssueDetails(num);
      if (details) {
        results.push(details);
      } else {
        errors.push({ issueNumber: num, error: 'Not found' });
      }
    } catch (err: unknown) {
      errors.push({ issueNumber: num, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { results, errors };
}

