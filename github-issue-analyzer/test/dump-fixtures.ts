/**
 * Dump Neo4j fixture data from a running dev instance.
 *
 * Uses the Neo4j HTTP transactional API (port 7474, exposed by ast dev)
 * so no Bolt port forwarding is needed.
 *
 * Usage:
 *   bun test/dump-fixtures.ts                                 # while ast dev is running
 *   NEO4J_HTTP_URL=http://localhost:7474 bun test/dump-fixtures.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const ISSUE_LIMIT = 50;
const OUTPUT_PATH = join(dirname(import.meta.path), 'fixtures', 'seed.cypher');

function getHttpUrl(): string {
  if (process.env.NEO4J_HTTP_URL) return process.env.NEO4J_HTTP_URL;
  const host = process.env.NEO4J_HOST || 'localhost';
  const port = process.env.NEO4J_HTTP_PORT || '7474';
  return `http://${host}:${port}`;
}

function getAuthHeader(): Record<string, string> {
  const authEnabled =
    process.env.NEO4J_AUTH !== undefined && process.env.NEO4J_AUTH !== 'none';
  if (!authEnabled) return {};
  const user = process.env.NEO4J_USERNAME || 'neo4j';
  const pass = process.env.NEO4J_PASSWORD || '';
  return { Authorization: `Basic ${btoa(`${user}:${pass}`)}` };
}

interface CypherRow {
  row: unknown[];
  meta: unknown[];
}

interface CypherResult {
  columns: string[];
  data: CypherRow[];
}

interface CypherResponse {
  results: CypherResult[];
  errors: { code: string; message: string }[];
}

async function runCypher(
  query: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const url = `${getHttpUrl()}/db/neo4j/tx/commit`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify({
      statements: [{ statement: query, parameters: params }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Neo4j HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as CypherResponse;
  if (json.errors.length > 0) {
    throw new Error(`Cypher error: ${json.errors.map((e) => e.message).join('; ')}`);
  }

  const result = json.results[0];
  if (!result || result.data.length === 0) return [];

  return result.data.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = row.row[i];
    });
    return obj;
  });
}

function escapeStr(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  const s = String(val)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `'${s}'`;
}

function propsToString(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') {
      parts.push(`${k}: ${v}`);
    } else if (typeof v === 'boolean') {
      parts.push(`${k}: ${v}`);
    } else if (Array.isArray(v)) {
      const items = v.map((i) =>
        typeof i === 'string' ? escapeStr(i) : String(i),
      );
      parts.push(`${k}: [${items.join(', ')}]`);
    } else {
      parts.push(`${k}: ${escapeStr(v)}`);
    }
  }
  return parts.join(', ');
}

interface NodeExport {
  label: string;
  varName: string;
  props: Record<string, unknown>;
}

interface RelExport {
  fromVar: string;
  toVar: string;
  type: string;
}

function nodeKey(props: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(props)
      .sort()
      .reduce(
        (o, k) => {
          o[k] = props[k];
          return o;
        },
        {} as Record<string, unknown>,
      ),
  );
}

async function dumpNodes(
  label: string,
  issueIds: string[],
): Promise<NodeExport[]> {
  const queries: Record<string, { q: string; p: Record<string, unknown> }> = {
    Issue: {
      q: `MATCH (n:Issue) WHERE n.issueId IN $ids RETURN properties(n) AS props, labels(n) AS lbls`,
      p: { ids: issueIds },
    },
    Comment: {
      q: `MATCH (i:Issue)-[:HAS_COMMENT]->(n:Comment) WHERE i.issueId IN $ids RETURN properties(n) AS props, labels(n) AS lbls`,
      p: { ids: issueIds },
    },
    User: {
      q: `MATCH (i:Issue)-[:AUTHORED_BY]->(n:User) WHERE i.issueId IN $ids RETURN DISTINCT properties(n) AS props, labels(n) AS lbls
          UNION
          MATCH (i:Issue)-[:HAS_COMMENT]->(c:Comment)-[:AUTHORED_BY]->(n:User) WHERE i.issueId IN $ids RETURN DISTINCT properties(n) AS props, labels(n) AS lbls`,
      p: { ids: issueIds },
    },
    Label: {
      q: `MATCH (i:Issue)-[:HAS_LABEL]->(n:Label) WHERE i.issueId IN $ids RETURN DISTINCT properties(n) AS props, labels(n) AS lbls`,
      p: { ids: issueIds },
    },
    Reaction: {
      q: `MATCH (i:Issue)-[:HAS_REACTION]->(n:Reaction) WHERE i.issueId IN $ids RETURN properties(n) AS props, labels(n) AS lbls
          UNION
          MATCH (i:Issue)-[:HAS_COMMENT]->(c:Comment)-[:HAS_REACTION]->(n:Reaction) WHERE i.issueId IN $ids RETURN properties(n) AS props, labels(n) AS lbls`,
      p: { ids: issueIds },
    },
    Category: {
      q: `MATCH (i:Issue)-[:BELONGS_TO_CATEGORY]->(n:Category) WHERE i.issueId IN $ids RETURN DISTINCT properties(n) AS props, labels(n) AS lbls`,
      p: { ids: issueIds },
    },
    Competitor: {
      q: `MATCH (i:Issue)-[:MENTIONS_COMPETITOR]->(n:Competitor) WHERE i.issueId IN $ids RETURN DISTINCT properties(n) AS props, labels(n) AS lbls
          UNION
          MATCH (i:Issue)-[:HAS_COMMENT]->()-[:MENTIONS_COMPETITOR]->(n:Competitor) WHERE i.issueId IN $ids RETURN DISTINCT properties(n) AS props, labels(n) AS lbls`,
      p: { ids: issueIds },
    },
    Workaround: {
      q: `MATCH (i:Issue)-[:HAS_WORKAROUND]->(n:Workaround) WHERE i.issueId IN $ids RETURN properties(n) AS props, labels(n) AS lbls
          UNION
          MATCH (i:Issue)-[:HAS_COMMENT]->()-[:HAS_WORKAROUND]->(n:Workaround) WHERE i.issueId IN $ids RETURN properties(n) AS props, labels(n) AS lbls`,
      p: { ids: issueIds },
    },
    Solution: {
      q: `MATCH (i:Issue)-[:HAS_SOLUTION]->(n:Solution) WHERE i.issueId IN $ids RETURN properties(n) AS props, labels(n) AS lbls
          UNION
          MATCH (i:Issue)-[:HAS_COMMENT]->()-[:HAS_SOLUTION]->(n:Solution) WHERE i.issueId IN $ids RETURN properties(n) AS props, labels(n) AS lbls`,
      p: { ids: issueIds },
    },
    Keyword: {
      q: `MATCH (i:Issue)-[*1..2]->(w)-[:HAS_KEYWORD]->(n:Keyword) WHERE i.issueId IN $ids RETURN DISTINCT properties(n) AS props, labels(n) AS lbls`,
      p: { ids: issueIds },
    },
    Meta: {
      q: `MATCH (n:Meta) RETURN properties(n) AS props, labels(n) AS lbls`,
      p: {},
    },
  };

  const entry = queries[label];
  if (!entry) {
    return [];
  }

  const rows = await runCypher(entry.q, entry.p);
  const nodes: NodeExport[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const props = row.props as Record<string, unknown>;
    const key = nodeKey(props);
    if (seen.has(key)) continue;
    seen.add(key);

    const lbls = (row.lbls as string[]) || [label];
    const primaryLabel = lbls[0] || label;
    const varName = `${primaryLabel.toLowerCase()}_${nodes.length}`;
    nodes.push({ label: lbls.join(':'), varName, props });
  }

  return nodes;
}

async function dumpRelationships(
  issueIds: string[],
  nodeMap: Map<string, string>,
): Promise<RelExport[]> {
  const relQueries = [
    `MATCH (a:Issue)-[r:AUTHORED_BY]->(b:User) WHERE a.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (a:Issue)-[r:HAS_LABEL]->(b:Label) WHERE a.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (a:Issue)-[r:HAS_COMMENT]->(b:Comment) WHERE a.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (a:Issue)-[r:HAS_REACTION]->(b:Reaction) WHERE a.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (i:Issue)-[:HAS_COMMENT]->(a:Comment)-[r:AUTHORED_BY]->(b:User) WHERE i.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (i:Issue)-[:HAS_COMMENT]->(a:Comment)-[r:HAS_REACTION]->(b:Reaction) WHERE i.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (a:Issue)-[r:BELONGS_TO_CATEGORY]->(b:Category) WHERE a.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (a:Issue)-[r:MENTIONS_COMPETITOR]->(b:Competitor) WHERE a.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (a:Issue)-[r:HAS_WORKAROUND]->(b:Workaround) WHERE a.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (a:Issue)-[r:HAS_SOLUTION]->(b:Solution) WHERE a.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (i:Issue)-[:HAS_COMMENT]->(a:Comment)-[r:MENTIONS_COMPETITOR]->(b:Competitor) WHERE i.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (i:Issue)-[:HAS_COMMENT]->(a:Comment)-[r:HAS_WORKAROUND]->(b:Workaround) WHERE i.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (i:Issue)-[:HAS_COMMENT]->(a:Comment)-[r:HAS_SOLUTION]->(b:Solution) WHERE i.issueId IN $ids RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (a:Workaround)-[r:HAS_KEYWORD]->(b:Keyword) WHERE EXISTS { MATCH (i:Issue)-[*1..2]->(a) WHERE i.issueId IN $ids } RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
    `MATCH (a:Solution)-[r:HAS_KEYWORD]->(b:Keyword) WHERE EXISTS { MATCH (i:Issue)-[*1..2]->(a) WHERE i.issueId IN $ids } RETURN properties(a) AS ap, properties(b) AS bp, type(r) AS t`,
  ];

  const rels: RelExport[] = [];

  for (const query of relQueries) {
    const rows = await runCypher(query, { ids: issueIds });
    for (const row of rows) {
      const fromProps = row.ap as Record<string, unknown>;
      const toProps = row.bp as Record<string, unknown>;
      const relType = row.t as string;

      const fromVar = nodeMap.get(nodeKey(fromProps));
      const toVar = nodeMap.get(nodeKey(toProps));

      if (fromVar && toVar) {
        rels.push({ fromVar, toVar, type: relType });
      }
    }
  }

  return rels;
}

async function main() {
  const httpUrl = getHttpUrl();
  console.log(`Connecting to Neo4j HTTP API at ${httpUrl}...`);

  const issueRows = await runCypher(
    `MATCH (i:Issue) RETURN i.issueId AS id ORDER BY i.number ASC LIMIT $limit`,
    { limit: ISSUE_LIMIT },
  );
  const issueIds = issueRows.map((r) => r.id as string);
  console.log(`Found ${issueIds.length} issues to export`);

  if (issueIds.length === 0) {
    console.error(
      'No issues found in database. Is ast dev running with ingested data?',
    );
    process.exit(1);
  }

  const nodeLabels = [
    'Issue',
    'Comment',
    'User',
    'Label',
    'Reaction',
    'Category',
    'Competitor',
    'Workaround',
    'Solution',
    'Keyword',
    'Meta',
  ];
  const allNodes: NodeExport[] = [];
  const nodeMap = new Map<string, string>();

  for (const label of nodeLabels) {
    const nodes = await dumpNodes(label, issueIds);
    console.log(`  ${label}: ${nodes.length} nodes`);
    for (const node of nodes) {
      const key = nodeKey(node.props);
      if (!nodeMap.has(key)) {
        nodeMap.set(key, node.varName);
        allNodes.push(node);
      }
    }
  }

  console.log(`\nTotal nodes: ${allNodes.length}`);

  const rels = await dumpRelationships(issueIds, nodeMap);
  console.log(`Total relationships: ${rels.length}`);

  const lines: string[] = [];
  lines.push('// Auto-generated Neo4j fixture data');
  lines.push(`// Exported: ${new Date().toISOString()}`);
  lines.push(`// Issues: ${issueIds.length}`);
  lines.push('//');
  lines.push(
    '// Regenerate: bun test/dump-fixtures.ts (while ast dev is running)',
  );
  lines.push('');

  lines.push('// --- Nodes ---');
  for (const node of allNodes) {
    const fid = `_fid: ${escapeStr(node.varName)}`;
    const props = propsToString(node.props);
    lines.push(
      `CREATE (:${node.label} {${fid}, ${props}});`,
    );
  }

  lines.push('');
  lines.push('// --- Relationships ---');
  for (const rel of rels) {
    lines.push(
      `MATCH (a {_fid: ${escapeStr(rel.fromVar)}}), (b {_fid: ${escapeStr(rel.toVar)}}) CREATE (a)-[:${rel.type}]->(b);`,
    );
  }

  lines.push('');

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf-8');
  console.log(`\nWritten to ${OUTPUT_PATH}`);
  console.log(`  ${allNodes.length} nodes, ${rels.length} relationships`);
}

main().catch((err) => {
  console.error('Dump failed:', err);
  process.exit(1);
});
