---
name: git-master
description: Structured git workflow skill for clean commits and safe history changes.
---

# Git Master Skill

Use this skill when changes are ready to stage, commit, inspect, or restructure safely.

## Core Objectives

- Keep history clear and reviewable.
- Preserve branch safety and avoid destructive operations.
- Explain intent in commit messages, not just file changes.

## Standard Flow

1. Inspect `git status` and `git diff` before staging.
2. Stage only relevant files for the intended change.
3. Create concise commit messages focused on rationale.
4. Re-check `git status` to verify clean expected state.

## Safety Rules

- Do not force-push protected branches.
- Do not amend already-pushed commits unless explicitly requested.
- Avoid mixing unrelated work in one commit.
- Prefer new commits over risky history rewrites.

## Review Checklist

- Commit scope matches a single intent.
- No secrets or generated noise are included.
- Tests/checks relevant to changed code are run.
- Follow-up actions are clear (push, PR, or additional fixes).
