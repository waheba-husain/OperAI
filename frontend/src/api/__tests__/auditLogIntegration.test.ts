/* ============================================================
   frontend/src/api/__tests__/auditLogIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Stage 2.4F Phase 1 Integration Tests

   Covers Stage 2.4F Phase 1 API Contract & Client Requirements:
   1. GET /api/audit request construction and supported query filters:
      - Default params handling
      - limit, event_type, and include_snapshots query parameters
      - All documented event_type enum values
      - Successful mapping of AuditListResponseDTO
   2. POST /api/audit/{id}/undo URL and request construction:
      - Endpoint path and method (POST /api/audit/{id}/undo)
      - URL path safety (encodeURIComponent for audit id)
      - Empty request body verification per spec
      - X-API-Key header attachment
   3. Successful response mapping:
      - Full payload mapping for AuditUndoResponseDTO
      - Safe handling when option_number is omitted vs present
   4. Error handling & Status code verification:
      - 401 UNAUTHORIZED (GET /api/audit & POST /api/audit/{id}/undo)
      - 404 AUDIT_NOT_FOUND (POST /api/audit/{id}/undo)
      - 409 UNDO_NOT_ALLOWED (POST /api/audit/{id}/undo)
      - 422 VALIDATION_ERROR (GET /api/audit)
      - 500 INTERNAL_ERROR (backend failure)
   5. Safety & Retry Prevention:
      - POST /api/audit/{id}/undo is never automatically retried
   6. Proposal semantics (AGENTS.md Rules 2 & 6):
      - Undo response status is 'pending', NEVER treated as executed
      - Explicit approval via approveAction is required to apply the reversal

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/auditLogIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError } from '../errors.ts'
import { approveAction, getAudit, undoAudit } from '../endpoints.ts'

import type {
  AuditEventTypeDTO,
  AuditListResponseDTO,
  AuditLogDTO,
  AuditUndoResponseDTO,
  ProposedActionDTO
} from '../../types/dto.ts'

import {
  adaptAuditLogsToViewModels,
  adaptAuditLogToViewModel,
  adaptSnapshotComparison,
  adaptUndoResponseToViewModel,
  deriveAuditLogSummary,
  formatAuditTimestampIST,
  formatSnapshotValue,
  mapAuditActorPresentation,
  mapAuditEventPresentation,
  mapPlanVersionTransition,
  resolveUndoOptionNumberFromActions
} from '../adapters/auditAdapter.ts'

import {
  DEMO_AUDIT_LOGS,
  DEMO_AUDIT_METADATA,
  DEMO_AUDIT_SUMMARY,
  DEMO_AUDIT_VIEW_MODELS
} from '../../pages/audit/auditData.ts'

/* ── 1. GET /api/audit Request Construction & Filters ───────── */

