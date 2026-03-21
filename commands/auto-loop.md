---
description: "Start Auto Loop - auto-continues until task completion. Use: /auto-loop <task description>"
---

# Auto Loop

Parse `$ARGUMENTS` for the task description and an optional `--max <number>` flag.

- If `$ARGUMENTS` contains `--max <number>`, extract that number as **maxIterations** and remove it from the task string.
- Otherwise, use **maxIterations**: 25

Invoke the `auto-loop` tool with:

- **task**: the extracted task description
- **maxIterations**: the extracted or default value

Examples:
- `/auto-loop Build a REST API` → task="Build a REST API", maxIterations=25
- `/auto-loop Build a REST API --max 50` → task="Build a REST API", maxIterations=50
- `/auto-loop --max 10 Fix all lint errors` → task="Fix all lint errors", maxIterations=10

After the tool confirms the loop is active, **immediately begin working on the task**. Do not just acknowledge — start doing the work right away.

## Progress Tracking

Before going idle, you MUST output structured progress so the plugin knows where you left off:

```markdown
## Completed
- [x] What you finished this iteration

## Next Steps
- [ ] What needs to be done next (in priority order)
```

## Completion

When the task is FULLY completed, signal completion by outputting the promise-DONE XML tag on its own line:

<promise>DONE</promise>

**IMPORTANT:** ONLY output this when the task is COMPLETELY and VERIFIABLY finished. Do NOT output false promises to escape the loop.

## Cancellation

Use `/cancel-auto-loop` to stop early.
