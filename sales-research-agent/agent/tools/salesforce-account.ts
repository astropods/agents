import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { SalesforceClient } from '../../src/services/salesforce';

let _client: SalesforceClient | null = null;
function getClient(): SalesforceClient {
  if (!_client) _client = new SalesforceClient();
  return _client;
}

export const salesforceAccountLookupTool = createTool({
  id: 'salesforceAccountLookup',
  description: `Lookup account in Salesforce (real-time API call) with intelligent field filtering.
Flow: OAuth → SOSL search → GET full record → Transform → Filter by intent.
Always call this FIRST when a company name is mentioned. Detect query intent from the user's question:
- "general" (default): Basic info + key metrics (ARR, MAU, CSM, tier)
- "metrics" or "arr": All ARR and metrics fields
- "usage": Usage metrics (MAU, DAU, collections, session hours)
- "team": Team info (CSM, owner, users, teams)
- "sales": Sales context (pipeline, expansion potential, health score)
- "account_info": Business info (industry, website, employee count)`,
  inputSchema: z.object({
    accountNameFromQuery: z.string().describe('Account name from user query (e.g. "microsoft", "cvs")'),
    queryIntent: z.enum(['general', 'metrics', 'arr', 'usage', 'team', 'sales', 'account_info']).optional().default('general'),
  }),
  outputSchema: z.record(z.unknown()),
  execute: async (input) => {
    console.log(`  [sfAccount] lookup "${input.accountNameFromQuery}" intent=${input.queryIntent}`);
    try {
      return await getClient().lookupAccount(input.accountNameFromQuery, 10, input.queryIntent);
    } catch (err) {
      console.error(`  [sfAccount] error:`, err);
      return {
        error: String(err),
        matched_accounts: [],
        all_matches: [],
        should_filter: false,
        match_explanation: `Salesforce lookup failed: ${err}`,
      };
    }
  },
});
