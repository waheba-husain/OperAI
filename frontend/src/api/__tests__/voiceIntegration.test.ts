/* ============================================================
   frontend/src/api/__tests__/voiceIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Browser Voice Layer Integration Tests

   Covers Feature 7 Phase 2 Requirements:
   1. Standard and webkit-prefixed SpeechRecognition support detection.
   2. Unsupported recognition handling and graceful degradation.
   3. Unsupported speech synthesis handling.
   4. Start and stop recognition lifecycle.
   5. Interim vs. finalized transcript assembly and distinction.
   6. Duplicate final transcript delivery suppression.
   7. Permission denial error handling (not-allowed).
   8. Recognition errors (no-speech, network, aborted, unknown).
   9. Repeated start/stop call safety and idempotency.
   10. Speech synthesis lifecycle, queue conflict prevention, and cancellation.
   11. Unmount cleanup (recognition abort, synthesis cancellation, no leaked updates).
   12. Complete absence of automatic API submission or action approval mutations.

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/voiceIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getSpeechRecognitionConstructor,
  getSpeechSynthesis,
  getSpeechSynthesisUtteranceConstructor,
  mapSpeechRecognitionError,
  VoiceSessionController,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionInstanceLike,
  type VoiceSessionState
} from '../../hooks/useVoice.ts'

/* ── Test Mocks for Browser Native Speech APIs ───────────────── */

class MockSpeechRecognitionInstance implements SpeechRecognitionInstanceLike {
  continuous = false
  interimResults = true
  lang = 'en-IN'
  maxAlternatives = 1

  startCount = 0
  stopCount = 0
  abortCount = 0

  onstart: ((ev: unknown) => void) | null = null
  onend: ((ev: unknown) => void) | null = null
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null = null
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null = null

  start(): void {
    this.startCount++
    // Simulate async browser event onstart
    queueMicrotask(() => {
      this.onstart?.({})
    })
  }

  stop(): void {
    this.stopCount++
    queueMicrotask(() => {
      this.onend?.({})
    })
  }

  abort(): void {
    this.abortCount++
    queueMicrotask(() => {
      this.onend?.({})
    })
  }

  // Test helpers to trigger events
  emitResult(event: SpeechRecognitionEventLike): void {
    this.onresult?.(event)
  }

  emitError(event: SpeechRecognitionErrorEventLike): void {
    this.onerror?.(event)
  }

  emitEnd(): void {
    this.onend?.({})
  }
}

class MockSpeechSynthesisUtterance {
  text: string
  lang = 'en-IN'
  onstart: ((ev: unknown) => void) | null = null
  onend: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null

  constructor(text: string = '') {
    this.text = text
  }
}

class MockSpeechSynthesis {
  speaking = false
  pending = false
  paused = false
  speakCalls: MockSpeechSynthesisUtterance[] = []
  cancelCalls = 0

  speak(utterance: unknown): void {
    const utt = utterance as MockSpeechSynthesisUtterance
    this.speakCalls.push(utt)
    this.speaking = true
    queueMicrotask(() => {
      utt.onstart?.({})
    })
  }

  cancel(): void {
    this.cancelCalls++
    this.speaking = false
  }

  // Test helper to finish utterance
  finishUtterance(index: number = this.speakCalls.length - 1): void {
    const utt = this.speakCalls[index]
    if (utt) {
      this.speaking = false
      utt.onend?.({})
    }
  }
}

/**
 * Helper to construct a mocked browser window environment.
 */
function createMockWindow(overrides?: {
  recognition?: unknown
  webkitRecognition?: unknown
  synthesis?: unknown
  utterance?: unknown
}): Record<string, unknown> {
  return {
    SpeechRecognition: overrides && 'recognition' in overrides ? overrides.recognition : MockSpeechRecognitionInstance,
    webkitSpeechRecognition: overrides && 'webkitRecognition' in overrides ? overrides.webkitRecognition : undefined,
    speechSynthesis: overrides && 'synthesis' in overrides ? overrides.synthesis : new MockSpeechSynthesis(),
    SpeechSynthesisUtterance: overrides && 'utterance' in overrides ? overrides.utterance : MockSpeechSynthesisUtterance
  }
}

