---
name: auto-loop
description: Start Auto Loop - auto-continues until task completion
---

# Auto Loop

Start an iterative development loop that automatically continues until the task is complete.

## How It Works

The Auto Loop creates a continuous feedback cycle for completing complex tasks:

1. You work on the task until you go idle
2. The plugin detects the idle state and checks for completion
3. If not complete, it extracts your progress and prompts you to continue
4. This repeats until you output the completion promise or max iterations reached

Your previous work remains accessible through files, git history, and the state file's progress sections.

## Starting the Loop

When you invoke this skill, create the state file in the project directory:

```bash
mkdir -p .opencode && cat > .opencode/auto-loop.local.md << 'EOF'
---
active: true
iteration: 0
maxIterations: 100
---

[The user's task prompt goes here]
EOF
```

Then inform the user and begin working on the task.

## Progress Tracking - CRITICAL

**Before going idle at the end of each work session, you MUST output structured progress sections.** The plugin parses these to persist your TODOs across iterations so you know exactly where to pick up.

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
```

**Rules:**
- Always use checkbox format (`- [x]` for done, `- [ ]` for remaining)
- Be specific — each item should be a concrete, actionable step
- Only list truly completed items under ## Completed
- Order ## Next Steps by priority — the continuation will tell you to start from the top
- The plugin extracts these sections and writes them into `auto-loop.local.md` for the next iteration

## Completion Promise - CRITICAL RULES

When you have FULLY completed the task, signal completion by outputting:

```
<promise>DONE</promise>
```

**IMPORTANT CONSTRAINTS:**

- ONLY output `<promise>DONE</promise>` when the task is COMPLETELY and VERIFIABLY finished
- The statement MUST be completely and unequivocally TRUE
- Do NOT output false promises to escape the loop, even if you think you're stuck
- Do NOT lie even if you think you should exit for other reasons
- If you're blocked, explain the blocker and request help instead of falsely completing

The loop can only be stopped by:
1. Truthful completion promise
2. Max iterations reached
3. User running `/cancel-auto-loop`

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
maxIterations: 100
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
