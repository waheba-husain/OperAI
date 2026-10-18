/* ============================================================
   frontend/src/pages/chat/demoChatData.ts
   OperAI / Cloud Kitchen Rescue — Controlled Chat & Voice Demo Data

   DATA INTEGRITY (per AGENTS.md rule 9):
   data_source = 'simulated' — these records provide deterministic,
   controlled conversation flows for offline demonstration and testing.

   SAFETY RULES:
   1. All proposed recovery options remain strictly pending proposals.
   2. Never marks proposals as approved or executed.
   3. Distinctly isolated from live API execution; no silent live-to-demo fallback.
   ============================================================ */

import type { AgentChatResponseDTO } from '../../types/dto.ts'
import type { ChatMessage } from '../../types/chat.ts'

export const DEMO_CHAT_METADATA = {
  dataSource: 'simulated',
  kitchenName: 'Cloud Kitchen Central #04',
  note: 'Simulated assistant voice/chat interactions for demonstration and validation.'
} as const

/**
 * Controlled mock responses conforming strictly to AgentChatResponseDTO (Rest_API_Spec.md §3.16).
 */
export const DEMO_CHAT_RESPONSES = {
  /** Normal informational briefing response (read-only) */
  informational: {
    reply:
      'Good morning. For today, 26 orders are scheduled. Paneer is short by 0.92 kg with 4 orders worth 1,260 rupees at risk before 1:45 PM. No other shortages detected.',
    intent: 'get_brief',
    tool_used: 'get_brief',
    data: {
      date: '2026-10-18',
      order_count: 26,
      shortage_count: 1,
      revenue_at_risk: 1260.0
    },
    requires_confirmation: false,
    confirm_phrases: []
  } satisfies AgentChatResponseDTO,

  /** Recovery proposal response (creates pending options, requires owner confirmation) */
  recoveryProposal: {
    reply:
      'Paneer is short for tomorrow and four orders worth 1,180 rupees are at risk. Option 1: use tofu in four orders, saves 147 rupees, needs customer consent. Option 2: buy 1 kg locally, one order runs 30 minutes late. Say confirm option 1, or confirm option 2.',
    intent: 'report_shortage',
    tool_used: 'propose_recovery',
    data: {
      group_id: 'grp-demo-paneer-01',
      option_action_ids: ['act-demo-opt-1', 'act-demo-opt-2', 'act-demo-opt-3']
    },
    requires_confirmation: true,
    confirm_phrases: ['confirm option 1', 'confirm option 2', 'confirm option 3']
  } satisfies AgentChatResponseDTO,

  /** Clarifying question when query is outside assistant domain */
  clarifyingUnknown: {
    reply:
      "I can only help manage kitchen operations, inventory shortages, pricing analysis, and incoming order intake. Would you like me to check today's risk brief or report an ingredient shortage?",
    intent: 'unknown',
    tool_used: null,
    data: null,
    requires_confirmation: false,
    confirm_phrases: []
  } satisfies AgentChatResponseDTO
} as const

/**
 * Deterministic message thread demonstrating user inputs and assistant replies
 * across informational and recovery-proposal conversation flows.
 */
export const DEMO_CHAT_CONVERSATION: readonly ChatMessage[] = [
  // Exchange 1: Informational Query
  {
    id: 'demo-msg-001',
    sender: 'user',
    text: 'What is my morning risk brief?',
    timestamp: '2026-10-18T09:30:00+05:30',
    inputMode: 'voice',
    isSimulated: true,
    status: 'sent'
  },
  {
    id: 'demo-msg-002',
    sender: 'assistant',
    text: DEMO_CHAT_RESPONSES.informational.reply,
    timestamp: '2026-10-18T09:30:02+05:30',
    intent: DEMO_CHAT_RESPONSES.informational.intent,
    toolUsed: DEMO_CHAT_RESPONSES.informational.tool_used,
    requiresConfirmation: DEMO_CHAT_RESPONSES.informational.requires_confirmation,
    confirmPhrases: DEMO_CHAT_RESPONSES.informational.confirm_phrases,
    isSimulated: true,
    status: 'sent'
  },

  // Exchange 2: Shortage Reporting & Recovery Proposal
  {
    id: 'demo-msg-003',
    sender: 'user',
    text: 'We are out of paneer',
    timestamp: '2026-10-18T09:31:15+05:30',
    inputMode: 'voice',
    isSimulated: true,
    status: 'sent'
  },
  {
    id: 'demo-msg-004',
    sender: 'assistant',
    text: DEMO_CHAT_RESPONSES.recoveryProposal.reply,
    timestamp: '2026-10-18T09:31:18+05:30',
    intent: DEMO_CHAT_RESPONSES.recoveryProposal.intent,
    toolUsed: DEMO_CHAT_RESPONSES.recoveryProposal.tool_used,
    requiresConfirmation: DEMO_CHAT_RESPONSES.recoveryProposal.requires_confirmation,
    confirmPhrases: DEMO_CHAT_RESPONSES.recoveryProposal.confirm_phrases,
    actionGroupId: DEMO_CHAT_RESPONSES.recoveryProposal.data.group_id,
    optionActionIds: DEMO_CHAT_RESPONSES.recoveryProposal.data.option_action_ids,
    isSimulated: true,
    status: 'sent'
  }
]
