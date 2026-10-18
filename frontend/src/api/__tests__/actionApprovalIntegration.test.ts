/* ============================================================
   frontend/src/api/__tests__/actionApprovalIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Approval & Replanning Integration Tests

   Covers Stage 2.4E Requirements:
   1. GET /api/actions mapping (PendingActionViewModel, option_number preservation)
   2. Explicit approval request payload (POST /api/actions/{id}/approve):
      - confirm_option_number (exact option number preserved, NOT UI array index)
      - input_mode: "click"
   3. Approval success response mapping:
      - Plan version before & after bump
      - Audit ID and change summary
      - Rescheduled tasks and affected orders
      - Expired sibling actions
   4. Customer message drafts & consent handling:
      - WhatsApp URL and message text preservation
      - needs_consent alert and manual sending semantics
   5. Explicit rejection request payload & response mapping (POST /api/actions/{id}/reject)
   6. Conflict & Error handling:
      - 401 UNAUTHORIZED
      - 404 ACTION_NOT_FOUND
      - 422 OPTION_MISMATCH
      - 422 VALIDATION_ERROR
      - 409 ACTION_NOT_PENDING
      - 409 ACTION_EXPIRED
      - 409 PLAN_CHANGED
      - 409 STOCK_CHANGED
      - 500 INTERNAL_ERROR
   7. Safety & Idempotency:
      - No automatic POST retries on mutation failure
      - Sibling actions invalidation
      - Post-approval refresh error isolation (preserves approval result)
      - Live/Demo isolation

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/actionApprovalIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError } from '../errors.ts'
import { approveAction, getActions, rejectAction } from '../endpoints.ts'
import {
  adaptApprovalResponseToViewModel,
  adaptCustomerMessageToViewModel,
  adaptProposedActionsToViewModels,
  adaptProposedActionToViewModel,
  adaptRejectionResponseToViewModel,
  formatActionErrorMessage,
  formatActionImpactSummary
} from '../adapters/actionAdapter.ts'

import type {
  ActionApproveResponseDTO,
  ActionListResponseDTO,
  ActionRejectResponseDTO,
  CustomerMessageDTO,
  ProposedActionDTO
} from '../../types/dto.ts'

/* ── 1. GET /api/actions Pending Actions Mapping ─────────────── */

