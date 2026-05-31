import path from "path"
import { Effect, Layer, Context } from "effect"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export const MEMORY_TEMPLATE = `# Session Notes

## Current State
What is currently happening in the session.

## Goals
What the user is trying to accomplish.

## Files and Functions
Key files and functions that have been discussed or modified.

## Decisions
Important decisions made during the session, and their rationale.

## Open Questions
Questions that remain unanswered or pending decisions.

## Learnings
Insights about the codebase, tools, or domain discovered during this session.
`

const MAX_LEARNINGS_SIZE = 10_000

export function memoryFilePath(directory: string, sessionID: string): string {
  return path.join(directory, ".opencode", "memory", `${sessionID}.md`)
}

export interface Interface {
  readonly read: (sessionID: string) => Effect.Effect<string | undefined>
  readonly write: (sessionID: string, content: string) => Effect.Effect<void>
  readonly appendLearnings: (sessionID: string, learnings: string[]) => Effect.Effect<void>
  readonly init: (sessionID: string) => Effect.Effect<void>
  readonly path: (sessionID: string) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionMemory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const fs = yield* AppFileSystem.Service

    const resolvePath = Effect.fn("SessionMemory.resolvePath")(function* (sessionID: string) {
      const config = yield* cfg.get()
      if (config.session_memory?.file_path) {
        return path.resolve(config.session_memory.file_path.replace(/\{sessionId\}/g, sessionID))
      }
      const ctx = yield* InstanceState.context
      return memoryFilePath(ctx.directory, sessionID)
    })

    const read = Effect.fn("SessionMemory.read")(function* (sessionID: string) {
      const config = yield* cfg.get()
      if (config.session_memory?.enabled === false) return undefined

      const filepath = yield* resolvePath(sessionID)
      const exists = yield* fs.existsSafe(filepath)
      if (!exists) return undefined

      const content = yield* fs.readFileString(filepath).pipe(Effect.catch(() => Effect.succeed("")))
      return content || undefined
    })

    const write = Effect.fn("SessionMemory.write")(function* (sessionID: string, content: string) {
      const filepath = yield* resolvePath(sessionID)
      yield* fs.ensureDir(path.dirname(filepath)).pipe(Effect.catch(() => Effect.void))
      yield* fs.writeFileString(filepath, content).pipe(Effect.catch(() => Effect.void))
    })

    const appendLearnings = Effect.fn("SessionMemory.appendLearnings")(function* (sessionID: string, learnings: string[]) {
      if (learnings.length === 0) return
      const filepath = yield* resolvePath(sessionID)
      const existingContent = yield* read(sessionID)
      const existing = existingContent ?? ""
      const existingLearnings = existing.match(/## Learnings\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() ?? ""
      const newEntries = learnings.filter((l) => !existingLearnings.includes(l))
      if (newEntries.length === 0) return
      const entry = `\n\n## Learnings\n${newEntries.map((l) => `- ${l}`).join("\n")}`
      const newContent = existingLearnings
        ? existing.replace(/(## Learnings\n)[\s\S]*?(?=\n## |$)/, `$1${existingLearnings}\n${newEntries.map((l) => `- ${l}`).join("\n")}`)
        : `${existing}${entry}`
      const trimmed = Buffer.byteLength(newContent, "utf-8") > MAX_LEARNINGS_SIZE
        ? newContent.slice(0, MAX_LEARNINGS_SIZE)
        : newContent
      yield* fs.ensureDir(path.dirname(filepath)).pipe(Effect.catch(() => Effect.void))
      yield* fs.writeFileString(filepath, trimmed).pipe(Effect.catch(() => Effect.void))
    })

    const init = Effect.fn("SessionMemory.init")(function* (sessionID: string) {
      const config = yield* cfg.get()
      if (config.session_memory?.enabled === false) return

      const filepath = yield* resolvePath(sessionID)
      const exists = yield* fs.existsSafe(filepath)
      if (!exists) {
        yield* fs.ensureDir(path.dirname(filepath)).pipe(Effect.catch(() => Effect.void))
        yield* fs.writeFileString(filepath, MEMORY_TEMPLATE).pipe(Effect.catch(() => Effect.void))
      }
    })

    const memPath = Effect.fn("SessionMemory.path")(function* (sessionID: string) {
      return yield* resolvePath(sessionID)
    })

    return Service.of({ read, write, appendLearnings, init, path: memPath })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as SessionMemory from "./memory"
