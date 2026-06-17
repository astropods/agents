import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Octokit } from "@octokit/rest";
import type { AnalyzedIssue } from "./utils";
import {
  buildUserMessage,
  fetchComments,
  fetchIssues,
  fetchSingleIssue,
  formatFullReport,
  formatIssueReport,
  normalizeAnalysis,
} from "./utils";

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  spies.forEach((s) => {
    s.mockRestore();
  });
  spies.length = 0;
});

function mockFetch(body: unknown, status = 200) {
  return spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("fetchSingleIssue", () => {
  test("returns issue data from the GitHub API", async () => {
    const spy = mockFetch({
      number: 7,
      title: "Login is broken",
      html_url: "https://github.com/owner/repo/issues/7",
      body: "Steps to reproduce...",
      comments: 3,
    });
    spies.push(spy);
    const octokit = new Octokit();
    const result = await fetchSingleIssue(octokit, "owner", "repo", 7);
    expect(result.number).toBe(7);
    expect(result.title).toBe("Login is broken");
  });

  test("calls the correct GitHub API endpoint", async () => {
    const spy = mockFetch({
      number: 42,
      title: "A bug",
      html_url: "https://github.com/a/b/issues/42",
      body: "",
      comments: 0,
    });
    spies.push(spy);
    const octokit = new Octokit();
    await fetchSingleIssue(octokit, "a", "b", 42);
    const url = (spy.mock.calls[0] as [string, unknown])[0] as string;
    expect(url).toContain("/repos/a/b/issues/42");
  });
});

describe("fetchComments", () => {
  test("returns comment bodies from the GitHub API", async () => {
    const spy = mockFetch([
      { id: 1, body: "First comment." },
      { id: 2, body: "Second comment." },
    ]);
    spies.push(spy);
    const octokit = new Octokit();
    const comments = await fetchComments(octokit, "owner", "repo", 7);
    expect(comments).toEqual(["First comment.", "Second comment."]);
  });

  test("skips comments with null body", async () => {
    const spy = mockFetch([
      { id: 1, body: "Valid." },
      { id: 2, body: null },
    ]);
    spies.push(spy);
    const octokit = new Octokit();
    const comments = await fetchComments(octokit, "owner", "repo", 7);
    expect(comments).toEqual(["Valid."]);
  });

  test("returns empty array when there are no comments", async () => {
    const spy = mockFetch([]);
    spies.push(spy);
    const octokit = new Octokit();
    const comments = await fetchComments(octokit, "owner", "repo", 7);
    expect(comments).toEqual([]);
  });

  test("fetches multiple pages when first page returns 100 items", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      body: `Comment ${i + 1}`,
    }));
    const page2 = [{ id: 101, body: "Last comment" }];
    const jsonResponse = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const spy = spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));
    spies.push(spy);
    const octokit = new Octokit();
    const comments = await fetchComments(octokit, "owner", "repo", 7);
    expect(comments).toHaveLength(101);
    expect(comments[0]).toBe("Comment 1");
    expect(comments[100]).toBe("Last comment");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("fetchIssues", () => {
  test("excludes pull requests from results", async () => {
    const spy = mockFetch([
      { number: 1, title: "Bug" },
      { number: 2, title: "A PR", pull_request: { url: "..." } },
      { number: 3, title: "Feature" },
    ]);
    spies.push(spy);
    const octokit = new Octokit();
    const issues = await fetchIssues(octokit, "owner", "repo", 50);
    expect(issues.map((i) => i.number)).toEqual([1, 3]);
  });

  test("respects the maxIssues limit", async () => {
    const spy = mockFetch(
      Array.from({ length: 5 }, (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
      })),
    );
    spies.push(spy);
    const octokit = new Octokit();
    const issues = await fetchIssues(octokit, "owner", "repo", 2);
    expect(issues).toHaveLength(2);
  });

  test("returns empty array when repo has no open issues", async () => {
    const spy = mockFetch([]);
    spies.push(spy);
    const octokit = new Octokit();
    const issues = await fetchIssues(octokit, "owner", "repo", 10);
    expect(issues).toHaveLength(0);
  });

  test("fetches multiple pages when first page returns 100 items", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
    }));
    const page2 = [{ number: 101, title: "Issue 101" }];
    const jsonResponse = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const spy = spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));
    spies.push(spy);
    const octokit = new Octokit();
    const issues = await fetchIssues(octokit, "owner", "repo", 200);
    expect(issues).toHaveLength(101);
    expect(issues[0].number).toBe(1);
    expect(issues[100].number).toBe(101);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// normalizeAnalysis
