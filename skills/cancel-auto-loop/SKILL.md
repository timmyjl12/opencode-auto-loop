---
name: cancel-auto-loop
description: Cancel active Auto Loop
---

# Cancel Loop

Stop an active Auto Loop before completion.

## How to Use

When you need to cancel the loop, invoke the `cancel-auto-loop` tool. The tool will:

1. Check if a loop is currently active
2. Report how many iterations were completed
3. Clean up the state file

**That's it.** Just call the `cancel-auto-loop` tool. Do NOT manually delete the state file.

## When to Use

Use this command when:
- The task requirements have changed
- You want to restart with different parameters (cancel first, then `/auto-loop` again)
- The loop appears stuck and you want manual control
- You need to work on something else

Note: Prefer completing tasks properly with `<promise>DONE</promise>` when possible.