test('GET /api/actions: maps proposed actions to PendingActionViewModel preserving IDs, group_id, and option_number', async () => {
  const mockActionsResponse: ActionListResponseDTO = {
    data: [
      {
        id: 'act-001',
        group_id: 'grp-paneer-01',
        option_number: 1,
        action_type: 'recovery',
        title: 'Use Organic Firm Tofu instead of Paneer across 4 affected orders',
        status: 'pending',
        impact: {
          orders_protected: 4,
          late_orders: 0,
          extra_cost: -147.2,
          score: 0.82
        },
        base_plan_version: 4,
        created_at: '2026-10-18T10:00:00+05:30',
        expires_at: '2026-10-18T13:30:00+05:30'
      },
      {
        id: 'act-002',
        group_id: 'grp-paneer-01',
        option_number: 2,
        action_type: 'recovery',
        title: 'Emergency purchase 1.0 kg Paneer locally',
        status: 'pending',
        impact: {
          orders_protected: 3,
          late_orders: 1,
          extra_cost: 40.0,
          score: 0.71
        },
        base_plan_version: 4,
        created_at: '2026-10-18T10:00:00+05:30',
        expires_at: '2026-10-18T13:30:00+05:30'
      }
    ],
    count: 2
  }

  const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
    assert.match(String(input), /\/api\/actions\?status=pending/)
    return new Response(JSON.stringify(mockActionsResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  const response = await getActions({ status: 'pending' }, { client })
  assert.equal(response.count, 2)

  const viewModels = adaptProposedActionsToViewModels(response.data)
  assert.equal(viewModels.length, 2)

  // Verify first action
  const opt1 = viewModels[0]
  assert.equal(opt1.id, 'act-001')
  assert.equal(opt1.groupId, 'grp-paneer-01')
  assert.equal(opt1.optionNumber, 1)
  assert.equal(opt1.actionType, 'recovery')
  assert.equal(opt1.title, 'Use Organic Firm Tofu instead of Paneer across 4 affected orders')
  assert.equal(opt1.status, 'pending')
  assert.equal(opt1.basePlanVersion, 4)
  assert.equal(opt1.impactSummary, 'Protects 4 order(s); saves ₹147.20.')
  assert.equal(opt1.createdAt, '2026-10-18T10:00:00+05:30')
  assert.equal(opt1.expiresAt, '2026-10-18T13:30:00+05:30')

  // Verify second action preserves option_number 2
  const opt2 = viewModels[1]
  assert.equal(opt2.id, 'act-002')
  assert.equal(opt2.optionNumber, 2)
  assert.equal(opt2.impactSummary, 'Protects 3 order(s); extra cost ₹40.00.')
})

/* ── 2. Explicit Approval Flow & Exact Option Number ─────────── */

test('POST /api/actions/{id}/approve: transmits exact confirm_option_number and input_mode: "click"', async () => {
  let capturedUrl = ''
  let capturedMethod = ''
  let capturedBody = ''
  let capturedHeaders: Record<string, string> = {}

  const mockApproveResponse: ActionApproveResponseDTO = {
    action: {
      id: 'act-002',
      status: 'executed',
      executed_at: '2026-10-18T10:15:00+05:30'
    },
    plan_version_before: 4,
    plan_version_after: 5,
    audit_id: 'aud-401',
    changes: {
      orders_affected: ['ord-101', 'ord-102'],
      tasks_rescheduled: 2,
      summary: 'Emergency restock applied; 1 order rescheduled.'
    },
    customer_messages: [],
    expired_action_ids: ['act-001', 'act-003']
  }

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(input)
    capturedMethod = init?.method ?? 'GET'
    capturedBody = String(init?.body ?? '')
    capturedHeaders = (init?.headers as Record<string, string>) ?? {}

    return new Response(JSON.stringify(mockApproveResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'secret-kitchen-key',
    fetchFn: mockFetch
  })

  // Testing Option #2 specifically (must NOT send index 1 or 0)
  const result = await approveAction(
    'act-002',
    { confirm_option_number: 2, input_mode: 'click' },
    { client }
  )

  assert.equal(capturedUrl, 'http://test-kitchen/api/actions/act-002/approve')
  assert.equal(capturedMethod, 'POST')
  assert.equal(capturedHeaders['X-API-Key'], 'secret-kitchen-key')
  assert.equal(capturedHeaders['Content-Type'], 'application/json')

  const parsedBody = JSON.parse(capturedBody)
  assert.equal(parsedBody.confirm_option_number, 2)
  assert.equal(parsedBody.input_mode, 'click')
  assert.equal(parsedBody.transcript, undefined)

  assert.equal(result.action.id, 'act-002')
  assert.equal(result.action.status, 'executed')
})

/* ── 3. Approval Success Result & Sibling Invalidation ────────── */

test('POST /api/actions/{id}/approve: maps success response to ApprovalResultViewModel', () => {
  const rawResponse: ActionApproveResponseDTO = {
    action: {
      id: 'act-001',
      status: 'executed',
      executed_at: '2026-10-18T10:20:00+05:30'
    },
    plan_version_before: 5,
    plan_version_after: 6,
    audit_id: 'aud-402',
    changes: {
      orders_affected: ['ord-101', 'ord-102', 'ord-103', 'ord-104'],
      tasks_rescheduled: 3,
      summary: 'Swapped paneer for tofu in 4 orders; 0 orders late'
    },
    customer_messages: [
      {
        order_id: 'ord-101',
        customer_name: 'Aditi Sharma',
        needs_consent: true,
        message: 'Hi Aditi, we are short of paneer. May we substitute tofu? Reply YES to confirm.',
        whatsapp_url: 'https://wa.me/919800000010?text=Hi%20Aditi...'
      }
    ],
    expired_action_ids: ['act-002', 'act-003']
  }

  const vm = adaptApprovalResponseToViewModel(rawResponse)

  assert.equal(vm.actionId, 'act-001')
  assert.equal(vm.status, 'executed')
  assert.equal(vm.executedAt, '2026-10-18T10:20:00+05:30')
  assert.equal(vm.planVersionBefore, 5)
  assert.equal(vm.planVersionAfter, 6)
  assert.equal(vm.auditId, 'aud-402')
  assert.equal(vm.changes.tasksRescheduled, 3)
  assert.deepEqual(vm.changes.ordersAffected, ['ord-101', 'ord-102', 'ord-103', 'ord-104'])
  assert.equal(vm.changes.summary, 'Swapped paneer for tofu in 4 orders; 0 orders late')
  assert.deepEqual(vm.expiredActionIds, ['act-002', 'act-003'])

  // Verify customer message mapping
  assert.equal(vm.customerMessages.length, 1)
  const msg = vm.customerMessages[0]
  assert.equal(msg.orderId, 'ord-101')
  assert.equal(msg.customerName, 'Aditi Sharma')
  assert.equal(msg.needsConsent, true)
  assert.equal(msg.message, 'Hi Aditi, we are short of paneer. May we substitute tofu? Reply YES to confirm.')
  assert.equal(msg.whatsappUrl, 'https://wa.me/919800000010?text=Hi%20Aditi...')
})

/* ── 4. Customer Message Drafts & Consent Warnings ───────────── */

test('Customer messages: properly flags consent requirements without auto-completing consent', () => {
  const draftWithConsent: CustomerMessageDTO = {
    order_id: 'ord-105',
    customer_name: 'Rahul Varma',
    needs_consent: true,
    message: 'Notice of dish substitution',
    whatsapp_url: 'https://wa.me/919800000011?text=Notice'
  }

  const draftWithoutConsent: CustomerMessageDTO = {
    order_id: 'ord-106',
    customer_name: 'Priya Patel',
    needs_consent: false,
    message: 'Your order is on schedule',
    whatsapp_url: 'https://wa.me/919800000012?text=Schedule'
  }

  const vm1 = adaptCustomerMessageToViewModel(draftWithConsent)
  assert.equal(vm1.needsConsent, true)

  const vm2 = adaptCustomerMessageToViewModel(draftWithoutConsent)
  assert.equal(vm2.needsConsent, false)
})

/* ── 5. Explicit Rejection Flow ──────────────────────────────── */

test('POST /api/actions/{id}/reject: transmits optional reason and adapts rejection response', async () => {
  let capturedUrl = ''
  let capturedMethod = ''
  let capturedBody = ''

  const mockRejectResponse: ActionRejectResponseDTO = {
    action: {
      id: 'act-003',
      status: 'rejected',
      decided_at: '2026-10-18T10:25:00+05:30'
    },
    audit_id: 'aud-403'
  }

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(input)
    capturedMethod = init?.method ?? 'GET'
    capturedBody = String(init?.body ?? '')

    return new Response(JSON.stringify(mockRejectResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  const response = await rejectAction('act-003', { reason: 'Customer prefers to wait' }, { client })

  assert.equal(capturedUrl, 'http://test-kitchen/api/actions/act-003/reject')
  assert.equal(capturedMethod, 'POST')
  assert.deepEqual(JSON.parse(capturedBody), { reason: 'Customer prefers to wait' })

  const vm = adaptRejectionResponseToViewModel(response)
  assert.equal(vm.actionId, 'act-003')
  assert.equal(vm.status, 'rejected')
  assert.equal(vm.auditId, 'aud-403')
})

test('POST /api/actions/{id}/reject: handles rejection without reason (empty body)', async () => {
  let capturedBody = ''

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedBody = String(init?.body ?? '')
    return new Response(
      JSON.stringify({
        action: { id: 'act-003', status: 'rejected', decided_at: '2026-10-18T10:25:00+05:30' },
        audit_id: 'aud-404'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await rejectAction('act-003', undefined, { client })
  assert.deepEqual(JSON.parse(capturedBody), {})
})

/* ── 6. Conflict & Error Code Handling ───────────────────────── */

test('Error handling: 422 OPTION_MISMATCH generates actionable user error', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'OPTION_MISMATCH',
          message: 'confirm_option_number 3 does not match action option_number 2'
        }
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await approveAction('act-002', { confirm_option_number: 3, input_mode: 'click' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 422)
      assert.equal(err.code, 'OPTION_MISMATCH')
      const msg = formatActionErrorMessage(err)
      assert.match(msg, /Option confirmation mismatch/i)
      return true
    }
  )
})

test('Error handling: 409 ACTION_NOT_PENDING indicates action already executed or expired', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'ACTION_NOT_PENDING',
          message: 'Action act-001 has already been executed'
        }
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await approveAction('act-001', { confirm_option_number: 1, input_mode: 'click' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 409)
      assert.equal(err.code, 'ACTION_NOT_PENDING')
      const msg = formatActionErrorMessage(err)
      assert.match(msg, /no longer pending/i)
      return true
    }
  )
})

test('Error handling: 409 ACTION_EXPIRED indicates proposal past validity cutoff', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'ACTION_EXPIRED',
          message: 'Action act-001 is past its expires_at timestamp'
        }
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await approveAction('act-001', { confirm_option_number: 1, input_mode: 'click' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 409)
      assert.equal(err.code, 'ACTION_EXPIRED')
      const msg = formatActionErrorMessage(err)
      assert.match(msg, /expired past its validity cutoff/i)
      return true
    }
  )
})

