/* ============================================================
   frontend/src/types/dto.ts
   OperAI / Cloud Kitchen Rescue — API Data Transfer Objects (DTOs)

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md
   - docs/Database_Schema.md
   - docs/System_Architecture.md
   - frontend/docs/stage-2.1-corrective-audit.md

   RULES (AGENTS.md & Stage 2.2):
   1. Field names preserve backend JSON keys exactly (snake_case).
   2. Documented field types preserved (numeric for money, ISO string for timestamps).
   3. String unions used for enums ONLY when allowed values are documented.
   4. Nullability modeled only where documented by the contract.
   5. Response envelopes ({ data, count }) modeled exactly as specified.
   6. NO UI-only fields (no progressPct, urgency, minutesUntilDue, formatted
      currency, display labels, or station workload aggregations).
   7. Immutable contract boundaries (all properties marked readonly).
   ============================================================ */

/* ── Common Enums & Base Types ─────────────────────────────── */

/** Documented data provenance flag (AGENTS.md Rule 9, DB Schema §1) */
export type DataSourceDTO = 'simulated' | 'verified'

/** Documented order intake channels (DB Schema §3.6) */
export type OrderChannelDTO =
  | 'whatsapp'
  | 'instagram'
  | 'swiggy'
  | 'zomato'
  | 'direct'

/** Documented order lifecycle statuses (Rest_API_Spec.md §3.5) */
export type OrderStatusDTO =
  | 'new'
  | 'planned'
  | 'in_progress'
  | 'delayed'
  | 'partial'
  | 'completed'
  | 'cancelled'

/** Documented plan task work types (DB Schema §3.8) */
export type PlanTaskTypeDTO = 'prep' | 'cook' | 'pack'

/** Documented plan task execution statuses (DB Schema §3.8) */
export type PlanTaskStatusDTO =
  | 'scheduled'
  | 'in_progress'
  | 'done'
  | 'cancelled'

/** Documented dish margin health evaluation (Rest_API_Spec.md §3.3) */
export type MarginStatusDTO = 'loss' | 'below_target' | 'healthy'

/** Documented proposed action category (Rest_API_Spec.md §3.11, DB Schema §3.9) */
export type ActionTypeDTO =
  | 'recovery'
  | 'price_change'
  | 'order_intake'
  | 'undo'

/** Documented proposed action state (Rest_API_Spec.md §3.11, DB Schema §3.9) */
export type ActionStatusDTO =
  | 'pending'
  | 'approved'
  | 'executed'
  | 'rejected'
  | 'expired'
  | 'failed'

/** Documented recovery strategy candidate types (Rest_API_Spec.md §3.10) */
export type RecoveryOptionTypeDTO =
  | 'substitute'
  | 'dish_swap'
  | 'delay_notify'
  | 'partial'
  | 'emergency_purchase'

/** Documented audit log event types (Rest_API_Spec.md §3.14, DB Schema §3.10) */
export type AuditEventTypeDTO =
  | 'action_executed'
  | 'action_rejected'
  | 'undo_executed'
  | 'order_created'
  | 'stock_updated'

/** Documented audit actor identities (Rest_API_Spec.md §3.14, DB Schema §3.10) */
export type AuditActorDTO = 'owner' | 'system' | 'agent'

/* ── Standard Error & Envelope Shapes ──────────────────────── */

