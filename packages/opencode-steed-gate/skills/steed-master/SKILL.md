---
name: steed-master
description: Dynamic Steed self-awareness skill for live repo, version, docs, and freestyle operations.
---

# Steed Master Skill

Use this skill when the user asks about Steed itself, wants a capability overview, or wants Steed to execute freestyle tasks with current repo awareness.

## Goals

- Keep answers fast by using local repo state first.
- Keep answers current by optionally checking upstream head.
- Ground decisions in live code and docs, not static summaries.

## Fast Discovery Loop

1. Run `/steed self --json`.
2. Use `local_reference_paths` from that output as the default source of truth.
3. If freshness matters, run `/steed self --check-remote --json`.
4. If `remote.status` is `update-available`, compare local files with `remote_reference_urls`.

## What `/steed self` Provides

- Project root and active workflow profile.
- Workflow cfg path currently in use.
- Repo origin URL and normalized web URL.
- Installed git identity (commit, branch, describe, dirty/clean).
- Optional remote default-branch comparison (`--check-remote`).
- Curated local paths and remote URLs for rapid follow-up reads.

## Operating Modes

- **Q&A mode**: explain behavior from current code/docs with exact file references.
- **Diff mode**: compare installed commit with remote head and call out drift.
- **Freestyle mode**: execute requested Steed operations, then report state changes and next steps.

## Tooling Guidance

- Prefer local file reads for speed.
- Use Context7/websearch/grep_app when user asks for external or latest references.
- Use remote URL reads only when needed for freshness verification.
- Keep outputs actionable: command to run, state observed, and next recommendation.