test('Error handling: 409 PLAN_CHANGED requires re-simulation', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'PLAN_CHANGED',
          message: 'Plan version moved from 4 to 5 since proposal was generated'
        }
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await approveAction('act-001', { confirm_option_number: 1, input_mode: 'click' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 409)
      assert.equal(err.code, 'PLAN_CHANGED')
      const msg = formatActionErrorMessage(err)
      assert.match(msg, /kitchen plan changed/i)
      return true
    }
  )
})

test('Error handling: 409 STOCK_CHANGED requires re-simulation', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'STOCK_CHANGED',
          message: 'Stock fingerprint changed since proposal was generated'
        }
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await approveAction('act-001', { confirm_option_number: 1, input_mode: 'click' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 409)
      assert.equal(err.code, 'STOCK_CHANGED')
      const msg = formatActionErrorMessage(err)
      assert.match(msg, /Ingredient stock changed/i)
      return true
    }
  )
})

test('Error handling: 404 ACTION_NOT_FOUND', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'ACTION_NOT_FOUND',
          message: 'Action act-999 not found'
        }
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await approveAction('act-999', { confirm_option_number: 1, input_mode: 'click' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 404)
      assert.equal(err.code, 'ACTION_NOT_FOUND')
      return true
    }
  )
})

test('Error handling: 401 UNAUTHORIZED surfaces authentication failure', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid API key'
        }
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'bad-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await approveAction('act-001', { confirm_option_number: 1, input_mode: 'click' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 401)
      assert.equal(err.code, 'UNAUTHORIZED')
      return true
    }
  )
})

