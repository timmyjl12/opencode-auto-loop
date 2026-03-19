---
description: Start Auto Loop - auto-continues until task completion
---

# Auto Loop

Start an iterative development loop that automatically continues until the task is complete.

## Setup

Create the state file in the project directory:

```bash
mkdir -p .opencode && cat > .opencode/auto-loop.local.md << 'EOF'
---
active: true
iteration: 0
maxIterations: 100
---

$ARGUMENTS
EOF
```

## Task

Now begin working on the task: **$ARGUMENTS**

## Progress Tracking

Before going idle, you MUST output structured progress so the plugin knows where you left off:

```markdown
## Completed
- [x] What you finished this iteration

## Next Steps
- [ ] What needs to be done next (in priority order)
```

The plugin extracts these into the state file for the next iteration's continuation prompt.

## Completion

When the task is FULLY completed, signal completion by outputting:

```
<promise>DONE</promise>
```

**IMPORTANT:** ONLY output this when the task is COMPLETELY and VERIFIABLY finished. Do NOT output false promises to escape the loop.

## Cancellation

Use `/cancel-auto-loop` to stop early.