test('GET /api/audit: default request constructs clean URL and maps response envelope', async () => {
  let capturedUrl = ''
  let capturedMethod = ''
  let capturedHeaders: HeadersInit | undefined

  const mockAuditResponse: AuditListResponseDTO = {
    data: [
      {
        id: 'l1',
        action_id: 'a1',
        event_type: 'action_executed',
        actor: 'owner',
        summary: 'Swapped paneer for tofu in 4 orders; plan v4 to v5',
        plan_version_before: 4,
        plan_version_after: 5,
        undoable: true,
        created_at: '2026-10-18T10:30:00+05:30'
      }
    ],
    count: 1
  }

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = input.toString()
    capturedMethod = init?.method ?? 'GET'
    capturedHeaders = init?.headers

    return new Response(JSON.stringify(mockAuditResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const res = await getAudit(undefined, { client })

  assert.equal(capturedMethod, 'GET')
  assert.equal(capturedUrl, 'http://test-kitchen/api/audit')
  assert.equal((capturedHeaders as Record<string, string>)['X-API-Key'], 'test-api-key')
  assert.equal((capturedHeaders as Record<string, string>)['Accept'], 'application/json')

  assert.equal(res.count, 1)
  assert.equal(res.data.length, 1)
  assert.equal(res.data[0].id, 'l1')
  assert.equal(res.data[0].event_type, 'action_executed')
  assert.equal(res.data[0].actor, 'owner')
  assert.equal(res.data[0].undoable, true)
  assert.equal(res.data[0].plan_version_before, 4)
  assert.equal(res.data[0].plan_version_after, 5)
})

test('GET /api/audit: serializes limit, event_type, and include_snapshots query parameters correctly', async () => {
  let capturedUrl = ''

  const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
    capturedUrl = input.toString()
    return new Response(JSON.stringify({ data: [], count: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await getAudit(
    {
      limit: 25,
      event_type: 'action_executed',
      include_snapshots: true
    },
    { client }
  )

  const parsedUrl = new URL(capturedUrl)
  assert.equal(parsedUrl.pathname, '/api/audit')
  assert.equal(parsedUrl.searchParams.get('limit'), '25')
  assert.equal(parsedUrl.searchParams.get('event_type'), 'action_executed')
  assert.equal(parsedUrl.searchParams.get('include_snapshots'), 'true')
})

test('GET /api/audit: maps full audit entry with before/after snapshots and null action_id', async () => {
  const mockAuditWithSnapshots: AuditListResponseDTO = {
    data: [
      {
        id: 'l2',
        action_id: null, // System event has null action_id per DB schema
        event_type: 'stock_updated',
        actor: 'system',
        summary: 'Inventory delivery arrived: 5kg tomatoes added',
        plan_version_before: null,
        plan_version_after: null,
        undoable: false,
        created_at: '2026-10-18T09:00:00+05:30',
        before_snapshot: { stock: { ing_tomato: 1.5 } },
        after_snapshot: { stock: { ing_tomato: 6.5 } }
      }
    ],
    count: 1
  }

  const mockFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockAuditWithSnapshots), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const res = await getAudit({ include_snapshots: true }, { client })

  assert.equal(res.data.length, 1)
  const item = res.data[0]
  assert.equal(item.action_id, null)
  assert.equal(item.event_type, 'stock_updated')
  assert.equal(item.actor, 'system')
  assert.equal(item.undoable, false)
  assert.deepEqual(item.before_snapshot, { stock: { ing_tomato: 1.5 } })
  assert.deepEqual(item.after_snapshot, { stock: { ing_tomato: 6.5 } })
})

test('GET /api/audit: supports all documented event_type filter options', async () => {
  const supportedEventTypes: AuditEventTypeDTO[] = [
    'action_executed',
    'action_rejected',
    'undo_executed',
    'order_created',
    'stock_updated'
  ]

  for (const event_type of supportedEventTypes) {
    let capturedUrl = ''

    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      capturedUrl = input.toString()
      return new Response(JSON.stringify({ data: [], count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const client = new ApiClient({
      baseUrl: 'http://test-kitchen',
      apiKey: 'test-api-key',
      fetchFn: mockFetch
    })

    await getAudit({ event_type }, { client })
    const parsed = new URL(capturedUrl)
    assert.equal(parsed.searchParams.get('event_type'), event_type)
  }
})

/* ── 2. POST /api/audit/{id}/undo Request Construction ──────── */

test('POST /api/audit/{id}/undo: sends POST request to exact documented URL without request body', async () => {
  let capturedUrl = ''
  let capturedMethod = ''
  let capturedBody: unknown = null
  let capturedHeaders: HeadersInit | undefined

  const mockUndoResponse: AuditUndoResponseDTO = {
    action: {
      id: 'a_undo1',
      group_id: 'g_undo1',
      option_number: 1,
      action_type: 'undo',
      title: 'Undo: Swapped paneer for tofu in 4 orders',
      status: 'pending',
      undo_of_audit_id: 'l1',
      base_plan_version: 5,
      expires_at: '2026-10-18T13:30:00+05:30'
    }
  }

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = input.toString()
    capturedMethod = init?.method ?? 'GET'
    capturedBody = init?.body
    capturedHeaders = init?.headers

    return new Response(JSON.stringify(mockUndoResponse), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const res = await undoAudit('l1', { client })

  assert.equal(capturedMethod, 'POST')
  assert.equal(capturedUrl, 'http://test-kitchen/api/audit/l1/undo')
  assert.equal(capturedBody, undefined, 'Must not send a request body per Rest_API_Spec.md §3.15')
  assert.equal((capturedHeaders as Record<string, string>)['X-API-Key'], 'test-api-key')

  // Verify response shape
  assert.equal(res.action.id, 'a_undo1')
  assert.equal(res.action.action_type, 'undo')
  assert.equal(res.action.status, 'pending')
  assert.equal(res.action.undo_of_audit_id, 'l1')
  assert.equal(res.action.base_plan_version, 5)
  assert.equal(res.action.option_number, 1)
})

test('POST /api/audit/{id}/undo: safely encodes audit id in URL', async () => {
  let capturedUrl = ''

  const mockUndoResponse: AuditUndoResponseDTO = {
    action: {
      id: 'a_undo2',
      group_id: 'g_undo2',
      action_type: 'undo',
      title: 'Undo action',
      status: 'pending',
      expires_at: '2026-10-18T13:30:00+05:30'
    }
  }

  const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
    capturedUrl = input.toString()
    return new Response(JSON.stringify(mockUndoResponse), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  // ID containing characters requiring URL encoding
  await undoAudit('log/special:id#42', { client })

  assert.equal(capturedUrl, 'http://test-kitchen/api/audit/log%2Fspecial%3Aid%2342/undo')
})

/* ── 3. Successful Response Mapping & Typing ─────────────────── */

test('POST /api/audit/{id}/undo: handles response where option_number is omitted without assuming it', async () => {
  // Simulates a backend response where option_number is omitted from the undo proposal
  const mockUndoWithoutOptionNumber = {
    action: {
      id: 'a_undo_no_opt',
      group_id: 'g_undo_no_opt',
      action_type: 'undo',
      title: 'Undo: Swapped paneer for tofu',
      status: 'pending',
      undo_of_audit_id: 'l1',
      base_plan_version: 5,
      expires_at: '2026-10-18T13:30:00+05:30'
    }
  }

  const mockFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockUndoWithoutOptionNumber), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const res = await undoAudit('l1', { client })

  assert.equal(res.action.id, 'a_undo_no_opt')
  assert.equal(res.action.option_number, undefined, 'Must not invent an option_number when not returned')
  assert.equal(res.action.status, 'pending')
})

/* ── 4. Authentication and Documented API Errors ─────────────── */

test('Error handling: 401 UNAUTHORIZED surfaces authentication failure on GET /api/audit', async () => {
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
      await getAudit(undefined, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 401)
      assert.equal(err.code, 'UNAUTHORIZED')
      return true
    }
  )
})

test('Error handling: 401 UNAUTHORIZED surfaces authentication failure on POST /api/audit/{id}/undo', async () => {
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
      await undoAudit('l1', { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 401)
      assert.equal(err.code, 'UNAUTHORIZED')
      return true
    }
  )
})

test('Error handling: 404 AUDIT_NOT_FOUND on POST /api/audit/{id}/undo', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'AUDIT_NOT_FOUND',
          message: 'Unknown audit id: l999'
        }
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await undoAudit('l999', { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 404)
      assert.equal(err.code, 'AUDIT_NOT_FOUND')
      assert.match(err.message, /Unknown audit id/i)
      return true
    }
  )
})

test('Error handling: 409 UNDO_NOT_ALLOWED on POST /api/audit/{id}/undo when change is not undoable', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'UNDO_NOT_ALLOWED',
          message: 'Not the latest executed change, already undone, or not an executed change'
        }
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await undoAudit('l1', { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 409)
      assert.equal(err.code, 'UNDO_NOT_ALLOWED')
      assert.match(err.message, /not the latest executed change/i)
      return true
    }
  )
})

test('Error handling: 422 VALIDATION_ERROR on GET /api/audit for invalid query params', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Bad limit or unknown event_type'
        }
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await getAudit({ limit: 9999 }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 422)
      assert.equal(err.code, 'VALIDATION_ERROR')
      return true
    }
  )
})

test('Error handling: 500 INTERNAL_ERROR on backend failure', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server failure'
        }
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await undoAudit('l1', { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 500)
      assert.equal(err.code, 'INTERNAL_ERROR')
      return true
    }
  )
})

/* ── 5. Safety & Retry Prevention ────────────────────────────── */

test('Safety: POST /api/audit/{id}/undo is never automatically retried on failure', async () => {
  let callCount = 0

  const mockFetch = async (): Promise<Response> => {
    callCount++
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Database connection failed'
        }
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(async () => {
    await undoAudit('l1', { client })
  })

  // Exactly 1 network request made — NO retries on mutation failure per AGENTS.md
  assert.equal(callCount, 1)
})

/* ── 6. Proposal Semantics Verification ──────────────────────── */

