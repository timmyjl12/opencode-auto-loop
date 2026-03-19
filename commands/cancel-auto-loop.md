---
description: Cancel active Auto Loop
---

# Cancel Loop

Cancel the active Auto Loop.

## Steps

1. Check if a loop is active and get the iteration count:

```bash
if [ -f .opencode/auto-loop.local.md ]; then
  grep '^iteration:' .opencode/auto-loop.local.md
  rm -f .opencode/auto-loop.local.md
  echo "Auto Loop cancelled."
else
  echo "No active Auto Loop to cancel."
fi
```

2. Report the result to the user.
