/**
 * LLM client with circuit breaker, retry/backoff, and provider-wide 429 pause.
 *
 * Key behaviours:
 *  - Per-model CircuitBreaker: opens after N failures, auto-resets after resetMs
 *  - Exponential backoff with jitter on retries (configurable delay ladder)
 *  - Provider-wide 429 pause: after 3 consecutive 429s the whole provider is
 *    paused for 60 s (or the duration from Retry-After header)
 *  - If kilo-gateway is unreachable (network error), the client walks the
 *    fallback chain, which may include direct openrouter entries
 *  - 2-minute per-call timeout via AbortSignal.timeout
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CircuitBreakerOptions {
  /** Number of failures before the circuit opens (default 5). */
  threshold?: number
  /** Milliseconds before a half-open test is allowed (default 60 000). */
  resetMs?: number
}

export interface LLMCallOptions {
  model: string
  messages: { role: string; content: string }[]
  provider: 'openrouter' | 'kilo-gateway'
  temperature?: number
  maxTokens?: number
}

export interface LLMResponse {
  content: string
  model: string
  usage?: { prompt_tokens: number; completion_tokens: number }
}

export interface LLMClientOptions {
  /** Delay ladder in ms between retry attempts (default [5000, 15000, 45000]). */
  retryDelays?: number[]
  /** Ordered list of "provider/model" fallback entries. */
  fallbackChain?: string[]
  /** Number of failures before a model's circuit opens (default 5). */
  circuitBreakerThreshold?: number
  /** Time before open circuit auto-resets in ms (default 60 000). */
  circuitBreakerResetMs?: number
  /** How long to pause a provider after 3 consecutive 429s (default 60 000 ms). */
  providerPauseMs?: number
  /** Consecutive 429s before provider-wide pause (default 3). */
  providerPauseThreshold?: number
  /** Replaceable fetch function (injectable for tests). */
  fetchFn?: typeof fetch
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROVIDER_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  'kilo-gateway':
    process.env.KILO_GATEWAY_URL || 'https://api.kilo.ai/api/gateway/chat/completions',
}

export const DEFAULT_FALLBACK_CHAIN = [
  'kilo-gateway/minimax/minimax-m2.5:free',
  'kilo-gateway/corethink/corethink:free',
]

const CALL_TIMEOUT_MS = 120_000 // 2 minutes

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  private failures = 0
  private openedAt: number | null = null
  private readonly threshold: number
  private readonly resetMs: number

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = opts.threshold ?? 5
    this.resetMs = opts.resetMs ?? 60_000
  }

  isOpen(): boolean {
    if (this.openedAt === null) return false
    // Auto half-open after resetMs
    if (Date.now() - this.openedAt >= this.resetMs) {
      this.openedAt = null
      this.failures = 0
      return false
    }
    return true
  }

  recordFailure(): void {
    this.failures++
    if (this.failures >= this.threshold && this.openedAt === null) {
      this.openedAt = Date.now()
    }
  }

  recordSuccess(): void {
    this.failures = 0
    this.openedAt = null
  }
}

// ---------------------------------------------------------------------------
// ProviderPauseState — tracks consecutive 429s per provider
// ---------------------------------------------------------------------------

interface ProviderPauseState {
  consecutive429s: number
  pausedUntil: number | null
}

// ---------------------------------------------------------------------------
// LLMClient
// ---------------------------------------------------------------------------

export class LLMClient {
  private readonly retryDelays: number[]
  private readonly fallbackChain: string[]
  private readonly providerPauseMs: number
  private readonly providerPauseThreshold: number
  private readonly fetchFn: typeof fetch
  private readonly circuitBreakerThreshold: number
  private readonly circuitBreakerResetMs: number

  private circuitBreakers = new Map<string, CircuitBreaker>()
  private providerState = new Map<string, ProviderPauseState>()

  constructor(opts: LLMClientOptions = {}) {
    this.retryDelays = opts.retryDelays ?? [5_000, 15_000, 45_000]
    this.fallbackChain = opts.fallbackChain ?? DEFAULT_FALLBACK_CHAIN
    this.providerPauseMs = opts.providerPauseMs ?? 60_000
    this.providerPauseThreshold = opts.providerPauseThreshold ?? 3
    this.fetchFn = opts.fetchFn ?? fetch
    this.circuitBreakerThreshold = opts.circuitBreakerThreshold ?? 5
    this.circuitBreakerResetMs = opts.circuitBreakerResetMs ?? 60_000
  }

  // -------------------------------------------------------------------------
  // Public helpers (used by tests)
  // -------------------------------------------------------------------------

  /** Force a model's circuit open (for testing / manual override). */
  openCircuitForModel(model: string): void {
    const cb = this.getCircuitBreaker(model)
    for (let i = 0; i < this.circuitBreakerThreshold; i++) cb.recordFailure()
  }

  // -------------------------------------------------------------------------
  // Main entry point
  // -------------------------------------------------------------------------

