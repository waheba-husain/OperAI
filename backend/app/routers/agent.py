"""Agent chat endpoint router (Rest_API_Spec.md §3.16).

Provides the conversational entry point for voice and text Live Mode interactions.
Read-and-propose only: the agent can generate proposals, but approval and execution
must go through POST /api/actions/{id}/approve.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.ai.bedrock import BedrockClient, get_bedrock_client
from app.db import get_db
from app.deps import require_api_key
from app.schemas import AgentChatRequest, AgentChatResponse
from app.services.chat import orchestrate_chat

router = APIRouter(tags=["agent"], dependencies=[Depends(require_api_key)])


@router.post("/api/agent/chat", response_model=AgentChatResponse)
def post_agent_chat(
    payload: AgentChatRequest,
    db: Session = Depends(get_db),
    bedrock: BedrockClient = Depends(get_bedrock_client),
) -> AgentChatResponse:
    """Conversational endpoint for voice and text assistant interactions."""
    return orchestrate_chat(
        db=db,
        bedrock=bedrock,
        message=payload.message,
        input_mode=payload.input_mode,
        history=payload.history,
    )
