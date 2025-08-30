document.addEventListener("DOMContentLoaded", async () => {
  console.log("🎙️ Day 27 - UI Revamp and API Key Configuration");

  // Global variables
  window.audioChunks = [];
  window.currentTurnAudio = null;
  window.audioContext = null;
  let isPlayingAudio = false;
  let currentUserTranscript = "";

  // WebSocket Connection
  let ws;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  // ⭐ NEW: UI Elements for API Key Modal
  const settingsButton = document.getElementById("settings-button");
  const settingsModal = document.getElementById("settings-modal");
  const closeModalButton = document.getElementById("close-modal-button");
  const saveKeysButton = document.getElementById("save-keys-button");
  const assemblyaiKeyInput = document.getElementById("assemblyai-key");
  const geminiKeyInput = document.getElementById("gemini-key");
  const murfKeyInput = document.getElementById("murf-key");
  const tavilyKeyInput = document.getElementById("tavily-key");
  const openweatherKeyInput = document.getElementById("openweather-key");

  // ⭐ NEW: Functions to manage the modal
  const openModal = () => settingsModal.classList.remove("hidden");
  const closeModal = () => settingsModal.classList.add("hidden");

  settingsButton.addEventListener("click", openModal);
  closeModalButton.addEventListener("click", closeModal);
  
  saveKeysButton.addEventListener("click", () => {
      const keys = {
          assemblyai: assemblyaiKeyInput.value.trim(),
          gemini: geminiKeyInput.value.trim(),
          murf: murfKeyInput.value.trim(),
          tavily: tavilyKeyInput.value.trim(),
          openweather: openweatherKeyInput.value.trim(),
      };

      if (!keys.assemblyai || !keys.gemini || !keys.murf) {
          alert("Please provide the required API keys for AssemblyAI, Gemini, and Murf AI.");
          return;
      }

      localStorage.setItem("apiKeys", JSON.stringify(keys));
      console.log("API Keys saved to localStorage.");
      displaySystemMessage("✅ API Keys saved locally.");
      closeModal();
      
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          console.log("WebSocket is open or connecting, closing to reconnect with new keys.");
          ws.close();
      }
      // connectWebSocket will be called by the `onclose` handler, or we call it if no connection existed
      if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectWebSocket();
      }
  });

  // ⭐ NEW: Load keys from localStorage into the form
  function loadKeysFromStorage() {
      const savedKeys = localStorage.getItem("apiKeys");
      if (savedKeys) {
          const keys = JSON.parse(savedKeys);
          assemblyaiKeyInput.value = keys.assemblyai || "";
          geminiKeyInput.value = keys.gemini || "";
          murfKeyInput.value = keys.murf || "";
          tavilyKeyInput.value = keys.tavily || "";
          openweatherKeyInput.value = keys.openweather || "";
          return keys;
      }
      return null;
  }

  // Initialize Web Audio API
  async function initAudioContext() {
    if (!window.audioContext || window.audioContext.state === "closed") {
      try {
        window.audioContext = new (window.AudioContext ||
          window.webkitAudioContext)({
          sampleRate: 44100,
        });
        console.log(
          `✅ AudioContext initialized: ${window.audioContext.state}`
        );
      } catch (error) {
        console.error("❌ AudioContext init failed:", error);
        throw error;
      }
    }

    if (window.audioContext.state === "suspended") {
      try {
        await window.audioContext.resume();
        console.log("🔊 AudioContext resumed");
      } catch (error) {
        console.warn("⚠️ AudioContext resume failed:", error);
      }
    }

    return window.audioContext;
  }

  // Murf-style base64 to Uint8Array conversion
  function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Create WAV header
  function createWavHeader(
    dataLength,
    sampleRate = 44100,
    numChannels = 1,
    bitDepth = 16
  ) {
    const blockAlign = (numChannels * bitDepth) / 8;
    const byteRate = sampleRate * blockAlign;
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    function writeStr(offset, str) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeStr(36, "data");
    view.setUint32(40, dataLength, true);

    return new Uint8Array(buffer);
  }

  // Combine WAV chunks
  function playCombinedWavChunks(base64Chunks) {
    const pcmData = [];
    for (let i = 0; i < base64Chunks.length; i++) {
      const bytes = base64ToUint8Array(base64Chunks[i]);
      if (i === 0) {
        pcmData.push(bytes.slice(44)); // skip header in first chunk
      } else {
        pcmData.push(bytes); // entire chunk is raw PCM
      }
    }

    const totalPcm = new Uint8Array(
      pcmData.reduce((sum, c) => sum + c.length, 0)
    );
    let offset = 0;
    for (const part of pcmData) {
      totalPcm.set(part, offset);
      offset += part.length;
    }

    const wavHeader = createWavHeader(totalPcm.length);
    const finalWav = new Uint8Array(wavHeader.length + totalPcm.length);
    finalWav.set(wavHeader, 0);
    finalWav.set(totalPcm, wavHeader.length);

    return finalWav.buffer;
  }

  // Play complete audio buffer
  function playCompleteAudio(audioBuffer) {
    if (!window.audioContext || !audioBuffer) {
      console.error("❌ Missing audio context or buffer");
      return;
    }

    try {
      console.log(`🔊 PLAYING AUDIO: ${audioBuffer.duration.toFixed(3)}s`);
      const source = window.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      const gainNode = window.audioContext.createGain();
      source.connect(gainNode);
      gainNode.connect(window.audioContext.destination);
      gainNode.gain.setValueAtTime(0.7, window.audioContext.currentTime);
      source.start(0);
      isPlayingAudio = true;

      source.onended = () => {
        console.log(`✅ Audio playback completed successfully`);
        isPlayingAudio = false;
        setAgentStatus("Turn Detection + LLM Ready", "green");
      };

      source.onerror = (error) => {
        console.error("❌ Audio source error:", error);
        isPlayingAudio = false;
        setAgentStatus("❌ Playback Error", "red");
      };
    } catch (error) {
      console.error("❌ playCompleteAudio error:", error);
      setAgentStatus("❌ Playback Error", "red");
    }
  }

  // Audio chunk handler
  async function handleAudioChunk(data) {
    console.log(`🎵 RECEIVED AUDIO CHUNK for turn ${data.turn_number}`);

    try {
      await initAudioContext();
    } catch (error) {
      console.error("❌ Audio context error:", error);
      setAgentStatus("❌ Audio Context Error", "red");
      return;
    }

    if (
      !window.currentTurnAudio ||
      window.currentTurnAudio.turn !== data.turn_number
    ) {
      window.currentTurnAudio = {
        turn: data.turn_number,
        base64Chunks: [],
        validChunks: 0,
      };
      console.log(
        `🎯 NEW TURN: Starting audio accumulation for turn ${data.turn_number}`
      );
      setAgentStatus("🎵 Receiving Audio...", "blue");
    }

    if (data.audio_data && data.audio_data.length > 0) {
      window.currentTurnAudio.base64Chunks.push(data.audio_data);
      window.currentTurnAudio.validChunks++;
    }

    if (
      data.final ||
      (data.audio_data !== undefined && data.audio_data.length === 0)
    ) {
      console.log("🎵 PROCESSING COMPLETE AUDIO");

      if (window.currentTurnAudio.base64Chunks.length === 0) {
        console.error(
          `❌ No audio chunks to process for turn ${data.turn_number}`
        );
        setAgentStatus("❌ No Audio Data", "red");
        return;
      }

      setAgentStatus("🔄 Processing Audio...", "orange");

      try {
        const combinedWav = playCombinedWavChunks(
          window.currentTurnAudio.base64Chunks
        );
        const audioBuffer = await window.audioContext.decodeAudioData(
          combinedWav
        );

        if (!audioBuffer || audioBuffer.length === 0) {
          throw new Error("Empty decoded buffer");
        }

        console.log(`✅ DECODE SUCCESS: ${audioBuffer.duration.toFixed(3)}s`);

        window.audioChunks.push({
          turn: data.turn_number,
          chunks: window.currentTurnAudio.validChunks,
          duration: audioBuffer.duration,
          success: true,
          timestamp: new Date().toISOString(),
        });

        setAgentStatus("🔊 Playing Audio...", "green");
        playCompleteAudio(audioBuffer);
        displaySystemMessage(
          `🎵 Playing: ${audioBuffer.duration.toFixed(1)}s (${
            window.currentTurnAudio.validChunks
          } chunks)`
        );
      } catch (error) {
        console.error(`❌ AUDIO PROCESSING FAILED: ${error.message}`);
        setAgentStatus("❌ Audio Decode Failed", "red");
        displaySystemMessage(`❌ Audio failed: ${error.message}`);

        window.audioChunks.push({
          turn: data.turn_number,
          chunks: window.currentTurnAudio.validChunks,
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }

      setTimeout(() => {
        window.currentTurnAudio = null;
        if (!isPlayingAudio) {
          setAgentStatus("Turn Detection + LLM Ready", "green");
        }
      }, 1000);
    }
  }

  function handleAudioStreamingComplete(data) {
    console.log(`🎵 Audio streaming complete for turn ${data.turn_number}`);
    if (
      window.currentTurnAudio &&
      window.currentTurnAudio.base64Chunks.length > 0
    ) {
      handleAudioChunk({
        turn_number: data.turn_number,
        audio_data: "",
        final: true,
      });
    }
  }

  // Debug functions
  window.inspectAudio = function () {
    console.log("🔍 AUDIO INSPECTION:");
    console.log(`📊 Total attempts: ${window.audioChunks.length}`);
    console.log(
      `🎵 AudioContext: ${
        window.audioContext ? window.audioContext.state : "null"
      }`
    );
    console.log(`▶️ Playing: ${isPlayingAudio}`);
    console.log(`🎯 Current turn:`, window.currentTurnAudio);

    window.audioChunks.forEach((attempt, i) => {
      const status = attempt.success ? "✅" : "❌";
      console.log(
        `${status} Turn ${attempt.turn}: ${attempt.chunks} chunks, ${
          attempt.duration ? attempt.duration.toFixed(3) : "N/A"
        }s`
      );
      if (attempt.error) console.log(`  Error: ${attempt.error}`);
    });

    return {
      audioChunks: window.audioChunks,
      currentTurn: window.currentTurnAudio,
    };
  };

  window.testAudio = function () {
    console.log("🧪 Testing audio...");
    initAudioContext().then(() => {
      const oscillator = window.audioContext.createOscillator();
      const gainNode = window.audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(window.audioContext.destination);
      oscillator.frequency.value = 440;
      gainNode.gain.setValueAtTime(0.1, window.audioContext.currentTime);
      oscillator.start();
      oscillator.stop(window.audioContext.currentTime + 0.5);
      console.log("🔊 Test tone should play");
    });
  };

  // WebSocket connection
  function connectWebSocket() {
    // ⭐ MODIFIED: Check for keys before connecting
    const apiKeys = loadKeysFromStorage();
    if (!apiKeys || !apiKeys.assemblyai || !apiKeys.gemini || !apiKeys.murf) {
        console.log("API keys not found in storage. Opening settings modal.");
        setAgentStatus("API Keys Required", "orange");
        openModal();
        return; // Don't connect until keys are provided
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      console.log("✅ WebSocket connected, sending API keys...");
      // ⭐ MODIFIED: Send keys as the first message
      ws.send(JSON.stringify({
          type: "configure_api_keys",
          keys: apiKeys
      }));
      setAgentStatus("Authenticating...", "blue");
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "connection_established":
            setAgentStatus("Turn Detection + LLM Ready", "green");
            displaySystemMessage("🎙️ Audio system ready - speak naturally!");
            break;

          case "partial_transcript":
            displayPartialTranscription(data.text);
            setAgentStatus("🎤 User Speaking...", "blue");
            break;

          case "final_transcript":
          case "turn_completed":
          case "turn_updated":
            displayFinalTranscription(
              data.text || data.final_transcript,
              data.turn_number
            );
            currentUserTranscript = data.text || data.final_transcript;
            updateOrAddTurnInHistory(data);
            break;

          case "llm_streaming_start":
            setAgentStatus("🤖 AI Thinking...", "orange");
            break;

          case "llm_chunk":
            setAgentStatus("🤖 AI Responding...", "purple");
            break;

          case "llm_streaming_complete":
            setAgentStatus("🎵 Generating Audio...", "blue");
            displaySystemMessage(`🤖 AI: ${data.full_response}`);
            addToConversationHistory(
              data.turn_number,
              currentUserTranscript,
              data.full_response
            );
            break;

          case "audio_chunk":
            handleAudioChunk(data);
            break;

          case "audio_streaming_complete":
            handleAudioStreamingComplete(data);
            break;

          case "open_url":
            console.log(`🖥️ ACTION: Opening URL in new tab: ${data.url}`);
            displaySystemMessage(`🖥️ Opening ${data.url}...`);
            window.open(data.url, '_blank');
            break;

          case "llm_error":
            setAgentStatus("❌ LLM Error", "red");
            displaySystemMessage(`❌ LLM Error: ${data.error}`);
            break;

          case "error":
            setAgentStatus(`❌ ${data.message}`, "red");
            displaySystemMessage(`❌ System Error: ${data.message}`);
            if (data.message.includes("API key")) {
                openModal();
            }
            break;

          case "session_begin":
            displaySystemMessage("✅ Session started - speak naturally!");
            break;

          default:
            console.log(`📨 Unhandled: ${data.type}`, data);
        }
      } catch (e) {
        console.log("📨 Raw message:", event.data);
      }
    };

    ws.onclose = () => {
      setAgentStatus("Disconnected", "gray");
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        setTimeout(connectWebSocket, 3000);
      } else {
        setAgentStatus("Connection Failed", "red");
        displaySystemMessage("❌ Could not reconnect to the server. Please check your connection and API keys, then refresh the page.");
      }
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
      setAgentStatus("Connection Error", "red");
    };
  }

  // Recording and UI setup
  let isRecording = false;
  let recordingAudioContext;
  let processor;

  const recordButton = document.getElementById("record-button");
  const recordIcon = document.getElementById("record-icon");
  const stopIcon = document.getElementById("stop-icon");
  const agentStatus = document.getElementById("agent-status");
  const currentTurnContainer = document.getElementById(
    "current-turn-container"
  );
  const turnHistoryContainer = document.getElementById(
    "turn-history-container"
  );
  const systemMessagesContainer = document.getElementById("system-messages");

  // Recording button
  recordButton.addEventListener("click", async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  });

  function convertFloat32ToInt16(buffer) {
    const int16Buffer = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, buffer[i]));
      int16Buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return int16Buffer;
  }

  async function startRecording() {
    try {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // Try to connect if not already
        connectWebSocket();
        throw new Error("WebSocket not connected. Please ensure API keys are correct and try again.");
      }

      await initAudioContext();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      isRecording = true;
      updateButtonUI(true);
      setAgentStatus("🎙️ Recording...", "red");
      clearCurrentTurn();

      recordingAudioContext = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = recordingAudioContext.createMediaStreamSource(stream);
      processor = recordingAudioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        if (isRecording && ws && ws.readyState === WebSocket.OPEN) {
          const inputData = event.inputBuffer.getChannelData(0);
          const int16Data = convertFloat32ToInt16(inputData);
          ws.send(int16Data.buffer);
        }
      };

      source.connect(processor);
      processor.connect(recordingAudioContext.destination);
      window.currentStream = stream;

      console.log("🎙️ Recording started");
    } catch (error) {
      console.error("❌ Recording error:", error);
      alert(`Error starting recording: ${error.message}`);
      isRecording = false;
      updateButtonUI(false);
      setAgentStatus("❌ Mic/Config Error", "red");
    }
  }

  function stopRecording() {
    if (!isRecording) return;

    isRecording = false;
    updateButtonUI(false);
    setAgentStatus("⏹️ Stopping...", "orange");

    if (processor) {
      processor.disconnect();
      processor = null;
    }

    if (recordingAudioContext) {
      recordingAudioContext.close();
      recordingAudioContext = null;
    }

    if (window.currentStream) {
      window.currentStream.getTracks().forEach((track) => track.stop());
      window.currentStream = null;
    }

    setTimeout(() => {
      if (!isPlayingAudio) {
        setAgentStatus("Turn Detection + LLM Ready", "green");
      }
    }, 1000);
  }

  function updateButtonUI(recording) {
    if (recordIcon && stopIcon) {
      recordIcon.style.display = recording ? "none" : "block";
      stopIcon.style.display = recording ? "block" : "none";
      recordButton.classList.toggle("recording", recording);

      const spanText = recordButton.querySelector("span");
      if (recording) {
        spanText.textContent = "Stop Conversation";
        recordButton.classList.remove("bg-red-600", "hover:bg-red-700");
        recordButton.classList.add("bg-green-600", "hover:bg-green-700");
      } else {
        spanText.textContent = "Start Conversation";
        recordButton.classList.remove("bg-green-600", "hover:bg-green-700");
        recordButton.classList.add("bg-red-600", "hover:bg-red-700");
      }
    }
  }

  function setAgentStatus(message, color) {
    if (agentStatus) {
      agentStatus.textContent = message;
      agentStatus.className = `px-4 py-2 rounded-lg font-medium ${getColorClass(
        color
      )}`;
    }
  }

  function getColorClass(color) {
    const colors = {
      green: "bg-green-900/30 text-green-300 border border-green-600",
      blue: "bg-blue-900/30 text-blue-300 border border-blue-600",
      red: "bg-red-900/30 text-red-300 border border-red-600",
      orange: "bg-orange-900/30 text-orange-300 border border-orange-600",
      purple: "bg-purple-900/30 text-purple-300 border border-purple-600",
      gray: "bg-gray-900/30 text-gray-300 border border-gray-600",
    };
    return colors[color] || colors["gray"];
  }

  function displayPartialTranscription(text) {
    if (currentTurnContainer) {
      currentTurnContainer.innerHTML = `
                <div class="text-sm text-gray-400 mb-2">Current Turn (In Progress)</div>
                <div class="p-3 bg-blue-900/20 rounded-lg border border-blue-600">
                    <div class="text-blue-300">${text || "Listening..."}</div>
                </div>
            `;
    }
  }

  function displayFinalTranscription(text, turnNumber) {
    if (currentTurnContainer) {
      currentTurnContainer.innerHTML = `
                <div class="text-sm text-gray-400 mb-2">Turn ${
                  turnNumber || ""
                } - Final</div>
                <div class="p-3 bg-green-900/20 rounded-lg border border-green-600">
                    <div class="text-white">${text}</div>
                </div>
            `;
    }
  }

  function displaySystemMessage(message) {
    if (systemMessagesContainer) {
      const messageElement = document.createElement("div");
      messageElement.className =
        "mb-2 p-3 bg-yellow-900/20 border border-yellow-600 rounded-lg text-yellow-300 max-h-60 overflow-y-auto";
      messageElement.innerHTML = `
                <div class="text-xs text-yellow-400 mb-1">${new Date().toLocaleTimeString()}</div>
                <div class="text-sm whitespace-pre-wrap break-words">${message}</div>
            `;
      systemMessagesContainer.appendChild(messageElement);
      systemMessagesContainer.scrollTop = systemMessagesContainer.scrollHeight;
    }
  }

  function addToConversationHistory(turnNumber, userText, aiResponse) {
    if (turnHistoryContainer) {
      const turnElement = document.createElement("div");
      turnElement.className =
        "mb-4 p-4 bg-gray-800/50 rounded-lg border border-gray-600";
      turnElement.innerHTML = `
    <div class="text-sm text-gray-400 mb-2">Turn ${turnNumber}</div>
    <div class="flex justify-start mb-3">
        <div>
            <div class="text-base font-bold text-blue-400 mb-1">👤 You</div>
            <div class="bg-blue-900/30 text-white p-2 rounded-lg max-w-xs break-words">
                ${userText || "User spoke"}
            </div>
        </div>
    </div>
    <div class="flex justify-end">
        <div>
            <div class="text-base font-bold text-green-400 mb-1 text-right">🤖 AI</div>
            <div class="bg-green-900/30 text-green-300 p-2 rounded-lg max-w-xs break-words text-right">
                ${aiResponse}
            </div>
        </div>
    </div>
`;
      turnHistoryContainer.appendChild(turnElement);
      turnHistoryContainer.scrollTop = turnHistoryContainer.scrollHeight;
    }
  }

  function clearCurrentTurn() {
    if (currentTurnContainer) {
      currentTurnContainer.innerHTML = `
                <div class="text-sm text-gray-400 mb-2"></div>
                <div class="p-3 bg-gray-800/30 rounded-lg border border-gray-600">
                    <div class="text-gray-400">Start speaking to see real-time transcription</div>
                </div>
            `;
    }
  }

  function updateOrAddTurnInHistory(data) {}

  // Initialize clear state
  clearCurrentTurn();
  loadKeysFromStorage();
  connectWebSocket();
});