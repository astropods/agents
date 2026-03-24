"""
feature-flag-helper-agent - Identifies feature flag code that can be removed and old feature flags to be deleted

Environment variables (automatically injected by 'astro dev'):
  ANTHROPIC_API_KEY - injected by anthropic model
  GITHUB_TOKEN - injected by github integration
  GRPC_SERVER_ADDR - injected by Astro messaging service

Required environment variables (set via astro configure):
  LAUNCHDARKLY_API_KEY - LaunchDarkly REST API key
  LAUNCHDARKLY_PROJECT_KEY - LaunchDarkly project key (defaults to "default")
  LAUNCHDARKLY_PRODUCTION_ENV - LaunchDarkly production environment key (defaults to "production")
  GITHUB_REPO - GitHub repository to search in the format "owner/repo"

Scheduled notifications (optional):
  SLACK_BOT_TOKEN - Slack bot token (xoxb-...) for proactive audit notifications
  SLACK_NOTIFY_CHANNEL - Slack channel ID or name to post scheduled reports to
  (Scheduling is handled by the ingestion container configured in astropods.yml; runs bi-weekly)
"""
import os
import re
from datetime import datetime, timezone
import requests
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain.agents import create_agent
from astropods_adapter_langchain import LangChainAdapter, serve
from astropods_adapter_langchain.adapter import _text_from_content
from astropods_adapter_core.types import StreamHooks, StreamOptions

from src.flags import (
    LD_API_KEY,
    LD_PROJECT_KEY,
    LD_PROD_ENV,
    LD_BASE_URL,
    ROLLOUT_THRESHOLD_DAYS,
    GITHUB_TOKEN,
    GITHUB_REPO,
    SLACK_BOT_TOKEN,
    SLACK_NOTIFY_CHANNEL,
    _ld_headers,
    _days_ago,
    _is_fully_rolled_out,
    _fetch_eligible_flags,
    _format_flag_entry,
    _post_to_slack,
    _interval_label,
)


@tool
def list_oldest_rolled_out_flags() -> str:
    """
    List the 10 oldest LaunchDarkly feature flags that have been fully rolled out
    to 100% in production for at least 2 weeks, sorted oldest first.

    Returns flag key, name, how long since rollout, and a LaunchDarkly link.
    To check GitHub code references for a specific flag, use search_github_for_flag.
    """
    if not LD_API_KEY:
        return "Error: LAUNCHDARKLY_API_KEY environment variable is not set."

    url = f"{LD_BASE_URL}/flags/{LD_PROJECT_KEY}"
    params = {"env": LD_PROD_ENV, "summary": "false"}

    try:
        resp = requests.get(url, headers=_ld_headers(), params=params, timeout=15)
        if not resp.ok:
            return f"Error fetching flags from LaunchDarkly ({resp.status_code}): {resp.text}"
    except requests.RequestException as e:
        return f"Error fetching flags from LaunchDarkly: {e}"

    candidates = []
    for flag in resp.json().get("items", []):
        env = flag.get("environments", {}).get(LD_PROD_ENV, {})
        on_variation_index = env.get("onVariation", 0)
        if not _is_fully_rolled_out(env, on_variation_index):
            continue
        last_modified_ms = env.get("lastModified") or 0
        if last_modified_ms == 0:
            continue
        days_since = _days_ago(last_modified_ms)
        if days_since >= ROLLOUT_THRESHOLD_DAYS:
            candidates.append({
                "key": flag.get("key", ""),
                "name": flag.get("name", ""),
                "last_modified_ms": last_modified_ms,
                "days_since": days_since,
            })

    if not candidates:
        return (
            f"No flags found that have been fully rolled out in `{LD_PROD_ENV}` "
            f"for {ROLLOUT_THRESHOLD_DAYS}+ days."
        )

    # Sort oldest first (largest days_since) and take top 10
    candidates.sort(key=lambda f: f["days_since"], reverse=True)
    top10 = candidates[:10]

    lines = [
        f"{len(top10)} oldest flags rolled out 100% in {LD_PROD_ENV} for "
        f"{ROLLOUT_THRESHOLD_DAYS}+ days (oldest first):\n"
    ]
    for f in top10:
        last_modified_str = datetime.fromtimestamp(
            f["last_modified_ms"] / 1000, tz=timezone.utc
        ).strftime("%Y-%m-%d")
        ld_url = (
            f"https://app.launchdarkly.com/projects/{LD_PROJECT_KEY}"
            f"/flags/{f['key']}/targeting"
        )
        lines.append(
            f"- {f['key']} ({f['name']})\n"
            f"  Last modified in production: {last_modified_str} ({int(f['days_since'])} days ago)\n"
            f"  LaunchDarkly: {ld_url}"
        )

    lines.append("\nTo check code references for a specific flag, ask me to search GitHub for it.")
    return "\n".join(lines)


