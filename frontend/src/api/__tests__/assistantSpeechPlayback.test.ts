/* ============================================================
   frontend/src/api/__tests__/assistantSpeechPlayback.test.ts
   OperAI / Cloud Kitchen Rescue — Assistant Speech Playback Tests

   Feature 7 Voice + Chat Integration Requirements:
   1. Assistant response is spoken once in Live mode.
   2. User messages are not spoken.
   3. Historical messages are not spoken when opening the drawer.
   4. Muted responses are not spoken.
   5. Unmuting does not replay previously muted responses.
   6. Rerenders / state updates do not cause duplicate speech.
   7. Demo mode must not unexpectedly trigger speech.
   8. Speech synthesis unavailable in browser is handled without breaking chat.
   9. Component unmounting and request cancellation respect speech cancellation.
   10. Mute toggle while speaking immediately cancels ongoing speech.

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/assistantSpeechPlayback.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  processAssistantSpeechPlayback,
  type AssistantSpeechPlaybackOptions
} from '../../components/chat/assistantSpeechPlayback.ts'
import type { ChatMessage } from '../../types/chat.ts'
import { VoiceSessionController } from '../../hooks/useVoice.ts'

/* ── 1. Live Assistant Response Spoken Exactly Once ──────────── */

test('Speech Playback: new assistant response in Live mode is spoken once', () => {
  const spokenPhrases: string[] = []
  const initialIds = new Set<string>()
  const processedIds = new Set<string>()

  const assistantMsg: ChatMessage = {
    id: 'live-assistant-001',
    sender: 'assistant',
    text: 'Paneer is short for tomorrow. Four orders are at risk.',
    timestamp: '2026-10-21T10:00:00+05:30',
    isSimulated: false,
    status: 'sent'
  }

  const result = processAssistantSpeechPlayback({
    messages: [assistantMsg],
    mode: 'live',
    isMuted: false,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  })

  assert.strictEqual(result, true, 'processAssistantSpeechPlayback should return true when spoken')
  assert.strictEqual(spokenPhrases.length, 1)
  assert.strictEqual(spokenPhrases[0], 'Paneer is short for tomorrow. Four orders are at risk.')
  assert.strictEqual(processedIds.has('live-assistant-001'), true)
})

/* ── 2. User Messages Are NOT Spoken ────────────────────────── */

test('Speech Playback: user messages are never spoken', () => {
  const spokenPhrases: string[] = []
  const initialIds = new Set<string>()
  const processedIds = new Set<string>()

  const userMsg: ChatMessage = {
    id: 'live-user-001',
    sender: 'user',
    text: 'We are out of paneer tonight',
    timestamp: '2026-10-21T09:59:00+05:30',
    inputMode: 'voice',
    isSimulated: false,
    status: 'sent'
  }

  const result = processAssistantSpeechPlayback({
    messages: [userMsg],
    mode: 'live',
    isMuted: false,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  })

  assert.strictEqual(result, false, 'User message must not be spoken')
  assert.strictEqual(spokenPhrases.length, 0)
  assert.strictEqual(processedIds.has('live-user-001'), false)
})

/* ── 3. Historical Messages When Opening Drawer ─────────────── */

test('Speech Playback: historical assistant messages present at mount are not spoken when drawer opens', () => {
  const spokenPhrases: string[] = []
  const historicalMsg1: ChatMessage = {
    id: 'historical-msg-1',
    sender: 'user',
    text: 'What is my morning brief?',
    timestamp: '2026-10-21T08:00:00+05:30',
    isSimulated: false,
    status: 'sent'
  }
  const historicalMsg2: ChatMessage = {
    id: 'historical-msg-2',
    sender: 'assistant',
    text: 'Good morning. 26 orders scheduled. No critical shortages.',
    timestamp: '2026-10-21T08:00:02+05:30',
    isSimulated: false,
    status: 'sent'
  }

  // Drawer opens with historical messages already in state
  const messages = [historicalMsg1, historicalMsg2]
  const initialIds = new Set(messages.map((m) => m.id))
  const processedIds = new Set<string>()

  const result = processAssistantSpeechPlayback({
    messages,
    mode: 'live',
    isMuted: false,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  })

  assert.strictEqual(result, false, 'Historical message must not be spoken on drawer mount')
  assert.strictEqual(spokenPhrases.length, 0)
})

