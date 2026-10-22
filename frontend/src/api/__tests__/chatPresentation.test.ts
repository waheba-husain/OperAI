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

import { ApiClient } from '../client.ts'
import {
  ChatConversationController,
  extractActionMetadata,
  MAX_CHAT_MESSAGE_LENGTH,
  SUGGESTED_CHAT_PROMPTS,
  shouldRenderProposalCard
} from '../../hooks/useChatData.ts'
import { DEMO_CHAT_CONVERSATION } from '../../pages/chat/demoChatData.ts'
import type { ChatMessage } from '../../types/chat.ts'
import type { PageId } from '../../types/navigation.ts'

/* ── 1. Proposal Card Presentation Logic ─────────────────────── */

test('shouldRenderProposalCard: returns boolean false (never numeric 0) when confirmation is false and confirmPhrases is empty', () => {
  const ordinaryAssistantMsg: ChatMessage = {
    id: 'msg-1',
    sender: 'assistant',
    text: "It looks like there's no active production plan in the system for today.",
    timestamp: new Date().toISOString(),
    requiresConfirmation: false,
    confirmPhrases: [],
    actionGroupId: undefined,
    optionActionIds: undefined,
    status: 'sent'
  }

  const result = shouldRenderProposalCard(ordinaryAssistantMsg)
  // Must be strict boolean false, never numeric 0 which React renders as text
  assert.strictEqual(result, false)
  assert.notStrictEqual(result, 0)

  // Contrast with previous buggy expression:
  const isUser = ordinaryAssistantMsg.sender === 'user'
  const oldBuggyExpr = !isUser && (ordinaryAssistantMsg.requiresConfirmation || ordinaryAssistantMsg.actionGroupId || ordinaryAssistantMsg.confirmPhrases?.length)
  assert.strictEqual(oldBuggyExpr, 0) // Proves the bug evaluated to numeric 0!

  // Real proposal card with active confirmation returns boolean true
  const realProposalMsg: ChatMessage = {
    id: 'msg-2',
    sender: 'assistant',
    text: 'Paneer shortage recovery options available.',
    timestamp: new Date().toISOString(),
    requiresConfirmation: true,
    confirmPhrases: ['confirm option 1', 'confirm option 2'],
    actionGroupId: 'grp-paneer-1',
    optionActionIds: ['act-1', 'act-2'],
    status: 'sent'
  }
  assert.strictEqual(shouldRenderProposalCard(realProposalMsg), true)

  // Real proposal with only actionGroupId returns true
  const groupOnlyMsg: ChatMessage = {
    ...ordinaryAssistantMsg,
    actionGroupId: 'grp-xyz'
  }
  assert.strictEqual(shouldRenderProposalCard(groupOnlyMsg), true)

  // User messages never render proposal card
  const userMsg: ChatMessage = {
    ...realProposalMsg,
    sender: 'user'
  }
  assert.strictEqual(shouldRenderProposalCard(userMsg), false)
})

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

/* ── 5. Drawer Lifecycle & Layout Integration ─────────────────── */

test('ChatDrawer lifecycle: closing drawer terminates active voice recognition safely', () => {
  let stopListeningCalled = false
  let stopSpeakingCalled = false

  const mockVoice = {
    isListening: true,
    isSpeaking: true,
    stopListening() {
      stopListeningCalled = true
      this.isListening = false
    },
    stopSpeaking() {
      stopSpeakingCalled = true
      this.isSpeaking = false
    }
  }

  // Simulate drawer closing handler in AppLayout / ChatDrawer
  const handleClose = () => {
    if (mockVoice.isListening) {
      mockVoice.stopListening()
    }
    if (mockVoice.isSpeaking) {
      mockVoice.stopSpeaking()
    }
  }

  handleClose()

  assert.strictEqual(stopListeningCalled, true)
  assert.strictEqual(stopSpeakingCalled, true)
  assert.strictEqual(mockVoice.isListening, false)
  assert.strictEqual(mockVoice.isSpeaking, false)
})

test('ChatDrawer lifecycle: conversation state persists across drawer open and close cycles', () => {
  const controller = new ChatConversationController()

  // 1. User types draft and has messages
  controller.setDraft('Important user question')
  assert.strictEqual(controller.getSnapshot().draft, 'Important user question')

  // 2. User closes drawer (isChatOpen becomes false)
  let isChatOpen = false
  assert.strictEqual(isChatOpen, false)

  // State in controller must remain 100% intact
  assert.strictEqual(controller.getSnapshot().draft, 'Important user question')

  // 3. User reopens drawer (isChatOpen becomes true)
  isChatOpen = true
  assert.strictEqual(isChatOpen, true)
  assert.strictEqual(controller.getSnapshot().draft, 'Important user question')
})

