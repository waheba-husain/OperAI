/* ============================================================
   frontend/src/api/__tests__/chatDataHook.test.ts
   OperAI / Cloud Kitchen Rescue — Conversational State & Hook Integration Tests

   Covers Feature 7 Phase 3 Substep 3.1 Requirements:
   1. Initial state (live mode default, demo mode isolation).
   2. Explicit text submission via chatAgent().
   3. Explicit voice-transcript submission after user review & confirmation.
   4. No automatic submission when a voice transcript arrives (draft update only).
   5. Successful response handling and metadata mapping.
   6. Empty and overlong draft validation (422 VALIDATION_ERROR).
   7. Duplicate submission prevention during in-flight requests.
   8. API failure and draft preservation (no silent fallback to demo).
   9. Live-to-demo and demo-to-live mode isolation (no message cross-contamination).
   10. No live API calls in demo mode (simulated data source only).
   11. Complete absence of mutation or approval calls (AGENTS.md Rule 2).
   12. Honest handling of missing optional response metadata (no fabricated action IDs).
   13. Destruction and in-flight request cancellation.

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/chatDataHook.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError } from '../errors.ts'
import type { AgentChatResponseDTO } from '../../types/dto.ts'
import {
  ChatConversationController,
  extractActionMetadata,
  MAX_CHAT_MESSAGE_LENGTH,
  SUGGESTED_CHAT_PROMPTS
} from '../../hooks/useChatData.ts'
import {
  DEMO_CHAT_CONVERSATION,
  DEMO_CHAT_RESPONSES
} from '../../pages/chat/demoChatData.ts'

/* ── Test Utilities & Mock Client Factory ────────────────────── */

function createMockClient(options: {
  response?: AgentChatResponseDTO
  status?: number
  errorBody?: Record<string, unknown>
  delayMs?: number
  onRequest?: (payload: unknown, headers: HeadersInit | undefined) => void
}): { client: ApiClient; getCallCount: () => number } {
  let callCount = 0

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    callCount++
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body)
        options.onRequest?.(parsed, init.headers)
      } catch {
        options.onRequest?.(init.body, init.headers)
      }
    }

    if (options.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    }

    const status = options.status ?? 200
    if (status >= 400) {
      const errorPayload = options.errorBody ?? {
        error: { code: 'INTERNAL_ERROR', message: `Request failed with status ${status}`, details: {} }
      }
      return new Response(JSON.stringify(errorPayload), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const payload = options.response ?? {
      reply: 'Default mock assistant reply.',
      intent: 'get_brief',
      tool_used: 'get_brief',
      data: null,
      requires_confirmation: false,
      confirm_phrases: []
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key-operai-voice',
    fetchFn: mockFetch
  })

  return { client, getCallCount: () => callCount }
}

/* ── 1. Initial State ────────────────────────────────────────── */

test('ChatConversationController: initializes in live mode with clean default state', () => {
  const controller = new ChatConversationController()
  const snapshot = controller.getSnapshot()

  assert.strictEqual(snapshot.mode, 'live')
  assert.strictEqual(snapshot.isLive, true)
  assert.strictEqual(snapshot.isDemo, false)
  assert.strictEqual(snapshot.draft, '')
  assert.strictEqual(snapshot.draftInputMode, 'text')
  assert.strictEqual(snapshot.charCount, 0)
  assert.strictEqual(snapshot.maxChars, MAX_CHAT_MESSAGE_LENGTH)
  assert.strictEqual(snapshot.isEmpty, true)
  assert.strictEqual(snapshot.isOverLimit, false)
  assert.strictEqual(snapshot.canSubmit, false)
  assert.strictEqual(snapshot.isLoading, false)
  assert.strictEqual(snapshot.error, null)
  assert.strictEqual(snapshot.errorMessage, null)
  assert.strictEqual(snapshot.activeConfirmation, null)
  assert.strictEqual(snapshot.messages.length, 0)
})

