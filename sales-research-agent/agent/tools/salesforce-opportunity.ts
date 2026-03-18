import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { SalesforceClient } from '../../src/services/salesforce';

let _client: SalesforceClient | null = null;
function getClient(): SalesforceClient {
  if (!_client) _client = new SalesforceClient();
  return _client;
}

export const salesforceOpportunityLookupTool = createTool({
  id: 'salesforceOpportunityLookup',
  description: `Lookup opportunity in Salesforce with intelligent field filtering.
Use when user asks about deal wins/losses, opportunity ARR, competitors, or deal details.
Call AFTER account lookup to get account_id. When account_id is provided returns ALL opportunities (up to 100).
Detect query intent:
- "general" (default): Basic info (name, stage, amount, close date)
- "win": Win details (win reason, win against, competitors)
- "loss": Loss details (loss reason, who, why)
- "arr": All ARR-related fields
- "competitors": Competitive info
- "deal_details": Comprehensive deal info (products, SSO, onboarding)`,
  inputSchema: z.object({
    accountId: z.string().optional().describe('Account ID to find opportunities for'),
    opportunityId: z.string().optional().describe('Specific Opportunity ID'),
    opportunityName: z.string().optional().describe('Opportunity name to search for'),
    queryIntent: z.enum(['general', 'win', 'loss', 'arr', 'competitors', 'deal_details']).optional().default('general'),
    includeContactRoles: z.boolean().optional().default(true),
  }),
  outputSchema: z.record(z.unknown()),
  execute: async (input) => {
    console.log(`  [sfOpportunity] account=${input.accountId ?? ''} opp=${input.opportunityId ?? ''} name=${input.opportunityName ?? ''} intent=${input.queryIntent}`);
    try {
      return await getClient().lookupOpportunity(
        input.opportunityId,
        input.accountId,
        input.opportunityName,
        input.includeContactRoles ?? true,
        input.queryIntent,
      );
    } catch (err) {
      console.error(`  [sfOpportunity] error:`, err);
      return {
        error: String(err),
        opportunity: null,
        opportunities: [],
        contact_roles: [],
        sf_opportunity_id: null,
      };
    }
  },
});
