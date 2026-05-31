import { Effect, Layer, Context, Schedule, Duration, Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "../bus"

export const ScheduledTaskEvent = BusEvent.define(
  "scheduled.task.triggered",
  Schema.Struct({
    taskID: Schema.String,
    sessionID: Schema.String,
    prompt: Schema.String,
    remaining: Schema.Number,
  }),
)

export interface Task {
  readonly id: string
  readonly sessionID: string
  readonly interval: number
  readonly prompt: string
  readonly remaining: number
}

export interface Interface {
  readonly schedule: (task: Task) => Effect.Effect<void>
  readonly cancel: (id: string) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Task[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Scheduler") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const tasks = new Map<string, Task>()

    const schedule = Effect.fn("Scheduler.schedule")(function* (task: Task) {
      if (tasks.has(task.id)) return
      tasks.set(task.id, task)
      yield* bus.publish(ScheduledTaskEvent, {
        taskID: task.id,
        sessionID: task.sessionID,
        prompt: task.prompt,
        remaining: task.remaining,
      })
      if (task.remaining <= 1) {
        tasks.delete(task.id)
      }
    })

    const cancel = Effect.fn("Scheduler.cancel")(function* (id: string) {
      tasks.delete(id)
    })

    const list = Effect.fn("Scheduler.list")(function* () {
      return Array.from(tasks.values())
    })

    return Service.of({ schedule, cancel, list })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.defaultLayer),
)

export * as Scheduler from "./scheduler"