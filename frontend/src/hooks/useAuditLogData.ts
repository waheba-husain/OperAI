/* ============================================================
   frontend/src/hooks/useAuditLogData.ts
   OperAI / Cloud Kitchen Rescue — Audit Log & Undo Data Hook

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.14 (GET /api/audit)
   - docs/Rest_API_Spec.md §3.15 (POST /api/audit/{id}/undo)
   - docs/Rest_API_Spec.md §3.11 (GET /api/actions)
   - docs/Rest_API_Spec.md §3.12 (POST /api/actions/{id}/approve)
   - docs/Database_Schema.md §3.10 (audit_logs table)
   - AGENTS.md (Rules 2, 4, 5, 6)

   LIFECYCLE & SAFETY INVARIANTS:
   1. Requests verified audit history (GET /api/audit) via shared ApiClient.
   2. Handles Loading, Live, Empty, and Error states explicitly.
   3. NEVER silently falls back to mock data after a live API failure.
   4. Stale-request protection: uses request sequence counter & AbortController
      so rapid filter changes never let older responses overwrite newer selections.
   5. Explicit Undo Staging:
      - Calls POST /api/audit/{id}/undo.
      - Verifies action_type === 'undo' and status === 'pending'.
      - Strictly preserves authoritative option_number (NEVER defaults to 1).
      - If option_number is missing, resolves against GET /api/actions?group_id=...&status=pending.
      - If resolution fails or remains ambiguous, blocks approval and exposes error.
      - NEVER approves automatically.
   6. Explicit Approval: requires user confirmation; calls POST /api/actions/{id}/approve
      with the confirmed option number and input_mode: 'click'.
   7. Demo Mode Isolation: simulated records clearly identified; demo mode never
      triggers backend mutation requests.
   ============================================================ */

import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  ActionApproveResponseDTO,
  AuditEventTypeDTO,
  AuditListResponseDTO,
  AuditUndoResponseDTO
} from '../types/dto.ts'
import type {
  AuditLogSummary,
  AuditLogViewModel,
  UndoProposalViewModel
} from '../types/audit.ts'
import type { ApprovalResultViewModel } from '../types/shortageRecovery.ts'
import {
  apiClient as defaultApiClient,
  ApiClient,
  approveAction,
  getActions,
  getAudit,
  getDefaultConfig,
  undoAudit,
  ApiError,
  ConfigurationError,
  NetworkError
} from '../api/index.ts'
import {
  adaptAuditLogsToViewModels,
  adaptUndoResponseToViewModel,
  deriveAuditLogSummary,
  resolveUndoOptionNumberFromActions
} from '../api/adapters/auditAdapter.ts'
import { adaptApprovalResponseToViewModel } from '../api/adapters/actionAdapter.ts'
import {
  DEMO_AUDIT_METADATA,
  DEMO_AUDIT_SUMMARY,
  DEMO_AUDIT_VIEW_MODELS
} from '../pages/audit/auditData.ts'

export type AuditLogMode = 'live' | 'demo'

const SERVER_AUDIT_EVENT_TYPES = new Set<AuditEventTypeDTO>([
  'action_executed',
  'action_rejected',
  'undo_executed',
  'order_created'
])

export interface UseAuditLogDataOptions {
  readonly client?: ApiClient
  readonly initialMode?: AuditLogMode
  readonly initialLimit?: number
  readonly initialEventType?: AuditEventTypeDTO
  readonly initialIncludeSnapshots?: boolean
  readonly autoFetch?: boolean
}

export interface AuditLogDataResult {
  // Mode & State
  readonly mode: AuditLogMode
  readonly isLive: boolean
  readonly isLoading: boolean
  readonly error: ApiError | ConfigurationError | NetworkError | Error | null
  readonly isMissingConfig: boolean
  readonly isEmpty: boolean
  readonly dataSource: string

  // Audit Records & Presentation
  readonly logs: readonly AuditLogViewModel[]
  readonly summary: AuditLogSummary
  readonly selectedLogId: string | null
  readonly selectedLog: AuditLogViewModel | null
  readonly setSelectedLogId: (id: string | null) => void

  // Filter Controls
  readonly limit: number | undefined
  readonly eventType: AuditEventTypeDTO | undefined
  readonly includeSnapshots: boolean
  readonly setLimit: (limit?: number) => void
  readonly setEventType: (eventType?: AuditEventTypeDTO) => void
  readonly setIncludeSnapshots: (include: boolean) => void

