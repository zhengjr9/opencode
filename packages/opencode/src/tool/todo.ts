import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

// Todo.Info is still a zod schema (session/todo.ts). Inline the field shape
// here rather than referencing its `.shape` — the LLM-visible JSON Schema is
// identical, and it removes the last zod dependency from this tool.
const TodoItem = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
})

export const Parameters = Schema.Struct({
  todos: Schema.mutable(Schema.Array(TodoItem)).annotate({ description: "The updated todo list" }),
})

type Metadata = {
  todos: Todo.Info[]
}

function checkVerificationNudge(todos: Todo.Info[]): string | undefined {
  const completed = todos.filter((x) => x.status === "completed")
  if (completed.length < 3) return undefined
  const hasVerification = completed.some((x) => /verif|test/i.test(x.content))
  if (hasVerification) return undefined
  return [
    "NOTE: You just closed out 3+ tasks and none of them was a verification step.",
    "Before writing your final summary, consider spawning the verification agent (subagent_type=\"verification\") to independently verify your implementation.",
    "Only the verifier issues a verdict — you cannot self-assign PASS by listing caveats in your summary.",
  ].join("\n")
}

export const TodoWriteTool = Tool.define<typeof Parameters, Metadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          yield* todo.update({
            sessionID: ctx.sessionID,
            todos: params.todos,
          })

          const outputLines: string[] = [JSON.stringify(params.todos, null, 2)]
          const nudge = checkVerificationNudge(params.todos)
          if (nudge) outputLines.push("", nudge)

          return {
            title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
            output: outputLines.join("\n"),
            metadata: {
              todos: params.todos,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
