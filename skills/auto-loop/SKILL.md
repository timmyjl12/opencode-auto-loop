---
name: auto-loop
description: Start Auto Loop - auto-continues until task completion
---

# Auto Loop

Start an iterative development loop that automatically continues until the task is complete.

## How It Works

The Auto Loop creates a continuous feedback cycle for completing complex tasks:

1. You invoke the `auto-loop` tool, which creates the state file and starts the loop
2. You work on the task until you go idle
3. The plugin detects the idle state and checks for completion
4. If not complete, it extracts your progress and prompts you to continue
5. This repeats until you output the completion signal or max iterations reached

Your previous work remains accessible through files, git history, and the state file's progress sections.

## Starting the Loop

**Always use the `auto-loop` tool** to start the loop. Do NOT create the state file manually. The tool handles state file creation, session tracking, and initialization.

After the tool confirms the loop is active, **immediately begin working on the task**. Do not just acknowledge — start doing the work.

## Progress Tracking - CRITICAL

**Before going idle at the end of each work session, you MUST output structured progress sections AND a status line.** The plugin parses these to persist your TODOs across iterations so you know exactly where to pick up.

Use this format in your final message of each iteration:

```markdown
## Completed
- [x] Set up project structure
- [x] Created database schema
- [x] Implemented user model

## Next Steps
- [ ] Add JWT authentication middleware
- [ ] Create registration endpoint
- [ ] Write integration tests

STATUS: IN_PROGRESS
```

**Rules:**
- Always use checkbox format (`- [x]` for done, `- [ ]` for remaining)
- Be specific — each item should be a concrete, actionable step
- Only list truly completed items under ## Completed
- Order ## Next Steps by priority — the continuation will tell you to start from the top
- You MUST include a `STATUS: IN_PROGRESS` or `STATUS: COMPLETE` line on its own line in EVERY response
- The plugin extracts these sections and writes them into `auto-loop.local.md` for the next iteration

## Completion Signal - CRITICAL RULES

When you have FULLY completed the task, signal completion by outputting the promise-DONE XML tag on its own line:

```
STATUS: COMPLETE

<promise>DONE</promise>
```

**IMPORTANT CONSTRAINTS:**

- **If your Next Steps list has ANY unchecked items (`- [ ]`), you MUST NOT output the DONE signal.** The plugin will detect the contradiction and REJECT the completion, forcing another iteration.
- You MUST output `STATUS: COMPLETE` (on its own line) alongside the DONE signal. If the plugin detects `STATUS: IN_PROGRESS` with a DONE signal, it will reject the completion.
- ONLY output the completion signal when the task is COMPLETELY and VERIFIABLY finished
- The completion tag MUST be on its own line (not inline with other text)
- Do NOT mention or echo the completion tag in explanatory text — only output it as the actual signal
- Do NOT output false completion signals to escape the loop, even if you think you're stuck
- If you're blocked, output `STATUS: IN_PROGRESS` and explain the blocker instead of falsely completing

The loop can only be stopped by:
1. Truthful completion signal
2. Max iterations reached
3. User running `/cancel-auto-loop`

## Force Mode (--ralph)

When started with `--ralph`, the loop ignores ALL completion signals (`<promise>DONE</promise>`, `STATUS: COMPLETE`) and runs for the full iteration count. In force mode:
- You do NOT need to output `STATUS:` lines or the DONE signal
- The loop will continue for all iterations regardless
- Focus on making steady progress each iteration
- Still output `## Completed` and `## Next Steps` sections so the plugin can track progress

Example: `/auto-loop --ralph --max 10 Continue the refactoring task`

## Checking Status

Check current iteration and progress:
```bash
cat .opencode/auto-loop.local.md
```

## State File Format

The state file at `.opencode/auto-loop.local.md` uses YAML frontmatter with progress sections:

```markdown
---
active: true
iteration: 3
maxIterations: 25
sessionId: ses_abc123
---

Build a REST API with authentication

## Completed
- [x] Set up project structure
- [x] Created database schema

## Next Steps
- [ ] Add JWT authentication middleware
- [ ] Create registration endpoint
- [ ] Write integration tests
```

Add `.opencode/auto-loop.local.md` to your `.gitignore`.