  /**
   * Attempt the call against the requested model/provider.  If the primary
   * model's circuit is open, walk the fallback chain instead.
   */
  async call(opts: LLMCallOptions): Promise<LLMResponse> {
    const primaryKey = this.modelKey(opts.provider, opts.model)
    const primaryCb = this.getCircuitBreaker(primaryKey)

    if (!primaryCb.isOpen()) {
      try {
        return await this.callWithRetry(opts)
      } catch (err) {
        // Provider-wide pauses must propagate immediately — no fallback will help.
        if (err instanceof ProviderPausedError) throw err
        // Other failures fall through to the fallback chain.
      }
    }

    // Walk the fallback chain
    for (const entry of this.fallbackChain) {
      const [provider, ...rest] = entry.split('/')
      const model = rest.join('/')
      const fallbackKey = this.modelKey(provider, model)
      const fallbackCb = this.getCircuitBreaker(fallbackKey)
      if (fallbackCb.isOpen()) continue

      try {
        return await this.callWithRetry({
          ...opts,
          model,
          provider: provider as LLMCallOptions['provider'],
        })
      } catch (err) {
        if (err instanceof ProviderPausedError) throw err
        // Try next fallback
      }
    }

    throw new Error('All models exhausted: primary and all fallback circuits are open or failed')
  }

  // -------------------------------------------------------------------------
  // Internal: retry loop
  // -------------------------------------------------------------------------

  async callWithRetry(opts: LLMCallOptions): Promise<LLMResponse> {
    const maxAttempts = 1 + this.retryDelays.length
    let lastError: unknown

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Check provider-wide pause before each attempt
      this.assertProviderNotPaused(opts.provider)

      if (attempt > 0) {
        const delay = this.retryDelays[attempt - 1]
        await this.sleep(delay)
      }

      try {
        const result = await this.singleCall(opts)
        // Reset 429 counter on success
        this.getProviderState(opts.provider).consecutive429s = 0
        this.getCircuitBreaker(this.modelKey(opts.provider, opts.model)).recordSuccess()
        return result
      } catch (err: unknown) {
        lastError = err

        if (err instanceof ProviderPausedError) throw err

        if (err instanceof RateLimitError) {
          const state = this.getProviderState(opts.provider)
          state.consecutive429s++

          if (state.consecutive429s >= this.providerPauseThreshold) {
            const pauseMs = err.retryAfterMs ?? this.providerPauseMs
            state.pausedUntil = Date.now() + pauseMs
            state.consecutive429s = 0
            throw new ProviderPausedError(opts.provider, pauseMs)
          }

          // Respect Retry-After header for individual retry delay
          const waitMs = err.retryAfterMs ?? this.retryDelays[attempt] ?? 0
          if (waitMs > 0) await this.sleep(waitMs)
          continue
        }

        // Network / unknown error — mark circuit failure but keep retrying
        this.getCircuitBreaker(this.modelKey(opts.provider, opts.model)).recordFailure()
      }
    }

    this.getCircuitBreaker(this.modelKey(opts.provider, opts.model)).recordFailure()
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  // -------------------------------------------------------------------------
  // Internal: single HTTP call
  // -------------------------------------------------------------------------

  private async singleCall(opts: LLMCallOptions): Promise<LLMResponse> {
    const url = PROVIDER_URLS[opts.provider]
    if (!url) throw new Error(`Unknown provider: ${opts.provider}`)

    const body = JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
    })

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (opts.provider === 'openrouter' && process.env.OPENROUTER_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.OPENROUTER_API_KEY}`
    }

    let response: Response
    try {
      response = (await this.fetchFn(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      })) as Response
    } catch (err) {
      // Network-level failure (e.g. gateway unreachable)
      throw err
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After')
      const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : undefined
      throw new RateLimitError(retryAfterMs)
    }

    if (!response.ok) {
      throw new LLMError(`HTTP ${response.status}`, response.status)
    }

    const data = await response.json()
    const content: string = data?.choices?.[0]?.message?.content ?? ''
    const model: string = data?.model ?? opts.model
    const usage = data?.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens as number,
          completion_tokens: data.usage.completion_tokens as number,
        }
      : undefined

    return { content, model, usage }
  }

  // -------------------------------------------------------------------------
  // Internal: state helpers
  // -------------------------------------------------------------------------

  private getCircuitBreaker(key: string): CircuitBreaker {
    let cb = this.circuitBreakers.get(key)
    if (!cb) {
      cb = new CircuitBreaker({
        threshold: this.circuitBreakerThreshold,
        resetMs: this.circuitBreakerResetMs,
      })
      this.circuitBreakers.set(key, cb)
    }
    return cb
  }

  private getProviderState(provider: string): ProviderPauseState {
    let state = this.providerState.get(provider)
    if (!state) {
      state = { consecutive429s: 0, pausedUntil: null }
      this.providerState.set(provider, state)
    }
    return state
  }

  private assertProviderNotPaused(provider: string): void {
    const state = this.getProviderState(provider)
    if (state.pausedUntil !== null) {
      if (Date.now() < state.pausedUntil) {
        throw new ProviderPausedError(provider, state.pausedUntil - Date.now())
      }
      // Pause window has elapsed — clear it
      state.pausedUntil = null
    }
  }

  private modelKey(provider: string, model: string): string {
    return `${provider}::${model}`
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

export class RateLimitError extends Error {
  constructor(public readonly retryAfterMs?: number) {
    super('Rate limited (429)')
    this.name = 'RateLimitError'
  }
}

export class ProviderPausedError extends Error {
  constructor(
    public readonly provider: string,
    public readonly remainingMs: number,
  ) {
    super(`Provider paused: ${provider} (${remainingMs}ms remaining)`)
    this.name = 'ProviderPausedError'
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const llmClient = new LLMClient()