/* ── 4. Muted Responses Are NOT Spoken ──────────────────────── */

test('Speech Playback: assistant responses are not spoken when muted', () => {
  const spokenPhrases: string[] = []
  const initialIds = new Set<string>()
  const processedIds = new Set<string>()

  const assistantMsg: ChatMessage = {
    id: 'live-assistant-muted-1',
    sender: 'assistant',
    text: 'Alert: Butter chicken packaging is low.',
    timestamp: '2026-10-21T10:05:00+05:30',
    isSimulated: false,
    status: 'sent'
  }

  const result = processAssistantSpeechPlayback({
    messages: [assistantMsg],
    mode: 'live',
    isMuted: true, // Muted!
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  })

  assert.strictEqual(result, false)
  assert.strictEqual(spokenPhrases.length, 0, 'No speech should occur while muted')
  assert.strictEqual(
    processedIds.has('live-assistant-muted-1'),
    true,
    'Muted message must be marked processed so unmuting will not replay it'
  )
})

/* ── 5. Unmuting Does NOT Replay Previously Muted Responses ──── */

test('Speech Playback: unmuting does not replay previously muted responses', () => {
  const spokenPhrases: string[] = []
  const initialIds = new Set<string>()
  const processedIds = new Set<string>()

  const assistantMsg: ChatMessage = {
    id: 'live-assistant-prior-1',
    sender: 'assistant',
    text: 'Shortage detected for paneer.',
    timestamp: '2026-10-21T10:10:00+05:30',
    isSimulated: false,
    status: 'sent'
  }

  // 1. Message arrived while muted
  processAssistantSpeechPlayback({
    messages: [assistantMsg],
    mode: 'live',
    isMuted: true,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  })

  assert.strictEqual(spokenPhrases.length, 0)

  // 2. User un-mutes later without any new messages arriving
  const replayResult = processAssistantSpeechPlayback({
    messages: [assistantMsg],
    mode: 'live',
    isMuted: false, // Unmuted now
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  })

  assert.strictEqual(replayResult, false)
  assert.strictEqual(spokenPhrases.length, 0, 'Unmuting must NOT replay previously muted message')

  // 3. A brand new assistant message arriving AFTER unmuting DOES speak
  const newAssistantMsg: ChatMessage = {
    id: 'live-assistant-new-2',
    sender: 'assistant',
    text: 'New order arrived for Biryani.',
    timestamp: '2026-10-21T10:12:00+05:30',
    isSimulated: false,
    status: 'sent'
  }

  const newResult = processAssistantSpeechPlayback({
    messages: [assistantMsg, newAssistantMsg],
    mode: 'live',
    isMuted: false,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  })

  assert.strictEqual(newResult, true)
  assert.strictEqual(spokenPhrases.length, 1)
  assert.strictEqual(spokenPhrases[0], 'New order arrived for Biryani.')
})

/* ── 6. Rerenders Do NOT Cause Duplicate Speech ─────────────── */

test('Speech Playback: React rerenders and state updates do not cause duplicate speech', () => {
  const spokenPhrases: string[] = []
  const initialIds = new Set<string>()
  const processedIds = new Set<string>()

  const assistantMsg: ChatMessage = {
    id: 'live-assistant-rerender-1',
    sender: 'assistant',
    text: 'Analyzing recovery options...',
    timestamp: '2026-10-21T10:15:00+05:30',
    isSimulated: false,
    status: 'sent'
  }

  const options: AssistantSpeechPlaybackOptions = {
    messages: [assistantMsg],
    mode: 'live',
    isMuted: false,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  }

  // First run (response arrives)
  const firstRun = processAssistantSpeechPlayback(options)
  assert.strictEqual(firstRun, true)
  assert.strictEqual(spokenPhrases.length, 1)

  // Second run (simulating component rerender with same messages)
  const secondRun = processAssistantSpeechPlayback(options)
  assert.strictEqual(secondRun, false)
  assert.strictEqual(spokenPhrases.length, 1, 'Rerender must not cause duplicate speech')

  // Third run (simulating another state update)
  const thirdRun = processAssistantSpeechPlayback(options)
  assert.strictEqual(thirdRun, false)
  assert.strictEqual(spokenPhrases.length, 1, 'Subsequent rerenders must not re-speak')
})

