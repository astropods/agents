type RecordLike = Record<string, unknown>;

const VALID_ACCOUNT_INTENTS = [
  "general",
  "metrics",
  "arr",
  "usage",
  "team",
  "sales",
  "account_info",
] as const;
const VALID_OPPORTUNITY_INTENTS = [
  "general",
  "win",
  "loss",
  "arr",
  "competitors",
  "deal_details",
] as const;

type AccountIntent = (typeof VALID_ACCOUNT_INTENTS)[number];
type OpportunityIntent = (typeof VALID_OPPORTUNITY_INTENTS)[number];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SalesforceClient {
  private clientId: string | undefined;
  private clientSecret: string | undefined;
  private refreshToken: string | undefined;
  private domain: string;
  private baseUrl: string | undefined;
  private apiVersion: string;
  private accessToken: string | null = null;
  private instanceUrl: string | null = null;
  private tokenExpiresAt: number | null = null;
  private lastRequestTime = 0;
  private minRequestInterval = 100;
  private requestTimeout = 30000;

  constructor() {
    this.clientId = process.env.SF_CLIENT_ID;
    this.clientSecret = process.env.SF_CLIENT_SECRET;
    this.refreshToken = process.env.SF_REFRESH_TOKEN;
    this.domain = process.env.SF_DOMAIN ?? "https://login.salesforce.com";
    this.baseUrl = process.env.SF_BASE_URL;
    this.apiVersion = process.env.SF_API_VERSION ?? "v64.0";
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      await sleep(this.minRequestInterval - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  private validateSalesforceId(sfId: string, _objectType = "generic"): boolean {
    if (!sfId || typeof sfId !== "string") return false;
    if (sfId.length !== 15 && sfId.length !== 18) return false;
    if (!/^[a-zA-Z0-9]+$/.test(sfId)) return false;
    return true;
  }

  private validateQueryIntent(
    queryIntent: string,
    intentType: "account" | "opportunity"
  ): string {
    const valid =
      intentType === "account"
        ? (VALID_ACCOUNT_INTENTS as readonly string[])
        : (VALID_OPPORTUNITY_INTENTS as readonly string[]);
    if (!valid.includes(queryIntent)) {
      console.error(`Invalid query_intent '${queryIntent}', using 'general'`);
      return "general";
    }
    return queryIntent;
  }

  private getBaseUrl(): string {
    return this.baseUrl ?? this.instanceUrl ?? "";
  }

  private async makeRequestWithRetry(
    method: string,
    url: string,
    headers: Record<string, string>,
    options?: {
      params?: Record<string, string>;
      body?: string;
    },
    maxRetries = 3,
    baseDelay = 1000
  ): Promise<Response | null> {
    await this.rateLimit();

    const fullUrl = options?.params
      ? `${url}?${new URLSearchParams(options.params).toString()}`
      : url;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(fullUrl, {
          method,
          headers,
          body: options?.body,
          signal: AbortSignal.timeout(this.requestTimeout),
        });

        if (res.status === 401 && attempt < maxRetries) {
          console.error(
            `Token expired (401), refreshing and retrying (attempt ${attempt + 1}/${maxRetries + 1})`
          );
          this.accessToken = null;
          const token = await this.getAccessToken();
          if (token) {
            headers["Authorization"] = `Bearer ${token}`;
            continue;
          }
          console.error("Failed to refresh token");
          return null;
        }

        if (res.status === 429 && attempt < maxRetries) {
          let delay = baseDelay * Math.pow(2, attempt);
          const retryAfter = res.headers.get("Retry-After");
          if (retryAfter) {
            const parsed = parseFloat(retryAfter);
            if (!Number.isNaN(parsed)) delay = parsed * 1000;
          }
          console.error(
            `Rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`
          );
          await sleep(delay);
          continue;
        }

        if (res.status >= 400) {
          if (attempt < maxRetries && res.status >= 500) {
            const delay = baseDelay * Math.pow(2, attempt);
            console.error(
              `Server error ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`
            );
            await sleep(delay);
            continue;
          }
          const text = await res.text();
          console.error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
          return res;
        }

        return res;
      } catch (e) {
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.error(
            `Request failed: ${e}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`
          );
          await sleep(delay);
          continue;
        }
        console.error(`Request failed after all retries: ${e}`);
        return null;
      }
    }
    return null;
  }

  private async getAccessToken(): Promise<string | null> {
    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      Date.now() < this.tokenExpiresAt - 60000
    ) {
      return this.accessToken;
    }

    this.accessToken = null;

    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      console.error("Salesforce credentials not configured (SF_CLIENT_ID, SF_CLIENT_SECRET, SF_REFRESH_TOKEN)");
      return null;
    }

    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
      }).toString();

      const res = await fetch(`${this.domain}/services/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(this.requestTimeout),
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        console.error(`Salesforce OAuth failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
        return null;
      }

      this.accessToken = data.access_token as string;
      this.instanceUrl = data.instance_url as string;
      const expiresIn = (data.expires_in as number) ?? 7200;
      this.tokenExpiresAt = Date.now() + expiresIn * 1000;
      console.log(`Salesforce OAuth successful (expires in ${expiresIn}s)`);
      return this.accessToken;
    } catch (e) {
      console.error(`Salesforce OAuth error: ${e}`);
      return null;
    }
  }

  private sanitizeSoslSearchTerm(searchTerm: string): string {
    let sanitized = searchTerm.replace(/&/g, "*");
    sanitized = sanitized.replace(/\|/g, "*");
    sanitized = sanitized.replace(/!/g, "");
    sanitized = sanitized.replace(/-/g, "*");
    sanitized = sanitized.replace(/[(){}"]/g, " ");
    sanitized = sanitized.replace(/"/g, "");
    while (sanitized.includes("**")) sanitized = sanitized.replace(/\*\*/g, "*");
    while (sanitized.includes("  "))
      sanitized = sanitized.replace(/  /g, " ");
    return sanitized.trim();
  }

  async searchAccounts(
    searchTerm: string,
    maxMatches = 10
  ): Promise<RecordLike[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    const sanitized = this.sanitizeSoslSearchTerm(searchTerm);
    const soslQuery = `FIND {${sanitized}} IN NAME FIELDS RETURNING Account(Id, Name) LIMIT ${maxMatches}`;

    const baseUrl = this.baseUrl ?? this.instanceUrl;
    if (!baseUrl) return [];

    const res = await this.makeRequestWithRetry(
      "GET",
      `${baseUrl}/services/data/${this.apiVersion}/search`,
      { Authorization: `Bearer ${token}` },
      { params: { q: soslQuery } }
    );

    if (res && res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const records = (data.searchRecords ?? []) as RecordLike[];
      console.log(`SOSL search found ${records.length} accounts`);
      return records;
    }
    console.error("Salesforce search failed");
    return [];
  }

  async getAccountFullData(accountId: string): Promise<RecordLike | null> {
    if (!this.validateSalesforceId(accountId, "Account")) {
      console.error(`Invalid Account ID format: ${accountId}`);
      return null;
    }

    const token = await this.getAccessToken();
    if (!token) return null;

    const baseUrl = this.baseUrl ?? this.instanceUrl;
    if (!baseUrl) return null;

    const res = await this.makeRequestWithRetry(
      "GET",
      `${baseUrl}/services/data/${this.apiVersion}/sobjects/Account/${accountId}`,
      { Authorization: `Bearer ${token}` }
    );

    if (res && res.ok) {
      const account = (await res.json()) as RecordLike;
      console.log(`Retrieved full account data for ${accountId}`);
      return account;
    }
    console.error("Salesforce get account failed");
    return null;
  }

  private static cleanHtml(html: string | null | undefined): string | null {
    if (!html || typeof html !== "string") return null;
    let cleaned = html.replace(/<[^>]*>/g, "");
    cleaned = cleaned.replace(/&nbsp;/g, " ");
    cleaned = cleaned.replace(/&amp;/g, "&");
    cleaned = cleaned.replace(/&lt;/g, "<");
    cleaned = cleaned.replace(/&gt;/g, ">");
    cleaned = cleaned.split(/\s+/).join(" ");
    return cleaned.trim() || null;
  }

  private static parseNum(value: unknown): number | null {
    if (value == null || value === "") return null;
    try {
      return typeof value === "string" ? parseFloat(value) : Number(value);
    } catch {
      return null;
    }
  }

  private filterAccountDataByIntent(
    accountData: RecordLike,
    queryIntent: string
  ): RecordLike {
    const get = (o: unknown, k: string): unknown =>
      o && typeof o === "object" && k in o ? (o as RecordLike)[k] : undefined;
    const metrics = (accountData.current_metrics as RecordLike) ?? {};
    const teamInfo = (accountData.team_info as RecordLike) ?? {};
    const salesContext = (accountData.sales_context as RecordLike) ?? {};
    const usageContext = (accountData.usage_context as RecordLike) ?? {};
    const engagementMetrics = (accountData.engagement_metrics as RecordLike) ?? {};

    if (queryIntent === "general") {
      return {
        sf_account_id: accountData.sf_account_id,
        account_name: accountData.account_name,
        current_metrics: {
          arr_current_month: get(metrics, "arr_current_month"),
          total_90dau: get(metrics, "total_90dau"),
          total_users: get(metrics, "total_users"),
        },
        team_info: {
          csm_name: get(teamInfo, "csm_name"),
          account_tier: get(salesContext, "account_tier"),
        },
      };
    }
    if (queryIntent === "metrics" || queryIntent === "arr") {
      return {
        sf_account_id: accountData.sf_account_id,
        account_name: accountData.account_name,
        current_metrics: metrics,
        sales_context: {
          account_tier: get(salesContext, "account_tier"),
          open_pipeline_arr: get(salesContext, "open_pipeline_arr"),
          expansion_potential_arr: get(salesContext, "expansion_potential_arr"),
        },
      };
    }
    if (queryIntent === "usage") {
      return {
        sf_account_id: accountData.sf_account_id,
        account_name: accountData.account_name,
        current_metrics: {
          mau: get(metrics, "mau"),
          dau_90: get(metrics, "dau_90"),
          total_mau: get(metrics, "total_mau"),
          total_90dau: get(metrics, "total_90dau"),
          total_collections: get(metrics, "total_collections"),
          total_session_hours: get(metrics, "total_session_hours"),
        },
        usage_context: usageContext,
        engagement_metrics: engagementMetrics,
      };
    }
    if (queryIntent === "team") {
      return {
        sf_account_id: accountData.sf_account_id,
        account_name: accountData.account_name,
        team_info: teamInfo,
        current_metrics: {
          paid_users: get(metrics, "paid_users"),
          total_users: get(metrics, "total_users"),
          free_users: get(metrics, "free_users"),
          paid_teams: get(metrics, "paid_teams"),
          total_paid_teams: get(metrics, "total_paid_teams"),
        },
      };
    }
    if (queryIntent === "sales") {
      return {
        sf_account_id: accountData.sf_account_id,
        account_name: accountData.account_name,
        sales_context: salesContext,
        current_metrics: {
          arr_current_month: get(metrics, "arr_current_month"),
          arr_total: get(metrics, "arr_total"),
          open_pipeline_arr: get(salesContext, "open_pipeline_arr"),
        },
      };
    }
    if (queryIntent === "account_info") {
      return {
        sf_account_id: accountData.sf_account_id,
        account_name: accountData.account_name,
        industry: accountData.industry,
        website: accountData.website,
        business_info: accountData.business_info ?? {},
        record_metadata: accountData.record_metadata ?? {},
      };
    }
    return accountData;
  }

  private emptyResult(accountNameFromQuery: string): RecordLike {
    return {
      error: "No accounts found",
      matched_accounts: [],
      all_matches: [],
      should_filter: false,
      primary_account_id: null,
      primary_account_name: null,
      match_explanation: `No accounts found matching '${accountNameFromQuery}'`,
    };
  }

  private transformAccountData(account: RecordLike): RecordLike {
    let useCases: string[] = [];
    const raw = account.Use_Case_Name_Prolifiq__c;
    if (typeof raw === "string") {
      useCases = raw
        .split(";")
        .map((u) => u.trim())
        .filter(Boolean);
    }

    const get = (k: string): unknown => account[k];
    const num = (k: string): number | null =>
      SalesforceClient.parseNum(get(k));

    return {
      sf_account_id: get("Id"),
      account_name: get("Name"),
      industry: get("Industry"),
      website: get("Website"),
      current_metrics: {
        mau: num("MAU_Account__c"),
        dau_90: num("X90_DAU_Account__c"),
        total_mau: num("Total_MAU__c"),
        total_90dau: num("Total_90DAU__c"),
        child_account_mau: num("Child_Account_MAUDLRS__c"),
        child_account_90dau: num("Child_Account_90DAUDLRS__c"),
        dau_penetration: num("X90DAU_Penetration__c"),
        total_collections: num("of_Collections_Account__c"),
        total_session_hours: num("Total_User_Session_Time_in_Hrs_Account__c"),
        arr_current_month: num("ARR_Current_Month_Account__c"),
        arr_total: num("AnnualRevenue"),
        arr_parent_child: num("Parent_Child_ARR__c"),
        arr_parent_team: num("Parent_Team_ARR__c"),
        paid_users: num("number_of_Paid_Team_Users_ACC__c"),
        total_users: num("NumberOfEmployees"),
        free_users: num("number_of_Free_Team_Users_ACC__c"),
        paid_teams: num("number_of_Paid_Teams_ACC__c"),
        total_paid_teams: num("Total_Paid_Teams__c"),
        free_teams: num("number_of_Free_Teams_ACC__c"),
        child_account_paid_teams: num("Child_Account_Paid_TeamsDLRS__c"),
      },
      team_info: {
        csm_name: get("Aggregated_Team_CSM__c"),
        csm_id: get("customer_success_manager__c"),
        renewals_specialist_id: get("Renewals_Specialist__c"),
        account_owner: get("Account_Owner_Full_Name__c"),
        account_owner_role: get("Account_Owner_Role__c"),
        account_owner_job_category: get("Account_Owner_Job_Category__c"),
        account_owner_assigned_date: get("Account_Owner_Assigned_Timestamp__c"),
        solution_engineer: get("Solution_Engineer_Full_Name__c"),
        territory: get("Territory_Information__c"),
        fy_initial_ownership: get("FY_YY_Initial_Ownership__c"),
      },
      business_info: {
        annual_revenue: num("AnnualRevenue"),
        employee_count:
          num("Employee_Count__c") ?? num("NumberOfEmployees"),
        hq_city: get("HQ_city__c") ?? get("BillingCity"),
        hq_country: get("HQ_country__c") ?? get("BillingCountry"),
        description: get("Description"),
        segment: get("Ringlead_Segment__c"),
        region: get("Ringlead_Region__c"),
        sub_region: get("Ringlead_Sub_Region__c"),
      },
      sales_context: {
        account_tier: get("Account_Tier__c"),
        sales_prioritization: get("Sales_Prioritization_Tier__c"),
        expansion_potential_arr: num("Remaining_Account_Potential_ARR__c"),
        open_pipeline_arr: num("Open_Pipeline_ARR__c"),
        enterprise_90dau_penetration: num("Enterprise_90DAU_Penetration__c"),
        sales_play: get("Sales_Play_Target__c"),
        account_score: num("Account_ScoresDLRS__c"),
        pipeline_predict_score: num("engagio__pipeline_predict_score__c"),
        health_score: num("Health_Score__c"),
        churn_risk: get("Churn_Risk__c"),
        sales_notes: get("Sales_Tier_AE_Notes__c"),
        last_activity_date: get("Last_Activity__c"),
        last_ae_sales_activity: get("Last_Sales_Activity_Date_AEDLRS__c"),
        last_adr_sales_activity: get("Last_Sales_Activity_Date_ADRDLRS__c"),
      },
      usage_context: {
        use_cases: useCases,
        current_state: SalesforceClient.cleanHtml(
          get("Current_State_Prolifiq__c") as string
        ),
        desired_state: SalesforceClient.cleanHtml(
          get("Desired_State_Prolifiq__c") as string
        ),
      },
      engagement_metrics: {
        engagement_minutes_7d: num("engagio__EngagementMinutesLast7Days__c"),
        engagement_minutes_30d: num(
          "engagio__EngagementMinutesLast30Days__c"
        ),
        engagement_minutes_90d: num(
          "engagio__EngagementMinutesLast3Months__c"
        ),
        first_engagement_date: get("engagio__FirstEngagementDate__c"),
        imports_90d: num("Imports_in_last_90_days__c"),
        exports_90d: num("Exports_in_last_90_days__c"),
        paid_session_hours_last_month: num(
          "Paid_Session_Time_Last_Month_in_Hrs_Acc__c"
        ),
      },
      product_info: {
        product_categories: get("Product_Categories_AccountDLRS__c"),
        active_plans: get("Active_PlansDLRS__c"),
        total_paid_licenses: num("Total_Paid_Licenses__c"),
        child_account_paid_licenses: num(
          "Child_Account_Paid_LicensesDLRS__c"
        ),
      },
      marketing_context: {
        last_clicked_creative: get("Influ_Last_Clicked_Creative_Name__c"),
        last_clicked_creative_url: get("Influ_Last_Clicked_Creative_URL__c"),
        last_click_date: get("Influ_Last_Click_Date__c"),
        total_mql_contacts: num("Total_MQL_ContactsDLRS__c"),
      },
      record_metadata: {
        created_date: get("CreatedDate"),
        last_modified_date: get("LastModifiedDate"),
        created_by_id: get("CreatedById"),
        last_modified_by_id: get("LastModifiedById"),
        owner_id: get("OwnerId"),
        record_type_id: get("RecordTypeId"),
        channel_program_level_name: get("ChannelProgramLevelName"),
        channel_program_name: get("ChannelProgramName"),
        is_partner: get("IsPartner"),
        naics_code: get("ZI_NAICS_Code__c"),
      },
    };
  }

  async lookupAccount(
    accountNameFromQuery: string,
    maxMatches = 10,
    queryIntent: string = "general"
  ): Promise<RecordLike> {
    const intent = this.validateQueryIntent(
      queryIntent,
      "account"
    ) as AccountIntent;

    console.log(
      `Salesforce account lookup: '${accountNameFromQuery}' (intent: ${intent})`
    );

    const token = await this.getAccessToken();
    if (!token) {
      console.error("Salesforce OAuth failed, returning empty result");
      return this.emptyResult(accountNameFromQuery);
    }

    let searchResults = await this.searchAccounts(accountNameFromQuery, maxMatches);

    if (searchResults.length === 0) {
      const specialChars = ["-", "&", "|"];
      for (const char of specialChars) {
        if (accountNameFromQuery.includes(char)) {
          const variation = accountNameFromQuery.replaceAll(char, " ");
          console.log(
            `No results for '${accountNameFromQuery}', trying '${variation}'`
          );
          searchResults = await this.searchAccounts(variation, maxMatches);
          if (searchResults.length > 0) break;
        }
      }
    }

    if (searchResults.length === 0) {
      console.log(`No accounts found for '${accountNameFromQuery}'`);
      return this.emptyResult(accountNameFromQuery);
    }

    const accountNames = searchResults.map(
      (r) => (r.Name as string) ?? ""
    );
    const primaryAccountId = searchResults[0].Id as string;
    const primaryAccountName = searchResults[0].Name as string;

    const allMatches = searchResults.map((r) => ({
      sf_account_id: r.Id,
      account_name: r.Name,
      industry: r.Industry,
      website: r.Website,
    }));

    console.log(`Found ${accountNames.length} matching accounts: ${accountNames.join(", ")}`);

    const account = await this.getAccountFullData(primaryAccountId);

    if (!account) {
      console.error(
        `Failed to get full data for ${primaryAccountId}, using basic data`
      );
      return {
        matched_accounts: accountNames,
        primary_account: {
          sf_account_id: primaryAccountId,
          account_name: primaryAccountName,
        },
        all_matches: allMatches,
        should_filter: true,
        match_explanation: `Found ${accountNames.length} account(s) matching '${accountNameFromQuery}' (limited data)`,
      };
    }

    const primaryAccountContextFull = this.transformAccountData(account);
    const primaryAccountContext = this.filterAccountDataByIntent(
      primaryAccountContextFull,
      intent
    );

    return {
      matched_accounts: accountNames,
      primary_account: primaryAccountContext,
      all_matches: allMatches,
      filter_for_gong: { account_name: { $in: accountNames } },
      should_filter: accountNames.length > 0,
      match_explanation: `Found ${accountNames.length} account(s) matching '${accountNameFromQuery}'`,
      query_intent: intent,
    };
  }

  async searchOpportunities(
    accountId?: string,
    opportunityName?: string,
    stageName?: string,
    limit = 10
  ): Promise<RecordLike[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    const baseUrl = this.baseUrl ?? this.instanceUrl;
    if (!baseUrl) return [];

    const whereClauses: string[] = [];
    if (accountId) whereClauses.push(`AccountId = '${accountId}'`);
    if (opportunityName) {
      const escaped = opportunityName.replace(/'/g, "''");
      whereClauses.push(`Name LIKE '%${escaped}%'`);
    }
    if (stageName) {
      const escaped = stageName.replace(/'/g, "''");
      whereClauses.push(`StageName = '${escaped}'`);
    }
    const whereClause = whereClauses.length
      ? " WHERE " + whereClauses.join(" AND ")
      : "";
    const soqlQuery = `SELECT Id, Name, AccountId, StageName, CloseDate, Amount FROM Opportunity${whereClause} ORDER BY CloseDate DESC LIMIT ${limit}`;

    const res = await this.makeRequestWithRetry(
      "GET",
      `${baseUrl}/services/data/${this.apiVersion}/query`,
      { Authorization: `Bearer ${token}` },
      { params: { q: soqlQuery } }
    );

    if (res && res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const records = (data.records ?? []) as RecordLike[];
      console.log(`SOQL search found ${records.length} opportunities`);
      return records;
    }
    console.error("Salesforce opportunity search failed");
    return [];
  }

  async getOpportunityFullData(
    opportunityId: string
  ): Promise<RecordLike | null> {
    if (!this.validateSalesforceId(opportunityId, "Opportunity")) {
      console.error(`Invalid Opportunity ID format: ${opportunityId}`);
      return null;
    }

    const token = await this.getAccessToken();
    if (!token) return null;

    const baseUrl = this.baseUrl ?? this.instanceUrl;
    if (!baseUrl) return null;

    const res = await this.makeRequestWithRetry(
      "GET",
      `${baseUrl}/services/data/${this.apiVersion}/sobjects/Opportunity/${opportunityId}`,
      { Authorization: `Bearer ${token}` }
    );

    if (res && res.ok) {
      const opp = (await res.json()) as RecordLike;
      console.log(`Retrieved full opportunity data for ${opportunityId}`);
      return opp;
    }
    console.error("Salesforce get opportunity failed");
    return null;
  }

  async getOpportunityContactRoles(
    opportunityId: string
  ): Promise<RecordLike[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    const baseUrl = this.baseUrl ?? this.instanceUrl;
    if (!baseUrl) return [];

    const soqlQuery = `SELECT Id, ContactId, OpportunityId, Role, IsPrimary, Job_Level__c, Title__c, CreatedById, LastModifiedById FROM OpportunityContactRole WHERE OpportunityId = '${opportunityId}'`;

    const res = await this.makeRequestWithRetry(
      "GET",
      `${baseUrl}/services/data/${this.apiVersion}/query`,
      { Authorization: `Bearer ${token}` },
      { params: { q: soqlQuery } }
    );

    if (res && res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const records = (data.records ?? []) as RecordLike[];
      return records;
    }
    console.error("Salesforce get opportunity contact roles failed");
    return [];
  }

  private filterOpportunityDataByIntent(
    opportunityData: RecordLike,
    queryIntent: string
  ): RecordLike {
    if (queryIntent === "win") {
      return {
        sf_opportunity_id: opportunityData.sf_opportunity_id,
        opportunity_name: opportunityData.opportunity_name,
        account_id: opportunityData.account_id,
        close_date: opportunityData.close_date,
        stage_name: opportunityData.stage_name,
        amount: opportunityData.amount,
        win_against: opportunityData.win_against,
        win_against_details: opportunityData.win_against_details,
        win_against_further_details: opportunityData.win_against_further_details,
        win_reason_detail: opportunityData.win_reason_detail,
        competitors: opportunityData.competitors,
        arr: opportunityData.arr,
        calculated_arr: opportunityData.calculated_arr,
      };
    }
    if (queryIntent === "loss") {
      return {
        sf_opportunity_id: opportunityData.sf_opportunity_id,
        opportunity_name: opportunityData.opportunity_name,
        account_id: opportunityData.account_id,
        close_date: opportunityData.close_date,
        stage_name: opportunityData.stage_name,
        amount: opportunityData.amount,
        loss_reason: opportunityData.loss_reason,
        loss_reason_details: opportunityData.loss_reason_details,
        loss_reason_detail_who: opportunityData.loss_reason_detail_who,
        loss_reason_detail_why: opportunityData.loss_reason_detail_why,
        loss_reason_further_details_who:
          opportunityData.loss_reason_further_details_who,
        loss_reason_further_details_why:
          opportunityData.loss_reason_further_details_why,
        loss_reason_who: opportunityData.loss_reason_who,
        loss_reason_why: opportunityData.loss_reason_why,
        competitors: opportunityData.competitors,
      };
    }
    if (queryIntent === "arr") {
      const arrKeys = [
        "arr",
        "calculated_arr",
        "commissionable_arr",
        "net_incremental_arr",
        "booked_active_arr",
        "opportunity_arr_year_1",
        "opportunity_arr_year_2",
        "opportunity_arr_year_3",
        "renewable_arr",
        "renewal_arr_delta",
        "renewal_commissionable_arr",
        "renewal_quota_arr",
        "total_team_arr_at_booking",
        "adjustments_to_net_incremental_arr",
        "adjustment_to_commissionable_arr",
        "current_team_arr",
      ];
      const arrFields: RecordLike = {};
      for (const key of arrKeys) {
        if (key in opportunityData) arrFields[key] = opportunityData[key];
      }
      return {
        sf_opportunity_id: opportunityData.sf_opportunity_id,
        opportunity_name: opportunityData.opportunity_name,
        account_id: opportunityData.account_id,
        close_date: opportunityData.close_date,
        stage_name: opportunityData.stage_name,
        amount: opportunityData.amount,
        ...arrFields,
      };
    }
    if (queryIntent === "competitors") {
      return {
        sf_opportunity_id: opportunityData.sf_opportunity_id,
        opportunity_name: opportunityData.opportunity_name,
        account_id: opportunityData.account_id,
        close_date: opportunityData.close_date,
        stage_name: opportunityData.stage_name,
        competitors: opportunityData.competitors,
        win_against: opportunityData.win_against,
        win_against_details: opportunityData.win_against_details,
      };
    }
    if (queryIntent === "deal_details") {
      return {
        sf_opportunity_id: opportunityData.sf_opportunity_id,
        opportunity_name: opportunityData.opportunity_name,
        account_id: opportunityData.account_id,
        close_date: opportunityData.close_date,
        stage_name: opportunityData.stage_name,
        amount: opportunityData.amount,
        probability: opportunityData.probability,
        type: opportunityData.type,
        product_categories: opportunityData.product_categories,
        sso_identity_access_provider:
          opportunityData.sso_identity_access_provider,
        onboarding_poc: opportunityData.onboarding_poc,
        onboarding_setup: opportunityData.onboarding_setup,
      };
    }
    return {
      sf_opportunity_id: opportunityData.sf_opportunity_id,
      opportunity_name: opportunityData.opportunity_name,
      account_id: opportunityData.account_id,
      close_date: opportunityData.close_date,
      stage_name: opportunityData.stage_name,
      amount: opportunityData.amount,
    };
  }

  private transformOpportunityData(opportunity: RecordLike): RecordLike {
    const get = (k: string): unknown => opportunity[k];
    const num = (k: string): number | null =>
      SalesforceClient.parseNum(get(k));

    return {
      sf_opportunity_id: get("Id"),
      opportunity_name: get("Name"),
      account_id: get("AccountId"),
      close_date: get("CloseDate"),
      stage_name: get("StageName"),
      amount: num("Amount"),
      probability: num("Probability"),
      type: get("Type"),
      forecast_category_name: get("ForecastCategoryName"),
      win_against: get("Win_Against__c"),
      win_against_details: get("Win_Against_Details__c"),
      win_against_further_details: get("Win_Against_Further_Details__c"),
      win_reason_detail: get("Win_Reason_Detail__c"),
      loss_reason: get("Loss_Reason__c"),
      loss_reason_details: get("Loss_Reason_Details__c"),
      loss_reason_detail_who: get("Loss_Reason_Detail_Who__c"),
      loss_reason_detail_why: get("Loss_Reason_Detail_Why__c"),
      loss_reason_further_details_who: get(
        "Loss_Reason_Further_Details_Who__c"
      ),
      loss_reason_further_details_why: get(
        "Loss_Reason_Further_Details_Why__c"
      ),
      loss_reason_who: get("Loss_Reason_Who__c"),
      loss_reason_why: get("Loss_Reason_Why__c"),
      competitors: get("Competitors__c"),
      product_categories: get("Product_CategoriesDLRS__c"),
      sso_identity_access_provider: get("SSO_Identity_Access_Provider__c"),
      was_sso_determining_factor: get(
        "Was_SSO_a_determining_factor_for_Enterpr__c"
      ),
      onboarding_poc: get("Onboarding_POC__c"),
      onboarding_setup: get("Onboarding_Setup__c"),
      arr: num("ARR__c"),
      calculated_arr: num("Calculated_ARR__c"),
      commissionable_arr: num("Commissionable_ARR__c"),
      commissionable_arr_adjustment_date: get(
        "Commissionable_ARR_Adjustment_Date__c"
      ),
      current_team_arr: num("Current_Team_ARR__c"),
      net_incremental_arr: num("Net_Incremental_ARR__c"),
      adjustments_to_net_incremental_arr: num(
        "Adjustments_to_Net_incremental_ARR__c"
      ),
      adjustment_to_commissionable_arr: num(
        "Adjustment_to_Commissionable_ARR__c"
      ),
      booked_active_arr: num("Booked_Active_ARRDLRS__c"),
      opportunity_arr_year_1: num("Opportunity_ARR_Year_1__c"),
      opportunity_arr_year_2: num("Opportunity_ARR_Year_2__c"),
      opportunity_arr_year_3: num("Opportunity_ARR_Year_3__c"),
      renewable_arr: num("Renewable_ARR__c"),
      renewal_arr_delta: num("Renewal_ARR_Delta__c"),
      renewal_commissionable_arr: num("Renewal_Commissionable_ARR__c"),
      renewal_quota_arr: num("Renewal_Quota_ARR__c"),
      total_team_arr_at_booking: num(
        "Total_Team_ARR_at_Booking__c"
      ),
      record_metadata: {
        created_date: get("CreatedDate"),
        last_modified_date: get("LastModifiedDate"),
        created_by_id: get("CreatedById"),
        last_modified_by_id: get("LastModifiedById"),
        owner_id: get("OwnerId"),
        record_type_id: get("RecordTypeId"),
        territory2_id: get("Territory2Id"),
        is_excluded_from_territory2_filter: get(
          "IsExcludedFromTerritory2Filter"
        ),
      },
    };
  }

  private transformOpportunityContactRoleData(ocr: RecordLike): RecordLike {
    return {
      sf_ocr_id: ocr.Id,
      contact_id: ocr.ContactId,
      opportunity_id: ocr.OpportunityId,
      role: ocr.Role,
      is_primary: ocr.IsPrimary,
      job_level: ocr.Job_Level__c,
      title: ocr.Title__c,
      record_metadata: {
        created_by_id: ocr.CreatedById,
        last_modified_by_id: ocr.LastModifiedById,
      },
    };
  }

  async lookupOpportunity(
    opportunityId?: string,
    accountId?: string,
    opportunityName?: string,
    includeContactRoles = true,
    queryIntent: string = "general"
  ): Promise<RecordLike> {
    const intent = this.validateQueryIntent(
      queryIntent,
      "opportunity"
    ) as OpportunityIntent;

    if (opportunityId && !this.validateSalesforceId(opportunityId, "Opportunity")) {
      console.error(`Invalid Opportunity ID format: ${opportunityId}`);
      return {
        error: "Invalid opportunity ID format",
        opportunity: null,
        opportunities: [],
        contact_roles: [],
      };
    }
    if (accountId && !this.validateSalesforceId(accountId, "Account")) {
      console.error(`Invalid Account ID format: ${accountId}`);
      return {
        error: "Invalid account ID format",
        opportunity: null,
        opportunities: [],
        contact_roles: [],
      };
    }

    console.log(
      `Salesforce opportunity lookup: id=${opportunityId}, account_id=${accountId}, name=${opportunityName} (intent: ${intent})`
    );

    const token = await this.getAccessToken();
    if (!token) {
      console.error("Salesforce OAuth failed, returning empty result");
      return {
        error: "OAuth failed",
        opportunity: null,
        opportunities: [],
        contact_roles: [],
      };
    }

    if (opportunityId) {
      const opportunity = await this.getOpportunityFullData(opportunityId);
      if (!opportunity) {
        return {
          error: "Failed to retrieve opportunity",
          opportunity: null,
          opportunities: [],
          contact_roles: [],
        };
      }
      const oppContextFull = this.transformOpportunityData(opportunity);
      const oppContext = this.filterOpportunityDataByIntent(oppContextFull, intent);
      let contactRoles: RecordLike[] = [];
      if (includeContactRoles) {
        const ocrRecords = await this.getOpportunityContactRoles(
          opportunity.Id as string
        );
        contactRoles = ocrRecords.map((ocr) =>
          this.transformOpportunityContactRoleData(ocr)
        );
      }
      return {
        opportunity: oppContext,
        opportunities: [],
        contact_roles: contactRoles,
        sf_opportunity_id: opportunity.Id,
        query_intent: intent,
      };
    }

    if (accountId) {
      const searchResults = await this.searchOpportunities(
        accountId,
        opportunityName,
        undefined,
        100
      );

      if (searchResults.length === 0) {
        return {
          error: null,
          opportunity: null,
          opportunities: [],
          contact_roles: [],
          query_intent: intent,
        };
      }

      const opportunities: RecordLike[] = [];
      const allContactRoles: RecordLike[] = [];

      for (const opp of searchResults) {
        const oppId = opp.Id as string;
        const fullOpp = await this.getOpportunityFullData(oppId);
        if (!fullOpp) continue;

        const oppContextFull = this.transformOpportunityData(fullOpp);
        const oppContext = this.filterOpportunityDataByIntent(oppContextFull, intent);

        let contactRoles: RecordLike[] = [];
        if (includeContactRoles) {
          const ocrRecords = await this.getOpportunityContactRoles(oppId);
          contactRoles = ocrRecords.map((ocr) =>
            this.transformOpportunityContactRoleData(ocr)
          );
        }

        opportunities.push(oppContext);
        allContactRoles.push(...contactRoles);
      }

      console.log(
        `Retrieved ${opportunities.length} opportunities for account ${accountId}`
      );

      return {
        opportunity: opportunities[0] ?? null,
        opportunities,
        contact_roles: allContactRoles,
        sf_opportunity_id: opportunities[0]?.sf_opportunity_id ?? null,
        query_intent: intent,
      };
    }

    if (opportunityName) {
      const searchResults = await this.searchOpportunities(
        undefined,
        opportunityName,
        undefined,
        1
      );

      if (searchResults.length === 0) {
        return {
          error: "No opportunities found",
          opportunity: null,
          opportunities: [],
          contact_roles: [],
        };
      }

      const oppId = searchResults[0].Id as string;
      const opportunity = await this.getOpportunityFullData(oppId);
      if (!opportunity) {
        return {
          error: "Failed to retrieve opportunity",
          opportunity: null,
          opportunities: [],
          contact_roles: [],
        };
      }

      const oppContextFull = this.transformOpportunityData(opportunity);
      const oppContext = this.filterOpportunityDataByIntent(oppContextFull, intent);
      let contactRoles: RecordLike[] = [];
      if (includeContactRoles) {
        const ocrRecords = await this.getOpportunityContactRoles(oppId);
        contactRoles = ocrRecords.map((ocr) =>
          this.transformOpportunityContactRoleData(ocr)
        );
      }

      return {
        opportunity: oppContext,
        opportunities: [],
        contact_roles: contactRoles,
        sf_opportunity_id: opportunity.Id,
        query_intent: intent,
      };
    }

    console.error("No lookup parameters provided");
    return {
      error: "No lookup parameters provided",
      opportunity: null,
      opportunities: [],
      contact_roles: [],
    };
  }
}
