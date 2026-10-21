/* ============================================================
   frontend/src/api/__tests__/voiceApprovalIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Voice Approval Integration Tests

   Covers Feature 7 Remaining Task 1: Voice-Based Approval of Recovery Options:
   1. Explicit valid voice confirmation resolves the correct action ID and calls approveAction.
   2. Voice confirmation includes exact confirm_option_number, input_mode: "voice", and transcript.
   3. Typed confirmation preserves input_mode: "click" (never falsely marked as voice).
   4. Ambiguous phrases ("what about option 2?") do NOT approve and route to chatAgent.
   5. Ordinary chat messages ("out of paneer") route to chatAgent normally.
   6. Invalid option numbers (e.g. option 5 of 2) do NOT call approveAction.
   7. Missing active confirmation proposal does NOT call approveAction.
   8. Missing action IDs in active confirmation do NOT call approveAction (no invented IDs).
   9. API errors (409 PLAN_CHANGED, 409 ACTION_EXPIRED, 422 OPTION_MISMATCH) display safely.
   10. Sibling proposals & repeated approvals prevented (activeConfirmation cleared on success/409).
   11. Successful approval displays assistant confirmation with real API figures without fabrication.
   12. Assistant speech playback spoken strictly once without duplicates; demo mode never speaks.
   13. Demo mode never performs a live approval or live network call.

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/voiceApprovalIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError } from '../errors.ts'
import {
  ChatConversationController,
  parseConfirmationPhrase
} from '../../hooks/useChatData.ts'
import { processAssistantSpeechPlayback } from '../../components/chat/assistantSpeechPlayback.ts'
import type {
  ActionApproveRequestDTO,
  ActionApproveResponseDTO,
  AgentChatResponseDTO
} from '../../types/dto.ts'
import type { ChatMessage } from '../../types/chat.ts'

/* ── Test Helpers & Mock Client ───────────────────────────────── */

interface MockServerCall {
  readonly method: string
  readonly url: string
  readonly body: unknown
  readonly headers: HeadersInit | undefined
}

