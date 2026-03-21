import { type Plugin, type PluginInput, tool } from "@opencode-ai/plugin";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  cpSync,
} from "fs";
import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

// Types
interface LoopState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  debounceMs: number;
  forceLoop?: boolean;
  sessionId?: string;
  prompt?: string;
  completed?: string;
  nextSteps?: string;
}

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFn = (level: LogLevel, message: string) => void;
type OpencodeClient = PluginInput["client"];

// Constants
const SERVICE_NAME = "auto-loop";
const STATE_FILENAME = "auto-loop.local.md";
const OPENCODE_CONFIG_DIR = join(homedir(), ".config/opencode");
const COMPLETION_TAG = /^\s*<promise>\s*DONE\s*<\/promise>\s*$/im;
const STATUS_COMPLETE_TAG = /^\s*STATUS:\s*COMPLETE\s*$/im;
const STATUS_IN_PROGRESS_TAG = /^\s*STATUS:\s*IN_PROGRESS\s*$/im;
const DEFAULT_DEBOUNCE_MS = 2000;
const DEFAULT_MAX_ITERATIONS = 25;

// Get plugin root directory (ESM only — package is "type": "module")
function getPluginRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  return dirname(dirname(__filename)); // Go up from src/ to plugin root
}

// Content-aware copy: always update if content differs
function copyIfChanged(src: string, dest: string): void {
  if (!existsSync(src)) return;
  if (existsSync(dest)) {
    const srcContent = readFileSync(src, "utf-8");
    const destContent = readFileSync(dest, "utf-8");
    if (srcContent === destContent) return;
  }
  const destDir = dirname(dest);
  mkdirSync(destDir, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

// Auto-copy skills and commands to opencode config, updating if content changed.
// Returns true if any new files were copied (first install), false otherwise.
function setupSkillsAndCommands(log: LogFn): boolean {
  const pluginRoot = getPluginRoot();
  const skillsDir = join(OPENCODE_CONFIG_DIR, "skill");
  const commandsDir = join(OPENCODE_CONFIG_DIR, "command");
  let newFilesCopied = false;

  // Copy skills
  const pluginSkillsDir = join(pluginRoot, "skills");
  if (existsSync(pluginSkillsDir)) {
    const skills = ["auto-loop", "cancel-auto-loop", "auto-loop-help"];
    for (const skill of skills) {
      const srcFile = join(pluginSkillsDir, skill, "SKILL.md");
      const destFile = join(skillsDir, skill, "SKILL.md");
      const isNew = !existsSync(destFile);
      try {
        copyIfChanged(srcFile, destFile);
        if (isNew && existsSync(destFile)) newFilesCopied = true;
      } catch (err) {
        log("warn", `Failed to copy skill '${skill}': ${err}`);
      }
    }
  }

  // Copy commands
  const pluginCommandsDir = join(pluginRoot, "commands");
  if (existsSync(pluginCommandsDir)) {
    const commands = ["auto-loop.md", "cancel-auto-loop.md", "auto-loop-help.md"];
    for (const cmd of commands) {
      const destCmd = join(commandsDir, cmd);
      const isNew = !existsSync(destCmd);
      try {
        copyIfChanged(join(pluginCommandsDir, cmd), destCmd);
        if (isNew && existsSync(destCmd)) newFilesCopied = true;
      } catch (err) {
        log("warn", `Failed to copy command '${cmd}': ${err}`);
      }
    }
  }

  return newFilesCopied;
}

// Get state file path (project-relative)
function getStateFile(directory: string): string {
  return join(directory, ".opencode", STATE_FILENAME);
}

// Parse markdown frontmatter state
function parseState(content: string): LoopState {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { active: false, iteration: 0, maxIterations: DEFAULT_MAX_ITERATIONS, debounceMs: DEFAULT_DEBOUNCE_MS };

  const frontmatter = match[1];
  const state: LoopState = {
    active: false,
    iteration: 0,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    debounceMs: DEFAULT_DEBOUNCE_MS,
  };

  for (const line of frontmatter.split("\n")) {
    const [key, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();
    if (key === "active") state.active = value === "true";
    if (key === "iteration") state.iteration = parseInt(value) || 0;
    if (key === "maxIterations") state.maxIterations = parseInt(value) || DEFAULT_MAX_ITERATIONS;
    if (key === "debounceMs") state.debounceMs = parseInt(value) || DEFAULT_DEBOUNCE_MS;
    if (key === "forceLoop") state.forceLoop = value === "true";
    if (key === "sessionId") state.sessionId = value || undefined;
  }

  // Get prompt and progress sections from body (after frontmatter)
  const body = content.slice(match[0].length).trim();
  if (body) {
    // Split body at ## Completed / ## Next Steps section boundaries
    const parts = body.split(/^(?=## (?:Completed|Next Steps))/m);

    // First part is always the original prompt
    state.prompt = parts[0].trim();

    // Remaining parts are the progress sections
    for (let i = 1; i < parts.length; i++) {
      const section = parts[i];
      if (section.startsWith("## Completed")) {
        state.completed = section.replace(/^## Completed\n?/, "").trim();
      } else if (section.startsWith("## Next Steps")) {
        state.nextSteps = section.replace(/^## Next Steps\n?/, "").trim();
      }
    }
  }

  return state;
}

// Serialize state to markdown frontmatter with progress sections
function serializeState(state: LoopState): string {
  const lines = [
    "---",
    `active: ${state.active}`,
    `iteration: ${state.iteration}`,
    `maxIterations: ${state.maxIterations}`,
    `debounceMs: ${state.debounceMs}`,
  ];
  if (state.forceLoop) lines.push(`forceLoop: ${state.forceLoop}`);
  if (state.sessionId) lines.push(`sessionId: ${state.sessionId}`);
  lines.push("---");
  if (state.prompt) lines.push("", state.prompt);
  if (state.completed) lines.push("", "## Completed", state.completed);
  if (state.nextSteps) lines.push("", "## Next Steps", state.nextSteps);
  return lines.join("\n");
}

// Read state from project directory
async function readState(directory: string): Promise<LoopState> {
  const stateFile = getStateFile(directory);
  try {
    const content = await readFile(stateFile, "utf-8");
    return parseState(content);
  } catch {
    return { active: false, iteration: 0, maxIterations: DEFAULT_MAX_ITERATIONS, debounceMs: DEFAULT_DEBOUNCE_MS };
  }
}

// Write state to project directory
async function writeState(directory: string, state: LoopState, log: LogFn): Promise<void> {
  try {
    const stateFile = getStateFile(directory);
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, serializeState(state));
  } catch (err) {
    log("error", `Failed to write state: ${err}`);
  }
}

// Clear state
async function clearState(directory: string, log: LogFn): Promise<void> {
  try {
    const stateFile = getStateFile(directory);
    await unlink(stateFile);
  } catch (err) {
    // ENOENT is fine — file already gone
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log("warn", `Failed to clear state: ${err}`);
    }
  }
}

// Strip markdown code fences and inline code before checking for completion tag
function stripCodeFences(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "") // triple-backtick blocks
    .replace(/`[^`]+`/g, "");       // inline backtick code
}

// Extract text from the last assistant message in a session.
// Fetches only the most recent messages to avoid pulling the entire history.
async function getLastAssistantText(
  client: OpencodeClient,
  sessionId: string,
  directory: string,
  log: LogFn
): Promise<string | null> {
  try {
    const response = await client.session.messages({
      path: { id: sessionId },
      query: { directory, limit: 10 },
    });

    const messages = response.data ?? [];

    const assistantMessages = messages.filter(
      (msg) => msg.info?.role === "assistant"
    );

    if (assistantMessages.length === 0) return null;

    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    const parts = lastAssistant.parts || [];

    return parts
      .filter((p) => p.type === "text")
      .map((p) => ("text" in p ? p.text : "") ?? "")
      .join("\n");
  } catch (err) {
    log("warn", `Failed to fetch session messages: ${err}`);
    return null;
  }
}

// Check completion by looking for <promise>DONE</promise> in last assistant text
function checkCompletion(text: string): boolean {
  return COMPLETION_TAG.test(stripCodeFences(text));
}

// Extract the STATUS signal presence from text.
function getStatusSignals(text: string): {
  hasComplete: boolean;
  hasInProgress: boolean;
} {
  const cleaned = stripCodeFences(text);
  return {
    hasComplete: STATUS_COMPLETE_TAG.test(cleaned),
    hasInProgress: STATUS_IN_PROGRESS_TAG.test(cleaned),
  };
}

// Check if the parsed Next Steps section contains unchecked items (- [ ] ...).
// Returns true if there are incomplete items, meaning the task is NOT done.
function hasIncompleteSteps(text: string): boolean {
  const nextSteps = extractNextSteps(stripCodeFences(text));
  if (!nextSteps) return false;

  const uncheckedItems = nextSteps
    .split("\n")
    .filter((line) => /^\s*-\s*\[ \]/.test(line));

  return uncheckedItems.length > 0;
}

// Validate whether the DONE signal should be honored.
// Returns { valid: true } if completion is legitimate,
// or { valid: false, reason: string } if it should be rejected.
function validateCompletion(text: string): { valid: boolean; reason?: string } {
  // Check 1: contradictory STATUS signals
  const statusSignals = getStatusSignals(text);
  if (statusSignals.hasComplete && statusSignals.hasInProgress) {
    return {
      valid: false,
      reason: "Both STATUS: COMPLETE and STATUS: IN_PROGRESS are present",
    };
  }

  // Check 2: STATUS signal contradicts DONE
  if (statusSignals.hasInProgress) {
    return {
      valid: false,
      reason: "STATUS: IN_PROGRESS contradicts the DONE signal",
    };
  }

  // Check 3: Unchecked next steps exist
  if (hasIncompleteSteps(text)) {
    return {
      valid: false,
      reason: "Unchecked next steps (- [ ] ...) found alongside DONE signal",
    };
  }

  // Check 4: If STATUS signal is present and is COMPLETE, extra confidence
  // If no STATUS signal at all, still allow (backward compatibility)
  return { valid: true };
}

// Extract next steps / TODOs from assistant message text
// Looks for common patterns: ## Next Steps, ## TODO, checkbox lists, numbered lists after keywords
function extractNextSteps(text: string): string | undefined {
  // Strategy 1: Look for an explicit ## Next Steps / ## TODO / ## Remaining section
  const sectionMatch = text.match(
    /^##\s*(?:Next Steps|TODO|Remaining|What's Left|Still To Do|Outstanding)[^\n]*\n([\s\S]*?)(?=\n## |\n\n---|$)/im
  );
  if (sectionMatch) {
    const content = sectionMatch[1].trim();
    if (content) return content;
  }

  // Strategy 2: Collect all unchecked checkbox items (- [ ] ...)
  const unchecked = text
    .split("\n")
    .filter((line) => /^\s*-\s*\[ \]/.test(line))
    .map((line) => line.trim());
  if (unchecked.length > 0) {
    return unchecked.join("\n");
  }

  // Strategy 3: Look for a numbered list after "next" or "todo" or "remaining" keywords
  const numberedMatch = text.match(
    /(?:next|todo|remaining|still need to|still to do)[^\n]*\n((?:\s*\d+\.\s+[^\n]+\n?)+)/i
  );
  if (numberedMatch) {
    return numberedMatch[1].trim();
  }

  return undefined;
}

// Extract completed items from assistant message text
function extractCompleted(text: string): string | undefined {
  // Strategy 1: Look for an explicit ## Completed / ## Done / ## Progress section
  const sectionMatch = text.match(
    /^##\s*(?:Completed|Done|Progress|Accomplished|Finished)[^\n]*\n([\s\S]*?)(?=\n## |\n\n---|$)/im
  );
  if (sectionMatch) {
    const content = sectionMatch[1].trim();
    if (content) return content;
  }

  // Strategy 2: Collect all checked checkbox items (- [x] ...)
  const checked = text
    .split("\n")
    .filter((line) => /^\s*-\s*\[x\]/i.test(line))
    .map((line) => line.trim());
  if (checked.length > 0) {
    return checked.join("\n");
  }

  return undefined;
}

// Merge completed items: deduplicate by normalizing checkbox text
function mergeCompleted(
  existing: string | undefined,
  incoming: string | undefined
): string | undefined {
  if (!existing && !incoming) return undefined;
  if (!existing) return incoming;
  if (!incoming) return existing;

  const existingLines = existing.split("\n").map((l) => l.trim()).filter(Boolean);
  const incomingLines = incoming.split("\n").map((l) => l.trim()).filter(Boolean);

  // Normalize for dedup: strip checkbox prefix and lowercase
  const normalize = (line: string) =>
    line.replace(/^-\s*\[x\]\s*/i, "").trim().toLowerCase();
  const existingSet = new Set(existingLines.map(normalize));

  for (const line of incomingLines) {
    if (!existingSet.has(normalize(line))) {
      existingLines.push(line);
      existingSet.add(normalize(line));
    }
  }

  return existingLines.join("\n");
}

// Build a progress section for the continuation prompt
function buildProgressSection(state: LoopState): string {
  const sections: string[] = [];

  if (state.completed) {
    sections.push(`\n## Completed So Far\n${state.completed}`);
  }
  if (state.nextSteps) {
    sections.push(`\n## Next Steps (pick up here)\n${state.nextSteps}`);
  }
  if (sections.length === 0) {
    sections.push(
      "\nNo structured progress recorded yet. Review your work so far and continue."
    );
  }

  return sections.join("\n");
}

// Build the loop context reminder for post-compaction injection
function buildLoopContextReminder(state: LoopState): string {
  const progress = buildProgressSection(state);
  const forceLabel = state.forceLoop ? " [FORCE MODE]" : "";
  const rules = state.forceLoop
    ? `IMPORTANT RULES:
- Before going idle, output ## Completed and ## Next Steps sections
- FORCE MODE is active — the loop will continue for all ${state.maxIterations} iterations regardless of completion signals
- Focus on making steady progress each iteration`
    : `IMPORTANT RULES:
- Before going idle, output ## Completed and ## Next Steps sections
- You MUST include a STATUS line: either \`STATUS: IN_PROGRESS\` or \`STATUS: COMPLETE\` on its own line
- Do NOT output <promise>DONE</promise> if there are ANY unchecked items (\`- [ ]\`) in your Next Steps — the plugin WILL reject it
- Only output \`STATUS: COMPLETE\` and the DONE signal when ALL steps are truly finished and Next Steps is empty
- Do NOT output false completion promises. If blocked, output \`STATUS: IN_PROGRESS\` and explain the blocker.`;

  return `[AUTO LOOP${forceLabel} ACTIVE — Iteration ${state.iteration}/${state.maxIterations}]

Original task: ${state.prompt || "(no task specified)"}
${progress}
${rules}`;
}

// Check if session is currently busy (not idle)
async function isSessionBusy(
  client: OpencodeClient,
  sessionId: string,
  log: LogFn
): Promise<boolean> {
  try {
    const response = await client.session.status({});
    const statuses = response.data ?? {};
    const status = statuses[sessionId];
    if (status && status.type !== "idle") {
      log("debug", `Session ${sessionId} is ${status.type}, skipping continuation`);
      return true;
    }
    return false;
  } catch (err) {
    log("warn", `Failed to check session status: ${err}`);
    return false; // Assume not busy if we can't check
  }
}

// Main plugin
export const AutoLoopPlugin: Plugin = async (ctx) => {
  const directory = ctx.directory || process.cwd();
  const client = ctx.client;

  // Structured logger using the SDK's app.log API
  const log: LogFn = (level, message) => {
    try {
      client.app.log({
        body: { service: SERVICE_NAME, level, message },
      });
    } catch {
      // Last resort: if logging itself fails, silently ignore
    }
  };

  // Toast helper using the SDK's tui.showToast API
  const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") => {
    try {
      client.tui.showToast({
        body: { message, variant },
      });
    } catch {
      // Non-critical — ignore
    }
  };

  // Auto-setup skills and commands — notify on first install
  const isFirstInstall = setupSkillsAndCommands(log);
  if (isFirstInstall) {
    toast("Auto Loop installed — restart opencode to enable /auto-loop commands", "warning");
    log("info", "First install detected — commands copied, restart needed for slash commands");
  }

  // Debounce tracking for idle events
  let lastContinuation = 0;
  // Guard: prevent sending while a continuation is already in-flight.
  // Set to true when we send promptAsync, cleared when we receive a
  // session.idle or session.status(idle) event — NOT in the finally block,
  // which fires too early (~50ms after the 204, while AI is still busy).
  let continuationInFlight = false;

  return {
    tool: {
      "auto-loop": tool({
        description:
          "Start Auto Loop — auto-continues until task completion. Use: /auto-loop <task description>",
        args: {
          task: tool.schema
            .string()
            .describe("The task to work on until completion"),
          maxIterations: tool.schema
            .number()
            .optional()
            .describe("Maximum iterations (default: 25)"),
          debounceMs: tool.schema
            .number()
            .optional()
            .describe("Debounce delay between iterations in ms (default: 2000)"),
          forceLoop: tool.schema
            .boolean()
            .optional()
            .describe("Force mode (--ralph): ignore completion signals and run for all iterations"),
        },
        async execute({ task, maxIterations = DEFAULT_MAX_ITERATIONS, debounceMs = DEFAULT_DEBOUNCE_MS, forceLoop = false }, context) {
          if (context.abort.aborted) return "Auto Loop start was cancelled.";

          const state: LoopState = {
            active: true,
            iteration: 0,
            maxIterations,
            debounceMs,
            forceLoop: forceLoop ? true : undefined,
            sessionId: context.sessionID,
            prompt: task,
          };
          await writeState(directory, state, log);
          // Reset guards so the first idle event is not blocked
          continuationInFlight = false;
          lastContinuation = 0;

          const modeLabel = forceLoop ? " [FORCE MODE]" : "";
          log("info", `Loop started${modeLabel} for session ${context.sessionID}`);
          toast(`Auto Loop started${modeLabel} (max ${maxIterations} iterations)`, "success");

          const forceNote = forceLoop
            ? `\n\n**FORCE MODE (--ralph):** Completion signals are IGNORED. The loop will run for all ${maxIterations} iterations regardless. Focus on making progress each iteration — you do NOT need to output STATUS or DONE signals.`
            : "";

          return `Auto Loop started (max ${maxIterations} iterations).${forceNote}

Task: ${task}

**Begin working on the task now.** The loop will auto-continue until ${forceLoop ? `all ${maxIterations} iterations are used` : "you signal completion"}.

Before going idle each iteration, output structured progress${forceLoop ? "" : " AND a status line"}:

\`\`\`
## Completed
- [x] What I finished

## Next Steps
- [ ] What remains (in priority order)
${forceLoop ? "" : "\nSTATUS: IN_PROGRESS"}
\`\`\`
${forceLoop ? "" : `
## Completion Rules — READ CAREFULLY

1. **If your Next Steps list has ANY unchecked items (\`- [ ]\`), you MUST NOT output the DONE signal.** The plugin will reject it.
2. You MUST include a \`STATUS: COMPLETE\` or \`STATUS: IN_PROGRESS\` line on its own line in every response.
3. Only when ALL steps are done and Next Steps is empty, output:
   - \`STATUS: COMPLETE\` on its own line
   - The promise-DONE XML tag on its own line
4. If you are blocked or stuck, output \`STATUS: IN_PROGRESS\` and explain the blocker. Do NOT output a false DONE.
`}
Use /cancel-auto-loop to stop early.`;
        },
      }),

      "cancel-auto-loop": tool({
        description: "Cancel active Auto Loop",
        args: {},
        async execute(_args, context) {
          if (context.abort.aborted) return "Cancel was aborted.";
          const state = await readState(directory);
          if (!state.active) {
            return "No active Auto Loop to cancel.";
          }
          const iterations = state.iteration;
          await clearState(directory, log);
          continuationInFlight = false;

          log("info", `Loop cancelled after ${iterations} iteration(s)`);
          toast(`Auto Loop cancelled after ${iterations} iteration(s)`, "warning");

          return `Auto Loop cancelled after ${iterations} iteration(s).`;
        },
      }),

      "auto-loop-help": tool({
        description: "Show Auto Loop plugin help",
        args: {},
        async execute() {
          return `# Auto Loop Help

## Available Commands

- \`/auto-loop <task>\` - Start an auto-continuation loop (default: 25 iterations)
- \`/auto-loop <task> --max <n>\` - Start with a custom iteration limit
- \`/auto-loop <task> --ralph\` - Force mode: ignore completion signals, run all iterations
- \`/auto-loop <task> --ralph --max <n>\` - Force mode with custom limit
- \`/cancel-auto-loop\` - Stop an active loop
- \`/auto-loop-help\` - Show this help

## Examples

- \`/auto-loop Build a REST API\` — runs up to 25 iterations
- \`/auto-loop Fix all lint errors --max 10\` — runs up to 10 iterations
- \`/auto-loop --ralph Continue refactoring\` — force runs all 25 iterations, ignores DONE signals
- \`/auto-loop --ralph --max 50 Big migration\` — force runs all 50 iterations

## How It Works

1. Start with: /auto-loop "Build a REST API"
2. AI works on the task until idle
3. Plugin auto-continues if not complete
4. Loop stops when AI outputs: <promise>DONE</promise>

## Force Mode (--ralph)

When \`--ralph\` is used, the loop ignores ALL completion signals and runs for the full iteration count. Useful when:
- You got interrupted and want to continue no matter what
- You want the AI to keep iterating and improving
- You don't want the AI to stop early

## State File

Located at: .opencode/auto-loop.local.md`;
        },
      }),
    },

    // Event hooks for auto-continuation, compaction recovery, and lifecycle
    event: async ({ event }) => {
      // --- session.idle: core auto-continuation logic ---
      if (event.type === "session.idle") {
        const sessionId = event.properties.sessionID;

        // Session confirmed idle — safe to clear in-flight guard
        continuationInFlight = false;

        const state = await readState(directory);

        if (!state.active) return;
        if (!sessionId) return;
        if (state.sessionId && state.sessionId !== sessionId) return;

        const now = Date.now();
        if (now - lastContinuation < state.debounceMs) return;

        // Double-check the session is truly idle before sending
        if (await isSessionBusy(client, sessionId, log)) return;

        // Fetch last assistant message (used for completion check + progress extraction)
        const lastText = await getLastAssistantText(client, sessionId, directory, log);

        // Skip completion check on iteration 0 (first idle after loop start)
        // to avoid false positives from the tool's initial response text.
        // Also skip entirely when forceLoop is true — force mode ignores
        // all completion signals and runs until max iterations.
        if (!state.forceLoop && state.iteration > 0 && lastText && checkCompletion(lastText)) {
          // Validate the DONE signal — reject if there are unchecked steps
          // or if the STATUS signal contradicts completion
          const validation = validateCompletion(lastText);
          if (validation.valid) {
            await clearState(directory, log);
            log("info", `Loop completed at iteration ${state.iteration}`);
            toast(`Auto Loop completed after ${state.iteration} iteration(s)`, "success");
            return;
          } else {
            log("warn", `Rejected premature DONE signal: ${validation.reason}`);
            toast(`Auto Loop: DONE rejected — ${validation.reason}`, "warning");
            // Fall through to send another continuation prompt
          }
        }

        if (state.iteration >= state.maxIterations) {
          await clearState(directory, log);
          log("warn", `Loop hit max iterations (${state.maxIterations})`);
          toast(`Auto Loop stopped — max iterations (${state.maxIterations}) reached`, "warning");
          return;
        }

        // Extract progress from last message and merge with existing state
        const newNextSteps = lastText ? extractNextSteps(lastText) : undefined;
        const newCompleted = lastText ? extractCompleted(lastText) : undefined;

        const newState: LoopState = {
          ...state,
          iteration: state.iteration + 1,
          sessionId,
          nextSteps: newNextSteps || state.nextSteps,
          completed: mergeCompleted(state.completed, newCompleted),
        };
        await writeState(directory, newState, log);
        lastContinuation = Date.now();

        // Build continuation prompt with progress context
        const progressSection = buildProgressSection(newState);

        const forceLabel = state.forceLoop ? " [FORCE MODE]" : "";
        const importantRules = state.forceLoop
          ? `IMPORTANT:
- Pick up from the next incomplete step below
- Before going idle, list your progress using ## Completed and ## Next Steps sections
- FORCE MODE is active — the loop will continue for all ${newState.maxIterations} iterations regardless of completion signals
- Focus on making steady progress each iteration`
          : `IMPORTANT:
- Pick up from the next incomplete step below
- Before going idle, list your progress using ## Completed and ## Next Steps sections
- You MUST include a STATUS line: either \`STATUS: IN_PROGRESS\` or \`STATUS: COMPLETE\` on its own line
- Do NOT output <promise>DONE</promise> if there are ANY unchecked items (\`- [ ]\`) in your Next Steps — the plugin WILL reject it
- Only output \`STATUS: COMPLETE\` and the DONE signal when ALL steps are truly finished and Next Steps is empty
- Do not stop until the task is truly done`;

        const continuationPrompt = `[AUTO LOOP${forceLabel} — ITERATION ${newState.iteration}/${newState.maxIterations}]

Continue working on the task. Do NOT repeat work that is already done.
${progressSection}
${importantRules}

Original task:
${state.prompt || "(no task specified)"}`;

        try {
          // Use promptAsync (fire-and-forget) so the event handler returns
          // immediately. This allows the next session.idle event to fire
          // naturally when the AI finishes, enabling the loop to continue.
          // The synchronous prompt() blocks until the AI response completes,
          // which prevents subsequent idle events from being processed.
          continuationInFlight = true;
          await client.session.promptAsync({
            path: { id: sessionId },
            body: {
              parts: [{ type: "text", text: continuationPrompt }],
            },
          });
          log("info", `Sent continuation ${newState.iteration}/${newState.maxIterations}`);
          toast(`Auto Loop: iteration ${newState.iteration}/${newState.maxIterations}`);
        } catch (err) {
          // On failure, clear the guard so the next idle event can retry
          continuationInFlight = false;
          log("error", `Failed to send continuation prompt: ${err}`);
        }
      }

      // --- session.status: clear in-flight guard when session returns to idle ---
      if (event.type === "session.status") {
        if (event.properties.status?.type === "idle") {
          continuationInFlight = false;
        }
      }

      // --- session.compacted: re-inject loop context after compaction ---
      if (event.type === "session.compacted") {
        const sessionId = event.properties.sessionID;
        const state = await readState(directory);

        if (!state.active) return;
        if (state.sessionId && state.sessionId !== sessionId) return;

        // After compaction, the AI loses loop context — send a reminder
        // Use promptAsync so we don't block event processing
        try {
          await client.session.promptAsync({
            path: { id: sessionId },
            body: {
              parts: [{ type: "text", text: buildLoopContextReminder(state) }],
            },
          });
          log("info", `Re-injected loop context after compaction for session ${sessionId}`);
        } catch (err) {
          log("warn", `Failed to re-inject loop context after compaction: ${err}`);
        }
      }

      // --- session.error: pause the loop on error ---
      if (event.type === "session.error") {
        const sessionId = event.properties.sessionID;
        // sessionID is optional in the SDK types — if missing, we can't
        // reliably attribute the error to our session, so skip.
        if (!sessionId) return;

        const state = await readState(directory);

        if (
          state.active &&
          (!state.sessionId || state.sessionId === sessionId)
        ) {
          log("warn", `Session error detected, pausing loop at iteration ${state.iteration}`);
          toast("Auto Loop paused — session error", "error");
          continuationInFlight = false;
          // Mark inactive but keep state so user can inspect/resume
          await writeState(directory, { ...state, active: false }, log);
        }
      }

      // --- session.deleted: clean up if it's our session ---
      if (event.type === "session.deleted") {
        const state = await readState(directory);
        if (!state.active) return;

        const deletedSessionId = event.properties.info?.id;
        if (state.sessionId && deletedSessionId && state.sessionId !== deletedSessionId) return;

        await clearState(directory, log);
        continuationInFlight = false;
        log("info", "Session deleted, cleaning up loop state");
      }
    },
  };
};

export default AutoLoopPlugin;
