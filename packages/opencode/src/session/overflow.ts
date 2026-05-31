import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000
const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

export function usable(input: { cfg: Config.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

/**
 * Get the auto-compact threshold for a model.
 * Inspired by Claude-Code's getAutoCompactThreshold().
 */
export function getAutoCompactThreshold(input: {
  cfg: Config.Info
  model: Provider.Model
  outputTokenMax?: number
}): number {
  const effectiveWindow = usable(input)
  const threshold = effectiveWindow - AUTOCOMPACT_BUFFER_TOKENS
  return Math.max(0, threshold)
}

/**
 * Calculate token warning state, inspired by Claude-Code's calculateTokenWarningState().
 */
export function calculateTokenWarningState(input: {
  cfg: Config.Info
  tokens: number
  model: Provider.Model
  outputTokenMax?: number
}): {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const autoCompactThreshold = getAutoCompactThreshold(input)
  const isAutoEnabled = input.cfg.compaction?.auto !== false
  const threshold = isAutoEnabled
    ? autoCompactThreshold
    : usable(input)

  const percentLeft = Math.max(
    0,
    Math.round(((threshold - input.tokens) / threshold) * 100),
  )

  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS
  const errorThreshold = threshold - ERROR_THRESHOLD_BUFFER_TOKENS

  const isAboveWarningThreshold = input.tokens >= warningThreshold
  const isAboveErrorThreshold = input.tokens >= errorThreshold
  const isAboveAutoCompactThreshold = isAutoEnabled && input.tokens >= autoCompactThreshold

  const actualWindow = usable(input)
  const blockingLimit = actualWindow - MANUAL_COMPACT_BUFFER_TOKENS
  const isAtBlockingLimit = input.tokens >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

export function isOverflow(input: {
  cfg: Config.Info
  tokens: MessageV2.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= getAutoCompactThreshold(input)
}