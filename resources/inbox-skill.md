---
name: cc-inbox
description: Push project updates to the user's inbox in Claude Code Terminal Center.
---

# cc-inbox — push to the user's inbox

Claude Code Terminal Center exposes one MCP server, `cc-inbox`, with a single
tool: `inbox_push`. Use it to surface something the user should see — a
finished analysis, a question, a blocked task, a status check-in — without
making them re-read your terminal scrollback.

## Installation

This skill is shipped, not auto-installed. To install it for a project, copy
this file to:

```
.claude/skills/cc-inbox/SKILL.md
```

inside the project root. Claude Code will pick it up on next launch. The
`cc-inbox` MCP server is wired up automatically by the launcher — you don't
need to touch `.mcp.json`.

## The tool

**Tool:** `cc-inbox.inbox_push`

**Schema:**

```ts
{
  docs?: Array<{ path: string }>,  // paths relative to the project root
  comments?: string                 // markdown
}
```

At least one of `docs` / `comments` must be present.

## When to use it

Push an update to the user's inbox from this project. Use this when you have
something the user should see — a finished analysis (point to the report file
via `docs`), a question back to the user (write it as `comments`), a blocked
task that needs input, or a status check-in.

`docs` are paths relative to this project root. Each one is rendered live in
the inbox UI when the user opens the entry — no snapshot is taken, so later
edits to the file will be reflected on subsequent reads.

`comments` is markdown — your voice to the user about what you did or want to
ask. Keep it short and direct; if more detail is needed put it in a doc and
reference it.

## Examples

**Just a comment** (a question or status):

```
inbox_push({
  comments: "Finished the migration audit. Two files use the legacy API and need a human eye — see `audit/report.md`. Want me to attempt the rewrite?"
})
```

**Comment plus a doc pointer** (preferred for deliverables):

```
inbox_push({
  comments: "Macro analysis for 2026-05-14 done.",
  docs: [{ path: "research/macro-2026-05-14.md" }]
})
```

**Just docs** (when the doc speaks for itself):

```
inbox_push({
  docs: [{ path: "design/proposed-api.md" }]
})
```

## Notes

- The project identity is supplied by the URL path of the MCP endpoint, not
  by you — you cannot push to a different project's inbox even if you tried.
- `docs` are pointers, never snapshots. If you regenerate `report.md` later,
  the user sees the new content next time they open the entry.
- Don't push noise — every entry buys the user's attention. One good push at
  the end of a task beats five status pings.
