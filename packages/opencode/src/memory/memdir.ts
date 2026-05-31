import path from "path"
import { Effect, Layer, Context } from "effect"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export const INDEX_FILE = "INDEX.md"
export const MAX_INDEX_LINES = 200
export const MAX_INDEX_BYTES = 25_000

export const MEMORY_TYPES = ["user", "project", "reference"] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export interface MemdirInfo {
  indexContent: string | undefined
  topicFiles: { name: string; content: string }[]
}

export const INDEX_TEMPLATE = `# Persistent Memory

This directory stores persistent knowledge across sessions.
Edit these files to teach the AI about preferences, patterns, and project context.

## How to Use

- \`user.md\`: Personal preferences, workflows, and habits
- \`project.md\`: Project architecture decisions, conventions, and patterns
- \`reference.md\`: External references, documentation links, and dependencies

## Guidelines

- Keep entries concise and factual
- Use bullet points for lists
- Update entries when preferences or patterns change
- Remove outdated information
`

export function memdirPath(directory: string): string {
  return path.join(directory, ".opencode", "memory")
}

export function indexPath(directory: string): string {
  return path.join(memdirPath(directory), INDEX_FILE)
}

export interface Interface {
  readonly read: () => Effect.Effect<MemdirInfo>
  readonly write: (file: string, content: string) => Effect.Effect<void>
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memdir") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const fs = yield* AppFileSystem.Service

    const resolveDir = Effect.fn("Memdir.resolveDir")(function* () {
      const ctx = yield* InstanceState.context
      return memdirPath(ctx.directory)
    })

    const resolvePath = Effect.fn("Memdir.resolvePath")(function* (file: string) {
      const dir = yield* resolveDir()
      return path.join(dir, file)
    })

    const read = Effect.fn("Memdir.read")(function* () {
      const config = yield* cfg.get()
      if (config.session_memory?.enabled === false) return { indexContent: undefined, topicFiles: [] }

      const dir = yield* resolveDir()
      const indexFile = path.join(dir, INDEX_FILE)
      const exists = yield* fs.existsSafe(dir)
      if (!exists) return { indexContent: undefined, topicFiles: [] }

      const indexContent = yield* fs.existsSafe(indexFile)
        .pipe(Effect.flatMap((ok) => ok
          ? fs.readFileString(indexFile).pipe(Effect.catch(() => Effect.succeed("")))
          : Effect.succeed(""),
        ))

      const files: string[] = []
      if (yield* fs.existsSafe(dir)) {
        for (const entry of yield* fs.readDir(dir)) {
          if (entry.endsWith(".md") && entry !== INDEX_FILE && entry !== "session-memory") {
            files.push(entry)
          }
        }
      }

      const topicFiles: { name: string; content: string }[] = []
      for (const file of files) {
        const content = yield* fs.readFileString(path.join(dir, file)).pipe(Effect.catch(() => Effect.succeed("")))
        if (content.trim()) topicFiles.push({ name: file, content })
      }

      // Trim index to limits
      let trimmed = (indexContent ?? "").trim()
      const lines = trimmed.split("\n")
      if (lines.length > MAX_INDEX_LINES) {
        trimmed = lines.slice(0, MAX_INDEX_LINES).join("\n")
      }
      if (Buffer.byteLength(trimmed, "utf-8") > MAX_INDEX_BYTES) {
        trimmed = trimmed.slice(0, MAX_INDEX_BYTES)
      }

      return { indexContent: trimmed || undefined, topicFiles }
    })

    const write = Effect.fn("Memdir.write")(function* (file: string, content: string) {
      const dir = yield* resolveDir()
      yield* fs.ensureDir(dir).pipe(Effect.catch(() => Effect.void))
      yield* fs.writeFileString(path.join(dir, file), content).pipe(Effect.catch(() => Effect.void))
    })

    const init = Effect.fn("Memdir.init")(function* () {
      const config = yield* cfg.get()
      if (config.session_memory?.enabled === false) return

      const dir = yield* resolveDir()
      const indexFile = path.join(dir, INDEX_FILE)
      const exists = yield* fs.existsSafe(indexFile)
      if (!exists) {
        yield* fs.ensureDir(dir).pipe(Effect.catch(() => Effect.void))
        yield* fs.writeFileString(indexFile, INDEX_TEMPLATE).pipe(Effect.catch(() => Effect.void))
      }
    })

    return Service.of({ read, write, init })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as Memdir from "./memdir"
