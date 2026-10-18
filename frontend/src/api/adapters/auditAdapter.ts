/* ============================================================
   frontend/src/api/adapters/auditAdapter.ts
   OperAI / Cloud Kitchen Rescue — Audit Log & Undo DTO to View-Model Adapter

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.14 (GET /api/audit)
   - docs/Rest_API_Spec.md §3.15 (POST /api/audit/{id}/undo)
   - docs/Database_Schema.md §3.10 (audit_logs table)
   - AGENTS.md (Rules 2, 4, 5, 6)

   SAFETY INVARIANTS:
   1. Never fabricate or invent option numbers (never use action.option_number ?? 1).
   2. Missing or unverified option numbers mark proposal as requiresOptionResolution.
   3. Undo proposals are strictly 'pending', never represented as executed.
   4. Defensively handle null, missing, empty, or polymorphic snapshots without crashing.
   ============================================================ */

import type {
  AuditActorDTO,
  AuditEventTypeDTO,
  AuditLogDTO,
  AuditUndoResponseDTO
} from '../../types/dto.ts'
import type {
  AuditActorPresentation,
  AuditEventPresentation,
  AuditLogSummary,
  AuditLogViewModel,
  PlanVersionTransition,
  SnapshotComparisonViewModel,
  SnapshotFieldDiff,
  UndoProposalViewModel
} from '../../types/audit.ts'
import { formatTimeAgo } from './actionAdapter.ts'
import { formatTimeIST } from './orderAdapter.ts'

/* ── 1. Event Type Presentation Mapping ─────────────────────── */

export const AUDIT_EVENT_PRESENTATION_MAP: Record<AuditEventTypeDTO, AuditEventPresentation> = {
  action_executed: {
    eventType: 'action_executed',
    label: 'Action Executed',
    badgeVariant: 'success',
    description: 'A proposed recovery or pricing action was approved and applied to the kitchen plan.'
  },
  action_rejected: {
    eventType: 'action_rejected',
    label: 'Action Declined',
    badgeVariant: 'danger',
    description: 'A proposed action was declined by the operator. Plan and stock were not modified.'
  },
  undo_executed: {
    eventType: 'undo_executed',
    label: 'Undo Reversal Applied',
    badgeVariant: 'warning',
    description: 'A prior change was reversed using its snapshot history after explicit approval.'
  },
  order_created: {
    eventType: 'order_created',
    label: 'Order Intake',
    badgeVariant: 'info',
    description: 'A new order was scheduled into the kitchen plan.'
  },
  stock_updated: {
    eventType: 'stock_updated',
    label: 'Stock Adjusted',
    badgeVariant: 'neutral',
    description: 'Inventory levels were modified via intake or physical count update.'
  }
}

/**
 * Maps documented or unknown audit event types into display presentation metadata.
 */
export function mapAuditEventPresentation(eventType: string): AuditEventPresentation {
  const known = AUDIT_EVENT_PRESENTATION_MAP[eventType as AuditEventTypeDTO]
  if (known) return known

  return {
    eventType: eventType as AuditEventTypeDTO,
    label: eventType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    badgeVariant: 'neutral',
    description: 'Kitchen operational event recorded in change history.'
  }
}

/* ── 2. Actor Presentation Mapping ──────────────────────────── */

export const AUDIT_ACTOR_PRESENTATION_MAP: Record<AuditActorDTO, AuditActorPresentation> = {
  owner: {
    actor: 'owner',
    label: 'Kitchen Owner',
    badgeLabel: 'Owner'
  },
  system: {
    actor: 'system',
    label: 'System Engine',
    badgeLabel: 'System'
  },
  agent: {
    actor: 'agent',
    label: 'AI Copilot',
    badgeLabel: 'AI Copilot'
  }
}

/**
 * Maps documented or unknown actor identities into display presentation metadata.
 */
export function mapAuditActorPresentation(actor: string): AuditActorPresentation {
  const known = AUDIT_ACTOR_PRESENTATION_MAP[actor as AuditActorDTO]
  if (known) return known

  return {
    actor: actor as AuditActorDTO,
    label: actor,
    badgeLabel: actor
  }
}

