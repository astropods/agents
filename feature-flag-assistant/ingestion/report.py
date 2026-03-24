"""
Ingestion container entrypoint — builds and posts the flag audit report to Slack.

Runs on a platform-managed schedule configured in astropods.yml.
Environment variables are injected by the Astro platform from inputs.
"""
import sys

from src.flags import (
    LD_API_KEY,
    LD_PROJECT_KEY,
    SLACK_BOT_TOKEN,
    SLACK_NOTIFY_CHANNEL,
    _fetch_eligible_flags,
    _format_flag_entry,
    _interval_label,
    _post_to_slack,
)


def build_report() -> str:
    newly_eligible, all_eligible, error = _fetch_eligible_flags()
    if error:
        return error
    if not newly_eligible:
        return ""

    ld_base = f"https://app.launchdarkly.com/projects/{LD_PROJECT_KEY}/flags"
    lines = [
        f":triangular_flag_on_post: *{_interval_label().capitalize()} LaunchDarkly Flag Report*\n",
        f"*{len(newly_eligible)} new flags eligible for deprecation:*",
    ]
    for f in newly_eligible:
        lines.append(_format_flag_entry(f, ld_base))

    backlog = [f for f in all_eligible if f not in newly_eligible][:5]
    if backlog:
        lines.append(f"\n*Top {len(backlog)} additional stale flags:*")
        for f in backlog:
            lines.append(_format_flag_entry(f, ld_base))

    lines.append("\n_Dates reflect last modified in LaunchDarkly — verify actual rollout date before deprecating. Ask me about a specific flag to see code references._")
    return "\n".join(lines)


def main() -> None:
    for val, name in [
        (LD_API_KEY, "LAUNCHDARKLY_API_KEY"),
        (SLACK_BOT_TOKEN, "SLACK_BOT_TOKEN"),
        (SLACK_NOTIFY_CHANNEL, "SLACK_NOTIFY_CHANNEL"),
    ]:
        if not val:
            print(f"[report] Missing required env var: {name}", flush=True)
            sys.exit(1)

    print("[report] Building flag audit report...", flush=True)
    report = build_report()
    if not report:
        print("[report] No newly eligible flags — skipping notification.", flush=True)
        return

    print(f"[report] Posting to {SLACK_NOTIFY_CHANNEL}...", flush=True)
    _post_to_slack(report)
    print("[report] Done.", flush=True)


if __name__ == "__main__":
    main()
