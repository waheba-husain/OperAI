/* ============================================================
   frontend/src/api/index.ts
   OperAI / Cloud Kitchen Rescue — API Module Public Exports
   ============================================================ */

// Client & Configuration
export { ApiClient, apiClient, getDefaultConfig } from './client'
export type { ApiClientConfig, RequestOptions } from './client'

// Standard Error Classes
export { ApiError, ConfigurationError, NetworkError } from './errors'

// Typed Endpoint Helpers
export {
  analyzePricing,
  approveAction,
  chatAgent,
  getActions,
  getAudit,
  getBrief,
  getIngredients,
  getMenu,
  getOrders,
  getPlan,
  getSummary,
  proposeRecovery,
  rejectAction,
  undoAudit
} from './endpoints'
export type {
  GetActionsParams,
  GetAuditParams,
  GetBriefParams,
  GetOrdersParams,
  GetPlanParams,
  GetSummaryParams
} from './endpoints'

// Presentation Adapters
export {
  adaptOrdersToLiveOrders,
  adaptOrderToLiveOrder,
  adaptOrderToLiveOpsQueue,
  adaptOrdersToLiveOpsQueue,
  adaptOrderToViewModel,
  adaptOrdersToViewModels,
  calculateDeadlineStatus,
  calculateOrderUrgency,
  CHANNEL_DISPLAY_MAP,
  deriveOrdersSummary,
  formatCurrency,
  formatDateIST,
  formatDeadlineDateIST,
  formatDueLabel,
  formatTimeIST,
  mapOrderStatus,
  STATUS_DISPLAY_MAP
} from './adapters/orderAdapter'

export {
  adaptPlanTaskToScheduleItem,
  adaptPlanTasksToScheduleItems,
  adaptTasksToLivePrepTasks,
  adaptTasksToOverviewItems,
  adaptTaskToLivePrepTask,
  adaptTaskToOverviewItem,
  calculateDurationMins,
  deriveSchedulePlanSummary,
  deriveWorkstationLabel,
  mapLiveTaskStatus,
  mapOverviewTaskStatus
} from './adapters/planAdapter'

export {
  adaptBriefToAiBriefing,
  adaptBriefToIngredientAlerts,
  adaptShortageToIngredientAlert
} from './adapters/briefAdapter'

export {
  adaptActionsToOpsAlerts,
  adaptActionToOpsAlert,
  adaptApprovalResponseToViewModel,
  adaptCustomerMessageToViewModel,
  adaptProposedActionsToViewModels,
  adaptProposedActionToViewModel,
  adaptRejectionResponseToViewModel,
  formatActionErrorMessage,
  formatActionImpactSummary,
  formatTimeAgo
} from './adapters/actionAdapter'

export { deriveOverviewKpis } from './adapters/kpiAdapter'
export type { KpiSourceData } from './adapters/kpiAdapter'

export {
  adaptAtRiskOrdersToViewModels,
  adaptRecoveryBaselineToViewModel,
  adaptRecoveryOptionToViewModel,
  adaptRecoveryResponseToViewModel,
  adaptShortagesToViewModels,
  adaptShortageToViewModel,
  deriveShortageRecoverySummary,
  formatCurrencyINR,
  formatExtraCostLabel,
  formatOptionTypeLabel
} from './adapters/recoveryAdapter'

export {
  adaptAuditLogsToViewModels,
  adaptAuditLogToViewModel,
  adaptSnapshotComparison,
  adaptUndoResponseToViewModel,
  AUDIT_ACTOR_PRESENTATION_MAP,
  AUDIT_EVENT_PRESENTATION_MAP,
  deriveAuditLogSummary,
  formatAuditTimestampIST,
  formatSnapshotValue,
  mapAuditActorPresentation,
  mapAuditEventPresentation,
  mapPlanVersionTransition,
  resolveUndoOptionNumberFromActions
} from './adapters/auditAdapter'

export {
  adaptCostBreakdown,
  adaptMenuItemToViewModel,
  adaptMenuItemsToViewModels,
  adaptPricingAnalysisToViewModel,
  calculateSimulatedPricingAnalysis,
  deriveMenuSummary,
  formatMarginStatusLabel,
  MARGIN_STATUS_DISPLAY_MAP
} from './adapters/menuAdapter'
