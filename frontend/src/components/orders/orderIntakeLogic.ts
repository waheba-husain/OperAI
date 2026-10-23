import type {
  OrderExtractResponseDTO,
  OrderExtractSuccessResponseDTO
} from '../../types/dto.ts'

export type OrderIntakeViewState = 'demo' | 'ready' | 'loading' | 'error' | 'clarification' | 'draft'

export function validateOrderMessage(message: string): string | null {
  if (!message.trim()) return 'Paste the customer message before extracting an order.'
  if (message.length > 2000) return 'Customer messages must be 2000 characters or fewer.'
  return null
}

export function getOrderIntakeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

export function getOrderIntakeViewState(input: {
  readonly isLive: boolean
  readonly isExtracting: boolean
  readonly result: OrderExtractResponseDTO | null
  readonly requestError: string | null
}): OrderIntakeViewState {
  if (input.isExtracting) return 'loading'
  if (input.requestError) return 'error'
  if (input.result && !input.result.draft) return 'clarification'
  if (input.result?.draft) return 'draft'
  return input.isLive ? 'ready' : 'demo'
}

export function canApproveOrder(input: {
  readonly isLive: boolean
  readonly actionStatus: string | undefined
  readonly isBusy: boolean
}): boolean {
  return input.isLive && input.actionStatus === 'pending' && !input.isBusy
}

export function toOrderDraftPreview(result: OrderExtractSuccessResponseDTO) {
  return {
    customerName: result.draft.customer_name,
    customerPhone: result.draft.customer_phone,
    channel: result.draft.channel,
    deadline: result.draft.deadline,
    items: result.draft.items.map((item) => ({
      key: item.menu_item_id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price
    })),
    totalAmount: result.draft.total_amount,
    confidence: result.confidence,
    warnings: result.warnings,
    optionNumber: result.action.option_number,
    actionStatus: result.action.status
  }
}
