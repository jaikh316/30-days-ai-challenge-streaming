# services/stt.py
import os
import assemblyai
from fastapi import UploadFile
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def transcribe_audio(audio_file: UploadFile) -> str:
    """
    Transcribes audio using the AssemblyAI API.
    """
    api_key = os.getenv("ASSEMBLYAI_API_KEY")
    if not api_key:
        logger.error("AssemblyAI API key not found.")
        raise ValueError("AssemblyAI API key not found.")
    
    assemblyai.settings.api_key = api_key
    
    logger.info("Starting transcription...")
    transcriber = assemblyai.Transcriber()
    transcript = transcriber.transcribe(audio_file.file)

    if transcript.status == assemblyai.TranscriptStatus.error:
        logger.error(f"STT Error: {transcript.error}")
        raise Exception(f"STT Error: {transcript.error}")
    
    user_text = transcript.text
    logger.info(f"Transcription successful. Text: '{user_text}'")
    return user_text
