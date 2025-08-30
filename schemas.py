# schemas.py
from pydantic import BaseModel
from typing import Optional

class AgentChatResponse(BaseModel):
    """Defines the structure for a successful agent chat response."""
    user_transcription: str
    ai_response_text: str
    ai_response_audio_url: str

class ErrorResponse(BaseModel):
    """Defines the structure for an error response."""
    user_transcription: Optional[str] = None
    ai_response_audio_url: str
    error: str