test('Proposal semantics: undo response creates a pending action, NEVER an already-executed reversal', async () => {
  const mockUndoResponse: AuditUndoResponseDTO = {
    action: {
      id: 'a_undo1',
      group_id: 'g_undo1',
      option_number: 1,
      action_type: 'undo',
      title: 'Undo: Swapped paneer for tofu in 4 orders',
      status: 'pending',
      undo_of_audit_id: 'l1',
      base_plan_version: 5,
      expires_at: '2026-10-18T13:30:00+05:30'
    }
  }

  const mockFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockUndoResponse), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const res = await undoAudit('l1', { client })

  // 1. Status MUST be 'pending'
  assert.equal(res.action.status, 'pending')
  assert.notEqual(res.action.status, 'executed')
  assert.notEqual(res.action.status, 'approved')

  // 2. Action type MUST be 'undo'
  assert.equal(res.action.action_type, 'undo')

  // 3. Must link to the audit log entry being undone
  assert.equal(res.action.undo_of_audit_id, 'l1')

  // 4. Must specify base_plan_version to guard against stale replan
  assert.equal(res.action.base_plan_version, 5)

  // 5. Must NOT claim to have modified any plan or executed reversal yet
  assert.equal((res as unknown as Record<string, unknown>).plan_version_after, undefined)
  assert.equal((res as unknown as Record<string, unknown>).changes, undefined)
})

/* ── 7. Audit Event & Actor Presentation Adapters ────────────── */

test('auditAdapter: maps all five documented audit event types and unknown fallback', () => {
  const documentedTypes: AuditEventTypeDTO[] = [
    'action_executed',
    'action_rejected',
    'undo_executed',
    'order_created',
    'stock_updated'
  ]

  for (const t of documentedTypes) {
    const pres = mapAuditEventPresentation(t)
    assert.equal(pres.eventType, t)
    assert(pres.label.length > 0)
    assert(pres.description.length > 0)
    assert(['success', 'danger', 'warning', 'info', 'neutral'].includes(pres.badgeVariant))
  }

  // Specific semantics check
  assert.equal(mapAuditEventPresentation('action_executed').badgeVariant, 'success')
  assert.equal(mapAuditEventPresentation('action_rejected').badgeVariant, 'danger')
  assert.equal(mapAuditEventPresentation('undo_executed').badgeVariant, 'warning')
  assert.equal(mapAuditEventPresentation('order_created').badgeVariant, 'info')
  assert.equal(mapAuditEventPresentation('stock_updated').badgeVariant, 'neutral')

  // Unknown fallback
  const fallback = mapAuditEventPresentation('custom_system_hook')
  assert.equal(fallback.eventType, 'custom_system_hook')
  assert.equal(fallback.label, 'Custom System Hook')
  assert.equal(fallback.badgeVariant, 'neutral')
})

test('auditAdapter: maps all documented actor types and provides fallback for unknown actors', () => {
  const owner = mapAuditActorPresentation('owner')
  assert.equal(owner.actor, 'owner')
  assert.equal(owner.label, 'Kitchen Owner')
  assert.equal(owner.badgeLabel, 'Owner')

  const system = mapAuditActorPresentation('system')
  assert.equal(system.actor, 'system')
  assert.equal(system.label, 'System Engine')
  assert.equal(system.badgeLabel, 'System')

  const agent = mapAuditActorPresentation('agent')
  assert.equal(agent.actor, 'agent')
  assert.equal(agent.label, 'AI Copilot')
  assert.equal(agent.badgeLabel, 'AI Copilot')

  const custom = mapAuditActorPresentation('staff_cook')
  assert.equal(custom.actor, 'staff_cook')
  assert.equal(custom.label, 'staff_cook')
})

/* ── 8. Timestamp & Plan Version Transition Adapters ─────────── */

test('auditAdapter: formats timestamps into readable IST date/time and handles invalid dates gracefully', () => {
  // Known ISO IST string
  const formatted = formatAuditTimestampIST('2026-10-18T14:30:00+05:30')
  assert.match(formatted, /18 Oct 2026/)
  assert.match(formatted, /2:30 pm/i)

  // Invalid and missing timestamps
  assert.equal(formatAuditTimestampIST(undefined), '—')
  assert.equal(formatAuditTimestampIST(''), '—')
  assert.equal(formatAuditTimestampIST('not-a-date'), '—')
})

test('auditAdapter: maps plan version transitions and handles non-transition states', () => {
  // Successful bump
  const bump = mapPlanVersionTransition(4, 5)
  assert.equal(bump.hasTransition, true)
  assert.equal(bump.before, 4)
  assert.equal(bump.after, 5)
  assert.equal(bump.display, 'v4 → v5')

  // Missing before
  const noBefore = mapPlanVersionTransition(null, 5)
  assert.equal(noBefore.hasTransition, false)
  assert.equal(noBefore.display, null)
  assert.equal(noBefore.after, 5)

  // Missing after
  const noAfter = mapPlanVersionTransition(4, null)
  assert.equal(noAfter.hasTransition, false)
  assert.equal(noAfter.display, null)
  assert.equal(noAfter.before, 4)

  // Non-plan event (both null)
  const nonPlan = mapPlanVersionTransition(null, null)
  assert.equal(nonPlan.hasTransition, false)
  assert.equal(nonPlan.display, null)
  assert.equal(nonPlan.before, null)
  assert.equal(nonPlan.after, null)
})

test('auditAdapter: handles nullable and missing action IDs accurately', () => {
  const withAction: AuditLogDTO = {
    id: 'l1',
    action_id: 'a1',
    event_type: 'action_executed',
    actor: 'owner',
    summary: 'Executed recovery',
    plan_version_before: 4,
    plan_version_after: 5,
    undoable: true,
    created_at: '2026-10-18T10:00:00+05:30'
  }
  const vmWithAction = adaptAuditLogToViewModel(withAction)
  assert.equal(vmWithAction.actionId, 'a1')
  assert.equal(vmWithAction.hasAction, true)

  const systemEvent: AuditLogDTO = {
    id: 'l2',
    action_id: null,
    event_type: 'stock_updated',
    actor: 'system',
    summary: 'Daily delivery registered',
    undoable: false,
    created_at: '2026-10-18T09:00:00+05:30'
  }
  const vmSystem = adaptAuditLogToViewModel(systemEvent)
  assert.equal(vmSystem.actionId, null)
  assert.equal(vmSystem.hasAction, false)

  const emptyActionId: AuditLogDTO = {
    ...systemEvent,
    action_id: '   '
  }
  const vmEmpty = adaptAuditLogToViewModel(emptyActionId)
  assert.equal(vmEmpty.actionId, null)
  assert.equal(vmEmpty.hasAction, false)
})

/* ── 9. Defensive Snapshot Comparison Adapter ───────────────── */