function createMockApprovalClient(config?: {
  chatResponse?: AgentChatResponseDTO
  approvalResponse?: ActionApproveResponseDTO
  approvalStatus?: number
  approvalErrorBody?: Record<string, unknown>
  chatStatus?: number
  chatErrorBody?: Record<string, unknown>
}): {
  client: ApiClient
  calls: MockServerCall[]
  getApprovalCalls: () => MockServerCall[]
  getChatCalls: () => MockServerCall[]
} {
  const calls: MockServerCall[] = []

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? 'GET'
    let body: unknown = undefined

    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }

    calls.push({ method, url, body, headers: init?.headers })

    // Route: POST /api/actions/{id}/approve
    if (url.includes('/api/actions/') && url.endsWith('/approve')) {
      const status = config?.approvalStatus ?? 200
      if (status >= 400) {
        const errorBody = config?.approvalErrorBody ?? {
          error: {
            code: 'ACTION_FAILED',
            message: `Approval failed with status ${status}`,
            details: {}
          }
        }
        return new Response(JSON.stringify(errorBody), {
          status,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      const defaultApprovalResponse: ActionApproveResponseDTO = {
        action: {
          id: 'act-tofu-01',
          status: 'executed',
          executed_at: '2026-10-21T10:05:00+05:30'
        },
        plan_version_before: 3,
        plan_version_after: 4,
        changes: {
          orders_affected: ['ord-101', 'ord-102'],
          tasks_rescheduled: 2,
          summary: 'Swapped paneer for tofu in 2 orders; 0 orders late'
        },
        audit_id: 'aud-uuid-999',
        customer_messages: [
          {
            order_id: 'ord-101',
            customer_name: 'Aditi Sharma',
            message: 'Hi Aditi, we are substituting paneer with tofu. Reply YES to confirm.',
            whatsapp_url: 'https://wa.me/919800000010?text=test',
            needs_consent: true
          }
        ],
        expired_action_ids: ['act-paneer-local-02']
      }

      return new Response(
        JSON.stringify(config?.approvalResponse ?? defaultApprovalResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Route: POST /api/agent/chat
    if (url.includes('/api/agent/chat')) {
      const status = config?.chatStatus ?? 200
      if (status >= 400) {
        const errorBody = config?.chatErrorBody ?? {
          error: {
            code: 'CHAT_FAILED',
            message: `Chat request failed with status ${status}`,
            details: {}
          }
        }
        return new Response(JSON.stringify(errorBody), {
          status,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      const defaultChatResponse: AgentChatResponseDTO = {
        reply: 'I found 2 recovery options for your paneer shortage. Option 1: tofu substitution. Option 2: local purchase.',
        intent: 'propose_recovery',
        tool_used: 'propose_recovery',
        data: {
          group_id: 'grp-paneer-01',
          option_action_ids: ['act-tofu-01', 'act-paneer-local-02']
        },
        requires_confirmation: true,
        confirm_phrases: ['confirm option 1', 'confirm option 2']
      }

      return new Response(
        JSON.stringify(config?.chatResponse ?? defaultChatResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not Found' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key-fariha-voice',
    fetchFn: mockFetch
  })

  return {
    client,
    calls,
    getApprovalCalls: () => calls.filter((c) => c.url.includes('/approve')),
    getChatCalls: () => calls.filter((c) => c.url.includes('/api/agent/chat'))
  }
}

function createProposalAssistantMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-assist-prop-1',
    sender: 'assistant',
    text: 'I found 2 recovery options for the paneer shortage.',
    timestamp: '2026-10-21T10:00:00Z',
    intent: 'propose_recovery',
    toolUsed: 'propose_recovery',
    requiresConfirmation: true,
    confirmPhrases: ['confirm option 1', 'confirm option 2'],
    actionGroupId: 'grp-paneer-01',
    optionActionIds: ['act-tofu-01', 'act-paneer-local-02'],
    isSimulated: false,
    status: 'sent',
    ...overrides
  }
}

/* ── 1. Phrase Parsing & Disambiguation ───────────────────────── */

test('parseConfirmationPhrase: correctly parses valid explicit confirmation phrases', () => {
  // Digit variations
  const p1 = parseConfirmationPhrase('confirm option 1')
  assert.deepStrictEqual(p1, { optionNumber: 1, rawText: 'confirm option 1' })

  const p2 = parseConfirmationPhrase('Confirm option 2.')
  assert.deepStrictEqual(p2, { optionNumber: 2, rawText: 'Confirm option 2.' })

  // Word variations
  const p3 = parseConfirmationPhrase('confirm option two!')
  assert.deepStrictEqual(p3, { optionNumber: 2, rawText: 'confirm option two!' })

  // Polite prefixes and suffixes
  const p4 = parseConfirmationPhrase('please confirm option 1')
  assert.deepStrictEqual(p4, { optionNumber: 1, rawText: 'please confirm option 1' })

  const p5 = parseConfirmationPhrase('yes, confirm option 2 please')
  assert.deepStrictEqual(p5, { optionNumber: 2, rawText: 'yes, confirm option 2 please' })

  const p6 = parseConfirmationPhrase('approve option 1')
  assert.deepStrictEqual(p6, { optionNumber: 1, rawText: 'approve option 1' })
})

test('parseConfirmationPhrase: returns null for ambiguous or conversational phrases (AGENTS.md Rule 2)', () => {
  assert.strictEqual(parseConfirmationPhrase('what about option 2?'), null)
  assert.strictEqual(parseConfirmationPhrase('I think option 1 looks better'), null)
  assert.strictEqual(parseConfirmationPhrase('Can you explain option 2?'), null)
  assert.strictEqual(parseConfirmationPhrase('Option 2 sounds promising'), null)
  assert.strictEqual(parseConfirmationPhrase('We are out of paneer'), null)
  assert.strictEqual(parseConfirmationPhrase('confirm'), null)
  assert.strictEqual(parseConfirmationPhrase('option 1'), null)
  assert.strictEqual(parseConfirmationPhrase('show me option 2 details'), null)
  assert.strictEqual(parseConfirmationPhrase(''), null)
  assert.strictEqual(parseConfirmationPhrase('   '), null)
})

/* ── 2. Explicit Voice Confirmation Resolves Correct Action ──── */

test('Voice Approval: explicit valid voice confirmation resolves action ID and dispatches approveAction', async () => {
  const { client, getApprovalCalls, getChatCalls } = createMockApprovalClient()

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [createProposalAssistantMessage()]
  })

  // Verify active confirmation exists
  const snapshotBefore = controller.getSnapshot()
  assert.strictEqual(snapshotBefore.activeConfirmation?.requiresConfirmation, true)
  assert.deepStrictEqual(snapshotBefore.activeConfirmation?.optionActionIds, [
    'act-tofu-01',
    'act-paneer-local-02'
  ])

  // Speech recognition updates editable draft buffer
  controller.applyVoiceTranscript('confirm option 2')
  const draftSnapshot = controller.getSnapshot()
  assert.strictEqual(draftSnapshot.draft, 'confirm option 2')
  assert.strictEqual(draftSnapshot.draftInputMode, 'voice')

  // User explicitly submits
  const success = await controller.sendMessage()
  assert.strictEqual(success, true)

  // Verify chatAgent was NOT called
  assert.strictEqual(getChatCalls().length, 0)

  // Verify approveAction was called with correct action ID for Option 2 (index 1)
  const approvalCalls = getApprovalCalls()
  assert.strictEqual(approvalCalls.length, 1)
  const call = approvalCalls[0]
  assert.strictEqual(call.url, 'https://test-api.operai.com/api/actions/act-paneer-local-02/approve')
  assert.strictEqual(call.method, 'POST')

  const body = call.body as ActionApproveRequestDTO
  assert.strictEqual(body.confirm_option_number, 2)
  assert.strictEqual(body.input_mode, 'voice')
  assert.strictEqual(body.transcript, 'confirm option 2')

  // Verify draft cleared after success
  const snapshotAfter = controller.getSnapshot()
  assert.strictEqual(snapshotAfter.draft, '')

  // Verify active confirmation is cleared so sibling actions cannot be confirmed
  assert.strictEqual(snapshotAfter.activeConfirmation, null)

  // Verify assistant message contains real summary and plan version
  const lastMsg = snapshotAfter.messages[snapshotAfter.messages.length - 1]
  assert.strictEqual(lastMsg.sender, 'assistant')
  assert.strictEqual(lastMsg.intent, 'approval_confirmed')
  assert.strictEqual(lastMsg.toolUsed, 'approve_action')
  assert.match(lastMsg.text, /Option 2 approved/i)
  assert.match(lastMsg.text, /Plan updated to version 4/i)
  assert.match(lastMsg.text, /1 customer message\(s\) drafted/i)
})

/* ── 3. Typed Confirmation Sets input_mode: "click" ──────────── */

test('Voice Approval: typed confirmation preserves input_mode "click" and is not falsely marked voice', async () => {
  const { client, getApprovalCalls } = createMockApprovalClient()

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [createProposalAssistantMessage()]
  })

  // User typed into draft input (not voice)
  controller.setDraft('confirm option 1')
  assert.strictEqual(controller.getSnapshot().draftInputMode, 'text')

  const success = await controller.sendMessage()
  assert.strictEqual(success, true)

  const approvalCalls = getApprovalCalls()
  assert.strictEqual(approvalCalls.length, 1)
  const body = approvalCalls[0].body as ActionApproveRequestDTO
  assert.strictEqual(body.confirm_option_number, 1)
  // Requirement 8: Typed confirmation must not be falsely recorded as voice input
  assert.strictEqual(body.input_mode, 'click')
  assert.strictEqual(body.transcript, 'confirm option 1')
})

/* ── 4. Invalid Option Numbers Do Not Call approveAction ──────── */

test('Voice Approval: out-of-bounds option number does not call approveAction and yields 422', async () => {
  const { client, getApprovalCalls } = createMockApprovalClient()

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [createProposalAssistantMessage()]
  })

  controller.applyVoiceTranscript('confirm option 5')
  const success = await controller.sendMessage()
  assert.strictEqual(success, false)

  // approveAction must NEVER be called
  assert.strictEqual(getApprovalCalls().length, 0)

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.error instanceof ApiError, true)
  assert.strictEqual((snapshot.error as ApiError).status, 422)
  assert.match(snapshot.errorMessage ?? '', /Option 5 is not a valid option/i)
})

