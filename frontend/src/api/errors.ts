/* ============================================================
   frontend/src/api/errors.ts
   OperAI / Cloud Kitchen Rescue — Standard API Error Classes

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §1 & §4 (Error Envelope & Codes)
   - AGENTS.md (Security & Error Handling)
   ============================================================ */

import type { ApiErrorDTO } from '../types/dto'

/**
 * Thrown when the backend responds with a 4xx or 5xx status code.
 * Preserves the documented backend error code and details without swallowing context.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>
  readonly url?: string

  constructor(status: number, errorData?: Partial<ApiErrorDTO>, url?: string) {
    const code = errorData?.code ?? 'UNKNOWN_ERROR'
    const message = errorData?.message ?? `Request failed with HTTP status ${status}`
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = errorData?.details ?? {}
    this.url = url

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

/**
 * Thrown when client configuration is missing or invalid
 * (e.g., missing VITE_API_KEY when attempting an authenticated request).
 */
export class ConfigurationError extends Error {
  readonly missingKey?: string

  constructor(message: string, missingKey?: string) {
    super(message)
    this.name = 'ConfigurationError'
    this.missingKey = missingKey

    Object.setPrototypeOf(this, ConfigurationError.prototype)
  }
}

/**
 * Thrown when a network failure, request abort, or timeout occurs
 * before a response is received from the backend.
 */
export class NetworkError extends Error {
  readonly url?: string
  readonly isTimeout: boolean
  readonly isAborted: boolean

  constructor(message: string, options?: { cause?: unknown; url?: string; isTimeout?: boolean; isAborted?: boolean }) {
    super(message, { cause: options?.cause })
    this.name = 'NetworkError'
    this.url = options?.url
    this.isTimeout = options?.isTimeout ?? false
    this.isAborted = options?.isAborted ?? false

    Object.setPrototypeOf(this, NetworkError.prototype)
  }
}