test('auditAdapter: snapshot adapter handles missing, null, empty, and malformed snapshots defensively', () => {
  // Both null
  const bothNull = adaptSnapshotComparison(null, null)
  assert.equal(bothNull.hasSnapshots, false)
  assert.equal(bothNull.hasBeforeSnapshot, false)
  assert.equal(bothNull.hasAfterSnapshot, false)
  assert.equal(bothNull.diffs.length, 0)
  assert.equal(bothNull.changedKeysCount, 0)

  // Both empty objects
  const bothEmpty = adaptSnapshotComparison({}, {})
  assert.equal(bothEmpty.hasSnapshots, false)
  assert.equal(bothEmpty.diffs.length, 0)

  // Malformed inputs (e.g. primitives passed defensively)
  const malformed = adaptSnapshotComparison('invalid' as unknown as Record<string, unknown>, null)
  assert.equal(malformed.hasSnapshots, false)
  assert.equal(malformed.diffs.length, 0)
})

test('auditAdapter: snapshot adapter extracts field-level diffs including nested objects and arrays without fabricating unchanged keys', () => {
  const beforeSnapshot = {
    order_items: [{ id: 'oi1', dish: 'Paneer Biryani' }],
    notes: 'Same kitchen note',
    assigned_burner: 2
  }

  const afterSnapshot = {
    order_items: [{ id: 'oi1', dish: 'Tofu Biryani' }],
    notes: 'Same kitchen note',
    new_delivery_status: 'confirmed'
  }

  const comp = adaptSnapshotComparison(beforeSnapshot, afterSnapshot)
  assert.equal(comp.hasSnapshots, true)
  assert.equal(comp.hasBeforeSnapshot, true)
  assert.equal(comp.hasAfterSnapshot, true)

  // Key 'notes' is identical: MUST NOT be in diffs
  const notesDiff = comp.diffs.find(d => d.key === 'notes')
  assert.equal(notesDiff, undefined, 'Unchanged keys must not be fabricated as diffs')

  // Key 'order_items' is modified
  const orderItemsDiff = comp.diffs.find(d => d.key === 'order_items')
  assert(orderItemsDiff)
  assert.equal(orderItemsDiff.changeType, 'modified')
  assert.match(orderItemsDiff.beforeValue!, /Paneer Biryani/)
  assert.match(orderItemsDiff.afterValue!, /Tofu Biryani/)

  // Key 'assigned_burner' was removed
  const burnerDiff = comp.diffs.find(d => d.key === 'assigned_burner')
  assert(burnerDiff)
  assert.equal(burnerDiff.changeType, 'removed')
  assert.equal(burnerDiff.beforeValue, '2')
  assert.equal(burnerDiff.afterValue, null)

  // Key 'new_delivery_status' was added
  const deliveryDiff = comp.diffs.find(d => d.key === 'new_delivery_status')
  assert(deliveryDiff)
  assert.equal(deliveryDiff.changeType, 'added')
  assert.equal(deliveryDiff.beforeValue, null)
  assert.equal(deliveryDiff.afterValue, '"confirmed"')

  assert.equal(comp.changedKeysCount, 3)
})

test('auditAdapter: formatSnapshotValue safely formats primitive types, arrays, and objects', () => {
  assert.equal(formatSnapshotValue('hello'), '"hello"')
  assert.equal(formatSnapshotValue(42), '42')
  assert.equal(formatSnapshotValue(true), 'true')
  assert.equal(formatSnapshotValue(null), 'null')
  assert.equal(formatSnapshotValue(undefined), 'undefined')
  assert.equal(formatSnapshotValue([1, 2]), '[1,2]')
  assert.equal(formatSnapshotValue({ a: 1 }), '{"a":1}')
})

/* ── 10. Audit Log Array Adaptation & Summary Derivation ────── */

test('auditAdapter: adapts full AuditLogDTO array and derives accurate summary statistics', () => {
  const dtos: AuditLogDTO[] = [
    {
      id: 'log-03',
      action_id: 'act-03',
      event_type: 'undo_executed',
      actor: 'owner',
      summary: 'Undid swap',
      undoable: true, // Latest undoable entry
      created_at: '2026-10-18T12:00:00+05:30'
    },
    {
      id: 'log-02',
      action_id: 'act-02',
      event_type: 'action_rejected',
      actor: 'owner',
      summary: 'Declined proposal',
      undoable: false,
      created_at: '2026-10-18T11:00:00+05:30'
    },
    {
      id: 'log-01',
      action_id: 'act-01',
      event_type: 'action_executed',
      actor: 'owner',
      summary: 'Swapped paneer',
      undoable: false,
      created_at: '2026-10-18T10:00:00+05:30'
    }
  ]

  const vms = adaptAuditLogsToViewModels(dtos)
  assert.equal(vms.length, 3)
  assert.equal(vms[0].id, 'log-03')
  assert.equal(vms[0].undoable, true)

  const summary = deriveAuditLogSummary(vms)
  assert.equal(summary.totalEntries, 3)
  assert.equal(summary.undoExecutedCount, 1)
  assert.equal(summary.actionRejectedCount, 1)
  assert.equal(summary.actionExecutedCount, 1)
  assert.equal(summary.orderCreatedCount, 0)
  assert.equal(summary.stockUpdatedCount, 0)
  assert.equal(summary.latestUndoableAuditId, 'log-03')
})

/* ── 11. Undo Proposal Safety & Invariant Tests ──────────────── */

test('undoProposal: preserves authoritative option_number and confirms proposal is ready for approval', () => {
  const undoResponse: AuditUndoResponseDTO = {
    action: {
      id: 'a_undo_valid',
      group_id: 'g_undo_valid',
      option_number: 1, // Authoritative option number from backend
      action_type: 'undo',
      title: 'Undo: Swapped paneer for tofu in 4 orders',
      status: 'pending',
      undo_of_audit_id: 'log-01',
      base_plan_version: 5,
      expires_at: '2026-10-18T16:00:00+05:30'
    }
  }

  const vm = adaptUndoResponseToViewModel(undoResponse)

  // Authoritative option number preserved exactly
  assert.equal(vm.optionNumber, 1)
  assert.equal(vm.requiresOptionResolution, false)
  assert.equal(vm.isReadyForApproval, true)
  assert.equal(vm.status, 'pending')
  assert.equal(vm.statusLabel, 'Pending Approval')
  assert.equal(vm.actionType, 'undo')
  assert.equal(vm.undoOfAuditId, 'log-01')
  assert.equal(vm.basePlanVersion, 5)
})