/* ── 1. Browser Detection & Prefixes ─────────────────────────── */

test('useVoice: detects standard window.SpeechRecognition when present', () => {
  const mockWin = {
    SpeechRecognition: MockSpeechRecognitionInstance
  }
  const ctor = getSpeechRecognitionConstructor(mockWin)
  assert.strictEqual(ctor, MockSpeechRecognitionInstance)
})

test('useVoice: detects webkitSpeechRecognition fallback when standard SpeechRecognition is undefined', () => {
  const mockWin = {
    webkitSpeechRecognition: MockSpeechRecognitionInstance
  }
  const ctor = getSpeechRecognitionConstructor(mockWin)
  assert.strictEqual(ctor, MockSpeechRecognitionInstance)
})

test('useVoice: safely returns null when in server/non-browser environment or APIs undefined', () => {
  assert.strictEqual(getSpeechRecognitionConstructor(undefined), null)
  assert.strictEqual(getSpeechRecognitionConstructor({}), null)
  assert.strictEqual(getSpeechSynthesis(undefined), null)
  assert.strictEqual(getSpeechSynthesis({}), null)
})

/* ── 2. Unsupported Environments ────────────────────────────── */

test('useVoice: sets unsupported state and error when SpeechRecognition is not supported', () => {
  const mockWin = createMockWindow({ recognition: undefined, webkitRecognition: undefined })
  const controller = new VoiceSessionController({ windowRef: mockWin })

  assert.strictEqual(controller.isRecognitionSupported, false)
  const state = controller.getState()
  assert.strictEqual(state.voiceState, 'unsupported')
  assert.strictEqual(state.errorReason, 'not_supported')
  assert.match(state.error!, /not supported/i)

  // startListening should be a safe no-op that emits error
  let emittedError: string | null = null
  controller.updateOptions({
    onError: (err) => {
      emittedError = err
    }
  })
  controller.startListening()
  assert(emittedError)
})

test('useVoice: gracefully handles unsupported SpeechSynthesis when speak() is called', () => {
  const mockWin = createMockWindow({ synthesis: null })
  const controller = new VoiceSessionController({ windowRef: mockWin })

  assert.strictEqual(controller.isSynthesisSupported, false)

  let capturedError: string | null = null
  controller.updateOptions({
    onError: (err) => {
      capturedError = err
    }
  })

  controller.speak('Test announcement')

  const state = controller.getState()
  assert.strictEqual(state.voiceState, 'unsupported')
  assert.strictEqual(state.errorReason, 'not_supported')
  assert.match(capturedError ?? '', /not supported/i)
})

/* ── 3. Start and Stop Lifecycle ─────────────────────────────── */

test('useVoice: startListening creates recognition instance with configured language and options', async () => {
  let createdInstance: MockSpeechRecognitionInstance | null = null

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      createdInstance = this
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  const controller = new VoiceSessionController({
    windowRef: mockWin,
    lang: 'en-IN',
    continuous: true,
    interimResults: true
  })

  controller.startListening()

  assert(createdInstance)
  assert.strictEqual((createdInstance as MockSpeechRecognitionInstance).lang, 'en-IN')
  assert.strictEqual((createdInstance as MockSpeechRecognitionInstance).continuous, true)
  assert.strictEqual((createdInstance as MockSpeechRecognitionInstance).interimResults, true)
  assert.strictEqual((createdInstance as MockSpeechRecognitionInstance).startCount, 1)

  // Let microtask fire onstart
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.strictEqual(controller.getState().isListening, true)
  assert.strictEqual(controller.getState().voiceState, 'listening')

  // Stop listening
  controller.stopListening()
  assert.strictEqual((createdInstance as MockSpeechRecognitionInstance).stopCount, 1)

  // Emit onend
  ;(createdInstance as MockSpeechRecognitionInstance).emitEnd()
  assert.strictEqual(controller.getState().isListening, false)
  assert.strictEqual(controller.getState().voiceState, 'idle')
})

