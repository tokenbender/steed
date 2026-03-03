---
name: playwright
description: Browser automation skill using Playwright MCP tools.
---

# Playwright Skill

Use this skill for browser-based validation, UI regression checks, and web data extraction.

## When to Use

- You need to navigate websites and verify UI state.
- You need deterministic screenshots or snapshots for evidence.
- You need repeatable browser actions in a workflow.

## Workflow

1. Define a short goal and success criteria.
2. Open/navigate to the target page.
3. Capture a structure snapshot before interacting.
4. Interact using stable selectors and re-check state.
5. Capture screenshot/evidence and summarize findings.

## Execution Rules

- Prefer Playwright MCP browser tools over ad-hoc shell scraping.
- Keep interactions explicit and idempotent.
- Re-check page state after every mutating action.
- Record exact failures with page URL and last successful step.

## Output Expectations

- Report what was validated.
- Include notable UI deltas and failed assertions.
- Reference captured artifacts when available.
