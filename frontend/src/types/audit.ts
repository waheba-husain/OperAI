/* ============================================================
   frontend/src/types/audit.ts
   OperAI / Cloud Kitchen Rescue — Audit Log & Undo View Models

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.14 (GET /api/audit)
   - docs/Rest_API_Spec.md §3.15 (POST /api/audit/{id}/undo)
   - docs/Database_Schema.md §3.10 (audit_logs table)
   - AGENTS.md (Rules 2, 4, 5, 6)

   SAFETY RULES:
   1. Keep API DTOs strictly separate from UI view models.
   2. Never manufacture an option number if omitted by backend.
   3. Never mark an undo proposal ready for approval without an authoritative option number.
   4. Never claim an undo proposal has executed.
   ============================================================ */

import type {
  ActionStatusDTO,
  ActionTypeDTO,
  AuditActorDTO,
  AuditEventTypeDTO
} from './dto.ts'

/** Presentation badge styling metadata for audit events */
export type AuditEventBadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral'

/** Event presentation metadata derived purely from event_type */
export interface AuditEventPresentation {
  readonly eventType: AuditEventTypeDTO
  readonly label: string
  readonly badgeVariant: AuditEventBadgeVariant
  readonly description: string
}

/** Actor display presentation */
export interface AuditActorPresentation {
  readonly actor: AuditActorDTO
  readonly label: string
  readonly badgeLabel: string
}

/** Plan version transition view model */
export interface PlanVersionTransition {
  readonly before: number | null
  readonly after: number | null
  readonly hasTransition: boolean
  readonly display: string | null // e.g. "v4 → v5"
}

/** Individual snapshot property difference */
export interface SnapshotFieldDiff {
  readonly key: string
  readonly beforeValue: string | null
  readonly afterValue: string | null
  readonly changeType: 'added' | 'removed' | 'modified' | 'unchanged'
}

/** Snapshot comparison view model */
export interface SnapshotComparisonViewModel {
  readonly hasSnapshots: boolean
  readonly hasBeforeSnapshot: boolean
  readonly hasAfterSnapshot: boolean
  readonly rawBefore: Record<string, unknown> | null
  readonly rawAfter: Record<string, unknown> | null
  readonly diffs: readonly SnapshotFieldDiff[]
  readonly changedKeysCount: number
}

/** Audit log timeline entry view model */
export interface AuditLogViewModel {
  readonly id: string
  readonly actionId: string | null
  readonly hasAction: boolean
  readonly eventType: AuditEventTypeDTO
  readonly eventPresentation: AuditEventPresentation
  readonly actor: AuditActorDTO
  readonly actorPresentation: AuditActorPresentation
  readonly summary: string
  readonly planVersionTransition: PlanVersionTransition
  readonly undoable: boolean
  readonly createdAt: string // ISO 8601 with offset
  readonly createdAtFormatted: string // e.g. "18 Oct 2026, 12:30 PM"
  readonly createdAtTimeAgo: string // e.g. "5m ago"
  readonly snapshotComparison: SnapshotComparisonViewModel
}

/** Undo proposal view model for user confirmation & approval staging */
export interface UndoProposalViewModel {
  readonly actionId: string
  readonly groupId: string
  /**
   * Authoritative option number returned by backend.
   * STRICTLY null if omitted or invalid; NEVER defaulted to 1.
   */
  readonly optionNumber: number | null
  /**
   * True if option_number was omitted by backend and must be resolved
   * from GET /api/actions?status=pending before approval.
   */
  readonly requiresOptionResolution: boolean
  /**
   * True ONLY if status is 'pending', action_type is 'undo', and optionNumber is a valid positive integer.
   */
  readonly isReadyForApproval: boolean
  readonly actionType: 'undo' | ActionTypeDTO
  readonly title: string
  readonly status: ActionStatusDTO
  /** Status banner text: "Pending Approval" (NEVER "Executed") */
  readonly statusLabel: string
  readonly undoOfAuditId: string | null
  readonly basePlanVersion: number | null
  readonly expiresAt: string
  readonly expiresAtFormatted: string
  readonly isExpired: boolean
  readonly impactSummary?: string
}

/** Summary statistics for Audit Log header & filter controls */
export interface AuditLogSummary {
  readonly totalEntries: number
  readonly actionExecutedCount: number
  readonly actionRejectedCount: number
  readonly undoExecutedCount: number
  readonly orderCreatedCount: number
  readonly stockUpdatedCount: number
  readonly latestUndoableAuditId: string | null
}