/* ── 4. Interim vs. Final Transcript Assembly ────────────────── */

test('useVoice: distinguishes interim from final transcripts and combines them cleanly', () => {
  let activeInstance: MockSpeechRecognitionInstance | null = null

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      activeInstance = this
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  const controller = new VoiceSessionController({
    windowRef: mockWin
  })

  let latestState: VoiceSessionState = controller.getState()
  controller.updateOptions({
    onStateChange: (st) => {
      latestState = st
    }
  })

  controller.startListening()
  const rec = activeInstance!

  // Event 1: Interim chunk
  rec.emitResult({
    resultIndex: 0,
    results: [
      {
        isFinal: false,
        length: 1,
        0: { transcript: 'We are out' }
      }
    ]
  })

  assert.strictEqual(latestState.finalTranscript, '')
  assert.strictEqual(latestState.interimTranscript, 'We are out')
  assert.strictEqual(latestState.transcript, 'We are out')

  // Event 2: Final chunk
  rec.emitResult({
    resultIndex: 0,
    results: [
      {
        isFinal: true,
        length: 1,
        0: { transcript: 'We are out of paneer' }
      }
    ]
  })

  assert.strictEqual(latestState.finalTranscript, 'We are out of paneer')
  assert.strictEqual(latestState.interimTranscript, '')
  assert.strictEqual(latestState.transcript, 'We are out of paneer')

  // Event 3: Final chunk + new Interim chunk
  rec.emitResult({
    resultIndex: 0,
    results: [
      {
        isFinal: true,
        length: 1,
        0: { transcript: 'We are out of paneer' }
      },
      {
        isFinal: false,
        length: 1,
        0: { transcript: 'for tomorrow' }
      }
    ]
  })

  assert.strictEqual(latestState.finalTranscript, 'We are out of paneer')
  assert.strictEqual(latestState.interimTranscript, 'for tomorrow')
  assert.strictEqual(latestState.transcript, 'We are out of paneer for tomorrow')
})

/* ── 5. Duplicate Final Results Suppression ──────────────────── */

test('useVoice: fires onFinalTranscript exactly once per finalized index and avoids duplication', () => {
  let activeInstance: MockSpeechRecognitionInstance | null = null

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      activeInstance = this
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  const finalSegments: string[] = []

  const controller = new VoiceSessionController({
    windowRef: mockWin,
    onFinalTranscript: (text) => {
      finalSegments.push(text)
    }
  })

  controller.startListening()
  const rec = activeInstance!

  const resultList = [
    {
      isFinal: true,
      length: 1,
      0: { transcript: 'Paneer shortage' }
    }
  ]

  // Simulate multiple browser result events delivering the same finalized result
  rec.emitResult({ resultIndex: 0, results: resultList })
  rec.emitResult({ resultIndex: 0, results: resultList })
  rec.emitResult({ resultIndex: 0, results: resultList })

  assert.strictEqual(finalSegments.length, 1, 'onFinalTranscript must fire only once per distinct final segment')
  assert.strictEqual(finalSegments[0], 'Paneer shortage')
  assert.strictEqual(controller.getState().finalTranscript, 'Paneer shortage')
})

/* ── 6. Permission Denial & Error Mapping ────────────────────── */

test('useVoice: maps not-allowed error to permission_denied with helpful user message', () => {
  let activeInstance: MockSpeechRecognitionInstance | null = null

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      activeInstance = this
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  let capturedError: string | null = null
  let capturedReason: string | null = null

  const controller = new VoiceSessionController({
    windowRef: mockWin,
    onError: (err, reason) => {
      capturedError = err
      capturedReason = reason
    }
  })

  controller.startListening()
  activeInstance!.emitError({ error: 'not-allowed' })

  const state = controller.getState()
  assert.strictEqual(state.voiceState, 'error')
  assert.strictEqual(state.errorReason, 'permission_denied')
  assert.match(state.error!, /permission was denied/i)
  assert.strictEqual(capturedReason, 'permission_denied')
  assert.strictEqual(capturedError, state.error)
})