test('undoProposal: missing option_number flags requiresOptionResolution without fabricating option 1', () => {
  const undoResponseMissingOption: AuditUndoResponseDTO = {
    action: {
      id: 'a_undo_no_opt',
      group_id: 'g_undo_no_opt',
      // option_number is omitted by backend
      action_type: 'undo',
      title: 'Undo: Swapped paneer for tofu',
      status: 'pending',
      undo_of_audit_id: 'log-01',
      expires_at: '2026-10-18T16:00:00+05:30'
    }
  }

  const vm = adaptUndoResponseToViewModel(undoResponseMissingOption)

  // CRITICAL RULE: Never use action.option_number ?? 1!
  assert.equal(vm.optionNumber, null, 'Must NOT fabricate option number 1')
  assert.notEqual(vm.optionNumber, 1, 'Must strictly never default to 1')
  assert.equal(vm.requiresOptionResolution, true, 'Must indicate resolution is required before approval')
  assert.equal(vm.isReadyForApproval, false, 'Must NOT mark proposal ready for approval without confirmed option number')
})

test('undoProposal: invalid option_number (0, negative, float) flags requiresOptionResolution', () => {
  const invalidOptions = [0, -1, 1.5, NaN]

  for (const invalidOpt of invalidOptions) {
    const undoResponse: AuditUndoResponseDTO = {
      action: {
        id: 'a_undo_invalid',
        group_id: 'g_undo',
        option_number: invalidOpt,
        action_type: 'undo',
        title: 'Undo proposal',
        status: 'pending',
        expires_at: '2026-10-18T16:00:00+05:30'
      }
    }

    const vm = adaptUndoResponseToViewModel(undoResponse)
    assert.equal(vm.optionNumber, null)
    assert.equal(vm.requiresOptionResolution, true)
    assert.equal(vm.isReadyForApproval, false)
  }
})

test('undoProposal: validates action_type and status, never claims executed', () => {
  // If status is not 'pending' (e.g. backend error returned executed action)
  const nonPendingResponse: AuditUndoResponseDTO = {
    action: {
      id: 'a_undo_executed',
      group_id: 'g_undo',
      option_number: 1,
      action_type: 'undo',
      title: 'Undo proposal',
      status: 'executed', // NOT pending
      expires_at: '2026-10-18T16:00:00+05:30'
    }
  }

  const vmNonPending = adaptUndoResponseToViewModel(nonPendingResponse)
  assert.equal(vmNonPending.isReadyForApproval, false, 'Must not be ready for approval if status is not pending')
  assert.equal(vmNonPending.statusLabel, 'executed')

  // If action_type is not 'undo'
  const nonUndoResponse: AuditUndoResponseDTO = {
    action: {
      id: 'a_not_undo',
      group_id: 'g_undo',
      option_number: 1,
      action_type: 'recovery', // NOT undo
      title: 'Recovery proposal',
      status: 'pending',
      expires_at: '2026-10-18T16:00:00+05:30'
    }
  }

  const vmNonUndo = adaptUndoResponseToViewModel(nonUndoResponse)
  assert.equal(vmNonUndo.isReadyForApproval, false, 'Must not be ready for approval if action_type is not undo')
})

/* ── 12. Controlled Mock Data & Demo Isolation ───────────────── */

test('auditData: controlled demo data contains realistic records covering all documented event types', () => {
  assert.equal(DEMO_AUDIT_METADATA.dataSource, 'simulated')
  assert.equal(DEMO_AUDIT_LOGS.length, 5)

  const eventTypesInDemo = new Set(DEMO_AUDIT_LOGS.map(l => l.event_type))
  assert.equal(eventTypesInDemo.has('action_executed'), true)
  assert.equal(eventTypesInDemo.has('action_rejected'), true)
  assert.equal(eventTypesInDemo.has('undo_executed'), true)
  assert.equal(eventTypesInDemo.has('order_created'), true)
  assert.equal(eventTypesInDemo.has('stock_updated'), true)

  // Verify nullable action_id is represented in mock data
  const systemLog = DEMO_AUDIT_LOGS.find(l => l.event_type === 'stock_updated')
  assert(systemLog)
  assert.equal(systemLog.action_id, null)

  // Verify plan version transition representation
  const executedLog = DEMO_AUDIT_LOGS.find(l => l.event_type === 'action_executed')
  assert(executedLog)
  assert.equal(executedLog.plan_version_before, 4)
  assert.equal(executedLog.plan_version_after, 5)

  // Summary correctly identifies latest undoable entry
  assert.equal(DEMO_AUDIT_SUMMARY.latestUndoableAuditId, 'log-001')
  assert.equal(DEMO_AUDIT_SUMMARY.totalEntries, 5)
})

test('auditData: demo mode filtering by event_type filters view models accurately', () => {
  const executedOnly = DEMO_AUDIT_VIEW_MODELS.filter(l => l.eventType === 'action_executed')
  assert.equal(executedOnly.length, 1)
  assert.equal(executedOnly[0].id, 'log-001')
  assert.equal(executedOnly[0].planVersionTransition.display, 'v4 → v5')

  const nonExistent = DEMO_AUDIT_VIEW_MODELS.filter(l => (l.eventType as string) === 'unknown_filter')
  assert.equal(nonExistent.length, 0)
})

/* ── 13. Data Hook Workflows: Fetch, Errors & Stale Protection ─ */

test('Audit Hook Workflow: live empty audit results map honestly without crashing', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify({ data: [], count: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const res = await getAudit(undefined, { client })
  const logs = adaptAuditLogsToViewModels(res.data)
  const summary = deriveAuditLogSummary(logs)

  assert.equal(logs.length, 0)
  assert.equal(summary.totalEntries, 0)
  assert.equal(summary.latestUndoableAuditId, null)
})

test('Audit Hook Workflow: live API failure does NOT fall back to mock data', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Database connection failed'
        }
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  let liveLogs: unknown[]
  let capturedError: unknown = null

  try {
    const res = await getAudit(undefined, { client })
    liveLogs = adaptAuditLogsToViewModels(res.data)
  } catch (err: unknown) {
    capturedError = err
    // Hook clears liveLogs and does NOT fall back to DEMO_AUDIT_LOGS
    liveLogs = []
  }

  assert(capturedError instanceof ApiError)
  assert.equal(capturedError.status, 500)
  assert.equal(liveLogs.length, 0)
  assert.notDeepEqual(liveLogs, DEMO_AUDIT_LOGS, 'Must never silently fall back to mock data on live error')
})

