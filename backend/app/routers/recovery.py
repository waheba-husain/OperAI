from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_api_key
from app.schemas import RecoveryProposeRequest, RecoveryProposeResponse
from app.services.recovery import propose_recovery

router = APIRouter(tags=["recovery"], dependencies=[Depends(require_api_key)])


@router.post(
    "/api/recovery/propose",
    response_model=RecoveryProposeResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_recovery_proposal(
    payload: RecoveryProposeRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> RecoveryProposeResponse:
    result = propose_recovery(
        db,
        target_date=payload.date,
        ingredient_id=payload.ingredient_id,
        reported_available_qty=payload.reported_available_qty,
    )
    if not result.options:
        response.status_code = status.HTTP_200_OK
    db.commit()
    return result