@tool
def list_flags_with_no_code_references() -> str:
    """
    List LaunchDarkly feature flags that have zero code references across all
    repositories. These flags are orphaned and safe to delete from LaunchDarkly.

    Returns a formatted list of flag keys with no code references.
    """
    if not LD_API_KEY:
        return "Error: LAUNCHDARKLY_API_KEY environment variable is not set."

    # Get all flags for context (names)
    flags_url = f"{LD_BASE_URL}/flags/{LD_PROJECT_KEY}"
    try:
        flags_resp = requests.get(
            flags_url,
            headers=_ld_headers(),
            params={"summary": "true"},
            timeout=15,
        )
        if not flags_resp.ok:
            return f"Error fetching flags from LaunchDarkly ({flags_resp.status_code}): {flags_resp.text}"
        flags_resp.raise_for_status()
    except requests.RequestException as e:
        return f"Error fetching flags from LaunchDarkly: {e}"

    flag_names = {f["key"]: f.get("name", "") for f in flags_resp.json().get("items", [])}

    # Get code reference statistics
    stats_url = f"{LD_BASE_URL}/code-refs/statistics/{LD_PROJECT_KEY}"
    try:
        stats_resp = requests.get(stats_url, headers=_ld_headers(), timeout=15)
        if not stats_resp.ok:
            return f"Error fetching code reference statistics from LaunchDarkly ({stats_resp.status_code}): {stats_resp.text}"
        stats_resp.raise_for_status()
    except requests.RequestException as e:
        return (
            f"Error fetching code reference statistics from LaunchDarkly: {e}\n"
            "Ensure the LaunchDarkly Code References feature is enabled and at least "
            "one scan has been run."
        )

    stats = stats_resp.json().get("flags", {})
    no_refs = [
        key for key, data in stats.items() if data.get("numCodeRefs", 0) == 0
    ]

    if not no_refs:
        return "No flags with zero code references found."

    lines = [
        f"- {key} ({flag_names.get(key, 'unknown name')})"
        for key in sorted(no_refs)
    ]
    header = f"Found {len(lines)} flag(s) with no code references (safe to delete from LaunchDarkly):\n\n"
    return header + "\n".join(lines)


@tool
def get_flag_details(flag_key: str) -> str:
    """
    Get detailed information about a specific LaunchDarkly feature flag,
    including its targeting rules and rollout percentages across environments.

    Args:
        flag_key: The LaunchDarkly feature flag key.
    """
    if not LD_API_KEY:
        return "Error: LAUNCHDARKLY_API_KEY environment variable is not set."

    url = f"{LD_BASE_URL}/flags/{LD_PROJECT_KEY}/{flag_key}"
    params = {"env": LD_PROD_ENV}
    try:
        resp = requests.get(url, headers=_ld_headers(), params=params, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        return f"Error fetching flag '{flag_key}': {e}"

    flag = resp.json()
    env = flag.get("environments", {}).get(LD_PROD_ENV, {})
    last_modified_ms = env.get("lastModified", 0)
    last_modified_str = (
        datetime.fromtimestamp(last_modified_ms / 1000, tz=timezone.utc).strftime(
            "%Y-%m-%d %H:%M UTC"
        )
        if last_modified_ms
        else "unknown"
    )

    lines = [
        f"{flag.get('name')} ({flag_key})",
        f"Description: {flag.get('description', 'none')}",
        f"Kind: {flag.get('kind', 'unknown')}",
        f"Tags: {', '.join(flag.get('tags', [])) or 'none'}",
        f"\n{LD_PROD_ENV} environment:",
        f"  Targeting on: {env.get('on', False)}",
        f"  Fallthrough: {env.get('fallthrough', {})}",
        f"  Last modified: {last_modified_str} ({int(_days_ago(last_modified_ms))} days ago)",
        f"  Rules: {len(env.get('rules', []))} rule(s)",
    ]
    return "\n".join(lines)


@tool
def search_github_for_flag(flag_key: str) -> str:
    """
    Search GitHub for code references to a specific LaunchDarkly feature flag key.
    Returns matching files with code snippets and links so the caller knows exactly
    what to edit. Also returns a direct link to the flag in LaunchDarkly.

    Args:
        flag_key: The LaunchDarkly feature flag key to search for.
    """
    if not GITHUB_TOKEN:
        return "Error: GITHUB_TOKEN is not set. Ensure the github integration is configured."
    if not GITHUB_REPO:
        return "Error: GITHUB_REPO environment variable is not set (expected format: owner/repo)."

    ld_flag_url = (
        f"https://app.launchdarkly.com/projects/{LD_PROJECT_KEY}"
        f"/flags/{flag_key}/targeting"
    )

    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.text-match+json",
    }
    params = {"q": f'"{flag_key}" repo:{GITHUB_REPO}', "per_page": 10}

    try:
        resp = requests.get(
            "https://api.github.com/search/code",
            headers=headers,
            params=params,
            timeout=15,
        )
        if not resp.ok:
            return f"Error searching GitHub ({resp.status_code}): {resp.text}"
    except requests.RequestException as e:
        return f"Error searching GitHub: {e}"

    items = resp.json().get("items", [])
    if not items:
        return (
            f"No code references found for `{flag_key}` in `{GITHUB_REPO}`.\n"
            f"LaunchDarkly flag: {ld_flag_url}"
        )

    lines = [
        f"Found {len(items)} file(s) referencing `{flag_key}` in `{GITHUB_REPO}`:",
        f"LaunchDarkly flag: {ld_flag_url}\n",
    ]

    for item in items:
        file_url = item.get("html_url", "")
        file_path = item.get("path", "")
        lines.append(f"{file_path}: {file_url}")

        # text_matches contains snippets with the matching lines highlighted
        for match in item.get("text_matches", []):
            fragment = match.get("fragment", "").strip()
            if fragment:
                lines.append(f"```\n{fragment}\n```")

        lines.append("")

    return "\n".join(lines)


