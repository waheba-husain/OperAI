/* ============================================================
   frontend/src/hooks/useShortageRecoveryData.ts
   OperAI / Cloud Kitchen Rescue — Shortage & Recovery Data Hook

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.9 (GET /api/brief)
   - docs/Rest_API_Spec.md §3.10 (POST /api/recovery/propose)
   - docs/Rest_API_Spec.md §3.11 (GET /api/actions)
   - docs/Rest_API_Spec.md §3.12 (POST /api/actions/{id}/approve)
   - docs/Rest_API_Spec.md §3.13 (POST /api/actions/{id}/reject)
   - AGENTS.md (Rule 1: Numbers from code; Rule 2: LLM never approves; Rule 4: Explicit option number)

   LIFECYCLE & STATE RULES:
   1. Requests verified risk brief (GET /api/brief) using shared ApiClient.
   2. Retrieves pending recovery actions (GET /api/actions?status=pending).
   3. Handles Loading, Live, Empty, and Error states explicitly.
   4. NEVER silently falls back to mock data after a live API failure.
   5. Explicit Approval: requires user click; sends exact option_number; input_mode = "click".
   6. Explicit Rejection: calls POST /api/actions/{id}/reject with optional reason.
   7. Prevents duplicate submissions while mutation is in progress.
   8. NEVER automatically retries mutation POST requests.
   9. Post-approval: refreshes brief, plan, and pending actions; invalidates expired siblings.
   10. If subsequent GET refresh fails, preserves successful approval result and surfaces refresh error.
   ============================================================ */

import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  ActionApproveRequestDTO,
  ActionApproveResponseDTO,
  ActionRejectRequestDTO,
  ActionRejectResponseDTO,
  BriefResponseDTO,
  ProposedActionDTO,
  RecoveryProposeRequestDTO,
  RecoveryProposeResponseDTO
} from '../types/dto.ts'
import type {
  ApprovalResultViewModel,
  AtRiskOrderViewModel,
  PendingActionViewModel,
  RecoveryProposalResultViewModel,
  RejectionResultViewModel,
  ShortageItemViewModel,
  ShortageRecoverySummary
} from '../types/shortageRecovery.ts'
import {
  apiClient as defaultApiClient,
  ApiClient,
  approveAction,
  getActions,
  getBrief,
  getDefaultConfig,
  getPlan,
  proposeRecovery,
  rejectAction,
  ApiError,
  ConfigurationError,
  NetworkError
} from '../api/index.ts'
import {
  adaptAtRiskOrdersToViewModels,
  adaptRecoveryResponseToViewModel,
  adaptShortagesToViewModels,
  deriveShortageRecoverySummary
} from '../api/adapters/recoveryAdapter.ts'
import {
  adaptApprovalResponseToViewModel,
  adaptProposedActionsToViewModels,
  adaptRejectionResponseToViewModel
} from '../api/adapters/actionAdapter.ts'
import { formatDateIST } from '../api/adapters/orderAdapter.ts'
import { getTodayDateIST } from './useOverviewData.ts'
import {
  DEMO_RECOVERY_METADATA,
  DEMO_VIEW_AT_RISK_ORDERS,
  DEMO_VIEW_PROPOSAL,
  DEMO_VIEW_SHORTAGES,
  DEMO_VIEW_SUMMARY
} from '../pages/shortageRecovery/shortageRecoveryData.ts'

export type ShortageRecoveryMode = 'live' | 'demo'

export interface UseShortageRecoveryDataOptions {
  readonly client?: ApiClient
  readonly initialDate?: string
  readonly initialMode?: ShortageRecoveryMode
}

export interface ActionMutationErrorState {
  readonly actionId: string
  readonly error: ApiError | ConfigurationError | NetworkError | Error
}