test('useVoice: maps standard recognition errors (no-speech, network, aborted, unknown)', () => {
  const errNoSpeech = mapSpeechRecognitionError('no-speech')
  assert.strictEqual(errNoSpeech.reason, 'no_speech')
  assert.match(errNoSpeech.message, /no speech/i)

  const errNetwork = mapSpeechRecognitionError('network')
  assert.strictEqual(errNetwork.reason, 'network')
  assert.match(errNetwork.message, /network/i)

  const errAborted = mapSpeechRecognitionError('aborted')
  assert.strictEqual(errAborted.reason, 'aborted')
  assert.match(errAborted.message, /cancelled/i)

  const errCustom = mapSpeechRecognitionError('other-error', 'Custom browser error message')
  assert.strictEqual(errCustom.reason, 'unknown')
  assert.strictEqual(errCustom.message, 'Custom browser error message')
})

test('useVoice: preserves error state when onend fires immediately after onerror', () => {
  let activeInstance: MockSpeechRecognitionInstance | null = null

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      activeInstance = this
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  const controller = new VoiceSessionController({ windowRef: mockWin })

  controller.startListening()
  const rec = activeInstance!

  rec.emitError({ error: 'no-speech' })
  rec.emitEnd()

  const state = controller.getState()
  assert.strictEqual(state.isListening, false)
  assert.strictEqual(state.voiceState, 'error', 'Voice state must remain error rather than transitioning to idle')
  assert.strictEqual(state.errorReason, 'no_speech')
})

/* ── 7. Repeated Start/Stop Calls (Idempotency) ─────────────── */

test('useVoice: repeated startListening calls while listening do not invoke start() repeatedly', () => {
  let activeInstance: MockSpeechRecognitionInstance | null = null

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      activeInstance = this
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  const controller = new VoiceSessionController({ windowRef: mockWin })

  controller.startListening()
  const firstInstance = activeInstance!
  assert.strictEqual(firstInstance.startCount, 1)

  // Call startListening again while already listening
  controller.startListening()
  controller.startListening()

  assert.strictEqual(firstInstance.startCount, 1, 'start() must not be called again when already listening')
})

test('useVoice: repeated stopListening calls when not listening are safe no-ops', () => {
  const mockWin = createMockWindow()
  const controller = new VoiceSessionController({ windowRef: mockWin })

  // Calling stopListening before startListening
  assert.doesNotThrow(() => {
    controller.stopListening()
    controller.stopListening()
  })
})

/* ── 8. Speech Synthesis & Queue Management ──────────────────── */

test('useVoice: speak cancels previous synthesis and plays new utterance', async () => {
  const mockWin = createMockWindow()
  const synth = mockWin.speechSynthesis as MockSpeechSynthesis
  const controller = new VoiceSessionController({ windowRef: mockWin, lang: 'en-IN' })

  controller.speak('First message')
  assert.strictEqual(synth.cancelCalls, 1)
  assert.strictEqual(synth.speakCalls.length, 1)
  assert.strictEqual(synth.speakCalls[0].text, 'First message')
  assert.strictEqual(synth.speakCalls[0].lang, 'en-IN')

  // Let microtask run onstart
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.strictEqual(controller.getState().isSpeaking, true)
  assert.strictEqual(controller.getState().voiceState, 'speaking')

  // Calling speak again cancels the first utterance
  controller.speak('Second message')
  assert.strictEqual(synth.cancelCalls, 2)
  assert.strictEqual(synth.speakCalls.length, 2)
  assert.strictEqual(synth.speakCalls[1].text, 'Second message')

  // Finish synthesis
  synth.finishUtterance(1)
  assert.strictEqual(controller.getState().isSpeaking, false)
  assert.strictEqual(controller.getState().voiceState, 'idle')
})