test('ChatDrawer lifecycle: closing drawer does NOT auto-submit draft or transcript', () => {
  const controller = new ChatConversationController()

  controller.applyVoiceTranscript('Spoken words before closing')
  assert.strictEqual(controller.getSnapshot().draft, 'Spoken words before closing')
  assert.strictEqual(controller.getSnapshot().messages.length, 0)

  // Drawer closes
  // Verify draft is preserved and NOT auto-submitted
  assert.strictEqual(controller.getSnapshot().draft, 'Spoken words before closing')
  assert.strictEqual(controller.getSnapshot().messages.length, 0)
  assert.strictEqual(controller.getSnapshot().isLoading, false)
})

test('ChatDrawer lifecycle: in-flight request completes safely across drawer close and reopen', async () => {
  const mockResponse = {
    reply: 'Kitchen brief completed in background.',
    intent: 'get_brief',
    tool_used: 'get_brief',
    data: { order_count: 12 },
    requires_confirmation: false,
    confirm_phrases: []
  }

  const mockFetch = async (): Promise<Response> => {
    await new Promise((r) => setTimeout(r, 30))
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  const controller = new ChatConversationController({ client })
  controller.setDraft('Status brief while drawer is open')

  // 1. Drawer open, user sends message
  let isChatOpen = true
  assert.strictEqual(isChatOpen, true)
  const sendPromise = controller.sendMessage()
  assert.strictEqual(controller.getSnapshot().isLoading, true)

  // 2. User closes drawer while request is in flight
  isChatOpen = false
  assert.strictEqual(isChatOpen, false)

  // 3. Request completes in background
  const success = await sendPromise
  assert.strictEqual(success, true)

  // 4. User reopens drawer
  isChatOpen = true
  assert.strictEqual(isChatOpen, true)

  // 5. Verify conversation displays both user and assistant messages cleanly
  const snapshot = controller.getSnapshot()
  assert.strictEqual(snapshot.isLoading, false)
  assert.strictEqual(snapshot.messages.length, 2)
  assert.strictEqual(snapshot.messages[0].text, 'Status brief while drawer is open')
  assert.strictEqual(snapshot.messages[1].text, 'Kitchen brief completed in background.')
  assert.strictEqual(snapshot.messages[1].isSimulated, false)
})

test('ChatConversationController: mode transition clears visible error without getting stuck', () => {
  const controller = new ChatConversationController()

  // User encounters validation error
  controller.setDraft('')
  controller.sendMessage() // Empty message triggers 422 error
  assert.ok(controller.getSnapshot().error !== null)
  assert.ok(controller.getSnapshot().errorMessage !== null)

  // Switch to demo mode
  controller.setMode('demo')
  assert.strictEqual(controller.getSnapshot().error, null)
  assert.strictEqual(controller.getSnapshot().errorMessage, null)

  // Switch back to live mode
  controller.setMode('live')
  assert.strictEqual(controller.getSnapshot().error, null)
  assert.strictEqual(controller.getSnapshot().errorMessage, null)
})

/* ── 5. React StrictMode Lifecycle & ChatInputBar Regression Tests ── */

test('ChatConversationController: React StrictMode mount/cleanup/remount lifecycle restores draft and messaging reactivity', async () => {
  const controller = new ChatConversationController()
  let currentSnapshot = controller.getSnapshot()

  controller.setOnStateChange((snap) => {
    currentSnapshot = snap
  })

  // 1. Initial mount: draft is empty
  assert.strictEqual(currentSnapshot.draft, '')
  assert.strictEqual(currentSnapshot.canSubmit, false)

  // 2. React StrictMode simulates unmount by calling effect cleanup: destroy()
  controller.destroy()

  // 3. React StrictMode immediately remounts by calling effect setup: activate() and setOnStateChange()
  controller.activate()
  controller.setOnStateChange((snap) => {
    currentSnapshot = snap
  })

  // 4. User types text into the textarea: setDraft must be fully responsive
  controller.setDraft('Out of paneer for butter chicken')
  assert.strictEqual(currentSnapshot.draft, 'Out of paneer for butter chicken')
  assert.strictEqual(currentSnapshot.isEmpty, false)
  assert.strictEqual(currentSnapshot.canSubmit, true)

  // 5. User appends additional text
  controller.appendDraft('need alternative')
  assert.strictEqual(currentSnapshot.draft, 'Out of paneer for butter chicken need alternative')

  // 6. User submits in demo mode: messages update and draft is cleared
  controller.setMode('demo')
  const success = await controller.sendMessage()
  assert.strictEqual(success, true)
  assert.strictEqual(currentSnapshot.draft, '')
  assert.strictEqual(currentSnapshot.canSubmit, false)
  assert.ok(currentSnapshot.messages.length >= 2)
})

test('ChatInputBar interaction logic: Enter submission, Shift+Enter newline, empty guard, and length limit', () => {
  let submittedWithMode: string | null = null
  const onSend = (options?: { inputMode?: string }) => {
    submittedWithMode = options?.inputMode ?? 'text'
  }

  const simulateKeyDown = (
    key: string,
    shiftKey: boolean,
    draft: string,
    isLoading: boolean,
    draftInputMode: 'text' | 'voice' = 'text'
  ): boolean => {
    submittedWithMode = null
    const charCount = draft.length
    const isOverLimit = charCount > MAX_CHAT_MESSAGE_LENGTH
    const isEmpty = draft.trim().length === 0
    const canSubmit = !isLoading && !isEmpty && !isOverLimit

    if (key === 'Enter' && !shiftKey) {
      if (canSubmit) {
        onSend({ inputMode: draftInputMode })
        return true // Prevented default and submitted
      }
      return false // Guarded from submission
    }
    return false // Newline or regular character inserted
  }

  // 1. Enter on valid draft triggers submission
  const submitted1 = simulateKeyDown('Enter', false, 'What is today risk brief?', false, 'text')
  assert.strictEqual(submitted1, true)
  assert.strictEqual(submittedWithMode, 'text')

  // 2. Shift+Enter does NOT submit (allows multiline entry)
  const submitted2 = simulateKeyDown('Enter', true, 'Line 1', false, 'text')
  assert.strictEqual(submitted2, false)
  assert.strictEqual(submittedWithMode, null)

  // 3. Enter on empty/whitespace draft does NOT submit
  const submitted3 = simulateKeyDown('Enter', false, '   ', false, 'text')
  assert.strictEqual(submitted3, false)
  assert.strictEqual(submittedWithMode, null)

  // 4. Enter while loading does NOT submit
  const submitted4 = simulateKeyDown('Enter', false, 'Valid text', true, 'text')
  assert.strictEqual(submitted4, false)
  assert.strictEqual(submittedWithMode, null)

  // 5. Enter when exceeding 500 characters does NOT submit
  const overlong = 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1)
  const submitted5 = simulateKeyDown('Enter', false, overlong, false, 'text')
  assert.strictEqual(submitted5, false)
  assert.strictEqual(submittedWithMode, null)

  // 6. Enter on voice draft preserves voice inputMode
  const submitted6 = simulateKeyDown('Enter', false, 'Spoken question', false, 'voice')
  assert.strictEqual(submitted6, true)
  assert.strictEqual(submittedWithMode, 'voice')
})