test('Voice Approval: option 0 is rejected as invalid option number', async () => {
  const { client, getApprovalCalls } = createMockApprovalClient()

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [createProposalAssistantMessage()]
  })

  controller.applyVoiceTranscript('confirm option 0')
  const success = await controller.sendMessage()
  assert.strictEqual(success, false)
  assert.strictEqual(getApprovalCalls().length, 0)

  const snapshot = controller.getSnapshot()
  assert.strictEqual((snapshot.error as ApiError).status, 422)
})

/* ── 5. Missing Active Confirmation Does Not Approve ─────────── */

test('Voice Approval: confirming without an active recovery proposal rejects with 409', async () => {
  const { client, getApprovalCalls } = createMockApprovalClient()

  // Controller initialized with NO active proposal
  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: []
  })

  controller.applyVoiceTranscript('confirm option 1')
  const success = await controller.sendMessage()
  assert.strictEqual(success, false)

  // Zero calls to approveAction
  assert.strictEqual(getApprovalCalls().length, 0)

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.error instanceof ApiError, true)
  assert.strictEqual((snapshot.error as ApiError).status, 409)
  assert.match(snapshot.errorMessage ?? '', /No active recovery proposal/i)
})

/* ── 6. Missing Action IDs Does Not Approve (No Invention) ───── */