test('useVoice: stopSpeaking stops synthesis and resets speaking state to idle', async () => {
  const mockWin = createMockWindow()
  const synth = mockWin.speechSynthesis as MockSpeechSynthesis
  const controller = new VoiceSessionController({ windowRef: mockWin })

  controller.speak('Playing prompt')
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.strictEqual(controller.getState().isSpeaking, true)

  controller.stopSpeaking()
  assert.strictEqual(controller.getState().isSpeaking, false)
  assert.strictEqual(controller.getState().voiceState, 'idle')
})

test('useVoice: speak automatically stops active listening to prevent microphone feedback loop', () => {
  let activeInstance: MockSpeechRecognitionInstance | null = null

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      activeInstance = this
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  const controller = new VoiceSessionController({ windowRef: mockWin })

  controller.startListening()
  assert.strictEqual(activeInstance!.stopCount, 0)

  // Start speech synthesis while microphone was listening
  controller.speak('Assistant response')

  assert.strictEqual(activeInstance!.stopCount, 1, 'Active recognition must be stopped when speech synthesis begins')
})

/* ── 9. Reset Transcript ─────────────────────────────────────── */

test('useVoice: resetTranscript clears all transcript buffers and resets error state', () => {
  let activeInstance: MockSpeechRecognitionInstance | null = null

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      activeInstance = this
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  const controller = new VoiceSessionController({ windowRef: mockWin })

  controller.startListening()
  activeInstance!.emitResult({
    resultIndex: 0,
    results: [
      {
        isFinal: true,
        length: 1,
        0: { transcript: 'Sample text' }
      }
    ]
  })
  activeInstance!.emitError({ error: 'no-speech' })

  assert.strictEqual(controller.getState().transcript, 'Sample text')
  assert.strictEqual(controller.getState().voiceState, 'error')

  controller.resetTranscript()

  const state = controller.getState()
  assert.strictEqual(state.transcript, '')
  assert.strictEqual(state.interimTranscript, '')
  assert.strictEqual(state.finalTranscript, '')
  assert.strictEqual(state.error, null)
  assert.strictEqual(state.errorReason, null)
})

/* ── 10. Unmount Cleanup Safety ──────────────────────────────── */

test('useVoice: destroy aborts recognition, cancels synthesis, and prevents subsequent state emission', () => {
  let activeInstance: MockSpeechRecognitionInstance | null = null

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      activeInstance = this
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  const synth = mockWin.speechSynthesis as MockSpeechSynthesis
  let emissionCount = 0

  const controller = new VoiceSessionController({
    windowRef: mockWin,
    onStateChange: () => {
      emissionCount++
    }
  })

  controller.startListening()
  const initialEmissions = emissionCount

  controller.destroy()

  assert.strictEqual(activeInstance!.abortCount, 1, 'Active recognition must be aborted on destroy')
  assert.strictEqual(synth.cancelCalls >= 1, true, 'Speech synthesis must be cancelled on destroy')

  // Events emitted after destroy must not trigger state changes
  activeInstance!.emitResult({
    resultIndex: 0,
    results: [{ isFinal: true, length: 1, 0: { transcript: 'Post unmount' } }]
  })
  activeInstance!.emitEnd()

  assert.strictEqual(emissionCount, initialEmissions, 'No state updates should be emitted after controller is destroyed')
})

/* ── 11. Safety Boundaries: No Auto-API or Auto-Approve ───────── */

test('useVoice: does NOT auto-submit transcripts or call approve/mutation endpoints', () => {
  let activeInstance: MockSpeechRecognitionInstance | null = null

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      activeInstance = this
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  const controller = new VoiceSessionController({ windowRef: mockWin })

  controller.startListening()

  // Simulate user saying an approval command
  activeInstance!.emitResult({
    resultIndex: 0,
    results: [
      {
        isFinal: true,
        length: 1,
        0: { transcript: 'confirm option 1' }
      }
    ]
  })

  const state = controller.getState()
  assert.strictEqual(state.transcript, 'confirm option 1')

  // Verification: useVoice purely exposes captured text; it has NO dependency on approveAction or endpoints
  assert.strictEqual(typeof (controller as unknown as Record<string, unknown>)['approveAction'], 'undefined')
  assert.strictEqual(typeof (controller as unknown as Record<string, unknown>)['chatAgent'], 'undefined')
})