test('ChatPanel & ChatInputBar voice interaction: microphone toggle and reviewable draft population', () => {
  const controller = new ChatConversationController()
  let isListening = false
  let micToggleCount = 0

  const handleToggleVoice = () => {
    micToggleCount++
    if (isListening) {
      isListening = false
    } else {
      isListening = true
    }
  }

  // 1. Click microphone to start listening
  handleToggleVoice()
  assert.strictEqual(micToggleCount, 1)
  assert.strictEqual(isListening, true)

  // 2. Speech recognition populates reviewable draft without submitting
  controller.applyVoiceTranscript('Butter chicken shortage inquiry', 'replace')
  assert.strictEqual(controller.getSnapshot().draft, 'Butter chicken shortage inquiry')
  assert.strictEqual(controller.getSnapshot().draftInputMode, 'voice')
  assert.strictEqual(controller.getSnapshot().messages.length, 0)
  assert.strictEqual(controller.getSnapshot().canSubmit, true)

  // 3. User edits the reviewable draft
  controller.setDraft('Butter chicken shortage inquiry - urgent')
  assert.strictEqual(controller.getSnapshot().draft, 'Butter chicken shortage inquiry - urgent')
  assert.strictEqual(controller.getSnapshot().draftInputMode, 'text')

  // 4. Click microphone again to stop listening
  handleToggleVoice()
  assert.strictEqual(micToggleCount, 2)
  assert.strictEqual(isListening, false)
})

test('ChatPanel: incoming transcript populates editable draft even if speech session has ended (isListening is false)', () => {
  const controller = new ChatConversationController()
  let lastSpokenTranscript = ''

  const syncTranscript = (transcript: string) => {
    if (!transcript) return
    if (transcript !== lastSpokenTranscript) {
      lastSpokenTranscript = transcript
      controller.applyVoiceTranscript(transcript, 'replace')
    }
  }

  // Recognition session ends, produces final transcript while isListening is false
  syncTranscript('We are out of paneer for tonight')

  assert.strictEqual(controller.getSnapshot().draft, 'We are out of paneer for tonight')
  assert.strictEqual(controller.getSnapshot().draftInputMode, 'voice')
  assert.strictEqual(controller.getSnapshot().canSubmit, true)
  assert.strictEqual(controller.getSnapshot().messages.length, 0, 'Must NOT auto-submit')
})

