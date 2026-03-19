import { type Plugin, type PluginInput, tool } from "@opencode-ai/plugin";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  cpSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

// Types
interface LoopState {
  active: boolean;
  iteration: number;
  maxIterations: number;
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
const COMPLETION_TAG = /<promise>\s*DONE\s*<\/promise>/is;
const DEBOUNCE_MS = 2000;

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
  if (!match) return { active: false, iteration: 0, maxIterations: 100 };

  const frontmatter = match[1];
  const state: LoopState = {
    active: false,
    iteration: 0,
    maxIterations: 100,
  };

  for (const line of frontmatter.split("\n")) {
    const [key, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();
    if (key === "active") state.active = value === "true";
    if (key === "iteration") state.iteration = parseInt(value) || 0;
    if (key === "maxIterations") state.maxIterations = parseInt(value) || 100;
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
  ];
  if (state.sessionId) lines.push(`sessionId: ${state.sessionId}`);
  lines.push("---");
  if (state.prompt) lines.push("", state.prompt);
  if (state.completed) lines.push("", "## Completed", state.completed);
  if (state.nextSteps) lines.push("", "## Next Steps", state.nextSteps);
  return lines.join("\n");
}

// Read state from project directory
function readState(directory: string): LoopState {
  const stateFile = getStateFile(directory);
  if (existsSync(stateFile)) {
    return parseState(readFileSync(stateFile, "utf-8"));
  }
  return { active: false, iteration: 0, maxIterations: 100 };
}

// Write state to project directory
function writeState(directory: string, state: LoopState, log: LogFn): void {
  try {
    const stateFile = getStateFile(directory);
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, serializeState(state));
  } catch (err) {
    log("error", `Failed to write state: ${err}`);
  }
}

// Clear state
function clearState(directory: string, log: LogFn): void {
  try {
    const stateFile = getStateFile(directory);
    if (existsSync(stateFile)) unlinkSync(stateFile);
  } catch (err) {
    log("warn", `Failed to clear state: ${err}`);
  }
}

// Strip markdown code fences before checking for completion tag
function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

