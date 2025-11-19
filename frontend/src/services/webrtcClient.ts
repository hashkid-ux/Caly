import io from 'socket.io-client';

export interface CallMetrics {
  asrLatency: number;
  llmLatency: number;
  ttsLatency: number;
  totalLatency: number;
  lastUpdate: number;
}

function getServerUrl(): string {
  const host = window.location.hostname;
  const params = new URLSearchParams(window.location.search);
  const backendParam = params.get('backend');
  
  if (backendParam) {
    console.log('[WebRTC] Using backend from query param:', backendParam);
    return backendParam;
  }

  if (host.includes('ngrok-free.dev') || host.includes('ngrok.io')) {
    const localBackend = 'http://192.168.29.53:3000';
    console.log('[WebRTC] On ngrok, using local backend:', localBackend);
    return localBackend;
  }

  if (host === 'localhost' || host === '127.0.0.1') {
    return `http://localhost:3000`;
  }

  return `http://${host}:3000`;
}

export class WebRTCClient {
  private socket: any;
  private localStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private isRecording: boolean = false;
  private sessionId: string = '';

  private audioChunks: Blob[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private speechDetectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private SILENCE_THRESHOLD_MS = 600; // 600ms silence = sentence complete (natural pause)
  private INITIAL_SPEECH_DELAY_MS = 200; // 200ms before checking for silence (quick response)
  private isSpeaking = false;
  private lastAudioTime = 0;
  private isProcessingSentence = false; // Prevent duplicate processing

  private audioQueue: { data: Uint8Array; isLastChunk: boolean }[] = [];
  private isPlayingAudio = false;
  private lastRequestId: string = '';

  constructor(serverUrl?: string) {
    const url = serverUrl || getServerUrl();
    console.log('[WebRTC] 🔗 Connecting to:', url);

    this.socket = io(url, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.socket.on('connect', () => {
      console.log('[WebRTC] ✅ CONNECTED to server');
      console.log('[WebRTC] Session ID:', this.socket.id);
      this.sessionId = this.socket.id;
    });

    this.socket.on('disconnect', () => {
      console.log('[WebRTC] ❌ DISCONNECTED from server');
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('[WebRTC] ❌ Connection error:', error);
    });

    this.socket.on('audio_chunk', (data: any) => {
      // Only accept responses for the current request
      if (data.requestId && data.requestId !== this.lastRequestId) {
        console.log(`[WebRTC] ❌ Ignoring response for old request: ${data.requestId} (current: ${this.lastRequestId})`);
        return;
      }

      console.log(`[WebRTC] 📥 Audio chunk: ${data.buffer.length} bytes, final=${data.isFinal} [${data.requestId || 'old'}]`);
      this.audioQueue.push({
        data: new Uint8Array(data.buffer),
        isLastChunk: data.isFinal,
      });
      this.playQueuedAudio();
    });

    this.socket.on('text_response', (data: any) => {
      console.log('[WebRTC] 📝 Text response:', data.text);
    });

    this.socket.on('error', (error: any) => {
      console.error('[WebRTC] ❌ Socket error:', error);
    });
  }

  async startCall() {
    try {
      console.log('[WebRTC] 🎙️ Requesting microphone...');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone not available');
      }

      const audioConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          sampleRate: { ideal: 16000 },
        },
      };

      this.localStream = await navigator.mediaDevices
        .getUserMedia(audioConstraints)
        .catch(async (error) => {
          console.warn('[WebRTC] Advanced constraints failed:', error);
          return await navigator.mediaDevices.getUserMedia({ audio: true });
        });

      console.log('[WebRTC] ✅ Microphone granted');

      const mimeType = this.getMediaRecorderMimeType();
      console.log('[WebRTC] Using MIME type:', mimeType);

      this.mediaRecorder = new MediaRecorder(this.localStream, { mimeType });
      this.audioChunks = [];
      this.isSpeaking = false;
      this.lastAudioTime = 0;

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          console.log(`[WebRTC] 🎤 Got audio chunk: ${event.data.size} bytes`);
          this.audioChunks.push(event.data);
          this.lastAudioTime = Date.now();

          if (!this.isSpeaking) {
            this.isSpeaking = true;
            console.log('[WebRTC] ▶️ SPEAKING STARTED');
            if (this.silenceTimer) clearTimeout(this.silenceTimer);
          }

          if (this.speechDetectionTimeout) clearTimeout(this.speechDetectionTimeout);

          this.speechDetectionTimeout = setTimeout(() => {
            console.log(`[WebRTC] ⏳ Starting silence detection (waiting ${this.SILENCE_THRESHOLD_MS}ms)...`);
            if (this.silenceTimer) clearTimeout(this.silenceTimer);

            this.silenceTimer = setTimeout(() => {
              console.log('[WebRTC] 🛑 SILENCE DETECTED - Processing sentence');
              this.processSentence();
            }, this.SILENCE_THRESHOLD_MS);
          }, this.INITIAL_SPEECH_DELAY_MS);
        }
      };

      this.mediaRecorder.onstop = () => {
        console.log('[WebRTC] ⏹️ Recording stopped');
        // DON'T process remaining audio here - it was already processed during silence detection
        // This prevents duplicate/infinite requests
        this.audioChunks = []; // Clear any leftover chunks
        this.cleanup();
      };

      this.mediaRecorder.onerror = (event: any) => {
        console.error('[WebRTC] ❌ Recording error:', event.error);
      };

      this.mediaRecorder.start(50);
      this.isRecording = true;

      console.log('[WebRTC] ✅ CALL STARTED - Listening for audio...');
    } catch (error: any) {
      console.error('[WebRTC] ❌ Start call failed:', error);
      throw error;
    }
  }

  private processSentence() {
    // Prevent duplicate processing (e.g., from both silence detection and call stop)
    if (this.isProcessingSentence) {
      console.log('[WebRTC] ⚠️ Already processing a sentence, skipping duplicate');
      return;
    }

    if (this.audioChunks.length === 0) {
      console.log('[WebRTC] ⚠️ No audio chunks to process');
      return;
    }

    this.isProcessingSentence = true;

    // Generate unique request ID for this utterance
    this.lastRequestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const totalSize = this.audioChunks.reduce((sum, blob) => sum + blob.size, 0);
    console.log(`[WebRTC] 📤 Processing sentence: ${this.audioChunks.length} chunks = ${totalSize} bytes [${this.lastRequestId}]`);

    const mimeType = this.getMediaRecorderMimeType();
    const blob = new Blob(this.audioChunks, { type: mimeType });

    blob.arrayBuffer().then((buffer) => {
      console.log(`[WebRTC] 🚀 SENDING TO BACKEND: ${buffer.byteLength} bytes (final: true) [${this.lastRequestId}]`);

      if (!this.socket.connected) {
        console.error('[WebRTC] ❌ Socket not connected!');
        this.isProcessingSentence = false;
        return;
      }

      // Send request ID so backend and frontend can track this specific request
      this.socket.emit('audio_chunk', {
        buffer: new Uint8Array(buffer),
        isFinal: true,
        requestId: this.lastRequestId,
        timestamp: Date.now(),
      });

      console.log('[WebRTC] ✅ Audio sent to backend');
      this.isProcessingSentence = false; // Reset flag after sending
    }).catch((error) => {
      console.error('[WebRTC] ❌ Error processing audio:', error);
      this.isProcessingSentence = false; // Reset flag on error
    });

    this.audioChunks = [];
    this.isSpeaking = false;

    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.speechDetectionTimeout) clearTimeout(this.speechDetectionTimeout);
  }

  private cleanup() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.speechDetectionTimeout) clearTimeout(this.speechDetectionTimeout);
  }

  private getMediaRecorderMimeType(): string {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'audio/webm';
  }

  private async playQueuedAudio() {
    if (this.isPlayingAudio) {
      console.log('[WebRTC] ⏳ Already playing, queuing...');
      return;
    }

    while (this.audioQueue.length > 0) {
      this.isPlayingAudio = true;
      const { data, isLastChunk } = this.audioQueue.shift()!;

      try {
        console.log(`[WebRTC] 🔊 Playing audio chunk: ${data.length} bytes (last: ${isLastChunk})`);
        await this.playAudioBuffer(data);
        console.log('[WebRTC] ✅ Audio chunk finished');
      } catch (error) {
        console.error('[WebRTC] ❌ Playback error:', error);
      }

      if (isLastChunk) {
        console.log('[WebRTC] 🏁 All audio played');
        this.isPlayingAudio = false;
        break;
      }
    }

    this.isPlayingAudio = false;
  }

  private playAudioBuffer(buffer: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Create a new Uint8Array backed by a regular ArrayBuffer
        const safeBuffer = new Uint8Array(buffer);
        const audioBlob = new Blob([safeBuffer], { type: 'audio/mp3' });
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          resolve();
        };

        audio.onerror = (error) => {
          URL.revokeObjectURL(audioUrl);
          reject(error);
        };

        audio.play().catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async stopCall() {
    console.log('[WebRTC] 🛑 Stopping call...');
    this.cleanup();

    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    console.log('[WebRTC] ✅ Call stopped');
  }

  isConnected(): boolean {
    return this.socket.connected;
  }

  disconnect() {
    this.cleanup();
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}