test('ChatConversationController: initializes in demo mode with simulated conversation fixtures', () => {
  const controller = new ChatConversationController({ initialMode: 'demo' })
  const snapshot = controller.getSnapshot()

  assert.strictEqual(snapshot.mode, 'demo')
  assert.strictEqual(snapshot.isLive, false)
  assert.strictEqual(snapshot.isDemo, true)
  assert.strictEqual(snapshot.messages.length, DEMO_CHAT_CONVERSATION.length)

  // Every demo message must be explicitly marked simulated per AGENTS.md Rule 9
  for (const msg of snapshot.messages) {
    assert.strictEqual(msg.isSimulated, true)
  }

  // The last demo message in DEMO_CHAT_CONVERSATION is a recovery proposal requiring confirmation
  assert.notStrictEqual(snapshot.activeConfirmation, null)
  assert.strictEqual(snapshot.activeConfirmation?.requiresConfirmation, true)
  assert.deepStrictEqual(snapshot.activeConfirmation?.confirmPhrases, [
    'confirm option 1',
    'confirm option 2',
    'confirm option 3'
  ])
})

/* ── 2. Draft Manipulation & Suggested Prompts ───────────────── */

test('ChatConversationController: setDraft, appendDraft, and clearDraft update input state accurately', () => {
  const controller = new ChatConversationController()

  controller.setDraft('What is my brief?')
  let snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.draft, 'What is my brief?')
  assert.strictEqual(snapshot.charCount, 'What is my brief?'.length)
  assert.strictEqual(snapshot.isEmpty, false)
  assert.strictEqual(snapshot.canSubmit, true)

  controller.appendDraft('for today')
  snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.draft, 'What is my brief? for today')

  controller.clearDraft()
  snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.draft, '')
  assert.strictEqual(snapshot.isEmpty, true)
  assert.strictEqual(snapshot.canSubmit, false)
})

test('ChatConversationController: applySuggestedPrompt loads prompt into editable draft buffer', () => {
  const controller = new ChatConversationController()
  const prompt = SUGGESTED_CHAT_PROMPTS[0]

  controller.applySuggestedPrompt(prompt)
  const snapshot = controller.getSnapshot()

  assert.strictEqual(snapshot.draft, prompt)
  assert.strictEqual(snapshot.canSubmit, true)
  assert.strictEqual(snapshot.messages.length, 0) // Did NOT submit
})

/* ── 3. Voice Transcript Coordination (CRITICAL SAFETY) ───────── */

test('ChatConversationController: applyVoiceTranscript updates draft WITHOUT submitting automatically', () => {
  let submitted = false
  const { client } = createMockClient({
    onRequest: () => {
      submitted = true
    }
  })

  const controller = new ChatConversationController({ client })

  // Transcript arrives from browser speech recognition
  controller.applyVoiceTranscript('We are out of paneer')

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.draft, 'We are out of paneer')
  assert.strictEqual(snapshot.draftInputMode, 'voice')
  assert.strictEqual(snapshot.messages.length, 0) // No message appended yet
  assert.strictEqual(snapshot.isLoading, false) // Not loading
  assert.strictEqual(submitted, false) // Zero network requests sent!
})

test('ChatConversationController: speech transcript supports replace and append modes safely', () => {
  const controller = new ChatConversationController()

  controller.applyVoiceTranscript('paneer shortage', 'replace')
  assert.strictEqual(controller.getSnapshot().draft, 'paneer shortage')

  controller.applyVoiceTranscript('for tomorrow', 'append')
  assert.strictEqual(controller.getSnapshot().draft, 'paneer shortage for tomorrow')

  controller.applyVoiceTranscript('completely replaced', 'replace')
  assert.strictEqual(controller.getSnapshot().draft, 'completely replaced')
})

test('ChatConversationController: explicit submission after voice review transmits input_mode: voice', async () => {
  let capturedInputMode: string | undefined
  let capturedMessage: string | undefined

  const { client } = createMockClient({
    onRequest: (payload: unknown) => {
      const p = payload as Record<string, unknown>
      capturedInputMode = p['input_mode'] as string
      capturedMessage = p['message'] as string
    }
  })

  const controller = new ChatConversationController({ client })

  // 1. Spoken transcript fills draft
  controller.applyVoiceTranscript('We are out of paneer')

  // 2. User edits draft to clarify details
  controller.appendDraft('for tomorrow morning')

  // 3. User explicitly clicks Send
  const success = await controller.sendMessage()

  assert.strictEqual(success, true)
  assert.strictEqual(capturedMessage, 'We are out of paneer for tomorrow morning')
  assert.strictEqual(capturedInputMode, 'voice')

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.messages[0].sender, 'user')
  assert.strictEqual(snapshot.messages[0].inputMode, 'voice')
  assert.strictEqual(snapshot.messages[0].status, 'sent')
})