test('Voice Approval: active proposal without valid option action IDs rejects without inventing IDs', async () => {
  const { client, getApprovalCalls } = createMockApprovalClient()

  // Proposal has actionGroupId but empty optionActionIds
  const brokenProposal = createProposalAssistantMessage({
    optionActionIds: []
  })

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [brokenProposal]
  })

  controller.applyVoiceTranscript('confirm option 1')
  const success = await controller.sendMessage()
  assert.strictEqual(success, false)

  // Must NEVER invent an action ID or infer from actionGroupId
  assert.strictEqual(getApprovalCalls().length, 0)

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.error instanceof ApiError, true)
  assert.strictEqual((snapshot.error as ApiError).status, 422)
  assert.match(snapshot.errorMessage ?? '', /No action IDs found/i)
})

test('Voice Approval: live mode rejects when selected option action ID is blank whitespace', async () => {
  const { client, getApprovalCalls } = createMockApprovalClient()

  const proposalWithBlankOption = createProposalAssistantMessage({
    optionActionIds: ['act-tofu-01', '   ']
  })

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [proposalWithBlankOption]
  })

  controller.applyVoiceTranscript('confirm option 2')
  const success = await controller.sendMessage()
  assert.strictEqual(success, false)
  assert.strictEqual(getApprovalCalls().length, 0)

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.error instanceof ApiError, true)
  assert.strictEqual((snapshot.error as ApiError).status, 422)
  assert.strictEqual((snapshot.error as ApiError).code, 'MISSING_ACTION_ID')
  assert.match(snapshot.errorMessage ?? '', /Action ID for Option 2 is missing or invalid/i)
  assert.notStrictEqual(snapshot.activeConfirmation, null)
})

/* ── 7. Ambiguous & Ordinary Messages Continue Through chatAgent ─ */

test('Voice Approval: ambiguous phrase ("what about option 2?") routes through chatAgent', async () => {
  const { client, getApprovalCalls, getChatCalls } = createMockApprovalClient()

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [createProposalAssistantMessage()]
  })

  controller.applyVoiceTranscript('What about option 2?')
  const success = await controller.sendMessage()
  assert.strictEqual(success, true)

  // Zero approval calls
  assert.strictEqual(getApprovalCalls().length, 0)

  // Routed through normal chatAgent endpoint
  const chatCalls = getChatCalls()
  assert.deepStrictEqual(chatCalls[0].body, {
    message: 'What about option 2?',
    input_mode: 'voice',
    history: [
      {
        role: 'assistant',
        content: 'I found 2 recovery options for the paneer shortage.'
      }
    ]
  })
})