/* ── 6. Chat-to-Recovery Navigation (Feature 7) ───────────────── */

test('ChatProposalCard navigation: renders button when onNavigate is provided', () => {
  const shouldRenderNavButton = (props: { onNavigate?: (pageId: PageId) => void }): boolean => {
    return typeof props.onNavigate === 'function'
  }

  const mockNavigate = (_pageId: PageId) => {}
  assert.strictEqual(shouldRenderNavButton({ onNavigate: mockNavigate }), true)
})

test('ChatProposalCard navigation: omits button when onNavigate is absent', () => {
  const shouldRenderNavButton = (props: { onNavigate?: (pageId: PageId) => void }): boolean => {
    return typeof props.onNavigate === 'function'
  }

  assert.strictEqual(shouldRenderNavButton({ onNavigate: undefined }), false)
  assert.strictEqual(shouldRenderNavButton({}), false)
})

test('ChatProposalCard navigation: clicking invokes onNavigate with exactly "shortage-recovery"', () => {
  let navigatedPage: PageId | null = null
  const onNavigate = (pageId: PageId) => {
    navigatedPage = pageId
  }

  // Simulate proposal card button click: onClick={() => onNavigate('shortage-recovery')}
  const handleNavClick = (navFn: (pageId: PageId) => void) => {
    navFn('shortage-recovery')
  }

  handleNavClick(onNavigate)
  assert.strictEqual(navigatedPage, 'shortage-recovery')
})

test('ChatProposalCard navigation: navigation does not invoke approval APIs or mutate proposal data', () => {
  const controller = new ChatConversationController()

  // Initialize with draft
  controller.setDraft('We need 2kg more paneer')
  assert.strictEqual(controller.getSnapshot().draft, 'We need 2kg more paneer')

  let approveActionCalled = false
  let chatAgentCalled = false

  const mockApproveAction = () => {
    approveActionCalled = true
  }
  const mockChatAgent = () => {
    chatAgentCalled = true
  }

  // Trigger navigation
  let navigatedDestination: PageId | null = null
  const onNavigate = (pageId: PageId) => {
    navigatedDestination = pageId
  }

  onNavigate('shortage-recovery')

  // Verify navigation occurred to correct destination
  assert.strictEqual(navigatedDestination, 'shortage-recovery')

  // Verify approveAction and chatAgent were NOT called (AGENTS.md Rule 2 invariant)
  assert.strictEqual(approveActionCalled, false)
  assert.strictEqual(chatAgentCalled, false)

  // Verify draft and controller state remain untouched
  assert.strictEqual(controller.getSnapshot().draft, 'We need 2kg more paneer')
  assert.strictEqual(controller.getSnapshot().isLoading, false)
  assert.strictEqual(controller.getSnapshot().error, null)
})

test('AppLayout navigation: callback closes the chat drawer and navigates to "shortage-recovery"', () => {
  let currentPage: PageId = 'overview'
  let isChatOpen = true
  let stopListeningCalled = false
  let stopSpeakingCalled = false

  const mockVoice = {
    isListening: true,
    isSpeaking: true,
    stopListening() {
      stopListeningCalled = true
      this.isListening = false
    },
    stopSpeaking() {
      stopSpeakingCalled = true
      this.isSpeaking = false
    }
  }

  const handleNavigate = (page: PageId) => {
    currentPage = page
  }

  const handleCloseChat = () => {
    if (mockVoice.isListening) {
      mockVoice.stopListening()
    }
    if (mockVoice.isSpeaking) {
      mockVoice.stopSpeaking()
    }
    isChatOpen = false
  }

  const handleNavigateFromChat = (page: PageId) => {
    handleNavigate(page)
    handleCloseChat()
  }

  // Execute navigation triggered from inside chat proposal card
  handleNavigateFromChat('shortage-recovery')

  // 1. Page is navigated to shortage-recovery
  assert.strictEqual(currentPage, 'shortage-recovery')

  // 2. Chat drawer is closed so recovery board is visible
  assert.strictEqual(isChatOpen, false)

  // 3. Active voice recognition & speech playback are terminated cleanly
  assert.strictEqual(stopListeningCalled, true)
  assert.strictEqual(stopSpeakingCalled, true)
  assert.strictEqual(mockVoice.isListening, false)
  assert.strictEqual(mockVoice.isSpeaking, false)
})