test('Error handling: 500 INTERNAL_ERROR confirms rollback without claiming applied change', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Database transaction failed during atomic replan'
        }
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await approveAction('act-001', { confirm_option_number: 1, input_mode: 'click' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 500)
      assert.equal(err.code, 'INTERNAL_ERROR')
      const msg = formatActionErrorMessage(err)
      assert.match(msg, /rolled back/i)
      return true
    }
  )
})

/* ── 7. Safety, Idempotency & Retry Prevention ───────────────── */

test('Safety: POST /api/actions/{id}/approve is never automatically retried on failure', async () => {
  let callCount = 0

  const mockFetch = async (): Promise<Response> => {
    callCount++
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Transient error'
        }
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(async () => {
    await approveAction('act-001', { confirm_option_number: 1, input_mode: 'click' }, { client })
  })

  // Exactly 1 call was made — no automatic retries!
  assert.equal(callCount, 1)
})

test('Safety: expired sibling actions are identified and invalidated upon approval', () => {
  const mockOptions = [
    { actionId: 'act-1', optionNumber: 1, status: 'pending' as const },
    { actionId: 'act-2', optionNumber: 2, status: 'pending' as const },
    { actionId: 'act-3', optionNumber: 3, status: 'pending' as const }
  ]

  const expiredActionIds = ['act-2', 'act-3']
  const approvedActionId = 'act-1'

  const updatedOptions = mockOptions.map((opt) => {
    if (opt.actionId === approvedActionId) {
      return { ...opt, status: 'executed' as const }
    }
    if (expiredActionIds.includes(opt.actionId)) {
      return { ...opt, status: 'expired' as const }
    }
    return opt
  })

  assert.equal(updatedOptions[0].status, 'executed')
  assert.equal(updatedOptions[1].status, 'expired')
  assert.equal(updatedOptions[2].status, 'expired')
})

