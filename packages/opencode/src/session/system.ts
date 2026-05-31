import path from "path"
import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"
import { Config } from "@/config/config"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Memdir } from "@/memory/memdir"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

const STYLE_PROMPTS: Record<string, string> = {
  concise: [
    "Be concise and direct.",
    "Provide minimal explanation unless asked.",
    "Focus on actionable output rather than educational content.",
    "Skip introductions and conclusions.",
  ].join("\n"),
  explanatory: [
    "Provide thorough explanations of your approach and implementation choices.",
    "Explain the reasoning behind key decisions.",
    "Include relevant codebase patterns and architectural context.",
    "Use a teaching-oriented style with clear rationale for changes.",
  ].join("\n"),
}

export function getOutputStyle(cfg: Config.Info): string | undefined {
  const style = cfg.output_style
  if (!style || style === "default") return undefined
  return [
    `# Output Style: ${style}`,
    `The following output style is active. Follow the specific guidelines for this style in your responses.`,
    ...(STYLE_PROMPTS[style] ? [STYLE_PROMPTS[style]] : []),
  ].join("\n")
}

export function getMemoryPrompt(cfg: Config.Info, sessionID: string, directory: string, fs: AppFileSystem.Interface): Effect.Effect<string | undefined> {
  if (cfg.session_memory?.enabled === false) return Effect.succeed(undefined)
  const memoryFile = cfg.session_memory?.file_path
    ? path.resolve(cfg.session_memory.file_path.replace(/\{sessionId\}/g, sessionID))
    : path.join(directory, ".opencode", "memory", `${sessionID}.md`)

  return Effect.gen(function* () {
    const exists = yield* fs.existsSafe(memoryFile)
    if (!exists) return undefined
    const content = yield* fs.readFileString(memoryFile).pipe(Effect.catch(() => Effect.succeed("")))
    if (!content.trim()) return undefined
    return [
      `# Session Memory`,
      `The following notes have been extracted from the current session:`,
      content,
    ].join("\n")
  })
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  readonly sessionGuidance: (agent: Agent.Info, hasAskUserQuestionTool: boolean, hasAgentTool: boolean) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        return [
          [
            `# Environment`,
            `You have been invoked in the following environment:`,
            ` - Primary working directory: ${ctx.directory}`,
            ` - Workspace root folder: ${ctx.worktree}`,
            ` - Is a git repository: ${ctx.project.vcs === "git" ? "Yes" : "No"}`,
            ` - Platform: ${process.platform}`,
            ` - Today's date: ${new Date().toDateString()}`,
            ` - Shell: ${process.env.SHELL?.includes("zsh") ? "zsh" : process.env.SHELL?.includes("bash") ? "bash" : process.env.SHELL || "unknown"}`,
            model.api.id.includes("claude")
              ? ` - You are powered by the model named ${model.api.id}.`
              : ` - You are powered by the model ${model.api.id}.`,
          ].join("\n"),
        ]
      }),

      sessionGuidance: Effect.fn("SystemPrompt.sessionGuidance")(function* (agent: Agent.Info, hasAskUserQuestionTool: boolean, hasAgentTool: boolean) {
        const items: string[] = []
        if (hasAskUserQuestionTool) {
          items.push("- If you do not understand why the user has denied a tool call, use the AskUserQuestion tool to ask them.")
        }
        if (hasAgentTool) {
          items.push("- Use the Task tool with specialized agents when the task at hand matches the agent's description. Subagents are valuable for parallelizing independent queries or for protecting the main context window from excessive results.")
        }
        if (items.length === 0) return undefined
        return [
          "# Session-specific guidance",
          ...items,
        ].join("\n")
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export function getMemdirPrompt(info: Memdir.MemdirInfo, directory: string): string | undefined {
  const sections: string[] = []
  if (info.indexContent) {
    sections.push(`# Persistent Memory (${path.join(directory, ".opencode", "memory")})`, info.indexContent)
  }
  for (const topic of info.topicFiles) {
    sections.push(`## ${topic.name.replace(/\.md$/, "")}`, topic.content)
  }
  return sections.length > 0 ? sections.join("\n\n") : undefined
}

export * as SystemPrompt from "./system"