/* ============================================================
   frontend/src/hooks/useVoice.ts
   OperAI / Cloud Kitchen Rescue — Browser Voice Recognition & Synthesis Hook

   SOURCE OF TRUTH:
   - docs/System_Architecture.md §2 (Frontend Voice Layer)
   - AGENTS.md (Rules 1, 2, 4: Voice is read/propose only; no auto-approval)
   - docs/Rest_API_Spec.md §3.16 (Voice Assistant Integration)

   BROWSER APIS USED:
   - window.SpeechRecognition || window.webkitSpeechRecognition
   - window.speechSynthesis
   - window.SpeechSynthesisUtterance

   LIFECYCLE & SAFETY INVARIANTS:
   1. Lazy feature detection: Never constructs browser API objects at module import.
   2. No auto-listen on mount: Recognition is initiated strictly by explicit user action.
   3. Unmount safety: Aborts active recognition and cancels speech synthesis on cleanup.
      Prevents post-unmount state updates.
   4. Duplicate prevention: Accumulates finalized transcript segments without duplicate delivery.
   5. Conflict resolution: Cancels in-flight speech synthesis before speaking new text.
      Stops active listening before speaking to prevent microphone self-feedback.
   6. Mutation safety: Does NOT call chatAgent, approveAction, or any backend mutation API.
   7. Graceful degradation: Exposes isRecognitionSupported / isSynthesisSupported so text fallback
      remains seamless when voice APIs are unavailable or permission is denied.
   ============================================================ */

import { useState, useEffect, useCallback } from 'react'
import type { VoiceErrorReason, VoiceInputState } from '../types/chat.ts'

/* ── Web Speech API Minimal Type Definitions ─────────────────── */

export interface SpeechRecognitionAlternativeLike {
  readonly transcript: string
  readonly confidence?: number
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: SpeechRecognitionAlternativeLike
}

export interface SpeechRecognitionResultListLike {
  readonly length: number
  readonly [index: number]: SpeechRecognitionResultLike
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLike
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string
  readonly message?: string
}

export interface SpeechRecognitionInstanceLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives?: number
  start(): void
  stop(): void
  abort(): void
  onstart: ((ev: unknown) => void) | null
  onend: ((ev: unknown) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionInstanceLike

/* ── Browser Feature Detection Helpers ──────────────────────── */

/**
 * Returns the SpeechRecognition constructor (standard or webkit-prefixed) if available.
 * Safe for server-side or non-browser environments.
 */
export function getSpeechRecognitionConstructor(
  win: unknown = typeof window !== 'undefined' ? window : undefined
): SpeechRecognitionConstructor | null {
  if (!win || typeof win !== 'object') return null
  const w = win as Record<string, unknown>
  const ctor = (w['SpeechRecognition'] ?? w['webkitSpeechRecognition']) as unknown
  return typeof ctor === 'function' ? (ctor as SpeechRecognitionConstructor) : null
}

/**
 * Returns the SpeechSynthesis instance if available.
 */
export function getSpeechSynthesis(
  win: unknown = typeof window !== 'undefined' ? window : undefined
): SpeechSynthesis | null {
  if (!win || typeof win !== 'object') return null
  const w = win as Record<string, unknown>
  const synth = w['speechSynthesis'] as unknown
  return synth && typeof synth === 'object' ? (synth as SpeechSynthesis) : null
}

/**
 * Returns the SpeechSynthesisUtterance constructor if available.
 */
export function getSpeechSynthesisUtteranceConstructor(
  win: unknown = typeof window !== 'undefined' ? window : undefined
): (new (text?: string) => SpeechSynthesisUtterance) | null {
  if (!win || typeof win !== 'object') return null
  const w = win as Record<string, unknown>
  const ctor = (w['SpeechSynthesisUtterance'] ??
    (typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>)['SpeechSynthesisUtterance'] : undefined)) as unknown
  return typeof ctor === 'function' ? (ctor as new (text?: string) => SpeechSynthesisUtterance) : null
}

/**
 * Maps raw browser SpeechRecognition error codes to user-friendly messages and VoiceErrorReason.
 */