export interface ShortageRecoveryDataResult {
  readonly mode: ShortageRecoveryMode
  readonly isLive: boolean
  readonly isLoading: boolean
  readonly isProposing: boolean
  readonly isApprovingActionId: string | null
  readonly isRejectingActionId: string | null
  readonly error: ApiError | ConfigurationError | NetworkError | Error | null
  readonly proposalError: ApiError | ConfigurationError | NetworkError | Error | null
  readonly actionMutationError: ActionMutationErrorState | null
  readonly postApprovalRefreshError: string | null
  readonly latestApprovalResult: ApprovalResultViewModel | null
  readonly latestRejectionResult: RejectionResultViewModel | null
  readonly isMissingConfig: boolean
  readonly isEmptyShortages: boolean
  readonly targetDate: string
  readonly formattedDate: string
  readonly kitchenName: string
  readonly summary: ShortageRecoverySummary
  readonly shortages: readonly ShortageItemViewModel[]
  readonly atRiskOrders: readonly AtRiskOrderViewModel[]
  readonly proposal: RecoveryProposalResultViewModel | null
  readonly pendingActions: readonly PendingActionViewModel[]
  readonly isLoadingActions: boolean
  readonly actionsError: ApiError | ConfigurationError | NetworkError | Error | null
  readonly selectedIngredientId: string | null
  readonly reportedQty: number | undefined
  readonly setSelectedIngredientId: (id: string | null) => void
  readonly setReportedQty: (qty: number | undefined) => void
  readonly requestRecoveryProposal: (ingredientId: string, reportedQty?: number) => Promise<void>
  readonly approveRecoveryOption: (actionId: string, optionNumber: number) => Promise<ApprovalResultViewModel | null>
  readonly rejectRecoveryOption: (actionId: string, reason?: string) => Promise<RejectionResultViewModel | null>
  readonly clearApprovalResult: () => void
  readonly clearRejectionResult: () => void
  readonly clearActionMutationError: () => void
  readonly clearProposal: () => void
  readonly setTargetDate: (newDate: string) => void
  readonly refetch: () => Promise<void>
  readonly refetchActions: () => Promise<void>
  readonly setMode: (mode: ShortageRecoveryMode) => void
}