/* ── 3. Timestamp Formatting ────────────────────────────────── */

/**
 * Formats an ISO 8601 timestamp into a readable IST date and time string.
 * Example: "18 Oct 2026, 12:30 PM"
 */
export function formatAuditTimestampIST(isoString?: string): string {
  if (!isoString) return '—'
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return '—'

    const datePart = new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    }).format(date)

    const timePart = new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    }).format(date)

    return `${datePart}, ${timePart}`
  } catch {
    return '—'
  }
}

/* ── 4. Plan Version Transition Mapping ─────────────────────── */

/**
 * Transforms plan_version_before and plan_version_after into a clean transition view model.
 * Produces "v4 → v5" when both integers are provided, or null display when not applicable.
 */
export function mapPlanVersionTransition(
  before?: number | null,
  after?: number | null
): PlanVersionTransition {
  const validBefore = typeof before === 'number' && Number.isInteger(before)
  const validAfter = typeof after === 'number' && Number.isInteger(after)

  if (validBefore && validAfter) {
    return {
      before,
      after,
      hasTransition: true,
      display: `v${before} → v${after}`
    }
  }

  return {
    before: validBefore ? before : null,
    after: validAfter ? after : null,
    hasTransition: false,
    display: null
  }
}

/* ── 5. Defensive Snapshot Value & Comparison Formatting ────── */

/**
 * Safely formats an arbitrary snapshot value into an inspectable string representation.
 * Handles primitives, null, undefined, arrays, and nested objects without throwing.
 */
export function formatSnapshotValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value)
    } catch {
      return `[Array(${value.length})]`
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[Object]'
    }
  }
  return String(value)
}

/**
 * Compares before and after snapshot payloads defensively without assuming an unconfirmed schema.
 * Extracts key-level differences and preserves raw snapshot objects for deeper inspection.
 */
export function adaptSnapshotComparison(
  beforeSnapshot?: Record<string, unknown> | null,
  afterSnapshot?: Record<string, unknown> | null
): SnapshotComparisonViewModel {
  const isPlainObj = (obj: unknown): obj is Record<string, unknown> =>
    Boolean(obj && typeof obj === 'object' && !Array.isArray(obj))

  const hasBefore = isPlainObj(beforeSnapshot) && Object.keys(beforeSnapshot).length > 0
  const hasAfter = isPlainObj(afterSnapshot) && Object.keys(afterSnapshot).length > 0
  const hasSnapshots = hasBefore || hasAfter

  if (!hasSnapshots) {
    return {
      hasSnapshots: false,
      hasBeforeSnapshot: false,
      hasAfterSnapshot: false,
      rawBefore: isPlainObj(beforeSnapshot) ? beforeSnapshot : null,
      rawAfter: isPlainObj(afterSnapshot) ? afterSnapshot : null,
      diffs: [],
      changedKeysCount: 0
    }
  }

  const beforeObj = (hasBefore ? beforeSnapshot : {}) as Record<string, unknown>
  const afterObj = (hasAfter ? afterSnapshot : {}) as Record<string, unknown>

  const allKeys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])).sort()
  const diffs: SnapshotFieldDiff[] = []

  for (const key of allKeys) {
    const beforeVal = beforeObj[key]
    const afterVal = afterObj[key]

    const beforePresent = key in beforeObj
    const afterPresent = key in afterObj

    const beforeStr = beforePresent ? formatSnapshotValue(beforeVal) : null
    const afterStr = afterPresent ? formatSnapshotValue(afterVal) : null

    let changeType: SnapshotFieldDiff['changeType'] = 'unchanged'
    if (!beforePresent && afterPresent) {
      changeType = 'added'
    } else if (beforePresent && !afterPresent) {
      changeType = 'removed'
    } else if (beforeStr !== afterStr) {
      changeType = 'modified'
    }

    // Do NOT fabricate differences for unchanged keys
    if (changeType !== 'unchanged') {
      diffs.push({
        key,
        beforeValue: beforeStr,
        afterValue: afterStr,
        changeType
      })
    }
  }

  return {
    hasSnapshots: true,
    hasBeforeSnapshot: hasBefore,
    hasAfterSnapshot: hasAfter,
    rawBefore: isPlainObj(beforeSnapshot) ? beforeSnapshot : null,
    rawAfter: isPlainObj(afterSnapshot) ? afterSnapshot : null,
    diffs,
    changedKeysCount: diffs.length
  }
}

