/* ============================================================
   frontend/src/api/client.ts
   OperAI / Cloud Kitchen Rescue — Centralized Fetch API Client

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §1 (Conventions, Base URL, Auth Header)
   - AGENTS.md (Hard rules: no secrets in code, numbers from backend)
   ============================================================ */

import type { ApiErrorResponseDTO } from '../types/dto.ts'
import { ApiError, ConfigurationError, NetworkError } from './errors.ts'

export interface ApiClientConfig {
  /** Base URL for backend requests (e.g. "http://localhost:8000") */
  readonly baseUrl: string
  /** Shared secret for single demo kitchen (Rest_API_Spec.md §1) */
  readonly apiKey?: string
  /** Default request timeout in milliseconds (default: 10000ms) */
  readonly timeoutMs?: number
  /** Custom fetch implementation (useful for tests or mocking) */
  readonly fetchFn?: typeof fetch
}

export interface RequestOptions {
  /** HTTP method (default: 'GET') */
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** URL query parameters */
  readonly params?: Record<string, unknown> | object
  /** JSON-serializable request payload */
  readonly body?: unknown
  /** Optional custom headers */
  readonly headers?: Record<string, string>
  /** External AbortSignal for user-cancelled requests */
  readonly signal?: AbortSignal
  /** Per-request timeout in milliseconds */
  readonly timeoutMs?: number
  /** If false, omits the X-API-Key header (used for /health) */
  readonly requireAuth?: boolean
}

/**
 * Resolves default environment configuration from Vite environment variables.
 */
export function getDefaultConfig(): ApiClientConfig {
  const env = typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env as unknown as Record<string, string | undefined>)
    : {}
  const baseUrl = env.VITE_API_BASE_URL?.trim() || 'http://localhost:8000'
  const apiKey = env.VITE_API_KEY?.trim() || undefined

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''), // strip trailing slash
    apiKey,
    timeoutMs: 10000
  }
}

export class ApiClient {
  readonly config: ApiClientConfig
  private readonly fetchFn: typeof fetch

  constructor(config?: Partial<ApiClientConfig>) {
    const defaults = getDefaultConfig()
    const rawBaseUrl = (config?.baseUrl ?? defaults.baseUrl).replace(/\/+$/, '')
    
    // Validate baseUrl format
    try {
      new URL(rawBaseUrl)
    } catch {
      throw new ConfigurationError(
        `Invalid API base URL: "${rawBaseUrl}". Must be a valid absolute URL (e.g. "http://localhost:8000").`,
        'VITE_API_BASE_URL'
      )
    }

    this.config = {
      baseUrl: rawBaseUrl,
      apiKey: config?.apiKey ?? defaults.apiKey,
      timeoutMs: config?.timeoutMs ?? defaults.timeoutMs ?? 10000,
      fetchFn: config?.fetchFn ?? defaults.fetchFn ?? globalThis.fetch.bind(globalThis)
    }
    this.fetchFn = this.config.fetchFn!
  }

  /**
   * Constructs the full request URL with query parameters.
   */
  buildUrl(path: string, params?: RequestOptions['params']): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`
    const fullUrl = new URL(`${this.config.baseUrl}${cleanPath}`)

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          fullUrl.searchParams.set(key, String(value))
        }
      }
    }

    return fullUrl.toString()
  }

  /**
   * Executes an HTTP request against the OperAI backend.
   */
  async request<T>(path: string, options?: RequestOptions): Promise<T> {
    const requireAuth = options?.requireAuth ?? (path !== '/health')
    const apiKey = this.config.apiKey

    if (requireAuth && !apiKey) {
      throw new ConfigurationError(
        'Missing VITE_API_KEY. All /api endpoints require an X-API-Key header per Rest_API_Spec.md §1. ' +
        'Please define VITE_API_KEY in frontend/.env.',
        'VITE_API_KEY'
      )
    }

    const url = this.buildUrl(path, options?.params)
    const method = options?.method ?? 'GET'
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options?.headers
    }

    if (requireAuth && apiKey) {
      headers['X-API-Key'] = apiKey
    }

    let bodyPayload: string | undefined = undefined
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      bodyPayload = JSON.stringify(options.body)
    }

    // Configure timeout and abort handling
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs ?? 10000
    const controller = new AbortController()
    let isTimeout = false

    const timer = setTimeout(() => {
      isTimeout = true
      controller.abort()
    }, timeoutMs)

    // Chain external signal if provided
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    try {
      const response = await this.fetchFn(url, {
        method,
        headers,
        body: bodyPayload,
        signal: controller.signal
      })

      clearTimeout(timer)

      // Success branch
      if (response.ok) {
        // Handle 204 No Content
        if (response.status === 204) {
          return undefined as T
        }
        return (await response.json()) as T
      }

      // Error branch: attempt to parse standardized error envelope
      let errorData: Partial<ApiErrorResponseDTO['error']> | undefined = undefined
      try {
        const errorJson = (await response.json()) as ApiErrorResponseDTO
        if (errorJson && typeof errorJson === 'object' && 'error' in errorJson) {
          errorData = errorJson.error
        }
      } catch {
        // Response was not JSON
      }

      throw new ApiError(response.status, errorData, url)
    } catch (err: unknown) {
      clearTimeout(timer)

      // Re-throw ApiError or ConfigurationError directly
      if (err instanceof ApiError || err instanceof ConfigurationError) {
        throw err
      }

      // Map DOMException/AbortError to NetworkError
      const isAborted = (err instanceof Error && err.name === 'AbortError') || controller.signal.aborted

      throw new NetworkError(
        isTimeout
          ? `Request timed out after ${timeoutMs}ms for ${method} ${path}`
          : isAborted
            ? `Request was aborted for ${method} ${path}`
            : `Network failure connecting to ${url}: ${(err as Error)?.message ?? 'Unknown error'}`,
        { cause: err, url, isTimeout, isAborted }
      )
    }
  }

  /**
   * Convenience helper for GET requests.
   */
  async get<T>(path: string, params?: RequestOptions['params'], options?: Omit<RequestOptions, 'method' | 'params'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET', params })
  }

  /**
   * Convenience helper for POST requests.
   * NOTE: Never automatically retried per AGENTS.md rules.
   */
  async post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body })
  }
}

/**
 * Singleton API client instance configured with environment variables.
 */
export const apiClient = new ApiClient()