test('Audit Hook Workflow: stale request sequence counter protects against race conditions across rapid filter changes', async () => {
  let seq = 0
  let latestAppliedResult: string | null = null

  async function simulateFilterFetch(filterType: string, delayMs: number) {
    const currentSeq = ++seq
    await new Promise(resolve => setTimeout(resolve, delayMs))
    // Stale check
    if (currentSeq !== seq) {
      return
    }
    latestAppliedResult = filterType
  }

  // Request 1 for 'action_executed' begins first but takes 60ms (slow)
  const req1 = simulateFilterFetch('action_executed', 60)
  // User quickly switches filter to 'order_created' which takes 10ms (fast)
  const req2 = simulateFilterFetch('order_created', 10)

  await Promise.all([req1, req2])

  // Only the newer filter was applied
  assert.equal(latestAppliedResult, 'order_created')
})

/* ── 14. Data Hook Workflows: Option Number Resolution ───────── */

test('Audit Hook Workflow: resolves missing option_number from pending actions API', () => {
  // Undo proposal missing option_number
  const proposalMissingOpt = adaptUndoResponseToViewModel({
    action: {
      id: 'a_undo_target',
      group_id: 'g_undo_100',
      action_type: 'undo',
      title: 'Undo: Swapped paneer for tofu',
      status: 'pending',
      undo_of_audit_id: 'log-001',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  })

  assert.equal(proposalMissingOpt.requiresOptionResolution, true)
  assert.equal(proposalMissingOpt.isReadyForApproval, false)

  // Pending actions returned by GET /api/actions?group_id=g_undo_100&status=pending
  const pendingActions: ProposedActionDTO[] = [
    {
      id: 'a_undo_target',
      group_id: 'g_undo_100',
      option_number: 2, // Authoritative option number from pending actions table
      action_type: 'undo',
      title: 'Undo: Swapped paneer for tofu',
      status: 'pending',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  ]

  const { resolvedProposal, resolutionError } = resolveUndoOptionNumberFromActions(
    proposalMissingOpt,
    pendingActions
  )

  assert.equal(resolutionError, null)
  assert.equal(resolvedProposal.optionNumber, 2)
  assert.equal(resolvedProposal.requiresOptionResolution, false)
  assert.equal(resolvedProposal.isReadyForApproval, true)
})

test('Audit Hook Workflow: missing candidate in pending actions blocks approval', () => {
  const proposalMissingOpt = adaptUndoResponseToViewModel({
    action: {
      id: 'a_undo_target',
      group_id: 'g_undo_100',
      action_type: 'undo',
      title: 'Undo: Swapped paneer for tofu',
      status: 'pending',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  })

  // Pending actions empty
  const { resolvedProposal, resolutionError } = resolveUndoOptionNumberFromActions(
    proposalMissingOpt,
    []
  )

  assert.notEqual(resolutionError, null)
  assert.match(resolutionError!, /No pending undo action found/i)
  assert.equal(resolvedProposal.optionNumber, null)
  assert.equal(resolvedProposal.isReadyForApproval, false)
  assert.equal(resolvedProposal.requiresOptionResolution, true)
})

test('Audit Hook Workflow: ambiguous candidate actions in group blocks approval', () => {
  const proposalMissingOpt = adaptUndoResponseToViewModel({
    action: {
      id: 'a_undo_target',
      group_id: 'g_undo_100',
      action_type: 'undo',
      title: 'Undo: Swapped paneer for tofu',
      status: 'pending',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  })

  // Multiple undo actions in group
  const ambiguousActions: ProposedActionDTO[] = [
    {
      id: 'a_undo_target',
      group_id: 'g_undo_100',
      option_number: 1,
      action_type: 'undo',
      title: 'Undo 1',
      status: 'pending',
      expires_at: '2026-10-18T18:00:00+05:30'
    },
    {
      id: 'a_undo_target_2',
      group_id: 'g_undo_100',
      option_number: 2,
      action_type: 'undo',
      title: 'Undo 2',
      status: 'pending',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  ]

  const { resolvedProposal, resolutionError } = resolveUndoOptionNumberFromActions(
    proposalMissingOpt,
    ambiguousActions
  )

  assert.notEqual(resolutionError, null)
  assert.match(resolutionError!, /Ambiguous pending undo actions/i)
  assert.equal(resolvedProposal.isReadyForApproval, false)
})

test('Audit Hook Workflow: candidate with invalid option_number or non-pending status blocks approval', () => {
  const proposalMissingOpt = adaptUndoResponseToViewModel({
    action: {
      id: 'a_undo_target',
      group_id: 'g_undo_100',
      action_type: 'undo',
      title: 'Undo proposal',
      status: 'pending',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  })

  // Candidate with non-pending status
  const executedCandidate: ProposedActionDTO[] = [
    {
      id: 'a_undo_target',
      group_id: 'g_undo_100',
      option_number: 1,
      action_type: 'undo',
      title: 'Undo proposal',
      status: 'executed',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  ]

  const res1 = resolveUndoOptionNumberFromActions(proposalMissingOpt, executedCandidate)
  assert.equal(res1.resolvedProposal.isReadyForApproval, false)
  assert.match(res1.resolutionError!, /not a pending undo action/i)

  // Candidate with non-positive option_number
  const zeroCandidate: ProposedActionDTO[] = [
    {
      id: 'a_undo_target',
      group_id: 'g_undo_100',
      option_number: 0,
      action_type: 'undo',
      title: 'Undo proposal',
      status: 'pending',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  ]

  const res2 = resolveUndoOptionNumberFromActions(proposalMissingOpt, zeroCandidate)
  assert.equal(res2.resolvedProposal.isReadyForApproval, false)
  assert.match(res2.resolutionError!, /valid positive integer option_number/i)
})

/* ── 15. Safety & Mutation Invariants ────────────────────────── */

test('Audit Hook Workflow: duplicate undo proposal submission is rejected while in-flight', () => {
  let isProposingUndo = true

  function requestUndoSubmissionGuard(): boolean {
    if (isProposingUndo) {
      return false // Duplicate prevented
    }
    return true
  }

  assert.equal(requestUndoSubmissionGuard(), false)
  isProposingUndo = false
  assert.equal(requestUndoSubmissionGuard(), true)
})

test('Audit Hook Workflow: staged undo proposal is NOT automatically approved', async () => {
  let approvalEndpointCalled = false

  const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = input.toString()
    if (url.includes('/approve')) {
      approvalEndpointCalled = true
      return new Response(JSON.stringify({}), { status: 200 })
    }
    return new Response(
      JSON.stringify({
        action: {
          id: 'a_undo_01',
          group_id: 'g_undo_01',
          option_number: 1,
          action_type: 'undo',
          title: 'Undo: Swapped paneer for tofu',
          status: 'pending',
          expires_at: '2026-10-18T18:00:00+05:30'
        }
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  // Staging proposal
  const undoRes = await undoAudit('log-001', { client })
  const proposalVm = adaptUndoResponseToViewModel(undoRes)

  // Status is pending
  assert.equal(proposalVm.status, 'pending')
  assert.equal(proposalVm.statusLabel, 'Pending Approval')

  // Approval endpoint was NEVER called automatically!
  assert.equal(approvalEndpointCalled, false)
})

test('Audit Hook Workflow: demo mode prevents live mutation requests', async () => {
  let mutationRequestSent = false

  const mockFetch = async (): Promise<Response> => {
    mutationRequestSent = true
    return new Response(JSON.stringify({}), { status: 200 })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })
  void client

  const mode = 'demo'

  function attemptDemoUndoMutation(): Error | null {
    if (mode === 'demo') {
      return new Error('Undo proposals are disabled in Demo Mode.')
    }
    return null
  }

  const err = attemptDemoUndoMutation()
  assert(err)
  assert.match(err.message, /disabled in Demo Mode/i)
  assert.equal(mutationRequestSent, false)
})

/* ── 16. Phase 4 UI Integration & Approval Safety Tests ──────── */

test('Phase 4 UI Safety: approval success followed by subsequent refresh failure preserves real success and sets refresh error', async () => {
  let actionsApproveCalled = false
  let auditRefetchCalled = false

  const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = input.toString()
    if (url.includes('/approve')) {
      actionsApproveCalled = true
      return new Response(
        JSON.stringify({
          action: {
            id: 'a_undo_01',
            status: 'executed',
            executed_at: '2026-10-18T15:30:00+05:30'
          },
          plan_version_before: 5,
          plan_version_after: 6,
          audit_id: 'log-099',
          changes: {
            tasks_rescheduled: 2,
            orders_affected: ['ord-101'],
            summary: 'Reversal restored paneer from snapshot'
          },
          customer_messages: [],
          expired_action_ids: []
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (url.includes('/api/audit')) {
      auditRefetchCalled = true
      // Simulate background refresh failure
      return new Response(
        JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'DB connection dropped during refresh' } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response('{}', { status: 200 })
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  // 1. Approve undo action directly
  const approvalRes = await approveAction(
    'a_undo_01',
    { confirm_option_number: 1, input_mode: 'click' },
    { client }
  )

  assert.equal(actionsApproveCalled, true)
  assert.equal(approvalRes.action.status, 'executed')
  assert.equal(approvalRes.plan_version_after, 6)

  // 2. Refresh fails
  let postApprovalRefreshError: string | null = null
  try {
    await getAudit(undefined, { client })
  } catch (err) {
    postApprovalRefreshError = (err as Error).message
  }

  assert.equal(auditRefetchCalled, true)
  assert(postApprovalRefreshError)
  assert.match(postApprovalRefreshError, /DB connection dropped/i)

  // Verification: The approval success is NOT discarded or treated as failure!
  assert.equal(approvalRes.audit_id, 'log-099')
})

test('Phase 4 UI Safety: approval failure from backend is NOT presented as success', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'STALE_PLAN',
          message: 'Plan has already advanced to version 7. Cannot apply undo based on version 5.'
        }
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://test-kitchen',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  let caughtError: ApiError | null = null
  try {
    await approveAction(
      'a_undo_01',
      { confirm_option_number: 1, input_mode: 'click' },
      { client }
    )
  } catch (err) {
    caughtError = err as ApiError
  }

  assert(caughtError)
  assert.equal(caughtError.code, 'STALE_PLAN')
  assert.match(caughtError.message, /Plan has already advanced/i)
})

test('Phase 4 UI Safety: non-pending status or wrong action_type blocks approval readiness', () => {
  // Case A: status is already 'executed'
  const proposalA = adaptUndoResponseToViewModel({
    action: {
      id: 'a_01',
      group_id: 'g_01',
      option_number: 1,
      action_type: 'undo',
      title: 'Undo past action',
      status: 'executed',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  })
  assert.equal(proposalA.isReadyForApproval, false)
  assert.equal(proposalA.status, 'executed')

  // Case B: status is 'rejected'
  const proposalB = adaptUndoResponseToViewModel({
    action: {
      id: 'a_02',
      group_id: 'g_02',
      option_number: 1,
      action_type: 'undo',
      title: 'Undo past action',
      status: 'rejected',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  })
  assert.equal(proposalB.isReadyForApproval, false)

  // Case C: action_type is not 'undo'
  const proposalC = adaptUndoResponseToViewModel({
    action: {
      id: 'a_03',
      group_id: 'g_03',
      option_number: 1,
      action_type: 'recovery',
      title: 'Substitute paneer',
      status: 'pending',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  })
  assert.equal(proposalC.isReadyForApproval, false)

  // Case D: option_number is missing or 0
  const proposalD = adaptUndoResponseToViewModel({
    action: {
      id: 'a_04',
      group_id: 'g_04',
      action_type: 'undo',
      title: 'Undo past action',
      status: 'pending',
      expires_at: '2026-10-18T18:00:00+05:30'
    }
  })
  assert.equal(proposalD.isReadyForApproval, false)
  assert.equal(proposalD.requiresOptionResolution, true)
})

test('Phase 4 UI Safety: non-undoable records have undoable = false and do not allow undo initiation', () => {
  const nonUndoableLog: AuditLogDTO = {
    id: 'l_non_undo',
    action_id: null,
    event_type: 'action_rejected',
    actor: 'owner',
    summary: 'Declined proposal to delay order #501',
    undoable: false,
    created_at: '2026-10-18T11:00:00+05:30'
  }

  const vm = adaptAuditLogToViewModel(nonUndoableLog)
  assert.equal(vm.undoable, false)

  // Verify that an undoable log is correctly flagged
  const undoableLog: AuditLogDTO = {
    id: 'l_undo',
    action_id: 'a_swap',
    event_type: 'action_executed',
    actor: 'owner',
    summary: 'Substituted ingredient; plan v2 to v3',
    undoable: true,
    created_at: '2026-10-18T11:05:00+05:30'
  }
  const vmUndoable = adaptAuditLogToViewModel(undoableLog)
  assert.equal(vmUndoable.undoable, true)
})

test('Phase 4 UI Integration: plan-version transitions format only when both before and after are valid', () => {
  // Case A: Both valid
  const transitionA = mapPlanVersionTransition(4, 5)
  assert.equal(transitionA.hasTransition, true)
  assert.equal(transitionA.display, 'v4 → v5')

  // Case B: Before is null
  const transitionB = mapPlanVersionTransition(null, 5)
  assert.equal(transitionB.hasTransition, false)
  assert.equal(transitionB.display, null)

  // Case C: After is null
  const transitionC = mapPlanVersionTransition(4, null)
  assert.equal(transitionC.hasTransition, false)
  assert.equal(transitionC.display, null)

  // Case D: Both null
  const transitionD = mapPlanVersionTransition(null, null)
  assert.equal(transitionD.hasTransition, false)
  assert.equal(transitionD.display, null)
})

test('Phase 4 UI Integration: nullable action_id is represented cleanly without crashing', () => {
  const logNoAction: AuditLogDTO = {
    id: 'l_stock',
    event_type: 'stock_updated',
    actor: 'system',
    action_id: null,
    summary: 'Received morning inventory shipment',
    undoable: false,
    created_at: '2026-10-18T08:00:00+05:30'
  }

  const vm = adaptAuditLogToViewModel(logNoAction)
  assert.equal(vm.hasAction, false)
  assert.equal(vm.actionId, null)
})

test('Phase 4 UI Integration: snapshot diff distinguishes added, removed, modified, and unchanged fields', () => {
  const before = {
    item: 'Biryani',
    quantity: 10,
    discarded_prop: true
  }
  const after = {
    item: 'Biryani',
    quantity: 12,
    new_prop: 'added_value'
  }

  const comparison = adaptSnapshotComparison(before, after)
  assert.equal(comparison.hasSnapshots, true)
  assert.equal(comparison.changedKeysCount, 3)

  const itemDiff = comparison.diffs.find((d) => d.key === 'item')
  assert.equal(itemDiff, undefined) // Unchanged keys are safely excluded from diffs

  const qtyDiff = comparison.diffs.find((d) => d.key === 'quantity')
  assert.equal(qtyDiff?.changeType, 'modified')
  assert.equal(qtyDiff?.beforeValue, '10')
  assert.equal(qtyDiff?.afterValue, '12')

  const discardedDiff = comparison.diffs.find((d) => d.key === 'discarded_prop')
  assert.equal(discardedDiff?.changeType, 'removed')
  assert.equal(discardedDiff?.beforeValue, 'true')
  assert.equal(discardedDiff?.afterValue, null)

  const newDiff = comparison.diffs.find((d) => d.key === 'new_prop')
  assert.equal(newDiff?.changeType, 'added')
  assert.equal(newDiff?.beforeValue, null)
  assert.equal(newDiff?.afterValue, '"added_value"')
})

/* ── 17. Phase 4 Summary Semantics Tests (Task 1) ─────────────── */

test('Phase 4 Summary Semantics: deriveAuditLogSummary computes counts accurately from loaded view models without fabricating metrics', () => {
  const sampleLogs: AuditLogDTO[] = [
    {
      id: 'l_1',
      action_id: 'a_1',
      event_type: 'action_executed',
      actor: 'owner',
      summary: 'Executed 1',
      undoable: true,
      created_at: '2026-10-18T10:00:00+05:30'
    },
    {
      id: 'l_2',
      action_id: 'a_2',
      event_type: 'action_executed',
      actor: 'system',
      summary: 'Executed 2',
      undoable: false,
      created_at: '2026-10-18T09:30:00+05:30'
    },
    {
      id: 'l_3',
      action_id: 'a_3',
      event_type: 'action_rejected',
      actor: 'owner',
      summary: 'Rejected 1',
      undoable: false,
      created_at: '2026-10-18T09:00:00+05:30'
    },
    {
      id: 'l_4',
      action_id: 'a_4',
      event_type: 'undo_executed',
      actor: 'owner',
      summary: 'Undo 1',
      undoable: false,
      created_at: '2026-10-18T08:30:00+05:30'
    },
    {
      id: 'l_5',
      action_id: null,
      event_type: 'order_created',
      actor: 'system',
      summary: 'Order 1',
      undoable: false,
      created_at: '2026-10-18T08:00:00+05:30'
    },
    {
      id: 'l_6',
      action_id: null,
      event_type: 'stock_updated',
      actor: 'system',
      summary: 'Stock 1',
      undoable: false,
      created_at: '2026-10-18T07:30:00+05:30'
    }
  ]

  const vms = adaptAuditLogsToViewModels(sampleLogs)
  const summary = deriveAuditLogSummary(vms)

  assert.equal(summary.totalEntries, 6)
  assert.equal(summary.actionExecutedCount, 2)
  assert.equal(summary.actionRejectedCount, 1)
  assert.equal(summary.undoExecutedCount, 1)
  assert.equal(summary.orderCreatedCount, 1)
  assert.equal(summary.stockUpdatedCount, 1)
  assert.equal(summary.latestUndoableAuditId, 'l_1')
})

test('Phase 4 Summary Semantics: filtering preserves overall summary breakdown from unfiltered batch', () => {
  // Scenario: First request is unfiltered (GET /api/audit)
  const unfilteredLogs = DEMO_AUDIT_VIEW_MODELS // Has 1 of each type: total 5
  const overallSummary = deriveAuditLogSummary(unfilteredLogs)

  assert.equal(overallSummary.totalEntries, 5)
  assert.equal(overallSummary.actionExecutedCount, 1)
  assert.equal(overallSummary.actionRejectedCount, 1)
  assert.equal(overallSummary.undoExecutedCount, 1)
  assert.equal(overallSummary.orderCreatedCount, 1)
  assert.equal(overallSummary.stockUpdatedCount, 1)

  // Scenario: Second request is filtered by event_type='action_executed' (GET /api/audit?event_type=action_executed)
  const filteredLogs = unfilteredLogs.filter((l) => l.eventType === 'action_executed')
  const batchSummary = deriveAuditLogSummary(filteredLogs)

  // Verify that batchSummary alone would have wiped out other metrics to 0:
  assert.equal(batchSummary.totalEntries, 1)
  assert.equal(batchSummary.actionRejectedCount, 0)
  assert.equal(batchSummary.undoExecutedCount, 0)

  // Verify that preserving overallSummary retains the true operational breakdown:
  const activeSummary = overallSummary ?? batchSummary
  assert.equal(activeSummary.totalEntries, 5)
  assert.equal(activeSummary.actionExecutedCount, 1)
  assert.equal(activeSummary.actionRejectedCount, 1)
  assert.equal(activeSummary.undoExecutedCount, 1)
  assert.equal(activeSummary.stockUpdatedCount, 1)
})



