import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CircuitBreaker, LLMClient } from '../llm-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(content: string, model = 'test-model') {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      choices: [{ message: { content } }],
      model,
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
  }
}

function makeErrorResponse(status: number, retryAfter?: string) {
  return {
    ok: false,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
    json: async () => ({ error: { message: `HTTP ${status}` } }),
  }
}

// ---------------------------------------------------------------------------
// CircuitBreaker tests
// ---------------------------------------------------------------------------

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker()
    expect(cb.isOpen()).toBe(false)
  })

  it('opens after threshold failures', () => {
    const cb = new CircuitBreaker({ threshold: 3 })
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.isOpen()).toBe(false)
    cb.recordFailure()
    expect(cb.isOpen()).toBe(true)
  })

  it('resets on success (closes the circuit)', () => {
    const cb = new CircuitBreaker({ threshold: 3 })
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.isOpen()).toBe(true)
    cb.recordSuccess()
    expect(cb.isOpen()).toBe(false)
  })

  it('auto-resets to half-open after resetMs timeout', () => {
    vi.useFakeTimers()
    const cb = new CircuitBreaker({ threshold: 2, resetMs: 5000 })
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.isOpen()).toBe(true)

    vi.advanceTimersByTime(5001)
    expect(cb.isOpen()).toBe(false)
    vi.useRealTimers()
  })

  it('does not auto-reset before resetMs elapses', () => {
    vi.useFakeTimers()
    const cb = new CircuitBreaker({ threshold: 2, resetMs: 5000 })
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.isOpen()).toBe(true)

    vi.advanceTimersByTime(4999)
    expect(cb.isOpen()).toBe(true)
    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// LLMClient — basic success path
// ---------------------------------------------------------------------------

describe('LLMClient.call — success', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns parsed LLMResponse on a successful fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse('Hello world', 'gpt-4'))

    const client = new LLMClient({ fetchFn: mockFetch, retryDelays: [] })

    const promise = client.call({
      model: 'gpt-4',
      provider: 'openrouter',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.content).toBe('Hello world')
    expect(result.model).toBe('gpt-4')
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20 })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// LLMClient — retry on failure
// ---------------------------------------------------------------------------

describe('LLMClient.call — retry on transient failure', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retries on 500 and succeeds on the second attempt', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeErrorResponse(500))
      .mockResolvedValue(makeOkResponse('Retry success'))

    const client = new LLMClient({ fetchFn: mockFetch, retryDelays: [100] })

    const promise = client.call({
      model: 'test-model',
      provider: 'openrouter',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.content).toBe('Retry success')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('exhausts all retries and throws when all attempts fail', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeErrorResponse(503))

    // 0 retry delays = 1 attempt total; empty fallback chain so nothing else is tried
    const client = new LLMClient({ fetchFn: mockFetch, retryDelays: [], fallbackChain: [] })

    // Attach rejection handler immediately to avoid unhandled rejection warning,
    // then advance timers before awaiting.
    const rejection = expect(
      client.call({ model: 'test-model', provider: 'openrouter', messages: [{ role: 'user', content: 'Hi' }] })
    ).rejects.toThrow()

    await vi.runAllTimersAsync()
    await rejection
  })
})

// ---------------------------------------------------------------------------
// LLMClient — fallback when primary circuit is open
// ---------------------------------------------------------------------------

describe('LLMClient.call — fallback on open circuit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses fallback model when the primary model circuit breaker is open', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse('Fallback response', 'fallback-model'))

    const client = new LLMClient({
      fetchFn: mockFetch,
      retryDelays: [],
      fallbackChain: ['openrouter/fallback-model'],
      circuitBreakerThreshold: 2,
    })

    // Force the primary model's circuit open
    const primary = { model: 'primary-model', provider: 'openrouter' as const, messages: [{ role: 'user', content: 'Hi' }] }
    client.openCircuitForModel('primary-model')

    const promise = client.call(primary)
    await vi.runAllTimersAsync()
    const result = await promise

    // Should have called the fallback, not the primary
    expect(result.content).toBe('Fallback response')
    const calledUrl = (mockFetch.mock.calls[0][0] as string)
    expect(calledUrl).toContain('openrouter.ai')
  })
})

// ---------------------------------------------------------------------------
// LLMClient — provider-wide 429 pause
// ---------------------------------------------------------------------------

describe('LLMClient — provider-wide 429 pause', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('pauses provider after 3 consecutive 429s then recovers after 60s', async () => {
    // Three 429s then a success
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeErrorResponse(429))
      .mockResolvedValueOnce(makeErrorResponse(429))
      .mockResolvedValueOnce(makeErrorResponse(429))
      .mockResolvedValue(makeOkResponse('After pause'))

    const client = new LLMClient({
      fetchFn: mockFetch,
      // 2 retry delays → 3 total attempts; all three get a 429 → provider paused
      retryDelays: [10, 10],
      providerPauseMs: 60_000,
      // No fallback so ProviderPausedError is not swallowed by the fallback chain
      fallbackChain: [],
    })

    const opts = { model: 'test-model', provider: 'openrouter' as const, messages: [{ role: 'user', content: 'Hi' }] }

    // First call: hits 3 429s, provider gets paused, should throw.
    // Attach rejection handler before awaiting to avoid unhandled rejection warning.
    const firstRejection = expect(client.call(opts)).rejects.toThrow(/provider paused|rate limit|429/i)
    await vi.advanceTimersByTimeAsync(500)
    await firstRejection

    // Provider is now paused; a second call before 60s should throw immediately.
    // Attach rejection handler before advancing timers.
    const secondRejection = expect(client.call(opts)).rejects.toThrow(/provider paused/i)
    await secondRejection

    // Advance past the pause window
    vi.advanceTimersByTime(60_001)

    // Third call should now succeed
    const thirdCall = client.call(opts)
    await vi.advanceTimersByTimeAsync(500)
    const result = await thirdCall
    expect(result.content).toBe('After pause')
  })

  it('respects Retry-After header from 429 response', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeErrorResponse(429, '30'))
      .mockResolvedValue(makeOkResponse('After retry-after'))

    const client = new LLMClient({
      fetchFn: mockFetch,
      retryDelays: [100],
    })

    const opts = { model: 'test-model', provider: 'openrouter' as const, messages: [{ role: 'user', content: 'Hi' }] }

    const promise = client.call(opts)
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.content).toBe('After retry-after')
    // fetch was called at least twice (initial 429 + retry after delay)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// LLMClient — kilo-gateway fallback to openrouter on gateway-down
// ---------------------------------------------------------------------------

describe('LLMClient — gateway-down fallback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('falls back to openrouter when kilo-gateway is unreachable (network error)', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed')) // gateway down
      .mockResolvedValue(makeOkResponse('Direct openrouter response'))

    const client = new LLMClient({
      fetchFn: mockFetch,
      retryDelays: [],
      fallbackChain: ['openrouter/backup-model'],
    })

    const promise = client.call({
      model: 'some-model',
      provider: 'kilo-gateway',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.content).toBe('Direct openrouter response')
    // Second call should be to openrouter
    const secondCallUrl = (mockFetch.mock.calls[1][0] as string)
    expect(secondCallUrl).toContain('openrouter.ai')
  })
})