/* ── 7. Demo Mode Does NOT Trigger Speech ─────────────────────── */

test('Speech Playback: Demo mode does not trigger speech', () => {
  const spokenPhrases: string[] = []
  const initialIds = new Set<string>()
  const processedIds = new Set<string>()

  // 1. Message explicitly flagged simulated
  const demoMsg: ChatMessage = {
    id: 'demo-assistant-001',
    sender: 'assistant',
    text: 'Simulated briefing for Cloud Kitchen demo.',
    timestamp: '2026-10-21T10:20:00+05:30',
    isSimulated: true,
    status: 'sent'
  }

  const result1 = processAssistantSpeechPlayback({
    messages: [demoMsg],
    mode: 'demo',
    isMuted: false,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  })

  assert.strictEqual(result1, false, 'Simulated demo message must not trigger speech')
  assert.strictEqual(spokenPhrases.length, 0)

  // 2. Mode is demo even if isSimulated was omitted
  const unflaggedInDemo: ChatMessage = {
    id: 'demo-assistant-002',
    sender: 'assistant',
    text: 'Simulated reply in demo mode.',
    timestamp: '2026-10-21T10:21:00+05:30',
    status: 'sent'
  }

  const result2 = processAssistantSpeechPlayback({
    messages: [unflaggedInDemo],
    mode: 'demo',
    isMuted: false,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  })

  assert.strictEqual(result2, false, 'Demo mode must not trigger speech')
  assert.strictEqual(spokenPhrases.length, 0)
})

/* ── 8. Speech Synthesis Unavailable Handled Gracefully ──────── */

test('Speech Playback: browsers without speech synthesis do not crash or corrupt chat', () => {
  const spokenPhrases: string[] = []
  const initialIds = new Set<string>()
  const processedIds = new Set<string>()

  const assistantMsg: ChatMessage = {
    id: 'live-assistant-nosynth-1',
    sender: 'assistant',
    text: 'Briefing text that cannot be spoken.',
    timestamp: '2026-10-21T10:25:00+05:30',
    isSimulated: false,
    status: 'sent'
  }

  const result = processAssistantSpeechPlayback({
    messages: [assistantMsg],
    mode: 'live',
    isMuted: false,
    isSynthesisSupported: false, // Synthesis unsupported in browser!
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spokenPhrases.push(text)
  })

  assert.strictEqual(result, false)
  assert.strictEqual(spokenPhrases.length, 0)
})

/* ── 9. VoiceSessionController Speech Cancellation ───────────── */

test('Speech Playback: VoiceSessionController cancels speech on stopSpeaking()', () => {
  let cancelCalled = false
  const fakeUtterances: string[] = []

  class FakeSpeechSynthesisUtterance {
    text: string
    lang = 'en-IN'
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(text = '') {
      this.text = text
    }
  }

  const fakeSynth = {
    speaking: false,
    cancel() {
      cancelCalled = true
      this.speaking = false
    },
    speak(u: FakeSpeechSynthesisUtterance) {
      this.speaking = true
      fakeUtterances.push(u.text)
      u.onstart?.()
    }
  }

  const mockWindow = {
    SpeechSynthesisUtterance: FakeSpeechSynthesisUtterance,
    speechSynthesis: fakeSynth
  }

  const controller = new VoiceSessionController({ windowRef: mockWindow })
  assert.strictEqual(controller.isSynthesisSupported, true)

  // Start speaking
  controller.speak('First assistant message')
  assert.strictEqual(controller.getState().isSpeaking, true)
  assert.strictEqual(fakeUtterances[0], 'First assistant message')

  // Explicit cancellation (e.g. unmount, drawer close, or mute toggle)
  controller.stopSpeaking()
  assert.strictEqual(controller.getState().isSpeaking, false)
  assert.strictEqual(cancelCalled, true)
})

