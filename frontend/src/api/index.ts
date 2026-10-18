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
  approveAction,
  getActions,
  getAudit,
  getBrief,
  getIngredients,
  getMenu,
  getOrders,
  getPlan,
  getSummary,
  proposeRecovery,
  rejectAction
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
  calculateOrderUrgency,
  CHANNEL_DISPLAY_MAP,
  formatDateIST,
  formatTimeIST,
  mapOrderStatus
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