// Extract text from the last assistant message in a session
async function getLastAssistantText(
  client: OpencodeClient,
  sessionId: string,
  directory: string,
  log: LogFn
): Promise<string | null> {
  try {
    const response = await client.session.messages({
      path: { id: sessionId },
      query: { directory },
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
  return `[AUTO LOOP ACTIVE — Iteration ${state.iteration}/${state.maxIterations}]

Original task: ${state.prompt || "(no task specified)"}
${progress}
When the task is FULLY complete, you MUST output: <promise>DONE</promise>
Before going idle, list your progress using ## Completed and ## Next Steps sections.
Do NOT output false completion promises. If blocked, explain the blocker.`;
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
            .describe("Maximum iterations (default: 100)"),
        },
        async execute({ task, maxIterations = 100 }, context) {
          const state: LoopState = {
            active: true,
            iteration: 0,
            maxIterations,
            sessionId: context.sessionID,
            prompt: task,
          };
          writeState(directory, state, log);

          log("info", `Loop started for session ${context.sessionID}`);
          toast(`Auto Loop started (max ${maxIterations} iterations)`, "success");

          return `Auto Loop started (max ${maxIterations} iterations).

Task: ${task}

I will auto-continue until the task is complete. Before going idle each iteration, I will output structured progress:

\`\`\`
## Completed
- [x] What I finished

## Next Steps
- [ ] What remains (in priority order)
\`\`\`

When fully done, I will output \`<promise>DONE</promise>\` to signal completion.

Use /cancel-auto-loop to stop early.`;
        },
      }),

      "cancel-auto-loop": tool({
        description: "Cancel active Auto Loop",
        args: {},
        async execute() {
          const state = readState(directory);
          if (!state.active) {
            return "No active Auto Loop to cancel.";
          }
          const iterations = state.iteration;
          clearState(directory, log);

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

- \`/auto-loop <task>\` - Start an auto-continuation loop
- \`/cancel-auto-loop\` - Stop an active loop
- \`/auto-loop-help\` - Show this help

## How It Works

1. Start with: /auto-loop "Build a REST API"
2. AI works on the task until idle
3. Plugin auto-continues if not complete
4. Loop stops when AI outputs: <promise>DONE</promise>

## State File

Located at: .opencode/auto-loop.local.md`;
        },
      }),
    },

    // Event hooks for auto-continuation, compaction recovery, and lifecycle
    event: async ({ event }) => {
      // --- session.idle: core auto-continuation logic ---
      if (event.type === "session.idle") {
        const now = Date.now();
        if (now - lastContinuation < DEBOUNCE_MS) return;

        const sessionId = event.properties.sessionID;
        const state = readState(directory);

        if (!state.active) return;
        if (!sessionId) return;
        if (state.sessionId && state.sessionId !== sessionId) return;

        // Fetch last assistant message (used for completion check + progress extraction)
        const lastText = await getLastAssistantText(client, sessionId, directory, log);

        if (lastText && checkCompletion(lastText)) {
          clearState(directory, log);
          log("info", `Loop completed at iteration ${state.iteration}`);
          toast(`Auto Loop completed after ${state.iteration} iteration(s)`, "success");
          return;
        }

        if (state.iteration >= state.maxIterations) {
          clearState(directory, log);
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
          // Update next steps if we found new ones, otherwise keep previous
          nextSteps: newNextSteps || state.nextSteps,
          // Merge completed: append new completed items to existing
          completed: mergeCompleted(state.completed, newCompleted),
        };
        writeState(directory, newState, log);
        lastContinuation = Date.now();

        // Build continuation prompt with progress context
        const progressSection = buildProgressSection(newState);

        const continuationPrompt = `[AUTO LOOP — ITERATION ${newState.iteration}/${newState.maxIterations}]

Continue working on the task. Do NOT repeat work that is already done.
${progressSection}
IMPORTANT:
- Pick up from the next incomplete step below
- When FULLY complete, output: <promise>DONE</promise>
- Before going idle, list your progress using ## Completed and ## Next Steps sections
- Do not stop until the task is truly done

Original task:
${state.prompt || "(no task specified)"}`;

        try {
          await client.session.prompt({
            path: { id: sessionId },
            body: {
              parts: [{ type: "text", text: continuationPrompt }],
            },
          });
          log("info", `Sent continuation ${newState.iteration}/${newState.maxIterations}`);
          toast(`Auto Loop: iteration ${newState.iteration}/${newState.maxIterations}`);
        } catch (err) {
          log("error", `Failed to send continuation prompt: ${err}`);
        }
      }

      // --- session.compacted: re-inject loop context after compaction ---
      if (event.type === "session.compacted") {
        const sessionId = event.properties.sessionID;
        const state = readState(directory);

        if (!state.active) return;
        if (state.sessionId && state.sessionId !== sessionId) return;

        // After compaction, the AI loses loop context — send a reminder
        try {
          await client.session.prompt({
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
        const state = readState(directory);

        if (
          state.active &&
          (!state.sessionId || state.sessionId === sessionId)
        ) {
          log("warn", `Session error detected, pausing loop at iteration ${state.iteration}`);
          toast("Auto Loop paused — session error", "error");
          // Mark inactive but keep state so user can inspect/resume
          writeState(directory, { ...state, active: false }, log);
        }
      }

      // --- session.deleted: clean up if it's our session ---
      if (event.type === "session.deleted") {
        const state = readState(directory);
        if (!state.active) return;

        const deletedSessionId = event.properties.info?.id;
        if (state.sessionId && deletedSessionId && state.sessionId !== deletedSessionId) return;

        clearState(directory, log);
        log("info", "Session deleted, cleaning up loop state");
      }
    },
  };
};

export default AutoLoopPlugin;
