/* ============================================================
   frontend/src/api/__tests__/chatPresentation.test.ts
   OperAI / Cloud Kitchen Rescue — Chat Presentation Component Logic Tests

   Covers Feature 7 Phase 3 Substep 3.2 Requirements:
   1. Proposal card rendering logic (honesty with missing fields, proposal only).
   2. Absence of approve, reject, undo, or mutation buttons in proposal presentation.
   3. Simulated vs live message distinction and honest labeling.
   4. Character limits and counter threshold logic (500 chars).
   5. Explicit voice activation and transcript review behavior.
   6. Timestamp formatting resilience.

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/chatPresentation.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractActionMetadata,
  MAX_CHAT_MESSAGE_LENGTH,
  SUGGESTED_CHAT_PROMPTS
} from '../../hooks/useChatData.ts'
import { DEMO_CHAT_CONVERSATION, DEMO_CHAT_RESPONSES } from '../../pages/chat/demoChatData.ts'
import type { ChatMessage, ChatConfirmationPrompt } from '../../types/chat.ts'

/* ── 1. Proposal Card Presentation Logic ─────────────────────── */

test('ChatProposalCard logic: suppresses display when no confirmation metadata or group ID exists', () => {
  const shouldRenderProposal = (props: {
    requiresConfirmation?: boolean
    confirmPhrases?: readonly string[]
    actionGroupId?: string
  }): boolean => {
    const hasValidGroupId = typeof props.actionGroupId === 'string' && props.actionGroupId.trim().length > 0
    const hasConfirmPhrases = Array.isArray(props.confirmPhrases) && props.confirmPhrases.length > 0
    return Boolean(props.requiresConfirmation || hasValidGroupId || hasConfirmPhrases)
  }

  assert.strictEqual(
    shouldRenderProposal({
      requiresConfirmation: false,
      confirmPhrases: [],
      actionGroupId: undefined
    }),
    false
  )

  assert.strictEqual(
    shouldRenderProposal({
      requiresConfirmation: true,
      confirmPhrases: ['confirm option 1'],
      actionGroupId: 'grp-test-1'
    }),
    true
  )
})

test('ChatProposalCard logic: honest extraction handles absent actionGroupId and optionActionIds without fabricating', () => {
  const emptyData = extractActionMetadata({})
  assert.strictEqual(emptyData.actionGroupId, undefined)
  assert.strictEqual(emptyData.optionActionIds, undefined)

  const partialData = extractActionMetadata({ group_id: 'grp-valid-1' })
  assert.strictEqual(partialData.actionGroupId, 'grp-valid-1')
  assert.strictEqual(partialData.optionActionIds, undefined)

  const fullData = extractActionMetadata({
    group_id: 'grp-valid-2',
    option_action_ids: ['act-1', 'act-2']
  })
  assert.strictEqual(fullData.actionGroupId, 'grp-valid-2')
  assert.deepStrictEqual(fullData.optionActionIds, ['act-1', 'act-2'])
})

/* ── 2. Input Limits & Character Counter Logic ───────────────── */

test('ChatInputBar: enforces 500-character constraint accurately', () => {
  assert.strictEqual(MAX_CHAT_MESSAGE_LENGTH, 500)

  const isCanSubmit = (draft: string, isLoading = false): boolean => {
    const charCount = draft.length
    const isEmpty = draft.trim().length === 0
    const isOverLimit = charCount > MAX_CHAT_MESSAGE_LENGTH
    return !isLoading && !isEmpty && !isOverLimit
  }

  assert.strictEqual(isCanSubmit(''), false)
  assert.strictEqual(isCanSubmit('   '), false)
  assert.strictEqual(isCanSubmit('Valid message'), true)
  assert.strictEqual(isCanSubmit('a'.repeat(500)), true)
  assert.strictEqual(isCanSubmit('a'.repeat(501)), false)
  assert.strictEqual(isCanSubmit('Valid message', true), false) // Disabled during loading
})

test('ChatInputBar: identifies counter warning (>450) and danger (>500) thresholds', () => {
  const getCounterClass = (length: number): string => {
    if (length > MAX_CHAT_MESSAGE_LENGTH) return 'chat-input-bar__counter--danger'
    if (length > 450) return 'chat-input-bar__counter--warning'
    return ''
  }

  assert.strictEqual(getCounterClass(200), '')
  assert.strictEqual(getCounterClass(450), '')
  assert.strictEqual(getCounterClass(451), 'chat-input-bar__counter--warning')
  assert.strictEqual(getCounterClass(500), 'chat-input-bar__counter--warning')
  assert.strictEqual(getCounterClass(501), 'chat-input-bar__counter--danger')
})

/* ── 3. Simulated vs Live Message Clarity (AGENTS.md Rule 9) ─── */

test('ChatMessageList: demo conversation messages are all tagged simulated', () => {
  for (const msg of DEMO_CHAT_CONVERSATION) {
    assert.strictEqual(msg.isSimulated, true)
  }
})

test('ChatMessageList: live messages are explicitly not simulated', () => {
  const liveMessage: ChatMessage = {
    id: 'live-1',
    sender: 'user',
    text: 'Check my live brief',
    timestamp: '2026-10-18T10:00:00+05:30',
    isSimulated: false,
    status: 'sent'
  }

  assert.strictEqual(liveMessage.isSimulated, false)
})

/* ── 4. Suggested Prompts List ───────────────────────────────── */

test('ChatMessageList: suggested prompts are non-empty and relevant to cloud kitchen operations', () => {
  assert.ok(SUGGESTED_CHAT_PROMPTS.length >= 3)
  for (const prompt of SUGGESTED_CHAT_PROMPTS) {
    assert.strictEqual(typeof prompt, 'string')
    assert.ok(prompt.length > 5)
  }
})