test('Voice Approval: ordinary kitchen message routes through chatAgent normally', async () => {
  const { client, getApprovalCalls, getChatCalls } = createMockApprovalClient()

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: []
  })

  controller.setDraft('We are out of paneer')
  const success = await controller.sendMessage()
  assert.strictEqual(success, true)

  assert.strictEqual(getApprovalCalls().length, 0)
  assert.strictEqual(getChatCalls().length, 1)
  assert.deepStrictEqual(getChatCalls()[0].body, {
    message: 'We are out of paneer',
    input_mode: 'text'
  })
})

/* ── 8. API Conflicts & Validation Errors Surface Safely ──────── */

test('Voice Approval: handles 409 PLAN_CHANGED conflict safely and clears stale confirmation', async () => {
  const { client, getApprovalCalls } = createMockApprovalClient({
    approvalStatus: 409,
    approvalErrorBody: {
      error: {
        code: 'PLAN_CHANGED',
        message: 'Kitchen plan version changed since recovery options were generated.',
        details: { current_plan_version: 5, expected_plan_version: 3 }
      }
    }
  })

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [createProposalAssistantMessage()]
  })

  controller.applyVoiceTranscript('confirm option 1')
  const success = await controller.sendMessage()
  assert.strictEqual(success, false)

  assert.strictEqual(getApprovalCalls().length, 1)

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.error instanceof ApiError, true)
  assert.strictEqual((snapshot.error as ApiError).status, 409)
  // Formatted user message explains plan changed
  assert.match(snapshot.errorMessage ?? '', /plan changed/i)

  // Active confirmation is cleared to prevent repeated stale approvals
  assert.strictEqual(snapshot.activeConfirmation, null)
})

test('Voice Approval: handles 409 ACTION_EXPIRED conflict safely', async () => {
  const { client, getApprovalCalls } = createMockApprovalClient({
    approvalStatus: 409,
    approvalErrorBody: {
      error: {
        code: 'ACTION_EXPIRED',
        message: 'Proposed recovery action has expired.',
        details: { action_id: 'act-tofu-01' }
      }
    }
  })

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [createProposalAssistantMessage()]
  })

  controller.applyVoiceTranscript('confirm option 1')
  const success = await controller.sendMessage()
  assert.strictEqual(success, false)

  const snapshot = controller.getSnapshot()
  assert.match(snapshot.errorMessage ?? '', /action has expired/i)
  assert.strictEqual(snapshot.activeConfirmation, null)
})

test('Voice Approval: handles 422 OPTION_MISMATCH from backend safely without retry', async () => {
  const { client, getApprovalCalls } = createMockApprovalClient({
    approvalStatus: 422,
    approvalErrorBody: {
      error: {
        code: 'OPTION_MISMATCH',
        message: 'Action option_number 1 does not match confirm_option_number 2.',
        details: { action_option_number: 1, confirm_option_number: 2 }
      }
    }
  })

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [createProposalAssistantMessage()]
  })

  controller.applyVoiceTranscript('confirm option 2')
  const success = await controller.sendMessage()
  assert.strictEqual(success, false)

  // Exactly 1 call; no auto-retries on mutation failure
  assert.strictEqual(getApprovalCalls().length, 1)

  const snapshot = controller.getSnapshot()
  assert.strictEqual((snapshot.error as ApiError).status, 422)
  assert.match(snapshot.errorMessage ?? '', /confirmation number did not match/i)
})

/* ── 9. Demo Mode Never Performs Live Approvals ───────────────── */

test('Voice Approval: demo mode confirms without issuing live network calls', async () => {
  const { client, calls } = createMockApprovalClient()

  const controller = new ChatConversationController({
    client,
    initialMode: 'demo'
  })

  // Demo conversation already starts with proposal in active confirmation
  assert.strictEqual(controller.getSnapshot().activeConfirmation?.requiresConfirmation, true)

  controller.applyVoiceTranscript('confirm option 1')
  const success = await controller.sendMessage()
  assert.strictEqual(success, true)

  // Zero network calls in Demo mode
  assert.strictEqual(calls.length, 0)

  const snapshot = controller.getSnapshot()
  const lastAssistant = snapshot.messages[snapshot.messages.length - 1]
  assert.strictEqual(lastAssistant.isSimulated, true)
  assert.match(lastAssistant.text, /Demo Mode/i)
  assert.match(lastAssistant.text, /simulated and disabled/i)
  assert.strictEqual(snapshot.activeConfirmation, null)
})