/* ── 6. Audit Log Entry Adapters ────────────────────────────── */

/**
 * Transforms an AuditLogDTO into an AuditLogViewModel.
 * Handles nullable action IDs, plan transitions, and snapshots defensively.
 */
export function adaptAuditLogToViewModel(dto: AuditLogDTO): AuditLogViewModel {
  const hasAction = Boolean(dto.action_id && dto.action_id.trim().length > 0)
  const eventPresentation = mapAuditEventPresentation(dto.event_type)
  const actorPresentation = mapAuditActorPresentation(dto.actor)
  const planVersionTransition = mapPlanVersionTransition(dto.plan_version_before, dto.plan_version_after)
  const snapshotComparison = adaptSnapshotComparison(dto.before_snapshot, dto.after_snapshot)

  return {
    id: dto.id,
    actionId: hasAction ? dto.action_id : null,
    hasAction,
    eventType: dto.event_type,
    eventPresentation,
    actor: dto.actor,
    actorPresentation,
    summary: dto.summary,
    planVersionTransition,
    undoable: Boolean(dto.undoable),
    createdAt: dto.created_at,
    createdAtFormatted: formatAuditTimestampIST(dto.created_at),
    createdAtTimeAgo: formatTimeAgo(dto.created_at),
    snapshotComparison
  }
}

/**
 * Transforms an array of AuditLogDTO records into AuditLogViewModels.
 */
export function adaptAuditLogsToViewModels(dtos: readonly AuditLogDTO[]): AuditLogViewModel[] {
  return dtos.map(adaptAuditLogToViewModel)
}

/* ── 7. Audit Log Summary Derivation ────────────────────────── */

/**
 * Computes header statistics and identifies the latest undoable record from audit entries.
 */
export function deriveAuditLogSummary(logs: readonly AuditLogViewModel[]): AuditLogSummary {
  let actionExecutedCount = 0
  let actionRejectedCount = 0
  let undoExecutedCount = 0
  let orderCreatedCount = 0
  let stockUpdatedCount = 0
  let latestUndoableAuditId: string | null = null

  for (const log of logs) {
    switch (log.eventType) {
      case 'action_executed':
        actionExecutedCount++
        break
      case 'action_rejected':
        actionRejectedCount++
        break
      case 'undo_executed':
        undoExecutedCount++
        break
      case 'order_created':
        orderCreatedCount++
        break
      case 'stock_updated':
        stockUpdatedCount++
        break
    }

    // Since entries are sorted newest-first per API spec, the first undoable entry is the latest
    if (log.undoable && !latestUndoableAuditId) {
      latestUndoableAuditId = log.id
    }
  }

  return {
    totalEntries: logs.length,
    actionExecutedCount,
    actionRejectedCount,
    undoExecutedCount,
    orderCreatedCount,
    stockUpdatedCount,
    latestUndoableAuditId
  }
}

/* ── 8. Undo Proposal Adapter (Safety Critical) ─────────────── */

/**
 * Transforms an AuditUndoResponseDTO into an UndoProposalViewModel.
 *
 * CRITICAL SAFETY RULES:
 * 1. Never use action.option_number ?? 1.
 * 2. If option_number is missing or invalid, optionNumber is null and
 *    requiresOptionResolution is true.
 * 3. isReadyForApproval is true ONLY when action_type is 'undo', status is 'pending',
 *    and optionNumber is an authoritative positive integer.
 * 4. Never claim that the undo has executed.
 */
