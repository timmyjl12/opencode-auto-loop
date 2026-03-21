---
name: auto-loop-help
description: Explain Auto Loop plugin and available commands
---

# Auto Loop Help

The Auto Loop plugin provides auto-continuation for complex tasks in opencode.

## Available Commands

### `/auto-loop <task>`
Start an iterative development loop that automatically continues until the task is complete.

Example:
```
/auto-loop Build a REST API with authentication
```

The AI will work on your task and automatically continue until completion.

### `/auto-loop <task> --ralph`
Force mode: ignore all completion signals and run for the full iteration count. Useful when you got interrupted and want to resume, or when you want the AI to keep iterating without stopping early.

Examples:
```
/auto-loop --ralph Continue the refactoring
/auto-loop --ralph --max 10 Fix all lint errors
```

### `/cancel-auto-loop`
Cancel an active Auto Loop before it completes.

Example:
```
/cancel-auto-loop
```

### `/auto-loop-help`
Show plugin help and available commands.

## How It Works

1. **Start**: `/auto-loop` creates a state file at `.opencode/auto-loop.local.md`
2. **Loop**: When the AI goes idle, the plugin checks if `<promise>DONE</promise>` was output
3. **Continue**: If not found, it injects "Continue from where you left off"
4. **Stop**: Loop continues until DONE is found or max iterations (100) reached
5. **Cleanup**: State file is deleted when complete
6. **Compaction**: Loop context survives session compaction — task and iteration info is preserved

## Completion Signal

When the task is fully complete, the AI outputs:

```
<promise>DONE</promise>
```

This signals the loop to stop. The AI should ONLY output this when the task is truly complete.

## State File

Located at `.opencode/auto-loop.local.md` (add to `.gitignore`):

```markdown
---
active: true
iteration: 3
maxIterations: 25
sessionId: ses_abc123
---

Your original task prompt

## Completed
- [x] Set up project structure

## Next Steps
- [ ] Add authentication
```

## Credits

- Inspired by [Anthropic's auto-continue plugin](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum) for Claude Code
- Based on [opencode-auto-loop](https://github.com/timmyjl12/opencode-auto-loop)