  // Lifecycle
  readonly refetch: () => Promise<void>
  readonly setMode: (mode: AuditLogMode) => void

  // Undo Proposal Staging (Safety-Gated)
  readonly isProposingUndo: boolean
  readonly undoProposalError: ApiError | ConfigurationError | NetworkError | Error | null
  readonly undoResolutionError: string | null
  readonly stagedUndoProposal: UndoProposalViewModel | null
  readonly requestUndoProposal: (auditId: string) => Promise<UndoProposalViewModel | null>
  readonly clearUndoProposal: () => void

  // Explicit User Approval
  readonly isApprovingUndo: boolean
  readonly undoApprovalResult: ApprovalResultViewModel | null
  readonly undoApprovalError: ApiError | ConfigurationError | NetworkError | Error | null
  readonly postApprovalRefreshError: string | null
  readonly approveStagedUndo: () => Promise<ApprovalResultViewModel | null>
  readonly clearUndoApprovalResult: () => void
}

export function useAuditLogData(options?: UseAuditLogDataOptions): AuditLogDataResult {
  const activeClient = options?.client ?? defaultApiClient

  // Detect whether API key is configured
  const envConfig = getDefaultConfig()
  const hasApiKey = Boolean(activeClient.config.apiKey ?? envConfig.apiKey)

  // Mode Selection: explicit option > API key presence > demo
  const [mode, setMode] = useState<AuditLogMode>(() => {
    if (options?.initialMode) return options.initialMode
    return hasApiKey ? 'live' : 'demo'
  })

  // Filter State
  const [limit, setLimit] = useState<number | undefined>(options?.initialLimit ?? 50)
  const [eventType, setEventType] = useState<AuditEventTypeDTO | undefined>(options?.initialEventType)
  const [includeSnapshots, setIncludeSnapshots] = useState<boolean>(options?.initialIncludeSnapshots ?? true)

  // Selection
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)

  // Live Query State
  const [isLoading, setIsLoading] = useState<boolean>(mode === 'live')
  const [error, setError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [liveLogs, setLiveLogs] = useState<readonly AuditLogViewModel[]>([])
  const [liveSummary, setLiveSummary] = useState<AuditLogSummary>({
    totalEntries: 0,
    actionExecutedCount: 0,
    actionRejectedCount: 0,
    undoExecutedCount: 0,
    orderCreatedCount: 0,
    stockUpdatedCount: 0,
    latestUndoableAuditId: null
  })
  const [liveOverallSummary, setLiveOverallSummary] = useState<AuditLogSummary | null>(null)

  // Undo Proposal State
  const [isProposingUndo, setIsProposingUndo] = useState<boolean>(false)
  const [undoProposalError, setUndoProposalError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [undoResolutionError, setUndoResolutionError] = useState<string | null>(null)
  const [stagedUndoProposal, setStagedUndoProposal] = useState<UndoProposalViewModel | null>(null)

  // Approval Mutation State
  const [isApprovingUndo, setIsApprovingUndo] = useState<boolean>(false)
  const [undoApprovalResult, setUndoApprovalResult] = useState<ApprovalResultViewModel | null>(null)
  const [undoApprovalError, setUndoApprovalError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [postApprovalRefreshError, setPostApprovalRefreshError] = useState<string | null>(null)

  // Concurrency & Abort References
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef<number>(0)

  // ── Fetch Audit History ──────────────────────────────────────
  const fetchAudit = useCallback(async () => {
    if (mode !== 'live') {
      setIsLoading(false)
      setError(null)
      return
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    // Increment sequence counter to prevent stale response race conditions
    const currentSeq = ++requestSeqRef.current

    setIsLoading(true)
    setError(null)

    try {
      const canFilterOnServer = eventType !== undefined && SERVER_AUDIT_EVENT_TYPES.has(eventType)
      const response: AuditListResponseDTO = await getAudit(
        {
          limit,
          event_type: canFilterOnServer ? eventType : undefined,
          include_snapshots: includeSnapshots
        },
        {
          signal: controller.signal,
          client: activeClient
        }
      )

      // Guard against race conditions: ignore response if newer request was launched
      if (currentSeq !== requestSeqRef.current) {
        return
      }

      const auditRows = eventType && !canFilterOnServer
        ? response.data.filter((row) => row.event_type === eventType)
        : response.data
      const adaptedLogs = adaptAuditLogsToViewModels(auditRows)
      const derivedSummary = deriveAuditLogSummary(adaptedLogs)

      setLiveLogs(adaptedLogs)
      if (!eventType) {
        setLiveOverallSummary(derivedSummary)
        setLiveSummary(derivedSummary)
      } else {
        setLiveSummary(derivedSummary)
      }
      setError(null)
    } catch (err: unknown) {
      // Discard errors from aborted/stale requests
      if (currentSeq !== requestSeqRef.current) {
        return
      }

      const mappedErr =
        err instanceof ApiError || err instanceof ConfigurationError || err instanceof NetworkError
          ? err
          : err instanceof Error
            ? err
            : new Error(String(err))

      setError(mappedErr)
      setLiveLogs([])
      setLiveSummary({
        totalEntries: 0,
        actionExecutedCount: 0,
        actionRejectedCount: 0,
        undoExecutedCount: 0,
        orderCreatedCount: 0,
        stockUpdatedCount: 0,
        latestUndoableAuditId: null
      })
      setLiveOverallSummary(null)
    } finally {
      if (currentSeq === requestSeqRef.current) {
        setIsLoading(false)
      }
    }
  }, [mode, activeClient, limit, eventType, includeSnapshots])

  // Initial & Filter-Triggered Fetch
  useEffect(() => {
    if (options?.autoFetch !== false) {
      const run = async () => {
        await fetchAudit()
      }
      void run()
    }
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [fetchAudit, options?.autoFetch])

  // ── Request Undo Proposal (Safety Gated) ─────────────────────
  const requestUndoProposal = useCallback(
    async (auditId: string): Promise<UndoProposalViewModel | null> => {
      // 1. Prevent duplicate in-flight submissions
      if (isProposingUndo || isApprovingUndo) {
        return null
      }

      // 2. Demo mode isolation: do not trigger backend mutation
      if (mode === 'demo') {
        const demoErr = new Error(
          'Undo proposals are disabled in Demo Mode. Connect a live backend with API key to propose reversals.'
        )
        setUndoProposalError(demoErr)
        return null
      }

      setIsProposingUndo(true)
      setUndoProposalError(null)
      setUndoResolutionError(null)

      try {
        // Step 1: Request undo proposal from backend
        const response: AuditUndoResponseDTO = await undoAudit(auditId, {
          client: activeClient
        })

        // Step 2: Adapt and validate response shape
        const initialVm = adaptUndoResponseToViewModel(response)

        // Validate action type and pending status
        if (response.action.action_type !== 'undo' || response.action.status !== 'pending') {
          const invalidStateErr = new Error(
            `Invalid undo proposal returned: expected action_type 'undo' and status 'pending', got type '${response.action.action_type}' and status '${response.action.status}'.`
          )
          setUndoProposalError(invalidStateErr)
          return null
        }

        let resolvedVm = initialVm

        // Step 3: Check option number
        // If option_number is missing or invalid, resolve against GET /api/actions?status=pending&group_id=...
        if (initialVm.requiresOptionResolution || initialVm.optionNumber === null) {
          try {
            const actionsResponse = await getActions(
              {
                group_id: response.action.group_id,
                status: 'pending'
              },
              { client: activeClient }
            )

            const resolution = resolveUndoOptionNumberFromActions(
              initialVm,
              actionsResponse.data
            )

            resolvedVm = resolution.resolvedProposal
            if (resolution.resolutionError) {
              setUndoResolutionError(resolution.resolutionError)
            }
          } catch (resErr: unknown) {
            const msg = (resErr as Error)?.message ?? String(resErr)
            setUndoResolutionError(
              `Failed to resolve action details from GET /api/actions: ${msg}. Approval blocked for safety.`
            )
          }
        }

        setStagedUndoProposal(resolvedVm)
        return resolvedVm
      } catch (err: unknown) {
        const mappedErr =
          err instanceof ApiError || err instanceof ConfigurationError || err instanceof NetworkError
            ? err
            : err instanceof Error
              ? err
              : new Error(String(err))

        setUndoProposalError(mappedErr)
        setStagedUndoProposal(null)
        return null
      } finally {
        setIsProposingUndo(false)
      }
    },
    [isProposingUndo, isApprovingUndo, mode, activeClient]
  )

  // ── Explicit User Approval of Staged Undo ────────────────────
  const approveStagedUndo = useCallback(async (): Promise<ApprovalResultViewModel | null> => {
    // 1. Validate staged proposal existence
    if (!stagedUndoProposal) {
      setUndoApprovalError(new Error('No undo proposal staged for approval.'))
      return null
    }

    // 2. Strict Safety Gate: Do not approve if option_number is unresolved or proposal is not ready
    if (!stagedUndoProposal.isReadyForApproval || stagedUndoProposal.optionNumber === null) {
      const blockedErr = new Error(
        'Approval blocked: undo proposal has not been verified with an authoritative option_number or is not in pending status.'
      )
      setUndoApprovalError(blockedErr)
      return null
    }

    // 3. Prevent duplicate concurrent submissions
    if (isApprovingUndo) {
      return null
    }

    // 4. Demo mode check
    if (mode === 'demo') {
      const demoErr = new Error('Approving undo proposals is disabled in Demo Mode.')
      setUndoApprovalError(demoErr)
      return null
    }

    setIsApprovingUndo(true)
    setUndoApprovalError(null)
    setPostApprovalRefreshError(null)

    try {
      // Execute explicit approval with confirmed option number and click input_mode
      const response: ActionApproveResponseDTO = await approveAction(
        stagedUndoProposal.actionId,
        {
          confirm_option_number: stagedUndoProposal.optionNumber,
          input_mode: 'click'
        },
        { client: activeClient }
      )

      const result = adaptApprovalResponseToViewModel(response)
      setUndoApprovalResult(result)
      setStagedUndoProposal(null)

      // Post-approval background refresh of audit history
      try {
        await fetchAudit()
      } catch (refreshErr: unknown) {
        const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
        setPostApprovalRefreshError(`Undo approval succeeded, but automatic audit log refresh failed: ${msg}`)
      }

      return result
    } catch (err: unknown) {
      const mappedErr =
        err instanceof ApiError || err instanceof ConfigurationError || err instanceof NetworkError
          ? err
          : err instanceof Error
            ? err
            : new Error(String(err))

      setUndoApprovalError(mappedErr)
      return null
    } finally {
      setIsApprovingUndo(false)
    }
  }, [stagedUndoProposal, isApprovingUndo, mode, activeClient, fetchAudit])

  const clearUndoProposal = useCallback(() => {
    setStagedUndoProposal(null)
    setUndoProposalError(null)
    setUndoResolutionError(null)
  }, [])

  const clearUndoApprovalResult = useCallback(() => {
    setUndoApprovalResult(null)
    setUndoApprovalError(null)
    setPostApprovalRefreshError(null)
  }, [])

  // Controlled Demo Data Resolution
  const isLive = mode === 'live'
  const isMissingConfig = isLive && !hasApiKey

  const filteredDemoLogs = (() => {
    if (eventType) {
      return DEMO_AUDIT_VIEW_MODELS.filter((l) => l.eventType === eventType)
    }
    return DEMO_AUDIT_VIEW_MODELS
  })().slice(0, limit ?? 50)

  const activeLogs = isLive ? liveLogs : filteredDemoLogs
  const activeSummary = isLive ? (liveOverallSummary ?? liveSummary) : DEMO_AUDIT_SUMMARY
  const isEmpty = !isLoading && !error && activeLogs.length === 0

  const selectedLog = selectedLogId
    ? activeLogs.find((l) => l.id === selectedLogId) ?? null
    : null

  return {
    mode,
    isLive,
    isLoading,
    error,
    isMissingConfig,
    isEmpty,
    dataSource: isLive ? 'verified' : DEMO_AUDIT_METADATA.dataSource,

    logs: activeLogs,
    summary: activeSummary,
    selectedLogId,
    selectedLog,
    setSelectedLogId,

    limit,
    eventType,
    includeSnapshots,
    setLimit,
    setEventType,
    setIncludeSnapshots,

    refetch: fetchAudit,
    setMode,

    isProposingUndo,
    undoProposalError,
    undoResolutionError,
    stagedUndoProposal,
    requestUndoProposal,
    clearUndoProposal,

    isApprovingUndo,
    undoApprovalResult,
    undoApprovalError,
    postApprovalRefreshError,
    approveStagedUndo,
    clearUndoApprovalResult
  }
}