test('Voice Approval: demo mode rejects proposal whose selected option ID is missing or blank without clearing confirmation', async () => {
  const { client, calls } = createMockApprovalClient()

  // Proposal where option 1 is valid, but option 2 is blank whitespace
  const proposalWithBlankOptionId: ChatMessage = {
    id: 'demo-msg-prop-blank',
    sender: 'assistant',
    text: 'Option 1: Valid. Option 2: Blank ID.',
    timestamp: new Date().toISOString(),
    intent: 'propose_recovery',
    toolUsed: null,
    requiresConfirmation: true,
    confirmPhrases: ['confirm option 1', 'confirm option 2'],
    actionGroupId: 'grp-demo-01',
    optionActionIds: ['act-demo-valid-1', '   '],
    isSimulated: true,
    status: 'sent'
  }

  const controller = new ChatConversationController({
    client,
    initialMode: 'demo',
    initialMessages: [proposalWithBlankOptionId]
  })

  assert.strictEqual(controller.getSnapshot().activeConfirmation?.requiresConfirmation, true)

  controller.applyVoiceTranscript('confirm option 2')
  const success = await controller.sendMessage()

  // Must reject and not report success
  assert.strictEqual(success, false)

  // Zero network calls in Demo mode
  assert.strictEqual(calls.length, 0)

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.error instanceof ApiError, true)
  assert.strictEqual((snapshot.error as ApiError).status, 422)
  assert.strictEqual((snapshot.error as ApiError).code, 'MISSING_ACTION_ID')
  assert.match(snapshot.errorMessage ?? '', /Action ID for Option 2 is missing or invalid/i)

  // Must NOT report simulated approval
  const lastAssistant = snapshot.messages[snapshot.messages.length - 1]
  assert.notStrictEqual(lastAssistant.intent, 'approval_simulated')
  assert.strictEqual(lastAssistant.isSimulated, true)
  assert.match(lastAssistant.text, /Action ID for Option 2 is missing or invalid/i)

  // Must NOT clear active confirmation as if option were valid
  assert.notStrictEqual(snapshot.activeConfirmation, null)
  assert.strictEqual(snapshot.activeConfirmation?.requiresConfirmation, true)
})

test('Voice Approval: demo mode rejects proposal when selected option ID is empty string', async () => {
  const { client, calls } = createMockApprovalClient()

  const proposalWithEmptyOptionId: ChatMessage = {
    id: 'demo-msg-prop-empty',
    sender: 'assistant',
    text: 'Option 1: Empty ID.',
    timestamp: new Date().toISOString(),
    intent: 'propose_recovery',
    toolUsed: null,
    requiresConfirmation: true,
    confirmPhrases: ['confirm option 1'],
    actionGroupId: 'grp-demo-02',
    optionActionIds: [''],
    isSimulated: true,
    status: 'sent'
  }

  const controller = new ChatConversationController({
    client,
    initialMode: 'demo',
    initialMessages: [proposalWithEmptyOptionId]
  })

  controller.applyVoiceTranscript('confirm option 1')
  const success = await controller.sendMessage()

  assert.strictEqual(success, false)
  assert.strictEqual(calls.length, 0)

  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.error instanceof ApiError, true)
  assert.strictEqual((snapshot.error as ApiError).status, 422)
  assert.strictEqual((snapshot.error as ApiError).code, 'MISSING_ACTION_ID')
  assert.notStrictEqual(snapshot.activeConfirmation, null)
})