export interface ApiErrorDTO {
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

/** Standard error envelope returned on 4xx/5xx responses (Rest_API_Spec.md §1) */
export interface ApiErrorResponseDTO {
  readonly error: ApiErrorDTO
}

/** Generic list response envelope (Rest_API_Spec.md §1) */
export interface ApiListResponseDTO<T> {
  readonly data: readonly T[]
  readonly count: number
}

/* ── 1. Orders Contract (Rest_API_Spec.md §3.5 & §3.6) ─────── */

export interface OrderItemDTO {
  readonly menu_item_id: string
  readonly name: string
  readonly quantity: number
  readonly unit_price: number
}

/** Single order record returned by GET /api/orders (Rest_API_Spec.md §3.5) */
export interface OrderDTO {
  readonly id: string
  readonly customer_name: string
  readonly channel: OrderChannelDTO
  readonly deadline: string // ISO 8601 with offset (e.g. "2026-10-17T12:30:00+05:30")
  readonly status: OrderStatusDTO
  readonly total_amount: number // 2-decimal numeric
  readonly items: readonly OrderItemDTO[]
}

export type OrderListResponseDTO = ApiListResponseDTO<OrderDTO>

/** Order extraction draft payload returned by POST /api/orders/extract (Rest_API_Spec.md §3.6) */
export interface OrderDraftDTO {
  readonly customer_name: string
  readonly customer_phone?: string
  readonly channel: OrderChannelDTO
  readonly deadline: string // ISO 8601 with offset
  readonly items: readonly OrderItemDTO[]
  readonly total_amount: number
}

export interface OrderExtractSuccessResponseDTO {
  readonly draft: OrderDraftDTO
  readonly confidence: number
  readonly warnings: readonly string[]
  readonly action: ProposedActionDTO
}

export interface OrderExtractAmbiguousResponseDTO {
  readonly draft: null
  readonly confidence: number
  readonly clarifying_questions: readonly string[]
  readonly action: null
}

export type OrderExtractResponseDTO =
  | OrderExtractSuccessResponseDTO
  | OrderExtractAmbiguousResponseDTO

/* ── 2. Schedule & Plan Contract (Rest_API_Spec.md §3.7 & §3.8) ─ */

/** Scheduled work block in the kitchen timeline (Rest_API_Spec.md §3.8) */
export interface PlanTaskDTO {
  readonly id: string
  readonly order_id: string
  readonly order_item_id: string
  readonly dish: string
  readonly task_type: PlanTaskTypeDTO
  readonly burner_no: number | null // null for prep/pack, integer for cook
  readonly cook_no: number
  readonly start_at: string // ISO 8601 with offset
  readonly end_at: string   // ISO 8601 with offset
  readonly status: PlanTaskStatusDTO
  readonly locked: boolean
}

/** Response shape for GET /api/plan (Rest_API_Spec.md §3.8) */
export interface PlanResponseDTO {
  readonly date: string // YYYY-MM-DD
  readonly plan_version: number
  readonly tasks: readonly PlanTaskDTO[]
  readonly late_orders: readonly string[] // Array of order UUIDs unable to meet deadline
}

/** Response shape for POST /api/plan/generate (Rest_API_Spec.md §3.7) */
export interface PlanGenerateResponseDTO {
  readonly date: string // YYYY-MM-DD
  readonly plan_version: number
  readonly solver: 'cp_sat' | 'greedy'
  readonly feasible: boolean
  readonly orders_scheduled: number
  readonly task_count: number
  readonly late_orders: readonly string[]
}

/* ── 3. Proactive Risk Brief Contract (Rest_API_Spec.md §3.9) ─ */

export interface ShortageDTO {
  readonly ingredient_id: string
  readonly name: string
  readonly unit: string
  readonly stock_qty: number
  readonly needed_qty: number
  readonly short_by: number
}

export interface AtRiskOrderDTO {
  readonly order_id: string
  readonly customer_name: string
  readonly deadline: string // ISO 8601 with offset
  readonly total_amount: number
}

/** Response shape for GET /api/brief (Rest_API_Spec.md §3.9) */
export interface BriefResponseDTO {
  readonly date: string // YYYY-MM-DD
  readonly order_count: number
  readonly shortages: readonly ShortageDTO[]
  readonly at_risk_orders: readonly AtRiskOrderDTO[]
  readonly revenue_at_risk: number
  readonly data_source: DataSourceDTO
}

/* ── 4. Menu & Pricing Contract (Rest_API_Spec.md §3.3 & §3.4) ─ */

/** Shared cost structure calculated dynamically by backend services (Rest_API_Spec.md §3.3 & §3.4) */
export interface CostBreakdownDTO {
  readonly ingredients: number
  readonly packaging: number
  readonly commission: number
  readonly overhead: number
  readonly total: number
}

/** Menu dish catalog item returned by GET /api/menu (Rest_API_Spec.md §3.3) */
export interface MenuItemDTO {
  readonly id: string
  readonly name: string
  readonly price: number
  readonly cost_breakdown?: CostBreakdownDTO
  readonly profit_per_order?: number
  readonly margin_pct?: number
  readonly margin_status?: MarginStatusDTO
  readonly is_active?: boolean
  readonly data_source?: DataSourceDTO
}

export type MenuListResponseDTO = ApiListResponseDTO<MenuItemDTO>

/** Pricing engine assumptions returned by POST /api/pricing/analyze (Rest_API_Spec.md §3.4) */
export interface PricingAnalysisAssumptionsDTO {
  readonly commission_pct: number
  readonly overhead_pct: number
  readonly target_margin_pct: number
  readonly data_source: DataSourceDTO
}

/** Request payload for POST /api/pricing/analyze (Rest_API_Spec.md §3.4) */
export interface PricingAnalyzeRequestDTO {
  readonly menu_item_id: string
  readonly price?: number
  readonly propose_change?: boolean
}

/** Response shape for POST /api/pricing/analyze (Rest_API_Spec.md §3.4) */
export interface PricingAnalysisResponseDTO {
  readonly menu_item_id: string
  readonly name: string
  readonly analyzed_price: number
  readonly current_price: number
  readonly cost_breakdown: CostBreakdownDTO
  readonly profit_per_order: number
  readonly margin_pct: number
  readonly margin_status: MarginStatusDTO
  readonly suggested_price: number
  readonly suggested_profit_per_order: number
  readonly suggested_margin_pct: number
  readonly assumptions: PricingAnalysisAssumptionsDTO
  readonly action: ProposedActionDTO | null
}

/* ── 5. Proposed Actions Contract (Rest_API_Spec.md §3.11, §3.12, §3.13) ─ */

/** Recovery impact summary payload (Rest_API_Spec.md §3.10 & §3.11) */
export interface ActionRecoveryImpactDTO {
  readonly late_orders: number
  readonly orders_protected: number
  readonly extra_cost: number
  readonly score: number
  readonly revenue_at_risk_after?: number
  readonly margin_before_pct?: number
  readonly margin_after_pct?: number
  readonly customer_risk?: 'low' | 'medium' | 'high'
}

/** Price change impact summary payload (Rest_API_Spec.md §3.4) */
export interface ActionPriceChangeImpactDTO {
  readonly profit_per_order_before: number
  readonly profit_per_order_after: number
}

export type ActionImpactDTO =
  | ActionRecoveryImpactDTO
  | ActionPriceChangeImpactDTO
  | Record<string, unknown>

/** Proposed action object (Rest_API_Spec.md §3.11) */
export interface ProposedActionDTO {
  readonly id: string
  readonly group_id: string
  readonly option_number: number
  readonly action_type: ActionTypeDTO
  readonly title: string
  readonly status: ActionStatusDTO
  readonly impact?: ActionImpactDTO | null
  readonly base_plan_version?: number
  readonly undo_of_audit_id?: string | null
  readonly created_at?: string // ISO 8601 with offset
  readonly expires_at: string  // ISO 8601 with offset
}

export type ActionListResponseDTO = ApiListResponseDTO<ProposedActionDTO>

/** Customer notification draft returned upon approval (Rest_API_Spec.md §3.12) */
export interface CustomerMessageDTO {
  readonly order_id: string
  readonly customer_name: string
  readonly needs_consent: boolean
  readonly message: string
  readonly whatsapp_url: string
}

/** Request shape for POST /api/actions/{id}/approve (Rest_API_Spec.md §3.12) */
export interface ActionApproveRequestDTO {
  readonly confirm_option_number: number
  readonly input_mode?: 'voice' | 'click'
  readonly transcript?: string
}

/** Response shape for POST /api/actions/{id}/approve (Rest_API_Spec.md §3.12) */
export interface ActionApproveResponseDTO {
  readonly action: {
    readonly id: string
    readonly status: 'executed'
    readonly executed_at: string
  }
  readonly plan_version_before: number
  readonly plan_version_after: number
  readonly audit_id: string
  readonly changes: {
    readonly orders_affected: readonly string[]
    readonly tasks_rescheduled: number
    readonly summary: string
  }
  readonly customer_messages: readonly CustomerMessageDTO[]
  readonly expired_action_ids: readonly string[]
}

/** Request shape for POST /api/actions/{id}/reject (Rest_API_Spec.md §3.13) */
export interface ActionRejectRequestDTO {
  readonly reason?: string
}

/** Response shape for POST /api/actions/{id}/reject (Rest_API_Spec.md §3.13) */
export interface ActionRejectResponseDTO {
  readonly action: {
    readonly id: string
    readonly status: 'rejected'
    readonly decided_at: string
  }
  readonly audit_id: string
}

/* ── 6. Shortage Recovery Options Contract (Rest_API_Spec.md §3.10) ─ */

export interface RecoveryBaselineDTO {
  readonly label: string
  readonly late_orders: number
  readonly revenue_at_risk: number
  readonly extra_cost: number
}

export interface RecoveryShortageSummaryDTO {
  readonly ingredient_id: string
  readonly name: string
  readonly short_by: number
  readonly unit: string
}

export interface RecoveryScoringWeightsDTO {
  readonly weights: {
    readonly lateness: number
    readonly margin: number
    readonly customer_risk: number
  }
}

export interface RecoveryOptionDTO {
  readonly action_id: string
  readonly option_number: number
  readonly option_type: RecoveryOptionTypeDTO
  readonly title: string
  readonly status: ActionStatusDTO
  readonly needs_customer_consent: boolean
  readonly impact: ActionRecoveryImpactDTO
  readonly expires_at: string
}

/** Request shape for POST /api/recovery/propose (Rest_API_Spec.md §3.10) */
export interface RecoveryProposeRequestDTO {
  readonly date: string // YYYY-MM-DD (required)
  readonly ingredient_id: string // (required)
  readonly reported_available_qty?: number // optional number (e.g. 0 for "we're out of paneer")
}

/** Response shape for POST /api/recovery/propose (Rest_API_Spec.md §3.10) */
export interface RecoveryProposeResponseDTO {
  readonly group_id?: string
  readonly shortage?: RecoveryShortageSummaryDTO
  readonly baseline?: RecoveryBaselineDTO
  readonly scoring?: RecoveryScoringWeightsDTO
  readonly recommended_option_number?: number
  readonly options: readonly RecoveryOptionDTO[]
  readonly escalation?: string
}

/* ── 7. Audit Log & Undo Contract (Rest_API_Spec.md §3.14 & §3.15) ─ */

/** Audit entry returned by GET /api/audit (Rest_API_Spec.md §3.14) */
export interface AuditLogDTO {
  readonly id: string
  readonly action_id: string | null
  readonly event_type: AuditEventTypeDTO
  readonly actor: AuditActorDTO
  readonly summary: string
  readonly plan_version_before?: number | null
  readonly plan_version_after?: number | null
  readonly undoable: boolean
  readonly created_at: string // ISO 8601 with offset
  readonly before_snapshot?: Record<string, unknown> | null
  readonly after_snapshot?: Record<string, unknown> | null
}

export type AuditListResponseDTO = ApiListResponseDTO<AuditLogDTO>

/** Proposed undo action payload returned by POST /api/audit/{id}/undo (Rest_API_Spec.md §3.15) */
export interface AuditUndoActionDTO {
  readonly id: string
  readonly group_id: string
  /**
   * Option number to confirm at approval.
   * NOTE: Optional here because the REST API specification text does not explicitly guarantee
   * option_number across all response shapes, although the example shows option_number: 1.
   */
  readonly option_number?: number
  readonly action_type: 'undo' | ActionTypeDTO
  readonly title: string
  readonly status: ActionStatusDTO
  readonly undo_of_audit_id?: string | null
  readonly base_plan_version?: number
  readonly expires_at: string // ISO 8601 with offset
  readonly impact?: ActionImpactDTO | null
  readonly created_at?: string // ISO 8601 with offset
}

/** Response shape for POST /api/audit/{id}/undo (Rest_API_Spec.md §3.15) */
export interface AuditUndoResponseDTO {
  readonly action: AuditUndoActionDTO
}

/* ── 8. Ingredients Stock Contract (Rest_API_Spec.md §3.2) ──── */

export interface IngredientDTO {
  readonly id: string
  readonly name: string
  readonly unit: string
  readonly stock_qty: number
  readonly cost_per_unit: number
  readonly allergen_tags: readonly string[]
  readonly diet_tags: readonly string[]
  readonly data_source: DataSourceDTO
}

export type IngredientListResponseDTO = ApiListResponseDTO<IngredientDTO>

/* ── 9. Day-End Summary Contract (Rest_API_Spec.md §3.17) ───── */

/** Response shape for GET /api/summary (Rest_API_Spec.md §3.17) */
export interface DailySummaryDTO {
  readonly date: string // YYYY-MM-DD
  readonly orders_total: number
  readonly orders_completed: number
  readonly actions_executed: number
  readonly actions_undone: number
  readonly orders_protected: number
  readonly revenue_protected: number
  readonly net_extra_cost: number
  readonly data_source: DataSourceDTO
}

/* ── 10. AI Agent Assistant Contract (Rest_API_Spec.md §3.16) ── */

/** Documented input mode for assistant chat requests (Rest_API_Spec.md §3.16) */
export type AgentChatInputModeDTO = 'voice' | 'text'

/** Role for messages in conversation history */
export type ChatHistoryRoleDTO = 'user' | 'assistant'

/** Single conversational turn in history */
export interface ChatHistoryMessageDTO {
  readonly role: ChatHistoryRoleDTO
  readonly content: string
}

/** Request shape for POST /api/agent/chat (Rest_API_Spec.md §3.16) */
export interface AgentChatRequestDTO {
  readonly message: string // required, 1 to 500 characters
  readonly input_mode?: AgentChatInputModeDTO
  readonly history?: readonly ChatHistoryMessageDTO[]
}

/** Response shape for POST /api/agent/chat (Rest_API_Spec.md §3.16) */
export interface AgentChatResponseDTO {
  readonly reply: string
  readonly intent: string
  readonly tool_used: string | null
  readonly data?: Record<string, unknown> | null
  readonly requires_confirmation: boolean
  readonly confirm_phrases: readonly string[]
}