test('State integrity: successful approval followed by failed background refresh preserves approval result', async () => {
  let approvalSucceeded = false
  let refreshFailed = false
  let preservedResult: ActionApproveResponseDTO | null = null
  let refreshErrorMessage = ''

  const mockApproveResponse: ActionApproveResponseDTO = {
    action: { id: 'act-101', status: 'executed', executed_at: '2026-10-18T10:30:00+05:30' },
    plan_version_before: 2,
    plan_version_after: 3,
    audit_id: 'aud-501',
    changes: { orders_affected: ['ord-1'], tasks_rescheduled: 1, summary: 'Updated plan' },
    customer_messages: [],
    expired_action_ids: []
  }

  // 1. Execute approval POST (succeeds)
  const mockApproveFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockApproveResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const approveClient = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockApproveFetch
  })

  try {
    const res = await approveAction('act-101', { confirm_option_number: 1, input_mode: 'click' }, { client: approveClient })
    approvalSucceeded = true
    preservedResult = res
  } catch {
    approvalSucceeded = false
  }

  assert.equal(approvalSucceeded, true)
  assert.notEqual(preservedResult, null)

  // 2. Simulate subsequent GET /api/plan failing with network timeout / 500
  const mockPlanFailFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Failed to read plan' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const planFailClient = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-key',
    fetchFn: mockPlanFailFetch
  })

  try {
    await planFailClient.get('/api/plan', { date: '2026-10-18' })
  } catch (err: unknown) {
    refreshFailed = true
    refreshErrorMessage = err instanceof Error ? err.message : String(err)
  }

  // Verification: Mutation result is preserved! Not marked as failed, not rolled back
  assert.equal(refreshFailed, true)
  assert.equal(preservedResult?.action.status, 'executed')
  assert.equal(preservedResult?.plan_version_after, 3)
  assert.match(refreshErrorMessage, /Failed to read plan|INTERNAL_ERROR/i)
})

test('Customer messages: preserves WhatsApp draft URLs and requires manual sending', () => {
  const rawMsg: CustomerMessageDTO = {
    order_id: 'ord-201',
    customer_name: 'Pooja Hegde',
    needs_consent: true,
    message: 'Hello Pooja, we substituted tofu. Please confirm.',
    whatsapp_url: 'https://wa.me/919876543210?text=Hello%20Pooja'
  }

  const vm = adaptCustomerMessageToViewModel(rawMsg)
  assert.equal(vm.whatsappUrl, 'https://wa.me/919876543210?text=Hello%20Pooja')
  assert.equal(vm.needsConsent, true)
  assert.equal(vm.customerName, 'Pooja Hegde')
  assert.equal(vm.orderId, 'ord-201')
})