export function mapSpeechRecognitionError(
  error: string,
  eventMessage?: string
): { message: string; reason: VoiceErrorReason } {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        reason: 'permission_denied',
        message: 'Microphone permission was denied. Please allow microphone access in your browser settings.'
      }
    case 'no-speech':
      return {
        reason: 'no_speech',
        message: 'No speech was detected. Please check your microphone and speak again.'
      }
    case 'network':
      return {
        reason: 'network',
        message: 'Speech recognition network error. Please check your internet connection.'
      }
    case 'aborted':
      return {
        reason: 'aborted',
        message: 'Speech recognition was cancelled.'
      }
    case 'audio-capture':
      return {
        reason: 'unknown',
        message: 'No microphone was found or microphone is unavailable.'
      }
    case 'language-not-supported':
      return {
        reason: 'not_supported',
        message: 'The requested speech recognition language is not supported.'
      }
    default:
      return {
        reason: 'unknown',
        message: eventMessage && eventMessage.trim().length > 0
          ? eventMessage
          : `Speech recognition error: ${error}`
      }
  }
}

/* ── Hook Options and Return Types ──────────────────────────── */

export interface UseVoiceOptions {
  /** BCP 47 language tag (default: 'en-IN' for Indian English demo kitchen) */
  readonly lang?: string
  /** Whether to capture continuous speech across pauses (default: false for command turn) */
  readonly continuous?: boolean
  /** Whether to emit interim/provisional speech results (default: true) */
  readonly interimResults?: boolean
  /** Optional callback fired when a distinct finalized transcript segment is recognized */
  readonly onFinalTranscript?: (transcript: string) => void
  /** Optional callback fired on recognition error */
  readonly onError?: (error: string, reason: VoiceErrorReason) => void
  /** Custom window reference for testing/mocking in Node */
  readonly windowRef?: unknown
}

export interface UseVoiceReturn {
  /** Whether SpeechRecognition or webkitSpeechRecognition is supported */
  readonly isRecognitionSupported: boolean
  /** Whether SpeechSynthesis is supported */
  readonly isSynthesisSupported: boolean
  /** Current voice lifecycle state */
  readonly voiceState: VoiceInputState
  /** True when actively listening to microphone */
  readonly isListening: boolean
  /** True when actively speaking synthesized speech */
  readonly isSpeaking: boolean
  /** Full combined transcript (finalized + current interim) */
  readonly transcript: string
  /** In-progress provisional transcript segment */
  readonly interimTranscript: string
  /** Accumulated finalized transcript segment */
  readonly finalTranscript: string
  /** Latest error message or null */
  readonly error: string | null
  /** Categorized error reason or null */
  readonly errorReason: VoiceErrorReason | null
  /** Explicitly start microphone listening */
  readonly startListening: () => void
  /** Explicitly stop microphone listening */
  readonly stopListening: () => void
  /** Clear all transcript buffers and errors */
  readonly resetTranscript: () => void
  /** Speak a supplied text string via speech synthesis */
  readonly speak: (text: string) => void
  /** Stop any in-progress speech synthesis */
  readonly stopSpeaking: () => void
}

export interface VoiceSessionState {
  readonly voiceState: VoiceInputState
  readonly isListening: boolean
  readonly isSpeaking: boolean
  readonly transcript: string
  readonly interimTranscript: string
  readonly finalTranscript: string
  readonly error: string | null
  readonly errorReason: VoiceErrorReason | null
}

export interface VoiceSessionControllerOptions extends UseVoiceOptions {
  readonly onStateChange?: (state: VoiceSessionState) => void
}

/* ── Extractable Voice Session Controller ───────────────────── */

/**
 * Headless controller encapsulating speech recognition and speech synthesis
 * lifecycle, event processing, transcript accumulation, and error mapping.
 * Decoupled from React to enable exhaustive native unit testing in Node.
 */
export class VoiceSessionController {
  private options: VoiceSessionControllerOptions
  private win: unknown
  private recognitionInstance: SpeechRecognitionInstanceLike | null = null
  private activeUtterance: SpeechSynthesisUtterance | null = null

  private baseFinalTranscript = ''
  private sessionFinalTranscript = ''
  private interimTranscript = ''
  private finalTranscript = ''
  private transcript = ''
  private lastFinalProcessedIndex = -1

  private isListening = false
  private isSpeaking = false
  private voiceState: VoiceInputState = 'idle'
  private error: string | null = null
  private errorReason: VoiceErrorReason | null = null
  private isDestroyed = false

  readonly isRecognitionSupported: boolean
  readonly isSynthesisSupported: boolean

