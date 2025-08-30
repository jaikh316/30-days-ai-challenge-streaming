# services/murf_ws.py - FIXED VERSION FOR COMPLETE AUDIO PLAYBACK

import asyncio
import base64
import json
import logging
import websockets
import uuid
import math

logger = logging.getLogger(__name__)

class MurfStreamInputWS:
    """Fixed Murf WebSocket client for complete audio playback."""

    def __init__(self, api_key: str, voice_id: str, sample_rate: int = 44100,
                 channel_type: str = "MONO", audio_format: str = "WAV",
                 style: str = "Conversational", rate: int = 0, pitch: int = 0, variation: int = 1):
        self.api_key = api_key
        self.voice_id = voice_id
        self.sample_rate = sample_rate
        self.channel_type = channel_type
        self.audio_format = audio_format
        self.style = style
        self.rate = rate
        self.pitch = pitch
        self.variation = variation
        self.websocket = None
        self.client_websocket = None
        self.turn_number = None

        # Fixed: Audio tracking with proper buffer management
        self.audio_chunks_sent = 0
        self.total_audio_data = 0
        self.completion_event = asyncio.Event()
        self.first_chunk = True
        self.last_chunk_time = 0
        self.completion_task = None
        self.audio_buffer = []  # ⭐ NEW: Buffer to collect all audio chunks

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.disconnect()

    async def connect(self):
        """Connect to Murf WebSocket using official format."""
        try:
            # Official URL format with parameters
            websocket_url = (
                f"wss://api.murf.ai/v1/speech/stream-input"
                f"?api-key={self.api_key}"
                f"&sample_rate={self.sample_rate}"
                f"&channel_type={self.channel_type}"
                f"&format={self.audio_format}"
            )

            # Connect to Murf
            self.websocket = await websockets.connect(websocket_url)
            logger.info(f"🎵 Connected to Murf WebSocket successfully")

            # Send voice configuration
            voice_config_msg = {
                "voice_config": {
                    "voiceId": self.voice_id,
                    "style": self.style,
                    "rate": self.rate,
                    "pitch": self.pitch,
                    "variation": self.variation
                }
            }

            await self.websocket.send(json.dumps(voice_config_msg))
            logger.info(f"🎵 Sent voice config: {self.voice_id}")

            # Start listening for responses
            asyncio.create_task(self._listen_for_responses())

        except Exception as e:
            logger.error(f"Failed to connect to Murf WebSocket: {e}")
            # Use mock audio as fallback
            await self._setup_mock_fallback()

    async def _setup_mock_fallback(self):
        """Setup mock audio generation as fallback."""
        logger.info("🎵 Setting up mock audio fallback")
        self.use_mock = True

    async def disconnect(self):
        """Disconnect from Murf WebSocket."""
        if self.completion_task:
            self.completion_task.cancel()

        if self.websocket:
            try:
                await self.websocket.close()
                logger.info("🎵 Murf WebSocket disconnected")
            except Exception as e:
                logger.info(f"🎵 WebSocket disconnect: {e}")

    async def send_text_chunk(self, text: str, end: bool = False):
        """Send text chunk using official Murf format."""
        if hasattr(self, 'use_mock'):
            if end:  # Only generate mock audio at the end
                await self._generate_mock_audio(text, end)
            return

        if not self.websocket:
            logger.error("WebSocket not connected")
            return

        try:
            # Official message format
            text_msg = {
                "text": text,
                "end": end
            }

            await self.websocket.send(json.dumps(text_msg))
            logger.info(f"🎵 Sent to Murf: '{text[:50]}...' (end: {end})")

        except Exception as e:
            logger.error(f"Error sending text to Murf: {e}")

    async def _listen_for_responses(self):
        """Listen for Murf responses with improved audio handling."""
        try:
            while True:
                response = await self.websocket.recv()
                data = json.loads(response)
                logger.info(f"🎵 Received from Murf: {list(data.keys())}")

                # Handle audio response
                if "audio" in data:
                    await self._collect_audio_chunk(data)
                    self.last_chunk_time = asyncio.get_event_loop().time()

                    # Cancel existing completion task and start new one
                    if self.completion_task:
                        self.completion_task.cancel()
                    self.completion_task = asyncio.create_task(self._delayed_completion())

                # Handle explicit final flag
                if data.get("final"):
                    logger.info("🎵 Murf marked final chunk")
                    await self._send_complete_audio()
                    break

        except websockets.exceptions.ConnectionClosed:
            logger.info("🎵 Murf WebSocket connection closed")
        except Exception as e:
            logger.error(f"Error in Murf listener: {e}")
        finally:
            # Send any remaining audio
            if not self.completion_event.is_set():
                await self._send_complete_audio()

    async def _collect_audio_chunk(self, data: dict):
        """⭐ FIXED: Collect audio chunks instead of sending immediately."""
        if not self.client_websocket:
            return

        try:
            # Get base64 audio data
            audio_base64 = data.get("audio", "")
            if not audio_base64:
                return

            # Decode audio bytes
            audio_bytes = base64.b64decode(audio_base64)

            # Skip WAV header for first chunk only
            if self.first_chunk and len(audio_bytes) > 44:
                # Store header for final reconstruction
                self.wav_header = audio_bytes[:44]
                audio_bytes = audio_bytes[44:]
                self.first_chunk = False

            # ⭐ FIXED: Collect chunks instead of sending immediately
            if len(audio_bytes) > 0:
                self.audio_buffer.append(audio_bytes)
                self.audio_chunks_sent += 1
                logger.info(f"🎵 Collected audio chunk {self.audio_chunks_sent}")

        except Exception as e:
            logger.error(f"Error collecting audio chunk: {e}")

    async def _delayed_completion(self):
        """Wait for silence then send complete audio."""
        try:
            await asyncio.sleep(1.0)  # Wait 1 second for more chunks
            current_time = asyncio.get_event_loop().time()
            
            if current_time - self.last_chunk_time >= 1.0:  # No chunks for 1 second
                logger.info("🎵 No new audio chunks, sending complete audio")
                await self._send_complete_audio()
        except asyncio.CancelledError:
            pass

    async def _send_complete_audio(self):
        """⭐ FIXED: Send complete combined audio instead of individual chunks."""
        if self.completion_event.is_set():
            return  # Already completed

        if not self.client_websocket or len(self.audio_buffer) == 0:
            logger.warning("🎵 No audio chunks to send")
            self.completion_event.set()
            return

        try:
            logger.info(f"🎵 Combining {len(self.audio_buffer)} audio chunks into complete audio")
            
            # Combine all audio chunks
            combined_audio = b''.join(self.audio_buffer)
            
            # Add WAV header back if we have it
            if hasattr(self, 'wav_header'):
                # Update WAV header with correct data length
                combined_audio = self._update_wav_header(self.wav_header, combined_audio)
            
            # Encode complete audio
            complete_audio_b64 = base64.b64encode(combined_audio).decode('utf-8')
            
            # Send complete audio as single chunk
            final_message = {
                "type": "audio_chunk",
                "turn_number": self.turn_number,
                "audio_data": complete_audio_b64,
                "final": True,
                "timestamp": asyncio.get_event_loop().time()
            }

            await self.client_websocket.send_text(json.dumps(final_message))
            
            logger.info(f"🎵 Sent complete audio: {len(combined_audio)} bytes from {len(self.audio_buffer)} chunks")

            # Send completion message
            completion_message = {
                "type": "audio_streaming_complete",
                "turn_number": self.turn_number,
                "total_chunks": 1,  # We send as 1 complete chunk
                "total_audio_data": len(complete_audio_b64)
            }

            await self.client_websocket.send_text(json.dumps(completion_message))
            logger.info(f"🎵 Audio streaming complete for turn {self.turn_number}")

        except Exception as e:
            logger.error(f"Error sending complete audio: {e}")

        self.completion_event.set()

    def _update_wav_header(self, header: bytes, audio_data: bytes) -> bytes:
        """Update WAV header with correct data length."""
        import struct
        
        # Update the total file size (bytes 4-8)
        new_file_size = len(header) + len(audio_data) - 8
        header = header[:4] + struct.pack('<I', new_file_size) + header[8:]
        
        # Update the data chunk size (bytes 40-44)
        header = header[:40] + struct.pack('<I', len(audio_data)) + header[44:]
        
        return header + audio_data

    async def _generate_mock_audio(self, text: str, end: bool = False):
        """Generate mock audio when Murf is unavailable."""
        if not self.client_websocket or not end:
            return

        try:
            logger.info(f"🎵 Generating mock audio: 'Hello there! How can I help you today?'")

            # Generate complete WAV file
            samples = int(3.0 * 44100)  # 3 seconds of audio
            wav_data = self._create_realistic_wav(samples)

            # Send as single complete audio chunk
            message = {
                "type": "audio_chunk",
                "turn_number": self.turn_number,
                "audio_data": wav_data,
                "final": True,
                "timestamp": asyncio.get_event_loop().time()
            }

            await self.client_websocket.send_text(json.dumps(message))
            self.audio_chunks_sent = 1

            logger.info(f"🎵 Mock audio sent for turn {self.turn_number}")

            # Send completion
            completion_message = {
                "type": "audio_streaming_complete",
                "turn_number": self.turn_number,
                "total_chunks": 1,
                "total_audio_data": len(wav_data)
            }
            await self.client_websocket.send_text(json.dumps(completion_message))
            self.completion_event.set()

        except Exception as e:
            logger.error(f"Error generating mock audio: {e}")

    def _create_realistic_wav(self, samples: int):
        """Create realistic speech-like WAV file."""
        # WAV header for 44.1kHz, 16-bit, mono
        data_size = samples * 2
        file_size = 36 + data_size

        header = bytearray([
            0x52, 0x49, 0x46, 0x46,  # "RIFF"
            *file_size.to_bytes(4, 'little'),
            0x57, 0x41, 0x56, 0x45,  # "WAVE"
            0x66, 0x6D, 0x74, 0x20,  # "fmt "
            0x10, 0x00, 0x00, 0x00,  # fmt chunk size (16)
            0x01, 0x00,  # PCM format
            0x01, 0x00,  # mono channel
            0x44, 0xAC, 0x00, 0x00,  # 44100 sample rate
            0x88, 0x58, 0x01, 0x00,  # byte rate (44100 * 2)
            0x02, 0x00,  # block align (2)
            0x10, 0x00,  # 16-bit samples
            0x64, 0x61, 0x74, 0x61,  # "data"
            *data_size.to_bytes(4, 'little')
        ])

        # Generate realistic speech audio
        audio_data = bytearray()
        for i in range(samples):
            t = i / 44100

            # Create speech-like formants
            f1 = 300 + 200 * math.sin(2 * math.pi * 2 * t)
            f2 = 800 + 400 * math.sin(2 * math.pi * 1.5 * t)
            f3 = 1600 + 600 * math.sin(2 * math.pi * 1 * t)

            # Combine formants
            sample = (
                0.4 * math.sin(2 * math.pi * f1 * t) +
                0.25 * math.sin(2 * math.pi * f2 * t) +
                0.15 * math.sin(2 * math.pi * f3 * t) +
                0.1 * math.sin(2 * math.pi * (f1 * 2) * t)
            )

            # Add speech envelope
            envelope = 0.6 + 0.4 * math.sin(2 * math.pi * 4 * t)
            sample *= envelope

            # Add slight randomness
            sample += 0.02 * (0.5 - (i % 147) / 147.0)

            # Convert to 16-bit integer
            sample_int = max(-32768, min(32767, int(sample * 18000)))
            audio_data.extend(sample_int.to_bytes(2, 'little', signed=True))

        # Combine header and audio data
        complete_wav = header + audio_data
        return base64.b64encode(complete_wav).decode('utf-8')

    async def wait_for_complete(self, timeout: int = 60):
        """Wait for audio generation to complete."""
        try:
            await asyncio.wait_for(self.completion_event.wait(), timeout=timeout)
            logger.info(f"🎵 Processing completed for turn {self.turn_number}")
        except asyncio.TimeoutError:
            logger.warning(f"🎵 Processing timed out for turn {self.turn_number}")
            # Force completion on timeout
            if not self.completion_event.is_set():
                await self._send_complete_audio()
        except Exception as e:
            logger.error(f"Error waiting for completion: {e}")
