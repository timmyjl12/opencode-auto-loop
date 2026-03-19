---
description: Show Auto Loop plugin help and available commands
---

# Auto Loop Help

## Available Commands

- `/auto-loop <task>` - Start an auto-continuation loop for the given task
- `/cancel-auto-loop` - Stop an active Auto Loop
- `/auto-loop-help` - Show this help

## Quick Start

```
/auto-loop Build a REST API with user authentication
```

The AI will work on your task and automatically continue until it outputs `<promise>DONE</promise>` to signal completion.

## How It Works

1. Creates state file at `.opencode/auto-loop.local.md`
2. Works on task until idle
3. If no `<promise>DONE</promise>` found, auto-continues
4. Repeats until complete or max iterations (100) reached
5. Survives context compaction — loop state is injected into the summary

## Cancellation

To stop early:
```
/cancel-auto-loop
```

For more details, the AI can use the `auto-loop-help` tool.
