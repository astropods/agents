/**
 * Builds the issue payload for the triage workflow.
 *
 * Every field comes from Neo4j or the GitHub API. Nothing here is authored by
 * hand: a paraphrased issue body silently invalidates a whole run, because the
 * agents analyse the text they are given and cannot tell it is wrong.
 *
 *   bun test/build-triage-payload.ts [--limit N] [--exclude 1,2,3] [--out FILE]
 */

import neo4j from 'neo4j-driver';

interface LinkedPR {
  pr: number;
  draft: boolean;
}

interface TriageIssue {
  number: number;
  title: string;
  author: string;
  category: string;
  subcategory: string | null;
  severity: string;
  effort: string;
  score: number;
  createdAt: string;
  labels: string[];
  body: string;
  linkedOpenPRs: LinkedPR[];
  liveState: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Issues that an open PR already claims to close, keyed by issue number. */
async function fetchLinkedOpenPRs(owner: string, repo: string): Promise<Map<number, LinkedPR[]>> {
  const query = `
    query($owner:String!,$repo:String!,$cursor:String){
      repository(owner:$owner,name:$repo){
        pullRequests(states:OPEN, first:100, after:$cursor){
          pageInfo{ hasNextPage endCursor }
          nodes{ number isDraft closingIssuesReferences(first:20){ nodes{ number } } }
        }
      }
    }`;

  const linked = new Map<number, LinkedPR[]>();
  let cursor: string | null = null;
  for (;;) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { owner, repo, cursor } }),
    });
    const json = (await res.json()) as {
      data?: {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: boolean; endCursor: string };
            nodes: {
              number: number;
              isDraft: boolean;
              closingIssuesReferences: { nodes: { number: number }[] };
            }[];
          };
        };
      };
      errors?: unknown;
    };
    if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
    const page = json.data!.repository.pullRequests;
    for (const pr of page.nodes) {
      for (const issue of pr.closingIssuesReferences.nodes) {
        const list = linked.get(issue.number) ?? [];
        list.push({ pr: pr.number, draft: pr.isDraft });
        linked.set(issue.number, list);
      }
    }
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return linked;
}

/** Live open/closed state, so a run never analyses an issue that is already closed. */
async function fetchLiveStates(
  owner: string,
  repo: string,
  numbers: number[],
): Promise<Map<number, string>> {
  const states = new Map<number, string>();
  for (let i = 0; i < numbers.length; i += 50) {
    const batch = numbers.slice(i, i + 50);
    const fields = batch.map((n) => `i${n}: issue(number:${n}){ number state }`).join('\n');
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ ${fields} } }`,
        variables: { owner, repo },
      }),
    });
    const json = (await res.json()) as {
      data?: { repository: Record<string, { number: number; state: string } | null> };
    };
    for (const v of Object.values(json.data?.repository ?? {})) {
      if (v) states.set(v.number, v.state);
    }
  }
  return states;
}

async function main() {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!owner || !repo) throw new Error('GITHUB_OWNER and GITHUB_REPO are required');
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required');

  const exclude = new Set((arg('exclude') ?? '').split(',').filter(Boolean).map(Number));
  const limit = Number.parseInt(arg('limit') ?? '0', 10);
  const out = arg('out') ?? '/tmp/triage-payload.json';

  const driver = neo4j.driver(process.env.NEO4J_URI ?? 'bolt://localhost:7687');
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  let rows: TriageIssue[];
  try {
    const result = await session.run(
      `MATCH (i:Issue) WHERE i.priorityScore IS NOT NULL
       OPTIONAL MATCH (i)-[:HAS_LABEL]->(l:Label)
       RETURN i.number AS number, i.title AS title, i.authorLogin AS author,
              i.category AS category, i.subcategory AS subcategory,
              i.severity AS severity, i.effort AS effort, i.priorityScore AS score,
              i.createdAt AS createdAt, i.bodyText AS body, collect(l.name) AS labels
       ORDER BY i.priorityScore DESC, i.number ASC`,
    );
    rows = result.records.map((r) => ({
      number: neo4j.int(r.get('number')).toNumber(),
      title: r.get('title'),
      author: r.get('author') ?? '',
      category: r.get('category'),
      subcategory: r.get('subcategory'),
      severity: r.get('severity'),
      effort: r.get('effort'),
      score: neo4j.int(r.get('score')).toNumber(),
      createdAt: r.get('createdAt'),
      labels: (r.get('labels') as string[]).filter(Boolean),
      body: r.get('body') ?? '',
      linkedOpenPRs: [],
      liveState: 'UNKNOWN',
    }));
  } finally {
    await session.close();
    await driver.close();
  }

  const candidates = rows.filter((r) => !exclude.has(r.number));
  const [linked, states] = await Promise.all([
    fetchLinkedOpenPRs(owner, repo),
    fetchLiveStates(
      owner,
      repo,
      candidates.map((r) => r.number),
    ),
  ]);

  for (const r of candidates) {
    r.linkedOpenPRs = linked.get(r.number) ?? [];
    r.liveState = states.get(r.number) ?? 'UNKNOWN';
  }

  const closed = candidates.filter((r) => r.liveState !== 'OPEN');
  const open = candidates.filter((r) => r.liveState === 'OPEN');
  const withPR = open.filter((r) => r.linkedOpenPRs.length > 0);
  const payload = limit > 0 ? open.slice(0, limit) : open;

  await Bun.write(out, JSON.stringify(payload));

  console.log(`from graph        : ${rows.length}`);
  console.log(`excluded          : ${rows.length - candidates.length}`);
  console.log(
    `closed on GitHub  : ${closed.length}${closed.length ? ` (${closed.map((c) => '#' + c.number).join(', ')})` : ''}`,
  );
  console.log(`open              : ${open.length}`);
  console.log(`  of which have an open PR (workflow will skip): ${withPR.length}`);
  for (const r of withPR) {
    console.log(
      `    #${r.number} <- ${r.linkedOpenPRs.map((p) => '#' + p.pr + (p.draft ? ' (draft)' : '')).join(', ')}`,
    );
  }
  console.log(`written           : ${payload.length} issues -> ${out}`);
}

main();