/* ── 4. Explicit Text Submission & Successful Response Handling ── */

test('ChatConversationController: explicit text submission transmits input_mode: text and clears draft on success', async () => {
  let capturedInputMode: string | undefined
  const mockAssistantResponse: AgentChatResponseDTO = {
    reply: 'Morning brief: 26 orders scheduled, no shortages.',
    intent: 'get_brief',
    tool_used: 'get_brief',
    data: { order_count: 26 },
    requires_confirmation: false,
    confirm_phrases: []
  }

  const { client } = createMockClient({
    response: mockAssistantResponse,
    onRequest: (payload: unknown) => {
      const p = payload as Record<string, unknown>
      capturedInputMode = p['input_mode'] as string
    }
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('Check morning brief')

  const success = await controller.sendMessage()

  assert.strictEqual(success, true)
  assert.strictEqual(capturedInputMode, 'text')

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.draft, '') // Cleared on success
  assert.strictEqual(snapshot.messages.length, 2)

  // User message checks
  const userMsg = snapshot.messages[0]
  assert.strictEqual(userMsg.sender, 'user')
  assert.strictEqual(userMsg.text, 'Check morning brief')
  assert.strictEqual(userMsg.inputMode, 'text')
  assert.strictEqual(userMsg.status, 'sent')
  assert.strictEqual(userMsg.isSimulated, false)

  // Assistant message checks
  const assistantMsg = snapshot.messages[1]
  assert.strictEqual(assistantMsg.sender, 'assistant')
  assert.strictEqual(assistantMsg.text, mockAssistantResponse.reply)
  assert.strictEqual(assistantMsg.intent, 'get_brief')
  assert.strictEqual(assistantMsg.toolUsed, 'get_brief')
  assert.strictEqual(assistantMsg.requiresConfirmation, false)
  assert.strictEqual(assistantMsg.status, 'sent')
  assert.strictEqual(assistantMsg.isSimulated, false)
})

test('ChatConversationController: sendMessage with direct options preserves un-submitted draft', async () => {
  const { client } = createMockClient({})
  const controller = new ChatConversationController({ client })

  controller.setDraft('Preserved typed draft in box')

  // Direct send with custom text
  const success = await controller.sendMessage({ message: 'Direct override query', inputMode: 'text' })

  assert.strictEqual(success, true)
  const snapshot = controller.getSnapshot()
  // Draft was NOT cleared because message sent was different from draft
  assert.strictEqual(snapshot.draft, 'Preserved typed draft in box')
  assert.strictEqual(snapshot.messages[0].text, 'Direct override query')
})

/* ── 5. Empty & Overlong Message Validation ───────────────────── */

test('ChatConversationController: rejects empty and whitespace-only drafts without network call', async () => {
  const { client, getCallCount } = createMockClient({})
  const controller = new ChatConversationController({ client })

  controller.setDraft('')
  const successEmpty = await controller.sendMessage()
  assert.strictEqual(successEmpty, false)
  assert.strictEqual(getCallCount(), 0)
  assert.strictEqual(controller.getSnapshot().error?.name, 'ApiError')
  assert.strictEqual((controller.getSnapshot().error as ApiError).code, 'VALIDATION_ERROR')
  assert.strictEqual(controller.getSnapshot().messages.length, 0)

  controller.setDraft('      ')
  const successWhitespace = await controller.sendMessage()
  assert.strictEqual(successWhitespace, false)
  assert.strictEqual(getCallCount(), 0)
  assert.strictEqual(controller.getSnapshot().messages.length, 0)
})

test('ChatConversationController: rejects over-500-char draft with 422 VALIDATION_ERROR and preserves draft', async () => {
  const { client, getCallCount } = createMockClient({})
  const controller = new ChatConversationController({ client })

  const overlongText = 'a'.repeat(501)
  controller.setDraft(overlongText)

  const success = await controller.sendMessage()
  assert.strictEqual(success, false)
  assert.strictEqual(getCallCount(), 0)

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.draft, overlongText) // Draft preserved
  assert.strictEqual(snapshot.isOverLimit, true)
  assert.strictEqual(snapshot.canSubmit, false)
  assert.strictEqual(snapshot.error?.name, 'ApiError')
  assert.strictEqual((snapshot.error as ApiError).status, 422)
  assert.strictEqual((snapshot.error as ApiError).code, 'VALIDATION_ERROR')
})

