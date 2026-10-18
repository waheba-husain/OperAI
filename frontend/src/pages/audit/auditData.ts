/* ============================================================
   frontend/src/pages/audit/auditData.ts
   Illustrative demo data for the OperAI Audit Log page.

   DATA INTEGRITY (per AGENTS.md rule 9):
   data_source = 'simulated' — these values are realistic kitchen
   audit trail benchmarks for offline demonstration only.
   ============================================================ */

import type { AuditLogDTO } from '../../types/dto.ts'
import type { AuditLogSummary, AuditLogViewModel } from '../../types/audit.ts'
import {
  adaptAuditLogsToViewModels,
  deriveAuditLogSummary
} from '../../api/adapters/auditAdapter.ts'

export const DEMO_AUDIT_METADATA = {
  dataSource: 'simulated',
  kitchenName: 'Cloud Kitchen Central #04',
  note: 'Simulated kitchen audit trail and snapshot history for offline demonstration.'
} as const

/**
 * Controlled mock audit records representing all five documented event types,
 * plan version transitions, nullable action IDs, and snapshot availability.
 */
export const DEMO_AUDIT_LOGS: readonly AuditLogDTO[] = [
  {
    id: 'log-001',
    action_id: 'act-001',
    event_type: 'action_executed',
    actor: 'owner',
    summary: 'Swapped paneer for organic firm tofu in 4 affected orders; plan v4 to v5',
    plan_version_before: 4,
    plan_version_after: 5,
    undoable: true, // Most recent executed change eligible for undo
    created_at: '2026-10-18T13:30:00+05:30',
    before_snapshot: {
      order_items: [
        { id: 'oi-101', order_id: 'ord-101', dish: 'Paneer Butter Masala', ingredient: 'ing_paneer' },
        { id: 'oi-105', order_id: 'ord-105', dish: 'Paneer Biryani', ingredient: 'ing_paneer' }
      ],
      stock: { ing_paneer: 0.2, ing_tofu: 3.5 }
    },
    after_snapshot: {
      order_items: [
        { id: 'oi-101', order_id: 'ord-101', dish: 'Tofu Butter Masala', ingredient: 'ing_tofu' },
        { id: 'oi-105', order_id: 'ord-105', dish: 'Tofu Biryani', ingredient: 'ing_tofu' }
      ],
      stock: { ing_paneer: 0.2, ing_tofu: 2.1 }
    }
  },
  {
    id: 'log-002',
    action_id: 'act-002',
    event_type: 'action_rejected',
    actor: 'owner',
    summary: 'Declined emergency purchase proposal for paneer; operator will call supplier directly',
    plan_version_before: null,
    plan_version_after: null,
    undoable: false,
    created_at: '2026-10-18T12:45:00+05:30',
    before_snapshot: null,
    after_snapshot: null
  },
  {
    id: 'log-003',
    action_id: 'act-003',
    event_type: 'undo_executed',
    actor: 'owner',
    summary: 'Reversed prep time extension on Swiggy orders; plan v3 to v4',
    plan_version_before: 3,
    plan_version_after: 4,
    undoable: false,
    created_at: '2026-10-18T11:20:00+05:30',
    before_snapshot: {
      tasks: [{ id: 't-01', start_at: '2026-10-18T11:45:00+05:30' }]
    },
    after_snapshot: {
      tasks: [{ id: 't-01', start_at: '2026-10-18T11:15:00+05:30' }]
    }
  },
  {
    id: 'log-004',
    action_id: 'act-004',
    event_type: 'order_created',
    actor: 'owner',
    summary: 'WhatsApp order extracted & scheduled for Aditi Sharma (ord-101); 2 items planned',
    plan_version_before: null,
    plan_version_after: null,
    undoable: false,
    created_at: '2026-10-18T10:15:00+05:30',
    before_snapshot: null,
    after_snapshot: {
      order: { id: 'ord-101', customer: 'Aditi Sharma', total: 540.0 }
    }
  },
  {
    id: 'log-005',
    action_id: null, // Null action ID for system event per schema
    event_type: 'stock_updated',
    actor: 'system',
    summary: 'Morning delivery intake: 5.0 kg Basmati Rice, 3.0 kg Tofu added to kitchen inventory',
    plan_version_before: null,
    plan_version_after: null,
    undoable: false,
    created_at: '2026-10-18T08:30:00+05:30',
    before_snapshot: {
      stock: { ing_rice: 2.0, ing_tofu: 0.5 }
    },
    after_snapshot: {
      stock: { ing_rice: 7.0, ing_tofu: 3.5 }
    }
  }
]

export const DEMO_AUDIT_VIEW_MODELS: readonly AuditLogViewModel[] =
  adaptAuditLogsToViewModels(DEMO_AUDIT_LOGS)

export const DEMO_AUDIT_SUMMARY: AuditLogSummary =
  deriveAuditLogSummary(DEMO_AUDIT_VIEW_MODELS)
