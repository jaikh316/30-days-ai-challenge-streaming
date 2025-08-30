# services/tts.py
import os
import requests
import time
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_voices() -> list:
    """Fetches the list of available voices from the Murf AI API."""
    api_key = os.getenv("MURF_API_KEY")
    if not api_key:
        logger.error("MURF_API_KEY not found in environment variables.")
        raise ValueError("MURF_API_KEY not found.")
    
    api_key = api_key.strip()
    
    url = "https://api.murf.ai/v1/speech/voices"
    headers = {"api-key": api_key}
    
    logger.info("Fetching voices from Murf AI...")
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        
        voices = response.json()
        logger.info(f"Successfully fetched {len(voices)} voices from Murf AI.")
        return voices
    except requests.exceptions.RequestException as e:
        logger.error(f"Error fetching voices: {e}")
        raise

def generate_speech_audio(text: str, voice_id: str, session_id: str) -> str:
    """
    Generates speech audio using the Murf AI API.
    """
    api_key = os.getenv("MURF_API_KEY")
    if not api_key:
        logger.error("MURF_API_KEY not found in environment variables.")
        raise ValueError("MURF_API_KEY not found.")
    
    api_key = api_key.strip()
    
    generate_url = "https://api.murf.ai/v1/speech/generate" 
    headers = {
        "Content-Type": "application/json",
        "api-key": api_key
    }
    
    payload = {
        "voiceId": voice_id,
        "text": text,
        "format": "MP3",
        "sampleRate": 24000,
        "modelVersion": "GEN2"
    }
    
    logger.info(f"Requesting speech generation from Murf AI...")
    
    try:
        response = requests.post(generate_url, json=payload, headers=headers)
        response.raise_for_status()
        response_data = response.json()

        audio_url_from_api = response_data.get("audioFile")

        if not audio_url_from_api:
            raise Exception("Failed to get audio URL from Murf AI.")

        logger.info(f"Downloading generated audio from {audio_url_from_api}")
        audio_response = requests.get(audio_url_from_api)
        audio_response.raise_for_status()

        audio_filename = f"response_{session_id}.mp3"
        audio_filepath = os.path.join("static", audio_filename)
        
        with open(audio_filepath, "wb") as f:
            f.write(audio_response.content)
        
        final_audio_url = f"/static/{audio_filename}?v={time.time()}"
        logger.info(f"Speech audio successfully saved to {final_audio_url}")
        return final_audio_url
        
    except requests.exceptions.HTTPError as e:
        logger.error(f"HTTP Error: {e}")
        logger.error(f"Response content: {e.response.text if e.response else 'No response'}")
        raise