/* ── 12. Corrective Review Regression Tests ──────────────────── */

test('useVoice: late callbacks from an old recognition instance cannot overwrite a newer session', () => {
  const instances: MockSpeechRecognitionInstance[] = []

  class SpyRecognition extends MockSpeechRecognitionInstance {
    constructor() {
      super()
      instances.push(this)
    }
  }

  const mockWin = createMockWindow({ recognition: SpyRecognition })
  const controller = new VoiceSessionController({ windowRef: mockWin })

  // Session 1 begins
  controller.startListening()
  const rec1 = instances[0]
  assert(rec1)

  rec1.emitResult({
    resultIndex: 0,
    results: [{ isFinal: true, length: 1, 0: { transcript: 'Session 1 text' } }]
  })
  assert.strictEqual(controller.getState().finalTranscript, 'Session 1 text')

  // Stop session 1 and start Session 2
  controller.stopListening()
  controller.startListening()
  const rec2 = instances[1]
  assert(rec2)
  assert.notStrictEqual(rec1, rec2)

  rec2.emitResult({
    resultIndex: 0,
    results: [{ isFinal: true, length: 1, 0: { transcript: 'Session 2 text' } }]
  })
  assert.strictEqual(controller.getState().finalTranscript, 'Session 1 text Session 2 text')

  // Rec1 fires a late onend or onresult
  rec1.emitResult({
    resultIndex: 0,
    results: [{ isFinal: true, length: 1, 0: { transcript: 'Late session 1 text' } }]
  })
  rec1.emitEnd()

  // Verify that rec1's late callback was ignored and session 2 remains active
  assert.strictEqual(controller.getState().finalTranscript, 'Session 1 text Session 2 text')
  assert.strictEqual(controller.getState().isListening, true)
  assert.strictEqual(controller.getState().voiceState, 'listening')
})

test('useVoice: old onend/onerror callbacks from canceled speech cannot overwrite a newer utterance', async () => {
  const mockWin = createMockWindow()
  const synth = mockWin.speechSynthesis as MockSpeechSynthesis
  const controller = new VoiceSessionController({ windowRef: mockWin })

  // Utterance 1 starts
  controller.speak('First prompt')
  assert.strictEqual(synth.speakCalls.length, 1)
  const utt1 = synth.speakCalls[0]

  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.strictEqual(controller.getState().isSpeaking, true)

  // Utterance 2 interrupts utterance 1
  controller.speak('Second prompt')
  assert.strictEqual(synth.speakCalls.length, 2)
  const utt2 = synth.speakCalls[1]

  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.strictEqual(controller.getState().isSpeaking, true)

  // Old utterance 1 fires a late onend event
  utt1.onend?.({})

  // Must still be speaking utterance 2!
  assert.strictEqual(controller.getState().isSpeaking, true)
  assert.strictEqual(controller.getState().voiceState, 'speaking')

  // When utterance 2 finishes, speaking becomes false
  utt2.onend?.({})
  assert.strictEqual(controller.getState().isSpeaking, false)
  assert.strictEqual(controller.getState().voiceState, 'idle')
})

test('useVoice: unsupported speech synthesis operates gracefully without corrupting recognition', () => {
  // SpeechRecognition supported, SpeechSynthesis null
  const mockWin = createMockWindow({ synthesis: null })
  const controller = new VoiceSessionController({ windowRef: mockWin })

  assert.strictEqual(controller.isRecognitionSupported, true)
  assert.strictEqual(controller.isSynthesisSupported, false)

  // Recognition starts and receives speech normally
  controller.startListening()
  assert.strictEqual(controller.getState().isListening, true)
  assert.strictEqual(controller.getState().voiceState, 'listening')

  // User attempts speech synthesis
  controller.speak('System greeting')

  // Synthesis failed gracefully with unsupported error without stopping recognition
  assert.strictEqual(controller.getState().errorReason, 'not_supported')
  assert.strictEqual(controller.getState().isSpeaking, false)
})