export function useShortageRecoveryData(
  options?: UseShortageRecoveryDataOptions
): ShortageRecoveryDataResult {
  const activeClient = options?.client ?? defaultApiClient
  const [targetDate, setTargetDate] = useState<string>(
    () => options?.initialDate ?? getTodayDateIST()
  )

  const envConfig = getDefaultConfig()
  const hasApiKey = Boolean(activeClient.config.apiKey ?? envConfig.apiKey)

  const [mode, setMode] = useState<ShortageRecoveryMode>(() => {
    if (options?.initialMode) return options.initialMode
    return hasApiKey ? 'live' : 'demo'
  })

  // Brief state
  const [isLoading, setIsLoading] = useState<boolean>(mode === 'live')
  const [error, setError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [liveBrief, setLiveBrief] = useState<BriefResponseDTO | null>(null)

  // Recovery proposal state (from POST /api/recovery/propose)
  const [isProposing, setIsProposing] = useState<boolean>(false)
  const [proposalError, setProposalError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [liveProposal, setLiveProposal] = useState<RecoveryProposalResultViewModel | null>(null)

  // Pending actions state (from GET /api/actions?status=pending)
  const [livePendingActions, setLivePendingActions] = useState<readonly ProposedActionDTO[]>([])
  const [isLoadingActions, setIsLoadingActions] = useState<boolean>(false)
  const [actionsError, setActionsError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)

  // Mutation states (Approval & Rejection)
  const [isApprovingActionId, setIsApprovingActionId] = useState<string | null>(null)
  const [isRejectingActionId, setIsRejectingActionId] = useState<string | null>(null)
  const [actionMutationError, setActionMutationError] = useState<ActionMutationErrorState | null>(null)
  const [postApprovalRefreshError, setPostApprovalRefreshError] = useState<string | null>(null)
  const [latestApprovalResult, setLatestApprovalResult] = useState<ApprovalResultViewModel | null>(null)
  const [latestRejectionResult, setLatestRejectionResult] = useState<RejectionResultViewModel | null>(null)

  // Selected shortage for simulation
  const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null)
  const [reportedQty, setReportedQty] = useState<number | undefined>(undefined)

  const briefAbortRef = useRef<AbortController | null>(null)
  const actionsAbortRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef<number>(0)
  const actionsSeqRef = useRef<number>(0)
  const proposalSeqRef = useRef<number>(0)

  // Fetch Risk Brief for targetDate
  const fetchBrief = useCallback(async () => {
    if (mode !== 'live') {
      setIsLoading(false)
      setError(null)
      return
    }

    if (briefAbortRef.current) {
      briefAbortRef.current.abort()
    }
    const controller = new AbortController()
    briefAbortRef.current = controller

    const currentSeq = ++requestSeqRef.current

    setIsLoading(true)
    setError(null)

    try {
      const brief = await getBrief(
        { date: targetDate },
        { signal: controller.signal, client: activeClient }
      )

      if (currentSeq !== requestSeqRef.current) return

      setLiveBrief(brief)
      setError(null)

      // Auto-select first shortage ingredient if none selected
      if (brief.shortages.length > 0) {
        setSelectedIngredientId((prev) => prev ?? brief.shortages[0].ingredient_id)
      } else {
        setSelectedIngredientId(null)
      }
    } catch (err: unknown) {
      if (currentSeq !== requestSeqRef.current) return
      if (err instanceof Error && err.name === 'AbortError') return
      if (err instanceof NetworkError && err.isAborted) return

      // HARD RULE: Never silently fall back to mock data on API errors
      setError(err instanceof Error ? err : new Error(String(err)))
      setLiveBrief(null)
    } finally {
      if (currentSeq === requestSeqRef.current) {
        setIsLoading(false)
      }
    }
  }, [mode, targetDate, activeClient])

  // Fetch Pending Actions (GET /api/actions?status=pending)
  const fetchPendingActions = useCallback(async () => {
    if (mode !== 'live') {
      setIsLoadingActions(false)
      setActionsError(null)
      setLivePendingActions([])
      return
    }

    if (actionsAbortRef.current) {
      actionsAbortRef.current.abort()
    }
    const controller = new AbortController()
    actionsAbortRef.current = controller

    const currentSeq = ++actionsSeqRef.current

    setIsLoadingActions(true)
    setActionsError(null)

    try {
      const response = await getActions(
        { status: 'pending' },
        { signal: controller.signal, client: activeClient }
      )

      if (currentSeq !== actionsSeqRef.current) return

      setLivePendingActions(response.data)
      setActionsError(null)
    } catch (err: unknown) {
      if (currentSeq !== actionsSeqRef.current) return
      if (err instanceof Error && err.name === 'AbortError') return
      if (err instanceof NetworkError && err.isAborted) return

      setActionsError(err instanceof Error ? err : new Error(String(err)))
      setLivePendingActions([])
    } finally {
      if (currentSeq === actionsSeqRef.current) {
        setIsLoadingActions(false)
      }
    }
  }, [mode, activeClient])

  // Load initial brief and pending actions
  useEffect(() => {
    const run = async () => {
      await Promise.all([fetchBrief(), fetchPendingActions()])
    }
    void run()

    return () => {
      if (briefAbortRef.current) briefAbortRef.current.abort()
      if (actionsAbortRef.current) actionsAbortRef.current.abort()
    }
  }, [fetchBrief, fetchPendingActions])

  const [prevTargetDate, setPrevTargetDate] = useState(targetDate)
  const [prevMode, setPrevMode] = useState(mode)

  if (prevTargetDate !== targetDate || prevMode !== mode) {
    setPrevTargetDate(targetDate)
    setPrevMode(mode)
    setLiveProposal(null)
    setProposalError(null)
    setActionMutationError(null)
  }

  // Clear in-flight proposals when switching dates or mode
  useEffect(() => {
    proposalSeqRef.current++
  }, [targetDate, mode])

  // Request recovery options (POST /api/recovery/propose)
  const requestRecoveryProposal = useCallback(
    async (ingredientId: string, reportedAvailableQty?: number) => {
      // Prevent duplicate submissions while in progress
      if (isProposing) return

      // Validate reportedAvailableQty if provided: reject negative or NaN
      if (reportedAvailableQty !== undefined) {
        if (
          typeof reportedAvailableQty !== 'number' ||
          Number.isNaN(reportedAvailableQty) ||
          reportedAvailableQty < 0
        ) {
          setProposalError(
            new ApiError(422, {
              code: 'VALIDATION_ERROR',
              message: 'Reported available quantity must be a non-negative number'
            })
          )
          return
        }
      }

      const proposalSeq = ++proposalSeqRef.current
      const requestDate = targetDate

      setIsProposing(true)
      setProposalError(null)

      if (mode === 'demo') {
        // Simulated response for demo mode
        setTimeout(() => {
          if (proposalSeq === proposalSeqRef.current && requestDate === targetDate) {
            setLiveProposal(DEMO_VIEW_PROPOSAL)
            setIsProposing(false)
          }
        }, 400)
        return
      }

      try {
        const payload: RecoveryProposeRequestDTO = {
          date: targetDate,
          ingredient_id: ingredientId,
          ...(reportedAvailableQty !== undefined ? { reported_available_qty: reportedAvailableQty } : {})
        }

        const response: RecoveryProposeResponseDTO = await proposeRecovery(payload, {
          client: activeClient
        })

        if (proposalSeq !== proposalSeqRef.current || requestDate !== targetDate) return

        const adapted = adaptRecoveryResponseToViewModel(response)
        setLiveProposal(adapted)
        setProposalError(null)

        // Refresh pending actions so any newly stored pending actions appear
        void fetchPendingActions()
      } catch (err: unknown) {
        if (proposalSeq !== proposalSeqRef.current || requestDate !== targetDate) return

        // Surface actual backend error (e.g. 409 NO_SHORTAGE_DETECTED, 404 PLAN_NOT_FOUND)
        setProposalError(err instanceof Error ? err : new Error(String(err)))
        setLiveProposal(null)
      } finally {
        if (proposalSeq === proposalSeqRef.current) {
          setIsProposing(false)
        }
      }
    },
    [isProposing, mode, targetDate, activeClient, fetchPendingActions]
  )

  // Explicit Action Approval (POST /api/actions/{id}/approve)
  const approveRecoveryOption = useCallback(
    async (actionId: string, optionNumber: number): Promise<ApprovalResultViewModel | null> => {
      // 1. Prevent duplicate submissions while in progress
      if (isApprovingActionId !== null || isRejectingActionId !== null) {
        return null
      }

      // 2. Demo mode isolation per contract
      if (mode === 'demo') {
        setActionMutationError({
          actionId,
          error: new Error(
            'Action approval is disabled in Demo Mode. Connect a live backend with API key to approve and apply changes to the operational plan.'
          )
        })
        return null
      }

      setIsApprovingActionId(actionId)
      setActionMutationError(null)
      setPostApprovalRefreshError(null)

      try {
        const payload: ActionApproveRequestDTO = {
          confirm_option_number: optionNumber,
          input_mode: 'click'
        }

        const response: ActionApproveResponseDTO = await approveAction(actionId, payload, {
          client: activeClient
        })

        const result = adaptApprovalResponseToViewModel(response)
        setLatestApprovalResult(result)

        // Update local proposal state: mark executed and mark sibling actions as expired
        setLiveProposal((prev) => {
          if (!prev) return null
          const updatedOptions = prev.options.map((opt) => {
            if (opt.actionId === actionId) {
              return { ...opt, status: 'executed' as const }
            }
            if (response.expired_action_ids?.includes(opt.actionId)) {
              return { ...opt, status: 'expired' as const }
            }
            return opt
          })
          return { ...prev, options: updatedOptions }
        })

        // Post-approval background refreshes: refresh brief, pending actions, and schedule plan
        try {
          await Promise.all([
            fetchBrief(),
            fetchPendingActions(),
            getPlan({ date: targetDate }, { client: activeClient })
          ])
        } catch (refreshErr: unknown) {
          // If subsequent GET fails, preserve the successful approval result and report refresh failure separately
          const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
          setPostApprovalRefreshError(`Plan change succeeded, but automatic refresh failed: ${msg}`)
        }

        return result
      } catch (err: unknown) {
        const mappedErr =
          err instanceof ApiError || err instanceof ConfigurationError || err instanceof NetworkError
            ? err
            : err instanceof Error
              ? err
              : new Error(String(err))

        // On 409 ACTION_NOT_PENDING or 409 ACTION_EXPIRED, refresh pending actions
        if (err instanceof ApiError) {
          if (err.code === 'ACTION_NOT_PENDING' || err.code === 'ACTION_EXPIRED') {
            void fetchPendingActions()
          }
          if (err.code === 'ACTION_EXPIRED') {
            setLiveProposal((prev) => {
              if (!prev) return null
              const updatedOptions = prev.options.map((opt) =>
                opt.actionId === actionId ? { ...opt, status: 'expired' as const } : opt
              )
              return { ...prev, options: updatedOptions }
            })
          }
        }

        setActionMutationError({ actionId, error: mappedErr })
        return null
      } finally {
        setIsApprovingActionId(null)
      }
    },
    [
      isApprovingActionId,
      isRejectingActionId,
      mode,
      activeClient,
      targetDate,
      fetchBrief,
      fetchPendingActions
    ]
  )

  // Explicit Action Rejection (POST /api/actions/{id}/reject)
  const rejectRecoveryOption = useCallback(
    async (actionId: string, reason?: string): Promise<RejectionResultViewModel | null> => {
      // 1. Prevent duplicate submissions while in progress
      if (isApprovingActionId !== null || isRejectingActionId !== null) {
        return null
      }

      // 2. Demo mode isolation per contract
      if (mode === 'demo') {
        setActionMutationError({
          actionId,
          error: new Error(
            'Action rejection is disabled in Demo Mode. Connect a live backend with API key to record owner decisions in the audit log.'
          )
        })
        return null
      }

      setIsRejectingActionId(actionId)
      setActionMutationError(null)

      try {
        const payload: ActionRejectRequestDTO | undefined = reason ? { reason } : undefined

        const response: ActionRejectResponseDTO = await rejectAction(actionId, payload, {
          client: activeClient
        })

        const result = adaptRejectionResponseToViewModel(response)
        setLatestRejectionResult(result)

        // Update local proposal state: mark action as rejected
        setLiveProposal((prev) => {
          if (!prev) return null
          const updatedOptions = prev.options.map((opt) =>
            opt.actionId === actionId ? { ...opt, status: 'rejected' as const } : opt
          )
          return { ...prev, options: updatedOptions }
        })

        // Refresh pending actions list
        try {
          await fetchPendingActions()
        } catch {
          // Non-fatal
        }

        return result
      } catch (err: unknown) {
        const mappedErr =
          err instanceof ApiError || err instanceof ConfigurationError || err instanceof NetworkError
            ? err
            : err instanceof Error
              ? err
              : new Error(String(err))

        if (err instanceof ApiError && err.code === 'ACTION_NOT_PENDING') {
          void fetchPendingActions()
        }

        setActionMutationError({ actionId, error: mappedErr })
        return null
      } finally {
        setIsRejectingActionId(null)
      }
    },
    [isApprovingActionId, isRejectingActionId, mode, activeClient, fetchPendingActions]
  )

  const clearProposal = useCallback(() => {
    proposalSeqRef.current++
    setLiveProposal(null)
    setProposalError(null)
    setActionMutationError(null)
  }, [])

  const clearApprovalResult = useCallback(() => {
    setLatestApprovalResult(null)
    setPostApprovalRefreshError(null)
  }, [])

  const clearRejectionResult = useCallback(() => {
    setLatestRejectionResult(null)
  }, [])

  const clearActionMutationError = useCallback(() => {
    setActionMutationError(null)
  }, [])

  const isLiveMode = mode === 'live'

  // View models derivation
  const shortages = isLiveMode
    ? liveBrief ? adaptShortagesToViewModels(liveBrief) : []
    : DEMO_VIEW_SHORTAGES

  const atRiskOrders = isLiveMode
    ? liveBrief ? adaptAtRiskOrdersToViewModels(liveBrief.at_risk_orders) : []
    : DEMO_VIEW_AT_RISK_ORDERS

  const summary = isLiveMode
    ? deriveShortageRecoverySummary(liveBrief, targetDate)
    : DEMO_VIEW_SUMMARY

  const proposal = liveProposal

  const pendingActions = isLiveMode
    ? adaptProposedActionsToViewModels(livePendingActions)
    : []

  const isEmptyShortages = isLiveMode && liveBrief !== null && shortages.length === 0

  return {
    mode,
    isLive: isLiveMode && liveBrief !== null,
    isLoading,
    isProposing,
    isApprovingActionId,
    isRejectingActionId,
    error,
    proposalError,
    actionMutationError,
    postApprovalRefreshError,
    latestApprovalResult,
    latestRejectionResult,
    isMissingConfig: !hasApiKey,
    isEmptyShortages,
    targetDate,
    formattedDate: formatDateIST(targetDate),
    kitchenName: DEMO_RECOVERY_METADATA.kitchenName,
    summary,
    shortages,
    atRiskOrders,
    proposal,
    pendingActions,
    isLoadingActions,
    actionsError,
    selectedIngredientId,
    reportedQty,
    setSelectedIngredientId,
    setReportedQty,
    requestRecoveryProposal,
    approveRecoveryOption,
    rejectRecoveryOption,
    clearApprovalResult,
    clearRejectionResult,
    clearActionMutationError,
    clearProposal,
    setTargetDate,
    refetch: fetchBrief,
    refetchActions: fetchPendingActions,
    setMode
  }
}