test('Voice Approval: custom demo initialMessages do not leak into liveMessages upon mode switch', () => {
  const customDemoMsg: ChatMessage = {
    id: 'custom-demo-msg-01',
    sender: 'assistant',
    text: 'Custom demo recovery scenario.',
    timestamp: new Date().toISOString(),
    intent: 'propose_recovery',
    toolUsed: null,
    requiresConfirmation: true,
    confirmPhrases: ['confirm option 1'],
    actionGroupId: 'grp-demo-isolated',
    optionActionIds: ['act-demo-iso-1'],
    isSimulated: true,
    status: 'sent'
  }

  const controller = new ChatConversationController({
    initialMode: 'demo',
    initialMessages: [customDemoMsg]
  })

  // 1. In initial Demo Mode, custom messages initialize correctly
  const demoSnapshot = controller.getSnapshot()
  assert.strictEqual(demoSnapshot.mode, 'demo')
  assert.strictEqual(demoSnapshot.isDemo, true)
  assert.strictEqual(demoSnapshot.isLive, false)
  assert.strictEqual(demoSnapshot.messages.length, 1)
  assert.strictEqual(demoSnapshot.messages[0].id, 'custom-demo-msg-01')
  assert.strictEqual(demoSnapshot.activeConfirmation?.requiresConfirmation, true)

  // 2. Switch to Live mode: liveMessages must be empty (custom demo messages do not leak!)
  controller.setMode('live')
  const liveSnapshot = controller.getSnapshot()
  assert.strictEqual(liveSnapshot.mode, 'live')
  assert.strictEqual(liveSnapshot.isLive, true)
  assert.strictEqual(liveSnapshot.isDemo, false)
  assert.strictEqual(liveSnapshot.messages.length, 0)
  assert.strictEqual(liveSnapshot.activeConfirmation, null)

  // 3. Switch back to Demo mode: custom demo conversation is preserved
  controller.setMode('demo')
  const demoSnapshotAgain = controller.getSnapshot()
  assert.strictEqual(demoSnapshotAgain.mode, 'demo')
  assert.strictEqual(demoSnapshotAgain.messages.length, 1)
  assert.strictEqual(demoSnapshotAgain.messages[0].id, 'custom-demo-msg-01')
  assert.strictEqual(demoSnapshotAgain.activeConfirmation?.requiresConfirmation, true)
})

/* ── 10. Assistant Speech Playback for Voice Approval Confirmation ─ */

test('Voice Approval Speech Playback: speaks assistant confirmation response exactly once in Live mode', async () => {
  const { client } = createMockApprovalClient()

  const controller = new ChatConversationController({
    client,
    initialMode: 'live',
    initialMessages: [createProposalAssistantMessage()]
  })

  const initialIds = new Set(controller.getSnapshot().messages.map((m) => m.id))
  const spoken: string[] = []
  const processedIds = new Set<string>()

  // Execute approval
  controller.applyVoiceTranscript('confirm option 1')
  await controller.sendMessage()

  const messagesAfter = controller.getSnapshot().messages

  // Trigger speech playback check
  const played = processAssistantSpeechPlayback({
    messages: messagesAfter,
    mode: 'live',
    isMuted: false,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spoken.push(text)
  })

  assert.strictEqual(played, true)
  assert.strictEqual(spoken.length, 1)
  assert.match(spoken[0], /Option 1 approved/i)

  // Re-evaluating on rerender does NOT speak again (duplicate prevention)
  const playedAgain = processAssistantSpeechPlayback({
    messages: messagesAfter,
    mode: 'live',
    isMuted: false,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spoken.push(text)
  })

  assert.strictEqual(playedAgain, false)
  assert.strictEqual(spoken.length, 1)
})

test('Voice Approval Speech Playback: demo mode approval never triggers speech synthesis', async () => {
  const { client } = createMockApprovalClient()

  const controller = new ChatConversationController({
    client,
    initialMode: 'demo'
  })

  const initialIds = new Set(controller.getSnapshot().messages.map((m) => m.id))
  const spoken: string[] = []
  const processedIds = new Set<string>()

  controller.applyVoiceTranscript('confirm option 1')
  await controller.sendMessage()

  const messagesAfter = controller.getSnapshot().messages

  const played = processAssistantSpeechPlayback({
    messages: messagesAfter,
    mode: 'demo',
    isMuted: false,
    isSynthesisSupported: true,
    initialMessageIds: initialIds,
    processedMessageIds: processedIds,
    speak: (text) => spoken.push(text)
  })

  assert.strictEqual(played, false)
  assert.strictEqual(spoken.length, 0)
})