@tool
def preview_scheduled_report() -> str:
    """
    Preview the scheduled flag audit report as it would appear in Slack.
    Shows two sections: flags newly eligible for deprecation this interval,
    and the 5 oldest flags still waiting for cleanup. Use this to test the
    report format or manually trigger an audit without waiting for the schedule.
    """
    if not LD_API_KEY:
        return "Error: LAUNCHDARKLY_API_KEY environment variable is not set."

    newly_eligible, all_eligible, error = _fetch_eligible_flags()
    if error:
        return error
    if not all_eligible:
        return f"No flags have been at 100% in `{LD_PROD_ENV}` for {ROLLOUT_THRESHOLD_DAYS}+ days."

    ld_base = f"https://app.launchdarkly.com/projects/{LD_PROJECT_KEY}/flags"
    lines = [":triangular_flag_on_post: **Feature Flag Cleanup Report** (preview)\n"]

    if newly_eligible:
        lines.append(f"**{len(newly_eligible)} new flags eligible for deprecation:**")
        for f in newly_eligible:
            lines.append(_format_flag_entry(f, ld_base))
    else:
        lines.append(f"_No flags newly crossed the {ROLLOUT_THRESHOLD_DAYS}-day threshold this interval._")

    backlog = [f for f in all_eligible if f not in newly_eligible][:5]
    if backlog:
        lines.append(f"\n**Top {len(backlog)} additional stale flags:**")
        for f in backlog:
            lines.append(_format_flag_entry(f, ld_base))

    lines.append("\nDates reflect last modified in LaunchDarkly — verify actual rollout date before deprecating. Ask me about a specific flag to see code references.")
    return "\n".join(lines)


@tool
def send_report_to_slack() -> str:
    """
    Build the flag audit report and post it to the configured Slack channel immediately.
    Use this to test the Slack integration or to manually trigger a report outside the
    normal schedule.
    """
    if not SLACK_BOT_TOKEN:
        return "Error: SLACK_BOT_TOKEN is not configured."
    if not SLACK_NOTIFY_CHANNEL:
        return "Error: SLACK_NOTIFY_CHANNEL is not configured."
    if not LD_API_KEY:
        return "Error: LAUNCHDARKLY_API_KEY is not configured."

    newly_eligible, all_eligible, error = _fetch_eligible_flags()
    if error:
        return f"Error building report: {error}"

    ld_base = f"https://app.launchdarkly.com/projects/{LD_PROJECT_KEY}/flags"
    lines = [f":triangular_flag_on_post: *{_interval_label().capitalize()} LaunchDarkly Flag Report*\n"]

    if newly_eligible:
        lines.append(f"*{len(newly_eligible)} new flags eligible for deprecation:*")
        for f in newly_eligible:
            lines.append(_format_flag_entry(f, ld_base))
    else:
        lines.append(f"_No flags newly crossed the {ROLLOUT_THRESHOLD_DAYS}-day threshold this interval._")

    backlog = [f for f in all_eligible if f not in newly_eligible][:5]
    if backlog:
        lines.append(f"\n*Top {len(backlog)} additional stale flags:*")
        for f in backlog:
            lines.append(_format_flag_entry(f, ld_base))

    lines.append("\n_Dates reflect last modified in LaunchDarkly — verify actual rollout date before deprecating. Ask me about a specific flag to see code references._")
    report = "\n".join(lines)

    _post_to_slack(report)
    return f"Report sent to {SLACK_NOTIFY_CHANNEL}."


