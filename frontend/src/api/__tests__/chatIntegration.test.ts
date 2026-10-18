/* ============================================================
   frontend/src/api/__tests__/chatIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Assistant Chat Integration Tests

   Covers Feature 7 Phase 1 Requirements:
   1. Correct URL (/api/agent/chat) and HTTP method (POST).
   2. Authentication (X-API-Key) through the existing centralized ApiClient.
   3. Valid text and voice request payloads and field preservation.
   4. Validation of empty and over-500-character messages without silent text alteration.
   5. Documented error mappings: 401 UNAUTHORIZED, 422 VALIDATION_ERROR,
      502 AI_UNAVAILABLE, and 500 INTERNAL_ERROR.
   6. No automatic retries after a failed POST request.
   7. Controlled demo data integrity (simulated data source, proposal-only semantics,
      no execution mutations).
   8. Existing API conventions and AbortSignal support remain intact.

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/chatIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError, ConfigurationError, NetworkError } from '../errors.ts'
import { chatAgent } from '../endpoints.ts'
import type { AgentChatRequestDTO, AgentChatResponseDTO } from '../../types/dto.ts'
import {
  DEMO_CHAT_CONVERSATION,
  DEMO_CHAT_METADATA,
  DEMO_CHAT_RESPONSES
} from '../../pages/chat/demoChatData.ts'

/* ── 1. Correct URL and HTTP Method ──────────────────────────── */

test('chatAgent: executes POST request to /api/agent/chat with correct path and method', async () => {
  let capturedUrl = ''
  let capturedMethod = ''

  const mockResponse: AgentChatResponseDTO = {
    reply: 'Kitchen status is normal. 26 orders are scheduled.',
    intent: 'get_brief',
    tool_used: 'get_brief',
    data: { order_count: 26 },
    requires_confirmation: false,
    confirm_phrases: []
  }

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(input)
    capturedMethod = init?.method ?? ''
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-secret-key-123',
    fetchFn: mockFetch
  })

  const result = await chatAgent({ message: 'What is my status?' }, { client })

  assert.strictEqual(capturedMethod, 'POST')
  assert.strictEqual(capturedUrl, 'https://test-api.operai.com/api/agent/chat')
  assert.strictEqual(result.reply, mockResponse.reply)
  assert.strictEqual(result.intent, 'get_brief')
})

/* ── 2. Authentication & Header Conventions ─────────────────── */

test('chatAgent: attaches X-API-Key header and JSON headers per Rest_API_Spec.md §1', async () => {
  let capturedHeaders: Record<string, string> = {}

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedHeaders = (init?.headers as Record<string, string>) ?? {}
    return new Response(
      JSON.stringify({
        reply: 'Standing by.',
        intent: 'unknown',
        tool_used: null,
        data: null,
        requires_confirmation: false,
        confirm_phrases: []
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'my-demo-kitchen-api-key',
    fetchFn: mockFetch
  })

  await chatAgent({ message: 'Hello assistant' }, { client })

  assert.strictEqual(capturedHeaders['X-API-Key'], 'my-demo-kitchen-api-key')
  assert.strictEqual(capturedHeaders['Content-Type'], 'application/json')
  assert.strictEqual(capturedHeaders['Accept'], 'application/json')
})

test('chatAgent: throws ConfigurationError when apiKey is missing on authenticated client', async () => {
  const clientWithoutKey = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: undefined,
    fetchFn: async () => new Response('{}', { status: 200 })
  })

  await assert.rejects(
    async () => {
      await chatAgent({ message: 'Test without key' }, { client: clientWithoutKey })
    },
    (err: unknown) => {
      assert(err instanceof ConfigurationError)
      assert.strictEqual(err.missingKey, 'VITE_API_KEY')
      return true
    }
  )
})

/* ── 3. Valid Text and Voice Payloads ────────────────────────── */

