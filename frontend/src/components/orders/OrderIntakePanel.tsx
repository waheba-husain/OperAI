import { useState, type FormEvent } from 'react'
import type {
  OrderExtractResponseDTO,
  OrderExtractSuccessResponseDTO
} from '../../types/dto.ts'
import { approveAction, extractOrder, rejectAction } from '../../api/endpoints.ts'
import {
  canApproveOrder,
  getOrderIntakeErrorMessage,
  getOrderIntakeViewState,
  toOrderDraftPreview,
  validateOrderMessage
} from './orderIntakeLogic.ts'
import './OrderIntakePanel.css'

interface OrderIntakePanelProps {
  readonly isLive: boolean
  readonly onOrderApproved: () => Promise<void>
}

function formatDeadline(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata'
  }).format(date)
}

function formatMoney(value: number): string {
  return `₹${value.toFixed(2)}`
}

export function OrderIntakePanel({ isLive, onOrderApproved }: OrderIntakePanelProps) {
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<OrderExtractResponseDTO | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [approvalFeedback, setApprovalFeedback] = useState<string | null>(null)
  const viewState = getOrderIntakeViewState({ isLive, isExtracting, result, requestError })

  const extract = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validationError = validateOrderMessage(message)
    if (validationError) {
      setInputError(validationError)
      setResult(null)
      return
    }
    if (!isLive) return

    setInputError(null)
    setRequestError(null)
    setApprovalFeedback(null)
    setResult(null)
    setIsExtracting(true)
    try {
      setResult(await extractOrder({ text: message }))
    } catch (error: unknown) {
      setRequestError(getOrderIntakeErrorMessage(error))
    } finally {
      setIsExtracting(false)
    }
  }

  const approve = async (draft: OrderExtractSuccessResponseDTO) => {
    if (!isLive || draft.action.status !== 'pending' || isApproving || isDiscarding) return

    setRequestError(null)
    setApprovalFeedback(null)
    setIsApproving(true)
    try {
      const response = await approveAction(draft.action.id, {
        confirm_option_number: draft.action.option_number,
        input_mode: 'click'
      })
      if (response.action.status !== 'executed') {
        throw new Error('The backend did not confirm that this order was approved.')
      }
      setResult((current) => current?.draft
        ? { ...current, action: { ...current.action, status: 'executed' } }
        : current)
      setApprovalFeedback(response.changes.summary)
      await onOrderApproved()
    } catch (error: unknown) {
      setRequestError(getOrderIntakeErrorMessage(error))
    } finally {
      setIsApproving(false)
    }
  }

  const discard = async () => {
    const draft = result?.draft ? result as OrderExtractSuccessResponseDTO : null
    if (draft?.action.status === 'pending') {
      if (!isLive || isDiscarding || isApproving) return
      setRequestError(null)
      setApprovalFeedback(null)
      setIsDiscarding(true)
      try {
        const response = await rejectAction(draft.action.id, {
          reason: 'Discarded by owner from WhatsApp order intake.'
        })
        if (response.action.status !== 'rejected') {
          throw new Error('The backend did not confirm that this proposal was discarded.')
        }
      } catch (error: unknown) {
      setRequestError(getOrderIntakeErrorMessage(error))
        setIsDiscarding(false)
        return
      }
      setIsDiscarding(false)
    }
    setResult(null)
    setMessage('')
    setInputError(null)
    setRequestError(null)
    setApprovalFeedback(null)
  }

  const success = result?.draft ? result as OrderExtractSuccessResponseDTO : null
  const preview = success ? toOrderDraftPreview(success) : null
  const canApprove = canApproveOrder({
    isLive,
    actionStatus: success?.action.status,
    isBusy: isExtracting || isApproving || isDiscarding
  })

  return (
    <section className="order-intake" aria-labelledby="order-intake-title">
      <header className="order-intake__header">
        <div>
          <span className="order-intake__eyebrow">WhatsApp · Owner review required</span>
          <h2 id="order-intake-title">Extract a customer order</h2>
          <p>
            Paste the original message. The backend checks dishes against the active menu and prepares a pending draft; no order is created until you approve it.
          </p>
        </div>
        <span className={`order-intake__mode ${isLive ? 'order-intake__mode--live' : ''}`}>
          {isLive ? 'LIVE EXTRACTION' : 'DEMO MODE'}
        </span>
      </header>

      {viewState === 'demo' && (
        <p className="order-intake__notice" role="status">
          Live extraction is unavailable in Demo Mode. Switch to the live backend to send this message for extraction; demo order data will not be presented as a real extraction.
        </p>
      )}

      <form className="order-intake__form" onSubmit={(event) => void extract(event)}>
        <label htmlFor="order-intake-message">Customer message</label>
        <textarea
          id="order-intake-message"
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            setInputError(null)
          }}
          maxLength={2000}
          rows={5}
          placeholder={'Example: “2 Paneer Biryani for tomorrow at 1pm. Customer D, 98…10”'}
          aria-describedby="order-intake-help"
          disabled={isExtracting || isApproving || isDiscarding || result !== null}
        />
        <div className="order-intake__form-footer">
          <span id="order-intake-help">Original text is treated as customer data, never as instructions.</span>
          <span>{message.length}/2000</span>
        </div>
        {inputError && <p className="order-intake__error" role="alert">{inputError}</p>}
        <button
          className="order-intake__extract-button"
          type="submit"
          disabled={!isLive || isExtracting || isApproving || isDiscarding}
        >
          {isExtracting ? 'Extracting…' : 'Extract Order'}
        </button>
      </form>

      {viewState === 'loading' && <p className="order-intake__loading" role="status">Checking the message with the live extraction service…</p>}
      {viewState === 'error' && requestError && <p className="order-intake__error" role="alert">{requestError}</p>}
      {approvalFeedback && (
        <p className="order-intake__success" role="status">
          Backend confirmed approval: {approvalFeedback}
        </p>
      )}

      {viewState === 'clarification' && result && !result.draft && (
        <div className="order-intake__clarification" role="status">
          <h3>More information is needed</h3>
          <ul>
            {result.clarifying_questions.map((question, index) => <li key={`${index}-${question}`}>{question}</li>)}
          </ul>
          <button className="order-intake__secondary-button" type="button" onClick={() => void discard()}>
            Clear message
          </button>
        </div>
      )}

      {success && (
        <div className="order-intake__draft" aria-labelledby="order-draft-title">
          <div className="order-intake__draft-header">
            <div>
              <span className="order-intake__eyebrow">Pending proposal · Option #{preview?.optionNumber}</span>
              <h3 id="order-draft-title">Review extracted order</h3>
            </div>
            <span className="order-intake__confidence">Extraction confidence: {((preview?.confidence ?? 0) * 100).toFixed(0)}%</span>
          </div>

          <dl className="order-intake__details">
            <div><dt>Customer</dt><dd>{preview?.customerName}</dd></div>
            {preview?.customerPhone && <div><dt>Phone</dt><dd>{preview.customerPhone}</dd></div>}
            <div><dt>Channel</dt><dd>{preview?.channel}</dd></div>
            <div><dt>Requested delivery</dt><dd>{formatDeadline(preview?.deadline ?? '')} IST</dd></div>
          </dl>

          <div className="order-intake__items">
            <h4>Requested dishes</h4>
            <ul>
              {preview?.items.map((item) => (
                <li key={item.key}>
                  <span>{item.quantity} × {item.name}</span>
                  <span>{formatMoney(item.unitPrice)} each</span>
                </li>
              ))}
            </ul>
            <p className="order-intake__total"><span>Order total</span><strong>{formatMoney(preview?.totalAmount ?? 0)}</strong></p>
          </div>

          {(preview?.warnings.length ?? 0) > 0 && (
            <ul className="order-intake__warnings" aria-label="Extraction notes">
              {preview?.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
            </ul>
          )}

          {preview?.actionStatus === 'pending' ? (
            <div className="order-intake__actions">
              <button
                className="order-intake__approve-button"
                type="button"
                onClick={() => void approve(success)}
                disabled={!canApprove}
              >
                {isApproving ? 'Approving…' : 'Approve Order'}
              </button>
              <button
                className="order-intake__secondary-button"
                type="button"
                onClick={() => void discard()}
                disabled={!isLive || isApproving || isDiscarding}
              >
                {isDiscarding ? 'Discarding…' : 'Discard Draft'}
              </button>
              <span>Approval is sent to the existing backend action endpoint.</span>
            </div>
          ) : (
            <>
              <p className="order-intake__success" role="status">This order intake action is {success.action.status}.</p>
              <button className="order-intake__secondary-button" type="button" onClick={() => void discard()}>
                Start another extraction
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