export function adaptUndoResponseToViewModel(dto: AuditUndoResponseDTO): UndoProposalViewModel {
  const action = dto.action

  const isUndoType = action.action_type === 'undo'
  const isPendingStatus = action.status === 'pending'

  // Strict option number verification: must be a positive integer confirmed by the backend
  const rawOpt = action.option_number
  const hasValidOptionNumber = typeof rawOpt === 'number' && Number.isInteger(rawOpt) && rawOpt > 0
  const optionNumber = hasValidOptionNumber ? rawOpt : null

  // If option_number is omitted, the proposal requires resolution before approval
  const requiresOptionResolution = !hasValidOptionNumber

  // Ready for approval ONLY when proposal is pending, type is undo, and option number is confirmed
  const isReadyForApproval = isUndoType && isPendingStatus && hasValidOptionNumber

  const isExpired = action.expires_at ? new Date(action.expires_at).getTime() <= Date.now() : false

  return {
    actionId: action.id,
    groupId: action.group_id,
    optionNumber,
    requiresOptionResolution,
    isReadyForApproval,
    actionType: action.action_type,
    title: action.title,
    status: action.status,
    statusLabel: action.status === 'pending' ? 'Pending Approval' : String(action.status),
    undoOfAuditId: action.undo_of_audit_id ?? null,
    basePlanVersion: typeof action.base_plan_version === 'number' ? action.base_plan_version : null,
    expiresAt: action.expires_at,
    expiresAtFormatted: action.expires_at ? formatTimeIST(action.expires_at) : 'No expiry',
    isExpired,
    impactSummary: action.title
  }
}

/**
 * Resolves an undo proposal's authoritative option number against GET /api/actions results.
 * Enables approval ONLY when a matching pending undo action with a positive integer option number is confirmed.
 */
export function resolveUndoOptionNumberFromActions(
  proposal: UndoProposalViewModel,
  pendingActions: readonly {
    readonly id: string
    readonly group_id: string
    readonly option_number?: number | null
    readonly action_type: string
    readonly status: string
  }[]
): {
  readonly resolvedProposal: UndoProposalViewModel
  readonly resolutionError: string | null
} {
  // If proposal already has an authoritative option number and doesn't require resolution, preserve it
  if (!proposal.requiresOptionResolution && proposal.optionNumber !== null) {
    return { resolvedProposal: proposal, resolutionError: null }
  }

  // Find actions matching the actionId or undoOfAuditId within the same group
  const matchingActions = pendingActions.filter(
    (act) => act.id === proposal.actionId || (act.group_id === proposal.groupId && act.action_type === 'undo')
  )

  if (matchingActions.length === 0) {
    return {
      resolvedProposal: {
        ...proposal,
        optionNumber: null,
        requiresOptionResolution: true,
        isReadyForApproval: false
      },
      resolutionError: `No pending undo action found in group ${proposal.groupId} to resolve option number. Approval blocked for safety.`
    }
  }

  if (matchingActions.length > 1) {
    return {
      resolvedProposal: {
        ...proposal,
        optionNumber: null,
        requiresOptionResolution: true,
        isReadyForApproval: false
      },
      resolutionError: `Ambiguous pending undo actions in group ${proposal.groupId} (${matchingActions.length} candidates found). Approval blocked for safety.`
    }
  }

  const candidate = matchingActions[0]

  if (candidate.action_type !== 'undo' || candidate.status !== 'pending') {
    return {
      resolvedProposal: {
        ...proposal,
        optionNumber: null,
        requiresOptionResolution: true,
        isReadyForApproval: false
      },
      resolutionError: `Candidate action ${candidate.id} is not a pending undo action (type: ${candidate.action_type}, status: ${candidate.status}). Approval blocked.`
    }
  }

  const opt = candidate.option_number
  if (typeof opt !== 'number' || !Number.isInteger(opt) || opt <= 0) {
    return {
      resolvedProposal: {
        ...proposal,
        optionNumber: null,
        requiresOptionResolution: true,
        isReadyForApproval: false
      },
      resolutionError: `Candidate action ${candidate.id} does not contain a valid positive integer option_number. Approval blocked for safety.`
    }
  }

  // Authoritative option number resolved!
  return {
    resolvedProposal: {
      ...proposal,
      optionNumber: opt,
      requiresOptionResolution: false,
      isReadyForApproval: true
    },
    resolutionError: null
  }
}