test('chatAgent: accurately transmits voice input_mode and preserves exact message text', async () => {
  let capturedBody = ''

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedBody = String(init?.body ?? '')
    return new Response(
      JSON.stringify(DEMO_CHAT_RESPONSES.recoveryProposal),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const requestPayload: AgentChatRequestDTO = {
    message: 'We are out of paneer',
    input_mode: 'voice'
  }

  const response = await chatAgent(requestPayload, { client })

  const parsedBody = JSON.parse(capturedBody)
  assert.strictEqual(parsedBody.message, 'We are out of paneer')
  assert.strictEqual(parsedBody.input_mode, 'voice')
  assert.strictEqual(response.requires_confirmation, true)
  assert.strictEqual(response.intent, 'report_shortage')
  assert.strictEqual(response.tool_used, 'propose_recovery')
  assert.deepStrictEqual(response.confirm_phrases, [
    'confirm option 1',
    'confirm option 2',
    'confirm option 3'
  ])
})

test('chatAgent: accurately transmits text input_mode and preserves text with special characters', async () => {
  let capturedBody = ''

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedBody = String(init?.body ?? '')
    return new Response(
      JSON.stringify(DEMO_CHAT_RESPONSES.informational),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const messageWithSymbols = 'Brief check: do we have enough paneer & cream for order #104?'
  await chatAgent({ message: messageWithSymbols, input_mode: 'text' }, { client })

  const parsedBody = JSON.parse(capturedBody)
  assert.strictEqual(parsedBody.message, messageWithSymbols)
  assert.strictEqual(parsedBody.input_mode, 'text')
})

test('chatAgent: omits input_mode key when undefined without adding undefined property', async () => {
  let capturedBody = ''

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedBody = String(init?.body ?? '')
    return new Response(
      JSON.stringify(DEMO_CHAT_RESPONSES.informational),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await chatAgent({ message: 'What is my brief?' }, { client })

  const parsedBody = JSON.parse(capturedBody)
  assert.strictEqual(parsedBody.message, 'What is my brief?')
  assert.strictEqual('input_mode' in parsedBody, false)
})

test('chatAgent: accepts boundary valid lengths (1 char and 500 chars) without altering input', async () => {
  let capturedBody = ''

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedBody = String(init?.body ?? '')
    return new Response(
      JSON.stringify({
        reply: 'Acknowledged',
        intent: 'unknown',
        tool_used: null,
        data: null,
        requires_confirmation: false,
        confirm_phrases: []
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  // Boundary 1: single character
  await chatAgent({ message: '?' }, { client })
  assert.strictEqual(JSON.parse(capturedBody).message, '?')

  // Boundary 2: exactly 500 characters
  const message500 = 'x'.repeat(500)
  await chatAgent({ message: message500 }, { client })
  const parsed500 = JSON.parse(capturedBody)
  assert.strictEqual(parsed500.message.length, 500)
  assert.strictEqual(parsed500.message, message500)
})

/* ── 4. Empty and Over-500-Character Validation ─────────────── */

test('chatAgent: rejects empty message string with 422 VALIDATION_ERROR without sending network request', async () => {
  let networkCalls = 0
  const mockFetch = async (): Promise<Response> => {
    networkCalls++
    return new Response('{}', { status: 200 })
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await chatAgent({ message: '' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.strictEqual(err.status, 422)
      assert.strictEqual(err.code, 'VALIDATION_ERROR')
      assert.strictEqual(err.details.field, 'message')
      return true
    }
  )

  assert.strictEqual(networkCalls, 0, 'No network call should be made for empty message')
})

test('chatAgent: rejects message exceeding 500 characters with 422 VALIDATION_ERROR without truncating user text', async () => {
  let networkCalls = 0
  const mockFetch = async (): Promise<Response> => {
    networkCalls++
    return new Response('{}', { status: 200 })
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const overLimitMessage = 'a'.repeat(501)

  await assert.rejects(
    async () => {
      await chatAgent({ message: overLimitMessage }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.strictEqual(err.status, 422)
      assert.strictEqual(err.code, 'VALIDATION_ERROR')
      assert.strictEqual(err.details.length, 501)
      return true
    }
  )

  assert.strictEqual(networkCalls, 0, 'No network call should be made for over-500 message')
})

test('chatAgent: rejects non-string message with 422 VALIDATION_ERROR', async () => {
  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: async () => new Response('{}', { status: 200 })
  })

  await assert.rejects(
    async () => {
      // @ts-expect-error Testing runtime invalid argument
      await chatAgent({ message: null }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.strictEqual(err.status, 422)
      assert.strictEqual(err.code, 'VALIDATION_ERROR')
      return true
    }
  )
})

test('chatAgent: rejects whitespace-only message with 422 VALIDATION_ERROR without sending network request', async () => {
  let networkCalls = 0
  const mockFetch = async (): Promise<Response> => {
    networkCalls++
    return new Response('{}', { status: 200 })
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await chatAgent({ message: '     ' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.strictEqual(err.status, 422)
      assert.strictEqual(err.code, 'VALIDATION_ERROR')
      return true
    }
  )

  assert.strictEqual(networkCalls, 0, 'No network call should be made for whitespace-only message')
})

test('chatAgent: rejects invalid input_mode with 422 VALIDATION_ERROR without sending network request', async () => {
  let networkCalls = 0
  const mockFetch = async (): Promise<Response> => {
    networkCalls++
    return new Response('{}', { status: 200 })
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      // @ts-expect-error Testing runtime invalid argument
      await chatAgent({ message: 'Valid message', input_mode: 'keyboard' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.strictEqual(err.status, 422)
      assert.strictEqual(err.code, 'VALIDATION_ERROR')
      assert.strictEqual(err.details.field, 'input_mode')
      return true
    }
  )

  assert.strictEqual(networkCalls, 0, 'No network call should be made for invalid input_mode')
})

test('chatAgent: preserves leading and trailing spaces in message without silent trimming', async () => {
  let capturedBody = ''

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedBody = String(init?.body ?? '')
    return new Response(
      JSON.stringify(DEMO_CHAT_RESPONSES.informational),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const untrimmedMessage = '  What is my brief?  '
  await chatAgent({ message: untrimmedMessage }, { client })

  const parsedBody = JSON.parse(capturedBody)
  assert.strictEqual(parsedBody.message, untrimmedMessage, 'Message must not be silently trimmed')
})

/* ── 5. Documented Error Mappings ────────────────────────────── */

test('chatAgent: maps 401 UNAUTHORIZED from backend per Rest_API_Spec.md §3.16', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid API key',
          details: {}
        }
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'wrong-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await chatAgent({ message: 'What is my brief?' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.strictEqual(err.status, 401)
      assert.strictEqual(err.code, 'UNAUTHORIZED')
      assert.strictEqual(err.message, 'Missing or invalid API key')
      return true
    }
  )
})

test('chatAgent: maps 422 VALIDATION_ERROR from backend per Rest_API_Spec.md §3.16', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Empty or too long message',
          details: { field: 'message' }
        }
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await chatAgent({ message: 'Valid client length but backend rejected' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.strictEqual(err.status, 422)
      assert.strictEqual(err.code, 'VALIDATION_ERROR')
      return true
    }
  )
})

test('chatAgent: maps 502 AI_UNAVAILABLE when Bedrock is unreachable per Rest_API_Spec.md §3.16', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'AI_UNAVAILABLE',
          message: 'Bedrock unreachable; the direct endpoints above still work',
          details: { provider: 'bedrock', model_id: 'anthropic.claude-v2' }
        }
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await chatAgent({ message: 'We are out of paneer' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.strictEqual(err.status, 502)
      assert.strictEqual(err.code, 'AI_UNAVAILABLE')
      assert.strictEqual(err.message, 'Bedrock unreachable; the direct endpoints above still work')
      assert.strictEqual(err.details.provider, 'bedrock')
      return true
    }
  )
})

test('chatAgent: maps 500 INTERNAL_ERROR on unexpected backend failure per Rest_API_Spec.md §3.16', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Backend failure during chat generation',
          details: {}
        }
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await chatAgent({ message: 'What is my brief?' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.strictEqual(err.status, 500)
      assert.strictEqual(err.code, 'INTERNAL_ERROR')
      return true
    }
  )
})

/* ── 6. No Automatic Retries for POST ───────────────────────── */

test('chatAgent: does NOT automatically retry on network failure or 502 error', async () => {
  let callCount = 0

  const mockFetch = async (): Promise<Response> => {
    callCount++
    return new Response(
      JSON.stringify({
        error: {
          code: 'AI_UNAVAILABLE',
          message: 'Bedrock connection timed out'
        }
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(async () => {
    await chatAgent({ message: 'We are out of paneer' }, { client })
  })

  assert.strictEqual(callCount, 1, 'POST request must NEVER be automatically retried')
})

/* ── 7. Demo Data Integrity & Proposal Semantics ─────────────── */

test('demoChatData: metadata is explicitly labeled as simulated per AGENTS.md rule 9', () => {
  assert.strictEqual(DEMO_CHAT_METADATA.dataSource, 'simulated')
  assert.strictEqual(typeof DEMO_CHAT_METADATA.kitchenName, 'string')
  assert(DEMO_CHAT_METADATA.note.includes('offline demonstration') || DEMO_CHAT_METADATA.note.includes('validation'))
})

test('demoChatData: contains realistic deterministic conversations with informational and recovery flows', () => {
  assert(DEMO_CHAT_CONVERSATION.length >= 4, 'Should contain at least 4 messages (2 exchanges)')

  // Exchange 1: Informational
  const userMsg1 = DEMO_CHAT_CONVERSATION[0]
  const assistantMsg1 = DEMO_CHAT_CONVERSATION[1]
  assert.strictEqual(userMsg1.sender, 'user')
  assert.strictEqual(userMsg1.isSimulated, true)
  assert.strictEqual(assistantMsg1.sender, 'assistant')
  assert.strictEqual(assistantMsg1.intent, 'get_brief')
  assert.strictEqual(assistantMsg1.toolUsed, 'get_brief')
  assert.strictEqual(assistantMsg1.requiresConfirmation, false)
  assert.strictEqual(assistantMsg1.isSimulated, true)

  // Exchange 2: Recovery Proposal
  const userMsg2 = DEMO_CHAT_CONVERSATION[2]
  const assistantMsg2 = DEMO_CHAT_CONVERSATION[3]
  assert.strictEqual(userMsg2.sender, 'user')
  assert.strictEqual(userMsg2.isSimulated, true)
  assert.strictEqual(assistantMsg2.sender, 'assistant')
  assert.strictEqual(assistantMsg2.intent, 'report_shortage')
  assert.strictEqual(assistantMsg2.toolUsed, 'propose_recovery')
  assert.strictEqual(assistantMsg2.requiresConfirmation, true)
  assert(assistantMsg2.confirmPhrases && assistantMsg2.confirmPhrases.length > 0)
  assert.strictEqual(assistantMsg2.isSimulated, true)
})

test('demoChatData: recovery proposals remain strictly proposals and never claim execution', () => {
  const proposalResponse = DEMO_CHAT_RESPONSES.recoveryProposal
  assert.strictEqual(proposalResponse.tool_used, 'propose_recovery')
  assert.strictEqual(proposalResponse.requires_confirmation, true)

  // Verifies the payload only contains proposed option identifiers, not executed results
  const data = proposalResponse.data as { group_id: string; option_action_ids: string[] }
  assert(data.group_id.startsWith('grp-'))
  assert(data.option_action_ids.length > 0)

  // Proposals must never be marked executed or approved
  for (const actionId of data.option_action_ids) {
    assert(!actionId.includes('executed'), 'Option action IDs must not imply executed status')
  }
})

test('demoChatData: clarifying unknown response conforms to documented contract', () => {
  const unknownResponse = DEMO_CHAT_RESPONSES.clarifyingUnknown
  assert.strictEqual(unknownResponse.intent, 'unknown')
  assert.strictEqual(unknownResponse.tool_used, null)
  assert.strictEqual(unknownResponse.requires_confirmation, false)
  assert.deepStrictEqual(unknownResponse.confirm_phrases, [])
})

/* ── 8. Existing Conventions & AbortSignal Support ──────────── */

test('chatAgent: supports cancellation via AbortSignal', async () => {
  const controller = new AbortController()

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const promise = chatAgent({ message: 'Take your time' }, { client, signal: controller.signal })
  controller.abort()

  await assert.rejects(
    async () => {
      await promise
    },
    (err: unknown) => {
      assert(err instanceof NetworkError)
      assert.strictEqual(err.isAborted, true)
      return true
    }
  )
})
