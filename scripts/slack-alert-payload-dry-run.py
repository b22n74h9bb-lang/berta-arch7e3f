#!/usr/bin/env python3
"""Local dry-run for the Slack alert payload builder (no network, no secrets)."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


def clean(value: object, limit: int = 200) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit]


def build(env: dict[str, str]) -> tuple[bool, str]:
    url = env.get("SLACK_WEBHOOK_URL", "").strip()
    event = env.get("EVENT_NAME", "")
    repo = clean(env.get("REPO"), 120)
    text = ""
    mode = clean(env.get("DISPATCH_MODE"), 40)

    if not url:
        return False, ""
    if event == "pull_request" or (event == "workflow_dispatch" and mode == "e2e"):
        text = (
            f"E2E Slack alert test: {repo} "
            f"PR #{clean(env.get('PR_NUMBER'), 12)} "
            f"label {clean(env.get('PR_LABEL') or 'workflow_dispatch', 40)} "
            f"({clean(env.get('PR_SHA') or env.get('GITHUB_SHA'), 12)}) "
            f"{clean(env.get('PR_URL') or env.get('RUN_URL'), 300)}"
        )
    elif event == "workflow_run":
        text = (
            f"CI {clean(env.get('WF_CONCLUSION'))}: {repo} "
            f"workflow {clean(env.get('WF_NAME'))} "
            f"on {clean(env.get('WF_BRANCH'))} "
            f"({clean(env.get('WF_SHA'), 12)}) "
            f"{clean(env.get('WF_URL'), 300)}"
        )
    return bool(url and text), text


def main() -> None:
    cases = [
        ("skip-without-secret", {"EVENT_NAME": "pull_request", "REPO": "b22n74h9bb-lang/berta-arch7e3f"}),
        (
            "post-with-secret-e2e",
            {
                "SLACK_WEBHOOK_URL": "https://hooks.example.invalid/services/TEST",
                "EVENT_NAME": "pull_request",
                "REPO": "b22n74h9bb-lang/berta-arch7e3f",
                "PR_NUMBER": "3",
                "PR_LABEL": "e2e-slack-notify",
                "PR_SHA": "deadbeefcafebabe",
                "PR_URL": "https://github.com/b22n74h9bb-lang/berta-arch7e3f/pull/3",
            },
        ),
        (
            "post-with-secret-ci-failure",
            {
                "SLACK_WEBHOOK_URL": "https://hooks.example.invalid/services/TEST",
                "EVENT_NAME": "workflow_run",
                "REPO": "b22n74h9bb-lang/berta-arch7e3f",
                "WF_CONCLUSION": "failure",
                "WF_NAME": "example",
                "WF_BRANCH": "main",
                "WF_SHA": "abcdef123456",
                "WF_URL": "https://github.com/b22n74h9bb-lang/berta-arch7e3f/actions/runs/1",
            },
        ),
    ]

    results = []
    for name, env in cases:
        present, text = build(env)
        results.append({"case": name, "present": present, "text": text})
        print(f"{name}: present={present}")
        if text:
            print(f"  text={text}")

    skip = results[0]
    post = results[1]
    assert skip["present"] is False, "empty secret must skip"
    assert post["present"] is True, "secret + e2e must build payload"
    assert "E2E Slack alert test" in post["text"]
    print("DRY_RUN=PASS")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