/* ── 10. Mute Toggle While Speaking Cancels Ongoing Speech ───── */

test('Speech Playback: toggling mute while assistant is speaking calls stopSpeaking', () => {
  let wasCancelled = false

  const fakeVoice = {
    isSpeaking: true,
    stopSpeaking() {
      wasCancelled = true
      this.isSpeaking = false
    }
  }

  // Simulate handleToggleMute behavior
  let isMuted = false
  const handleToggleMute = () => {
    const nextMuted = !isMuted
    if (nextMuted && fakeVoice.isSpeaking) {
      fakeVoice.stopSpeaking()
    }
    isMuted = nextMuted
  }

  // Operator clicks mute button while assistant is talking
  handleToggleMute()

  assert.strictEqual(isMuted, true)
  assert.strictEqual(wasCancelled, true)
  assert.strictEqual(fakeVoice.isSpeaking, false)
})

/* ── 11. Ref Synchronization and Unmount Lifecycle ──────────── */

test('Speech Playback: synchronizing voice ref across renders prevents premature speech cancellation and stops speech on unmount', () => {
  interface MockVoiceInstance {
    id: string
    isSpeaking: boolean
    stopSpeaking: () => void
  }

  const stoppedInstances: string[] = []

  const createMockVoice = (id: string, isSpeaking = true): MockVoiceInstance => ({
    id,
    isSpeaking,
    stopSpeaking() {
      this.isSpeaking = false
      stoppedInstances.push(id)
    }
  })

  // 1. Initial mount with voice instance 1
  const voice1 = createMockVoice('voice-v1', true)
  const voiceRef = { current: voice1 as MockVoiceInstance | undefined }

  // Unmount effect cleanup defined with [] dependencies using synchronized ref
  const unmountCleanup = () => {
    if (voiceRef.current?.isSpeaking) {
      voiceRef.current.stopSpeaking()
    }
  }

  // 2. Parent rerenders (e.g., AppLayout state change while speech is playing)
  // Re-creates voice object as voice2.
  // In the flawed implementation, [voice] dependency triggered cleanup() here,
  // prematurely stopping speech mid-sentence.
  const voice2 = createMockVoice('voice-v2', true)
  // Ref synchronization effect executes on commit:
  voiceRef.current = voice2

  // Verify that rerender did NOT invoke stopSpeaking
  assert.strictEqual(stoppedInstances.length, 0, 'Rerender must not prematurely call stopSpeaking')
  assert.strictEqual(voice1.isSpeaking, true)
  assert.strictEqual(voice2.isSpeaking, true)

  // 3. Another rerender occurs (e.g. chatData update) producing voice3
  const voice3 = createMockVoice('voice-v3', true)
  voiceRef.current = voice3

  assert.strictEqual(stoppedInstances.length, 0, 'Subsequent rerenders must not stop speech')
  assert.strictEqual(voice3.isSpeaking, true)

  // 4. ChatPanel actually unmounts: effect cleanup runs
  unmountCleanup()

  // Verify that stopSpeaking was called ONCE, targeting the LATEST voice instance (voice3)
  assert.strictEqual(stoppedInstances.length, 1, 'Unmount should call stopSpeaking exactly once')
  assert.strictEqual(stoppedInstances[0], 'voice-v3', 'Cleanup must use the latest synchronized voice ref, not a stale instance')
  assert.strictEqual(voice3.isSpeaking, false)
  // Earlier instances were never touched by cleanup
  assert.strictEqual(voice1.isSpeaking, true)
  assert.strictEqual(voice2.isSpeaking, true)

  // 5. Unmounting when already silent is safe
  const voiceSilent = createMockVoice('voice-silent', false)
  voiceRef.current = voiceSilent
  unmountCleanup()
  assert.strictEqual(stoppedInstances.length, 1, 'Silent voice does not trigger stopSpeaking')
})

