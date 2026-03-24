"""
Shared LaunchDarkly flag logic used by both the agent (tools, on-demand reports)
and the ingestion container (scheduled Slack notifications).
"""
import os
import time
from datetime import datetime, timezone
import requests

LD_API_KEY = os.environ.get("LAUNCHDARKLY_API_KEY", "")
LD_PROJECT_KEY = os.environ.get("LAUNCHDARKLY_PROJECT_KEY", "default")
LD_PROD_ENV = os.environ.get("LAUNCHDARKLY_PRODUCTION_ENV", "production")
LD_BASE_URL = "https://app.launchdarkly.com/api/v2"
ROLLOUT_THRESHOLD_DAYS = 14

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "")

SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "")
SLACK_NOTIFY_CHANNEL = os.environ.get("SLACK_NOTIFY_CHANNEL", "")

REPORT_WINDOW_HOURS = 336  # 2 weeks — flags that crossed the threshold within this window are "newly eligible"


def _interval_label() -> str:
    return "bi-weekly"


def _ld_headers() -> dict:
    return {"Authorization": LD_API_KEY, "Content-Type": "application/json"}


def _days_ago(timestamp_ms: int) -> float:
    """Return how many days ago a millisecond timestamp was."""
    now_ms = time.time() * 1000
    return (now_ms - timestamp_ms) / (1000 * 60 * 60 * 24)


def _is_fully_rolled_out(env: dict, on_variation: int) -> bool:
    """Return True if the environment is targeting-on and serving on_variation to 100%."""
    if not env.get("on", False):
        return False
    fallthrough = env.get("fallthrough", {})
    if fallthrough.get("variation") == on_variation:
        return True
    rollout = fallthrough.get("rollout", {})
    for v in rollout.get("variations", []):
        if v.get("variation") == on_variation and v.get("weight", 0) == 100000:
            return True
    return False


def _get_code_ref_counts() -> dict:
    """Return {flag_key: numCodeRefs} from the LD code-reference stats API, or {} if unavailable."""
    url = f"{LD_BASE_URL}/code-refs/statistics/{LD_PROJECT_KEY}"
    try:
        resp = requests.get(url, headers=_ld_headers(), timeout=15)
        if not resp.ok:
            return {}
        return {k: v.get("numCodeRefs", 0) for k, v in resp.json().get("flags", {}).items()}
    except requests.RequestException:
        return {}


def _count_github_refs(flag_key: str) -> int:
    """Return the number of files in GITHUB_REPO containing flag_key, or -1 on error."""
    if not GITHUB_TOKEN or not GITHUB_REPO:
        return -1
    try:
        resp = requests.get(
            "https://api.github.com/search/code",
            headers={"Authorization": f"Bearer {GITHUB_TOKEN}"},
            params={"q": f'"{flag_key}" repo:{GITHUB_REPO}', "per_page": 1},
            timeout=10,
        )
        if resp.ok:
            return resp.json().get("total_count", -1)
    except requests.RequestException:
        pass
    return -1


def _fetch_eligible_flags() -> tuple[list, list, str]:
    """
    Fetch all LD flags and return (newly_eligible, all_eligible, error).
    newly_eligible: flags that crossed the 14-day threshold within the current interval.
    all_eligible: all flags at 14+ days, sorted oldest first.
    """
    url = f"{LD_BASE_URL}/flags/{LD_PROJECT_KEY}"
    params = {"env": LD_PROD_ENV, "summary": "false"}
    try:
        resp = requests.get(url, headers=_ld_headers(), params=params, timeout=15)
        if not resp.ok:
            return [], [], f"Error fetching flags ({resp.status_code}): {resp.text}"
    except requests.RequestException as e:
        return [], [], f"Error fetching flags: {e}"

    interval_days = REPORT_WINDOW_HOURS / 24.0
    ld_stats = _get_code_ref_counts()
    newly_eligible = []
    all_eligible = []

    for flag in resp.json().get("items", []):
        env = flag.get("environments", {}).get(LD_PROD_ENV, {})
        on_variation = env.get("onVariation", 0)
        if not _is_fully_rolled_out(env, on_variation):
            continue
        last_modified_ms = env.get("lastModified") or 0
        if not last_modified_ms:
            continue
        days_since = _days_ago(last_modified_ms)
        if days_since < ROLLOUT_THRESHOLD_DAYS:
            continue
        key = flag.get("key", "")
        ref_count = ld_stats[key] if key in ld_stats else _count_github_refs(key)
        entry = {
            "key": key,
            "name": flag.get("name", ""),
            "days_since": days_since,
            "last_modified_ms": last_modified_ms,
            "code_refs": ref_count,
        }
        all_eligible.append(entry)
        if days_since < ROLLOUT_THRESHOLD_DAYS + interval_days:
            newly_eligible.append(entry)

    newly_eligible.sort(key=lambda f: f["days_since"])
    all_eligible.sort(key=lambda f: f["days_since"], reverse=True)
    return newly_eligible, all_eligible, ""


def _format_flag_entry(f: dict, ld_base: str) -> str:
    """Format a single flag entry for a Slack report section."""
    last_modified = datetime.fromtimestamp(
        f["last_modified_ms"] / 1000, tz=timezone.utc
    ).strftime("%Y-%m-%d")
    n = f["code_refs"]
    if n == 0:
        ref_str = ":white_check_mark: no code references — safe to delete from LaunchDarkly"
    elif n > 0:
        ref_str = f":hammer_and_wrench: {n} code reference(s) — remove flag from code first"
    else:
        ref_str = ":question: code reference count unavailable"
    ld_url = f"{ld_base}/{f['key']}/targeting"
    return (
        f"• *<{ld_url}|{f['key']}>*\n"
        f"  Last modified in production: {last_modified} ({int(f['days_since'])} days ago)\n"
        f"  {ref_str}"
    )


def _post_to_slack(text: str) -> None:
    """Post a message to the configured Slack channel via chat.postMessage."""
    resp = requests.post(
        "https://slack.com/api/chat.postMessage",
        headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"},
        json={"channel": SLACK_NOTIFY_CHANNEL, "text": text, "mrkdwn": True},
        timeout=15,
    )
    try:
        data = resp.json()
        if not data.get("ok"):
            print(f"[report] Slack notification failed: {data.get('error')}")
    except Exception:
        print(f"[report] Slack API error: {resp.status_code}")