llm = ChatAnthropic(model="claude-sonnet-4-5")

tools = [
    list_oldest_rolled_out_flags,
    list_flags_with_no_code_references,
    get_flag_details,
    search_github_for_flag,
    preview_scheduled_report,
    send_report_to_slack,
]

system_prompt = (
    "You are the Feature Flag Helper Agent. You help engineering teams keep their "
    "codebase clean by identifying stale LaunchDarkly feature flags.\n\n"
    "You can identify two categories of flags to clean up:\n"
    "1. **Fully rolled out flags** — use list_oldest_rolled_out_flags to show the 10 "
    "oldest flags at 100% production rollout for 2+ weeks. Do not check GitHub for "
    "code references unless the user asks about a specific flag.\n"
    "2. **Orphaned flags** — flags with zero code references that can be deleted "
    "directly from LaunchDarkly.\n\n"
    "When the user asks about a specific flag, call search_github_for_flag to find "
    "exact code references. Include snippets, GitHub file links, and the LaunchDarkly "
    "flag link. Show exactly what to change: lines to delete and what the simplified "
    "code looks like after removing the flag check. Remind them to delete the flag "
    "from LaunchDarkly after the code change is deployed.\n\n"
    "3. **Audit preview** — if the user asks to preview or trigger the scheduled report, "
    "use preview_scheduled_report. Then format the response exactly as follows:\n"
    f"- Start with the title: 'Here is your {_interval_label()} LaunchDarkly Flag Report'\n"
    "- Two sections with bold headers: '### Newly Eligible for Deprecation' and '### Longest Overdue'\n"
    "- Each flag as a numbered list item: `1. [flag-key](ld_url) — last modified YYYY-MM-DD (X days ago) — (N code references)` "
    "or `(no code references)` or `(code references unavailable)`\n"
    "- Do not omit any flags or add extra commentary between list items."
)

class _PlatformAwareLangChainAdapter(LangChainAdapter):
    """Overrides stream to inject a platform-specific SystemMessage and strip
    code-block language identifiers for Slack before chunks are sent."""

    async def stream(self, prompt: str, hooks: StreamHooks, options: StreamOptions) -> None:
        # StreamOptions.platform isn't populated by the installed bridge version,
        # so infer from conversation_id: Slack IDs are {channelID}-{threadTS}
        # where channel IDs start with C (public), G (private), or D (DM).
        platform = getattr(options, "platform", "web")
        if platform == "web":
            cid = options.conversation_id or ""
            if re.match(r"^[CGD][A-Z0-9]", cid):
                platform = "slack"

        if platform == "slack":
            platform_instruction = (
                "You are responding in Slack. Use Slack mrkdwn formatting only: "
                "*bold* (never **double asterisks**), _italic_, `inline code`, "
                "``` for code blocks with NO language identifier (Slack does not "
                "support syntax highlighting — never write ```javascript or ```python), "
                "• for bullets, <url|text> for hyperlinks. Never use # headings."
            )
        else:
            platform_instruction = (
                "You are responding in a web chat. Use standard markdown: "
                "**bold**, _italic_, `code`, fenced code blocks with language identifiers, "
                "numbered or bulleted lists, [text](url) for links."
            )

        try:
            async for chunk in self._executor.astream(
                {"messages": [SystemMessage(content=platform_instruction), HumanMessage(content=prompt)]},
                stream_mode="updates",
            ):
                if "model" in chunk:
                    for msg in chunk["model"].get("messages", []):
                        tool_calls = getattr(msg, "tool_calls", None) or []
                        if tool_calls:
                            for tc in tool_calls:
                                tool_name = tc.get("name", "tool") if isinstance(tc, dict) else getattr(tc, "name", "tool")
                                hooks.on_status_update({"status": "PROCESSING", "custom_message": f"Running {tool_name}"})
                        else:
                            text = _text_from_content(msg.content)
                            if text:
                                if platform == "slack":
                                    text = re.sub(r"```[a-zA-Z]+\n", "```\n", text)
                                hooks.on_chunk(text)
                elif "tools" in chunk:
                    for msg in chunk["tools"].get("messages", []):
                        hooks.on_status_update({"status": "ANALYZING", "custom_message": f"Finished {getattr(msg, 'name', 'tool')}"})
            hooks.on_finish()
        except Exception as e:
            hooks.on_error(e)


agent = create_agent(llm, tools=tools, system_prompt=system_prompt)

adapter = _PlatformAwareLangChainAdapter(agent, name="feature-flag-assistant", system_prompt=system_prompt, tools=tools)

serve(adapter)