// ---------------------------------------------------------------------------

describe("normalizeAnalysis", () => {
  test("passes through a valid analysis unchanged", () => {
    const input = {
      summary: "A bug.",
      sentiment: "frustration",
      sentiment_details: "Users are upset.",
      competitive_mentions: ["competitor-x"],
      workarounds: ["use flag --foo"],
      priority: "high",
      priority_reason: "Causes data loss.",
    };
    const result = normalizeAnalysis(input);
    expect(result.priority).toBe("high");
    expect(result.sentiment).toBe("frustration");
    expect(result.competitive_mentions).toEqual(["competitor-x"]);
    expect(result.workarounds).toEqual(["use flag --foo"]);
  });

  test('falls back to "low" for unknown priority', () => {
    expect(normalizeAnalysis({ priority: "critical" }).priority).toBe("low");
    expect(normalizeAnalysis({ priority: "" }).priority).toBe("low");
    expect(normalizeAnalysis({ priority: 123 }).priority).toBe("low");
  });

  test('falls back to "neutral" for unknown sentiment', () => {
    expect(normalizeAnalysis({ sentiment: "angry" }).sentiment).toBe("neutral");
    expect(normalizeAnalysis({}).sentiment).toBe("neutral");
  });

  test('falls back to "(no summary)" for missing summary', () => {
    expect(normalizeAnalysis({}).summary).toBe("(no summary)");
    expect(normalizeAnalysis({ summary: 42 }).summary).toBe("(no summary)");
  });

  test("returns empty arrays for missing/invalid array fields", () => {
    const result = normalizeAnalysis({
      competitive_mentions: "foo",
      workarounds: null,
    });
    expect(result.competitive_mentions).toEqual([]);
    expect(result.workarounds).toEqual([]);
  });

  test("filters non-string entries from array fields", () => {
    const result = normalizeAnalysis({
      competitive_mentions: ["validTool", 42, null, "anotherTool"],
      workarounds: [true, "use workaround", undefined],
    });
    expect(result.competitive_mentions).toEqual(["validTool", "anotherTool"]);
    expect(result.workarounds).toEqual(["use workaround"]);
  });

  test("handles null and non-object input gracefully", () => {
    expect(() => normalizeAnalysis(null)).not.toThrow();
    expect(() => normalizeAnalysis("string")).not.toThrow();
    expect(() => normalizeAnalysis(42)).not.toThrow();
    expect(normalizeAnalysis(null).priority).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// formatIssueReport
// ---------------------------------------------------------------------------

function makeFullIssue(overrides: Partial<AnalyzedIssue> = {}): AnalyzedIssue {
  return {
    number: 42,
    title: "Something is broken",
    url: "https://github.com/owner/repo/issues/42",
    upvotes: 7,
    total_reactions: 10,
    comment_count: 3,
    analysis: {
      summary: "A widget crashes on startup.",
      sentiment: "frustration",
      sentiment_details: "Users are very frustrated.",
      competitive_mentions: [],
      workarounds: [],
      priority: "high",
      priority_reason: "Causes data loss.",
    },
    ...overrides,
  };
}

describe("formatIssueReport", () => {
  test("includes issue number, title, and URL", () => {
    const report = formatIssueReport(makeFullIssue());
    expect(report).toContain("#42");
    expect(report).toContain("Something is broken");
    expect(report).toContain("https://github.com/owner/repo/issues/42");
  });

  test("includes reaction counts and comment count", () => {
    const report = formatIssueReport(makeFullIssue());
    expect(report).toContain("7 upvotes");
    expect(report).toContain("10 total");
    expect(report).toContain("3 comments");
  });

  test("includes priority and sentiment in uppercase", () => {
    const report = formatIssueReport(makeFullIssue());
    expect(report).toContain("HIGH");
    expect(report).toContain("Causes data loss.");
    expect(report).toContain("FRUSTRATION");
    expect(report).toContain("Users are very frustrated.");
  });

  test("includes summary text", () => {
    const report = formatIssueReport(makeFullIssue());
    expect(report).toContain("A widget crashes on startup.");
  });

  test("shows competitive mentions section when array is non-empty", () => {
    const issue = makeFullIssue({
      analysis: {
        ...makeFullIssue().analysis,
        competitive_mentions: ["ToolA", "ToolB"],
      },
    });
    const report = formatIssueReport(issue);
    expect(report).toContain("Competitor/alternative mentions");
    expect(report).toContain("ToolA");
    expect(report).toContain("ToolB");
  });

  test("shows workarounds section when array is non-empty", () => {
    const issue = makeFullIssue({
      analysis: {
        ...makeFullIssue().analysis,
        workarounds: ["use flag --foo", "downgrade to v1"],
      },
    });
    const report = formatIssueReport(issue);
    expect(report).toContain("Workarounds reported");
    expect(report).toContain("• use flag --foo");
    expect(report).toContain("• downgrade to v1");
  });

  test("omits both sections when arrays are empty", () => {
    const report = formatIssueReport(makeFullIssue());
    expect(report).not.toContain("Competitor");
    expect(report).not.toContain("Workarounds");
  });
});

// ---------------------------------------------------------------------------
// formatFullReport — sorting
// ---------------------------------------------------------------------------

function makeIssue(
  n: number,
  priority: "high" | "medium" | "low",
): AnalyzedIssue {
  return {
    number: n,
    title: `Issue ${n}`,
    url: `https://github.com/owner/repo/issues/${n}`,
    upvotes: 0,
    total_reactions: 0,
    comment_count: 0,
    analysis: {
      summary: "Summary.",
      sentiment: "neutral",
      sentiment_details: "",
      competitive_mentions: [],
      workarounds: [],
      priority,
      priority_reason: "reason",
    },
  };
}

describe("formatFullReport", () => {
  test("sorts issues high → medium → low", () => {
    const issues = [
      makeIssue(1, "low"),
      makeIssue(2, "high"),
      makeIssue(3, "medium"),
    ];
    const report = formatFullReport(issues, "owner/repo");
    const highPos = report.indexOf("Issue 2");
    const medPos = report.indexOf("Issue 3");
    const lowPos = report.indexOf("Issue 1");
    expect(highPos).toBeLessThan(medPos);
    expect(medPos).toBeLessThan(lowPos);
  });

  test("includes totals line", () => {
    const issues = [
      makeIssue(1, "high"),
      makeIssue(2, "high"),
      makeIssue(3, "low"),
    ];
    const report = formatFullReport(issues, "owner/repo");
    expect(report).toContain("high: 2");
    expect(report).toContain("medium: 0");
    expect(report).toContain("low: 1");
  });

  test("includes repo name in header", () => {
    const report = formatFullReport([makeIssue(1, "low")], "pallets/flask");
    expect(report).toContain("pallets/flask");
  });
});

// ---------------------------------------------------------------------------
// buildUserMessage
// ---------------------------------------------------------------------------

describe("buildUserMessage", () => {
  test("includes title, body, and comments", () => {
    const msg = buildUserMessage("My bug", "It crashes.", [
      "comment one",
      "comment two",
    ]);
    expect(msg).toContain("Title: My bug");
    expect(msg).toContain("It crashes.");
    expect(msg).toContain("[Comment 1]");
    expect(msg).toContain("[Comment 2]");
  });

  test("shows (no comments) when empty", () => {
    const msg = buildUserMessage("title", "body", []);
    expect(msg).toContain("(no comments)");
  });

  test("shows (no description) when body is empty", () => {
    const msg = buildUserMessage("title", "", []);
    expect(msg).toContain("(no description)");
  });

  test("truncates body at 2000 chars", () => {
    const longBody = "x".repeat(3000);
    const msg = buildUserMessage("title", longBody, []);
    expect(msg).toContain("x".repeat(2000));
    expect(msg).not.toContain("x".repeat(2001));
  });

  test("truncates each comment at 500 chars", () => {
    const longComment = "c".repeat(600);
    const msg = buildUserMessage("title", "body", [longComment]);
    expect(msg).toContain("c".repeat(500));
    expect(msg).not.toContain("c".repeat(501));
  });
});