  constructor(options: VoiceSessionControllerOptions = {}) {
    this.options = options
    this.win = options.windowRef ?? (typeof window !== 'undefined' ? window : undefined)

    const recCtor = getSpeechRecognitionConstructor(this.win)
    const synth = getSpeechSynthesis(this.win)

    this.isRecognitionSupported = recCtor !== null
    this.isSynthesisSupported = synth !== null

    if (!this.isRecognitionSupported) {
      this.voiceState = 'unsupported'
      this.error = 'Speech recognition is not supported in this browser.'
      this.errorReason = 'not_supported'
    }
  }

  getState(): VoiceSessionState {
    return {
      voiceState: this.voiceState,
      isListening: this.isListening,
      isSpeaking: this.isSpeaking,
      transcript: this.transcript,
      interimTranscript: this.interimTranscript,
      finalTranscript: this.finalTranscript,
      error: this.error,
      errorReason: this.errorReason
    }
  }

  getActiveUtterance(): SpeechSynthesisUtterance | null {
    return this.activeUtterance
  }

  activate(): void {
    this.isDestroyed = false
  }

  updateOptions(options?: Partial<VoiceSessionControllerOptions>): void {
    if (!options) return
    this.options = {
      ...this.options,
      ...options,
      onStateChange: options.onStateChange ?? this.options.onStateChange
    }
  }

  private emitState(): void {
    if (this.isDestroyed) return
    this.options.onStateChange?.(this.getState())
  }

  startListening(): void {
    if (this.isDestroyed) return

    if (!this.isRecognitionSupported) {
      this.voiceState = 'unsupported'
      this.error = 'Speech recognition is not supported in this browser.'
      this.errorReason = 'not_supported'
      this.options.onError?.(this.error, this.errorReason)
      this.emitState()
      return
    }

    // Repeated call protection: if already listening, do not start again
    if (this.isListening) {
      return
    }

    // If currently speaking, stop synthesis first to avoid audio feedback
    if (this.isSpeaking) {
      this.stopSpeaking()
    }

    // Reset error state on new explicit user start
    this.error = null
    this.errorReason = null

    // Clean up any lingering prior recognition instance before starting a new session
    if (this.recognitionInstance) {
      try {
        this.recognitionInstance.onstart = null
        this.recognitionInstance.onresult = null
        this.recognitionInstance.onerror = null
        this.recognitionInstance.onend = null
        this.recognitionInstance.abort()
      } catch {
        // Ignore
      }
      this.recognitionInstance = null
    }

    // Carry forward any previously finalized transcript as base
    this.baseFinalTranscript = this.finalTranscript
    this.sessionFinalTranscript = ''
    this.interimTranscript = ''
    this.lastFinalProcessedIndex = -1

    const RecCtor = getSpeechRecognitionConstructor(this.win)!
    try {
      this.recognitionInstance = new RecCtor()
    } catch {
      this.error = 'Failed to initialize speech recognition.'
      this.errorReason = 'unknown'
      this.voiceState = 'error'
      this.options.onError?.(this.error, this.errorReason)
      this.emitState()
      return
    }

    const rec = this.recognitionInstance
    rec.lang = this.options.lang ?? 'en-IN'
    rec.continuous = this.options.continuous ?? false
    rec.interimResults = this.options.interimResults ?? true

    rec.onstart = () => {
      if (this.isDestroyed || this.recognitionInstance !== rec) return
      this.isListening = true
      this.voiceState = 'listening'
      this.emitState()
    }

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      if (this.isDestroyed || this.recognitionInstance !== rec) return

      let currentSessionFinal = ''
      let currentInterim = ''

      const results = event.results
      for (let i = 0; i < results.length; i++) {
        const item = results[i]
        const text = item[0]?.transcript?.trim() ?? ''
        if (!text) continue

        if (item.isFinal) {
          currentSessionFinal += (currentSessionFinal ? ' ' : '') + text
          // Avoid duplicate final transcript delivery
          if (i > this.lastFinalProcessedIndex) {
            this.lastFinalProcessedIndex = i
            this.options.onFinalTranscript?.(text)
          }
        } else {
          currentInterim += (currentInterim ? ' ' : '') + text
        }
      }

      this.sessionFinalTranscript = currentSessionFinal
      this.interimTranscript = currentInterim

      // Assemble finalTranscript
      if (this.baseFinalTranscript && this.sessionFinalTranscript) {
        this.finalTranscript = `${this.baseFinalTranscript} ${this.sessionFinalTranscript}`
      } else {
        this.finalTranscript = this.baseFinalTranscript || this.sessionFinalTranscript
      }

      // Assemble combined transcript
      if (this.finalTranscript && this.interimTranscript) {
        this.transcript = `${this.finalTranscript} ${this.interimTranscript}`
      } else {
        this.transcript = this.finalTranscript || this.interimTranscript
      }

      this.emitState()
    }

    rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (this.isDestroyed || this.recognitionInstance !== rec) return
      const mapped = mapSpeechRecognitionError(event.error, event.message)
      this.error = mapped.message
      this.errorReason = mapped.reason
      this.voiceState = 'error'
      this.isListening = false
      this.options.onError?.(this.error, this.errorReason)
      this.emitState()
    }

    rec.onend = () => {
      if (this.isDestroyed || this.recognitionInstance !== rec) return
      this.isListening = false
      // Discard any residual unfinalized interim on session end
      this.interimTranscript = ''
      this.transcript = this.finalTranscript

      // If ended normally without a previous error, return to idle
      if (this.voiceState !== 'error') {
        this.voiceState = 'idle'
      }

      this.recognitionInstance = null
      this.emitState()
    }

    try {
      rec.start()
      this.isListening = true
      this.voiceState = 'listening'
      this.emitState()
    } catch {
      this.error = 'Speech recognition could not be started.'
      this.errorReason = 'unknown'
      this.voiceState = 'error'
      this.isListening = false
      this.recognitionInstance = null
      this.options.onError?.(this.error, this.errorReason)
      this.emitState()
    }
  }

  stopListening(): void {
    if (this.isDestroyed) return
    if (!this.recognitionInstance) {
      return
    }

    try {
      this.recognitionInstance.stop()
    } catch {
      // Ignore if already stopped
    }
    this.isListening = false
    if (this.voiceState !== 'error') {
      this.voiceState = 'idle'
    }
    this.emitState()
  }

  resetTranscript(): void {
    if (this.isDestroyed) return

    this.baseFinalTranscript = ''
    this.sessionFinalTranscript = ''
    this.interimTranscript = ''
    this.finalTranscript = ''
    this.transcript = ''
    this.lastFinalProcessedIndex = -1
    this.error = null
    this.errorReason = null

    if (this.voiceState === 'error') {
      this.voiceState = this.isListening
        ? 'listening'
        : this.isSpeaking
          ? 'speaking'
          : 'idle'
    }

    this.emitState()
  }

  speak(text: string): void {
    if (this.isDestroyed) return

    const synth = getSpeechSynthesis(this.win)
    const UtteranceCtor = getSpeechSynthesisUtteranceConstructor(this.win)

    if (!synth || !UtteranceCtor || !this.isSynthesisSupported) {
      this.error = 'Speech synthesis is not supported in this browser.'
      this.errorReason = 'not_supported'
      this.voiceState = 'unsupported'
      this.options.onError?.(this.error, this.errorReason)
      this.emitState()
      return
    }

    const cleanText = text?.trim() ?? ''
    if (!cleanText) {
      return
    }

    // Stop listening before speaking to prevent microphone loop
    if (this.isListening) {
      this.stopListening()
    }

    // Detach and cancel previous utterance to prevent stale callbacks
    if (this.activeUtterance) {
      this.activeUtterance.onstart = null
      this.activeUtterance.onend = null
      this.activeUtterance.onerror = null
      this.activeUtterance = null
    }

    // Cancel in-flight synthesis to prevent conflicting speech queues
    try {
      synth.cancel()
    } catch {
      // Ignore
    }

    try {
      const utterance = new UtteranceCtor(cleanText)
      utterance.lang = this.options.lang ?? 'en-IN'
      this.activeUtterance = utterance

      utterance.onstart = () => {
        if (this.isDestroyed || this.activeUtterance !== utterance) return
        this.isSpeaking = true
        this.voiceState = 'speaking'
        this.emitState()
      }

      utterance.onend = () => {
        if (this.isDestroyed || this.activeUtterance !== utterance) return
        this.isSpeaking = false
        if (this.voiceState === 'speaking') {
          this.voiceState = 'idle'
        }
        this.activeUtterance = null
        this.emitState()
      }

      utterance.onerror = () => {
        if (this.isDestroyed || this.activeUtterance !== utterance) return
        this.isSpeaking = false
        if (this.voiceState === 'speaking') {
          this.voiceState = 'idle'
        }
        this.activeUtterance = null
        this.emitState()
      }

      synth.speak(utterance)
    } catch {
      this.error = 'Speech synthesis failed to speak.'
      this.errorReason = 'unknown'
      this.isSpeaking = false
      if (this.voiceState === 'speaking') {
        this.voiceState = 'idle'
      }
      this.activeUtterance = null
      this.emitState()
    }
  }

  stopSpeaking(): void {
    if (this.isDestroyed) return

    if (this.activeUtterance) {
      this.activeUtterance.onstart = null
      this.activeUtterance.onend = null
      this.activeUtterance.onerror = null
      this.activeUtterance = null
    }

    const synth = getSpeechSynthesis(this.win)
    if (synth) {
      try {
        synth.cancel()
      } catch {
        // Ignore
      }
    }

    this.isSpeaking = false
    if (this.voiceState === 'speaking') {
      this.voiceState = 'idle'
    }
    this.emitState()
  }

  destroy(): void {
    this.isDestroyed = true
    this.isListening = false
    this.isSpeaking = false
    if (this.voiceState !== 'unsupported') {
      this.voiceState = 'idle'
    }

    if (this.recognitionInstance) {
      try {
        this.recognitionInstance.onstart = null
        this.recognitionInstance.onresult = null
        this.recognitionInstance.onerror = null
        this.recognitionInstance.onend = null
        this.recognitionInstance.abort()
      } catch {
        // Ignore
      }
      this.recognitionInstance = null
    }

    if (this.activeUtterance) {
      this.activeUtterance.onstart = null
      this.activeUtterance.onend = null
      this.activeUtterance.onerror = null
      this.activeUtterance = null
    }

    const synth = getSpeechSynthesis(this.win)
    if (synth) {
      try {
        synth.cancel()
      } catch {
        // Ignore
      }
    }
  }
}