/* ── 6. Duplicate Submission Prevention ──────────────────────── */

test('ChatConversationController: prevents duplicate submissions while request is in flight', async () => {
  const { client, getCallCount } = createMockClient({
    delayMs: 50 // In flight for 50ms
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('First valid query')

  // First dispatch starts in-flight request
  const promise1 = controller.sendMessage()
  assert.strictEqual(controller.getSnapshot().isLoading, true)

  // Concurrent second dispatch should immediately be rejected
  const promise2 = controller.sendMessage()
  const result2 = await promise2
  assert.strictEqual(result2, false)

  const result1 = await promise1
  assert.strictEqual(result1, true)

  assert.strictEqual(getCallCount(), 1) // Exactly one network request was executed
})

/* ── 7. API Failure & Draft Preservation (No Silent Fallback) ─── */

test('ChatConversationController: preserves draft on 502 AI_UNAVAILABLE without silent demo fallback', async () => {
  const { client } = createMockClient({
    status: 502,
    errorBody: {
      error: { code: 'AI_UNAVAILABLE', message: 'Bedrock is unreachable.', details: {} }
    }
  })

  const controller = new ChatConversationController({ client })
  const userText = 'We are out of paneer'
  controller.setDraft(userText)

  const success = await controller.sendMessage()
  assert.strictEqual(success, false)

  const snapshot = controller.getSnapshot()
  // CRITICAL INVARIANT: Draft is preserved!
  assert.strictEqual(snapshot.draft, userText)
  assert.strictEqual(snapshot.isLoading, false)

  // CRITICAL INVARIANT: NEVER silently fallback to demo mode
  assert.strictEqual(snapshot.mode, 'live')
  assert.strictEqual(snapshot.isLive, true)

  // Error surfaced cleanly
  assert.strictEqual(snapshot.error?.name, 'ApiError')
  assert.strictEqual((snapshot.error as ApiError).status, 502)
  assert.strictEqual((snapshot.error as ApiError).code, 'AI_UNAVAILABLE')

  // User message marked error in thread; no assistant message fabricated
  assert.strictEqual(snapshot.messages.length, 1)
  assert.strictEqual(snapshot.messages[0].sender, 'user')
  assert.strictEqual(snapshot.messages[0].status, 'error')
  assert.strictEqual(snapshot.messages[0].errorMessage, 'Bedrock is unreachable.')
})

test('ChatConversationController: preserves draft on 401 UNAUTHORIZED failure', async () => {
  const { client } = createMockClient({
    status: 401,
    errorBody: {
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key.', details: {} }
    }
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('Test unauthorized query')

  const success = await controller.sendMessage()
  assert.strictEqual(success, false)

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.draft, 'Test unauthorized query')
  assert.strictEqual((snapshot.error as ApiError).status, 401)
  assert.strictEqual((snapshot.error as ApiError).code, 'UNAUTHORIZED')
})

/* ── 8. Recovery Proposals & Honest Metadata Handling ─────────── */

test('ChatConversationController: maps documented proposal metadata without fabricating missing fields', async () => {
  const proposalResponse: AgentChatResponseDTO = {
    reply: 'Paneer is short. Option 1: swap for tofu. Option 2: buy locally.',
    intent: 'report_shortage',
    tool_used: 'propose_recovery',
    data: {
      group_id: 'grp-live-101',
      option_action_ids: ['act-live-opt-1', 'act-live-opt-2']
    },
    requires_confirmation: true,
    confirm_phrases: ['confirm option 1', 'confirm option 2']
  }

  const { client } = createMockClient({ response: proposalResponse })
  const controller = new ChatConversationController({ client })
  controller.setDraft('We are out of paneer')

  await controller.sendMessage()

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.messages.length, 2)
  const assistantMsg = snapshot.messages[1]

  assert.strictEqual(assistantMsg.actionGroupId, 'grp-live-101')
  assert.deepStrictEqual(assistantMsg.optionActionIds, ['act-live-opt-1', 'act-live-opt-2'])
  assert.strictEqual(assistantMsg.requiresConfirmation, true)
  assert.deepStrictEqual(assistantMsg.confirmPhrases, ['confirm option 1', 'confirm option 2'])

  // Active confirmation prompt populated
  assert.notStrictEqual(snapshot.activeConfirmation, null)
  assert.strictEqual(snapshot.activeConfirmation?.actionGroupId, 'grp-live-101')
  assert.deepStrictEqual(snapshot.activeConfirmation?.confirmPhrases, ['confirm option 1', 'confirm option 2'])
})

test('extractActionMetadata: safely extracts valid IDs and omits missing or malformed fields honestly', () => {
  // Undefined or null
  assert.deepStrictEqual(extractActionMetadata(undefined), {})
  assert.deepStrictEqual(extractActionMetadata(null), {})

  // Valid full data
  const valid = extractActionMetadata({
    group_id: 'grp-123',
    option_action_ids: ['act-1', 'act-2']
  })
  assert.strictEqual(valid.actionGroupId, 'grp-123')
  assert.deepStrictEqual(valid.optionActionIds, ['act-1', 'act-2'])

  // Missing or empty fields
  const missing = extractActionMetadata({
    group_id: '   ',
    option_action_ids: []
  })
  assert.strictEqual(missing.actionGroupId, undefined)
  assert.strictEqual(missing.optionActionIds, undefined)

  // Malformed types: number or invalid types
  const malformed = extractActionMetadata({
    group_id: 12345 as unknown as string,
    option_action_ids: ['valid-id', 999, ''] as unknown as string[]
  })
  assert.strictEqual(malformed.actionGroupId, undefined)
  assert.deepStrictEqual(malformed.optionActionIds, ['valid-id'])
})

/* ── 9. Live-to-Demo and Demo-to-Live Isolation ───────────────── */

test('ChatConversationController: switches between live and demo modes without merging message threads', async () => {
  const { client } = createMockClient({
    response: {
      reply: 'Live assistant answer.',
      intent: 'get_brief',
      tool_used: 'get_brief',
      data: null,
      requires_confirmation: false,
      confirm_phrases: []
    }
  })

  const controller = new ChatConversationController({ client })

  // 1. Send live message
  controller.setDraft('Live query 1')
  await controller.sendMessage()

  assert.strictEqual(controller.getSnapshot().mode, 'live')
  assert.strictEqual(controller.getSnapshot().messages.length, 2)
  assert.strictEqual(controller.getSnapshot().messages[0].isSimulated, false)

  // 2. Switch to Demo Mode
  controller.setMode('demo')
  assert.strictEqual(controller.getSnapshot().mode, 'demo')
  assert.strictEqual(controller.getSnapshot().messages.length, DEMO_CHAT_CONVERSATION.length)
  // Demo messages are strictly simulated
  for (const m of controller.getSnapshot().messages) {
    assert.strictEqual(m.isSimulated, true)
  }

  // 3. Switch back to Live Mode
  controller.setMode('live')
  assert.strictEqual(controller.getSnapshot().mode, 'live')
  // Original live messages restored; no demo messages present
  assert.strictEqual(controller.getSnapshot().messages.length, 2)
  assert.strictEqual(controller.getSnapshot().messages[0].text, 'Live query 1')
  assert.strictEqual(controller.getSnapshot().messages[0].isSimulated, false)
})

/* ── 10. Demo Mode Execution (Zero Live API Calls) ─────────────── */

test('ChatConversationController: demo mode makes ZERO live API calls and uses deterministic responses', async () => {
  const { client, getCallCount } = createMockClient({})
  const controller = new ChatConversationController({ client, initialMode: 'demo' })

  controller.setDraft('We are out of paneer')
  const success = await controller.sendMessage()

  assert.strictEqual(success, true)
  assert.strictEqual(getCallCount(), 0) // ZERO network calls in demo mode!

  const snapshot = controller.getSnapshot()
  const lastUser = snapshot.messages[snapshot.messages.length - 2]
  const lastAssistant = snapshot.messages[snapshot.messages.length - 1]

  assert.strictEqual(lastUser.sender, 'user')
  assert.strictEqual(lastUser.text, 'We are out of paneer')
  assert.strictEqual(lastUser.isSimulated, true)

  assert.strictEqual(lastAssistant.sender, 'assistant')
  assert.strictEqual(lastAssistant.text, DEMO_CHAT_RESPONSES.recoveryProposal.reply)
  assert.strictEqual(lastAssistant.intent, DEMO_CHAT_RESPONSES.recoveryProposal.intent)
  assert.strictEqual(lastAssistant.isSimulated, true)
})

/* ── 11. Absolute Absence of Approval / Mutation Calls ────────── */

test('ChatConversationController: has ZERO approval, rejection, or undo mutation methods (AGENTS.md Rule 2)', () => {
  const controller = new ChatConversationController()
  const obj = controller as unknown as Record<string, unknown>

  assert.strictEqual(typeof obj['approveAction'], 'undefined')
  assert.strictEqual(typeof obj['rejectAction'], 'undefined')
  assert.strictEqual(typeof obj['undoAudit'], 'undefined')
  assert.strictEqual(typeof obj['applyChange'], 'undefined')
  assert.strictEqual(typeof obj['executeAction'], 'undefined')
})

/* ── 12. Reset / Clear & Unmount Cleanup ───────────────────────── */

test('ChatConversationController: clearConversation resets conversation history per mode', () => {
  const controller = new ChatConversationController({
    initialMessages: [
      {
        id: 'init-msg-1',
        sender: 'user',
        text: 'Hello',
        timestamp: new Date().toISOString()
      }
    ]
  })

  assert.strictEqual(controller.getSnapshot().messages.length, 1)

  controller.clearConversation()
  assert.strictEqual(controller.getSnapshot().messages.length, 0)
})

test('ChatConversationController: destroy aborts active in-flight request', async () => {
  const { client } = createMockClient({
    delayMs: 100,
    onRequest: () => {}
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('In flight request to abort')

  const sendPromise = controller.sendMessage()
  controller.destroy()

  const result = await sendPromise
  assert.strictEqual(result, false)
})

/* ── 13. Race Condition & Safety Corrective Tests ─────────────── */

test('ChatConversationController: clearing conversation during in-flight request prevents stale response repopulation', async () => {
  const proposalResponse: AgentChatResponseDTO = {
    reply: 'Stale reply that should be ignored because conversation was cleared.',
    intent: 'report_shortage',
    tool_used: 'propose_recovery',
    data: { group_id: 'grp-stale-1', option_action_ids: ['act-stale-1'] },
    requires_confirmation: true,
    confirm_phrases: ['confirm option 1']
  }

  const { client } = createMockClient({
    response: proposalResponse,
    delayMs: 40
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('We are out of paneer')

  // 1. Dispatch request
  const sendPromise = controller.sendMessage()
  assert.strictEqual(controller.getSnapshot().isLoading, true)
  assert.strictEqual(controller.getSnapshot().messages.length, 1)

  // 2. User clears conversation while request is in flight
  controller.clearConversation()
  assert.strictEqual(controller.getSnapshot().messages.length, 0)
  assert.strictEqual(controller.getSnapshot().activeConfirmation, null)

  // 3. In-flight request completes
  const result = await sendPromise
  assert.strictEqual(result, false)

  // 4. Verify conversation remains empty and stale response was NOT pushed
  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.messages.length, 0)
  assert.strictEqual(snapshot.activeConfirmation, null)
  assert.strictEqual(snapshot.isLoading, false)
  assert.strictEqual(snapshot.error, null)
})

test('ChatConversationController: clearing conversation during in-flight request ignores stale error', async () => {
  const { client } = createMockClient({
    status: 500,
    errorBody: { error: { code: 'INTERNAL_ERROR', message: 'Backend failure' } },
    delayMs: 40
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('Test query before clear')

  const sendPromise = controller.sendMessage()
  assert.strictEqual(controller.getSnapshot().isLoading, true)

  // Clear while in flight
  controller.clearConversation()

  await sendPromise

  // Stale error must not pollute the freshly cleared conversation
  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.messages.length, 0)
  assert.strictEqual(snapshot.error, null)
  assert.strictEqual(snapshot.errorMessage, null)
  assert.strictEqual(snapshot.isLoading, false)
})

test('ChatConversationController: mode switch during in-flight request keeps response in live thread without corrupting demo state', async () => {
  const proposalResponse: AgentChatResponseDTO = {
    reply: 'Live recovery proposal.',
    intent: 'report_shortage',
    tool_used: 'propose_recovery',
    data: { group_id: 'grp-live-switch', option_action_ids: ['act-live-switch-1'] },
    requires_confirmation: true,
    confirm_phrases: ['confirm option 1']
  }

  const { client } = createMockClient({
    response: proposalResponse,
    delayMs: 50
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('We are out of paneer')

  // 1. Start live request
  const liveSendPromise = controller.sendMessage()
  assert.strictEqual(controller.getSnapshot().mode, 'live')
  assert.strictEqual(controller.getSnapshot().isLoading, true)

  // 2. Switch to demo mode while request is in flight
  controller.setMode('demo')
  assert.strictEqual(controller.getSnapshot().mode, 'demo')

  // 3. Live request completes while user is viewing demo mode
  const result = await liveSendPromise
  assert.strictEqual(result, true)

  // 4. Verify currently active demo state is NOT corrupted by live response
  const demoSnapshot = controller.getSnapshot()
  assert.strictEqual(demoSnapshot.mode, 'demo')
  assert.strictEqual(demoSnapshot.isLoading, false)
  // Demo messages remain simulated fixtures only
  for (const msg of demoSnapshot.messages) {
    assert.strictEqual(msg.isSimulated, true)
    assert.notStrictEqual(msg.text, 'Live recovery proposal.')
  }

  // 5. Switch back to live mode
  controller.setMode('live')
  const liveSnapshot = controller.getSnapshot()
  assert.strictEqual(liveSnapshot.mode, 'live')
  assert.strictEqual(liveSnapshot.messages.length, 2)
  assert.strictEqual(liveSnapshot.messages[0].text, 'We are out of paneer')
  assert.strictEqual(liveSnapshot.messages[1].text, 'Live recovery proposal.')
  assert.strictEqual(liveSnapshot.messages[1].isSimulated, false)
  assert.strictEqual(liveSnapshot.activeConfirmation?.actionGroupId, 'grp-live-switch')
})

test('ChatConversationController: synchronous lock prevents rapid duplicate submissions before render', async () => {
  const { client, getCallCount } = createMockClient({
    delayMs: 40
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('Synchronous rapid click test')

  // Invoke twice in the exact same synchronous execution turn
  const p1 = controller.sendMessage()
  const p2 = controller.sendMessage()

  const [res1, res2] = await Promise.all([p1, p2])

  assert.strictEqual(res1, true)
  assert.strictEqual(res2, false) // Synchronously rejected by instance lock
  assert.strictEqual(getCallCount(), 1) // Exactly 1 API call made
})

test('ChatConversationController: does NOT clear draft if user typed newer input while request was in flight', async () => {
  const { client } = createMockClient({
    delayMs: 40
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('First thought')

  // 1. Submit initial draft
  const sendPromise = controller.sendMessage()

  // 2. User starts typing a second thought while request is in flight
  controller.setDraft('Second thought typed while waiting')

  // 3. Request completes
  const result = await sendPromise
  assert.strictEqual(result, true)

  // 4. Verify newer draft is NOT deleted!
  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.draft, 'Second thought typed while waiting')
  assert.strictEqual(snapshot.canSubmit, true)
})

test('ChatConversationController: does NOT clear draft if voice transcript arrives while request was in flight', async () => {
  const { client } = createMockClient({
    delayMs: 40
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('Initial text')

  const sendPromise = controller.sendMessage()

  // Spoken input arrives while request is in flight
  controller.applyVoiceTranscript('Spoken note during flight')

  const result = await sendPromise
  assert.strictEqual(result, true)

  // Spoken transcript must be preserved
  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.draft, 'Spoken note during flight')
  assert.strictEqual(snapshot.draftInputMode, 'voice')
})

test('ChatConversationController: voice transcript during in-flight request does not trigger auto-submit', async () => {
  const { client, getCallCount } = createMockClient({
    delayMs: 50
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('Query 1')

  const sendPromise = controller.sendMessage()

  // Apply voice transcript while request is in progress
  controller.applyVoiceTranscript('Voice transcript arrives mid-flight')

  assert.strictEqual(getCallCount(), 1) // Did not call API again
  assert.strictEqual(controller.getSnapshot().draft, 'Voice transcript arrives mid-flight')

  await sendPromise
  assert.strictEqual(getCallCount(), 1) // Total API calls remains 1
})

