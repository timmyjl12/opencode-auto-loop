---
description: Start Auto Loop - auto-continues until task completion
---

# Auto Loop

Invoke the `auto-loop` tool with the following arguments:

- **task**: $ARGUMENTS
- **maxIterations**: 100

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