/* ── React Hook: useVoice ───────────────────────────────────── */

/**
 * React hook exposing browser-native speech recognition and speech synthesis.
 * Safe for all browsers with text fallback.
 * CRITICAL SAFETY (AGENTS.md Rule 2):
 * This hook NEVER calls approval or mutation endpoints.
 */
export function useVoice(options?: UseVoiceOptions): UseVoiceReturn {
  const [state, setState] = useState<VoiceSessionState>(() => {
    const isRecSupported = getSpeechRecognitionConstructor() !== null
    return {
      voiceState: isRecSupported ? 'idle' : 'unsupported',
      isListening: false,
      isSpeaking: false,
      transcript: '',
      interimTranscript: '',
      finalTranscript: '',
      error: isRecSupported ? null : 'Speech recognition is not supported in this browser.',
      errorReason: isRecSupported ? null : 'not_supported'
    }
  })

  const [controller] = useState(() => {
    return new VoiceSessionController({
      onStateChange: (newState) => {
        setState(newState)
      }
    })
  })

  useEffect(() => {
    controller.activate()
    return () => {
      controller.destroy()
    }
  }, [controller])

  useEffect(() => {
    controller.updateOptions(options)
  }, [controller, options])

  const startListening = useCallback(() => {
    controller.startListening()
  }, [controller])

  const stopListening = useCallback(() => {
    controller.stopListening()
  }, [controller])

  const resetTranscript = useCallback(() => {
    controller.resetTranscript()
  }, [controller])

  const speak = useCallback((text: string) => {
    controller.speak(text)
  }, [controller])

  const stopSpeaking = useCallback(() => {
    controller.stopSpeaking()
  }, [controller])

  return {
    isRecognitionSupported: controller.isRecognitionSupported,
    isSynthesisSupported: controller.isSynthesisSupported,
    voiceState: state.voiceState,
    isListening: state.isListening,
    isSpeaking: state.isSpeaking,
    transcript: state.transcript,
    interimTranscript: state.interimTranscript,
    finalTranscript: state.finalTranscript,
    error: state.error,
    errorReason: state.errorReason,
    startListening,
    stopListening,
    resetTranscript,
    speak,
    stopSpeaking
  }
}
