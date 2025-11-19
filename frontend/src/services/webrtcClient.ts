import io from 'socket.io-client';

export interface CallMetrics {
  asrLatency: number;
  llmLatency: number;
  ttsLatency: number;
  totalLatency: number;
  lastUpdate: number;
}

// Auto-detect server URL based on current host
function getServerUrl(): string {
  const host = window.location.hostname;
  
  // Check for backend URL in query params first
  const params = new URLSearchParams(window.location.search);
  const backendParam = params.get('backend');
  if (backendParam) {
    console.log('[WebRTC] Using backend from query param:', backendParam);
    return backendParam;
  }
  
  // If on ngrok (HTTPS frontend), connect to local network backend
  if (host.includes('ngrok-free.dev') || host.includes('ngrok.io')) {
    // Android frontend on ngrok HTTPS can reach PC's local IP on HTTP
    const localBackend = 'http://192.168.29.53:3000';
    console.log('[WebRTC] On ngrok frontend, using local network backend:', localBackend);
    return localBackend;
  }
  
  // If accessing from localhost, use localhost:3000
  if (host === 'localhost' || host === '127.0.0.1') {
    return `http://localhost:3000`;
  }
  
  // If accessing from network IP, use same IP with port 3000
  return `http://${host}:3000`;
}

export class WebRTCClient {
  private socket: any;
  private localStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private isRecording: boolean = false;
  private sessionId: string = '';

  constructor(serverUrl?: string) {
    // Use provided URL or auto-detect
    const url = serverUrl || getServerUrl();
    console.log('[WebRTC] Connecting to server at:', url);
    
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
      console.log('[WebRTC] ✅ Connected to server');
      console.log('[WebRTC] Session ID:', this.socket.id);
      this.sessionId = this.socket.id;
    });

    this.socket.on('disconnect', () => {
      console.log('[WebRTC] ❌ Disconnected from server');
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('[WebRTC] ❌ Connection error:', error);
      console.error('[WebRTC] Error details:', {
        message: error.message,
        type: error.type,
        data: error.data,
      });
    });

    this.socket.on('audio_acknowledged', (data: any) => {
      console.log('[WebRTC] Audio acknowledged at', data.timestamp);
    });

    this.socket.on('audio_response', (data: any) => {
      console.log('[WebRTC] Audio response received');
      this.playAudio(data.audio);
    });

    this.socket.on('text_response', (data: any) => {
      console.log('[WebRTC] Text response received:', data.text);
    });

    this.socket.on('error', (error: any) => {
      console.error('[WebRTC] ❌ Socket error:', error);
    });
  }

  async startCall() {
    try {
      console.log('[WebRTC] Requesting microphone access...');
      
      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('[WebRTC] navigator.mediaDevices not available');
        throw new Error(
          '⚠️ HTTPS Required for Android!\n\n' +
          'Android needs HTTPS for microphone access.\n\n' +
          'For PC Testing (HTTP works):\n' +
          'http://localhost:5173 ✅\n\n' +
          'For Phone Testing:\n' +
          'Option 1: Test on PC first\n' +
          'Option 2: Use ngrok for HTTPS tunnel\n' +
          '  $ ngrok http 5173'
        );
      }
      
      // Try different audio constraints for better compatibility
      const audioConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          sampleRate: { ideal: 16000 },
        },
      };

      // Request microphone access
      this.localStream = await navigator.mediaDevices.getUserMedia(audioConstraints).catch(async (error) => {
        console.warn('[WebRTC] Advanced audio constraints failed, trying basic constraints:', error);
        // Fallback to basic audio constraints
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      });

      console.log('[WebRTC] Microphone access granted');

      // Set up Media Recorder
      const mimeType = this.getMediaRecorderMimeType();
      console.log('[WebRTC] Using MIME type:', mimeType);
      
      this.mediaRecorder = new MediaRecorder(this.localStream, {
        mimeType: mimeType,
      });

      const audioChunks: Blob[] = [];
      let silenceTimeout: ReturnType<typeof setTimeout> | null = null;
      const SILENCE_THRESHOLD = 1500; // ms - detect silence after 1.5 seconds

      const sendAudio = (isFinal: boolean = false) => {
        if (audioChunks.length === 0) {
          console.warn(`[WebRTC] No audio chunks to send (final: ${isFinal})`);
          return;
        }

        const blob = new Blob(audioChunks, { type: mimeType });
        blob.arrayBuffer().then((buffer) => {
          const byteLength = buffer.byteLength;
          console.log(`[WebRTC] Sending audio: ${byteLength} bytes (final: ${isFinal}), socket connected: ${this.socket.connected}`);
          
          if (!this.socket.connected) {
            console.error('[WebRTC] Socket not connected, cannot send audio');
            return;
          }
          
          this.socket.emit('audio_chunk', {
            buffer: new Uint8Array(buffer),
            isFinal: isFinal,
            timestamp: Date.now(),
          });
        }).catch((err) => {
          console.error('[WebRTC] Error converting audio blob:', err);
        });

        audioChunks.length = 0;
      };

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        console.log(`[WebRTC] Audio data available: ${event.data.size} bytes`);
        audioChunks.push(event.data);

        // Clear existing silence timeout
        if (silenceTimeout) {
          clearTimeout(silenceTimeout);
        }

        // Set silence detection - if no new audio for SILENCE_THRESHOLD, send as final
        silenceTimeout = setTimeout(() => {
          console.log('[WebRTC] Silence detected, sending final chunk');
          sendAudio(true); // Send as final when silence detected
          silenceTimeout = null;
        }, SILENCE_THRESHOLD);
      };

      this.mediaRecorder.onstop = () => {
        // Send any remaining audio chunks as final when recording stops
        if (audioChunks.length > 0) {
          sendAudio(true);
        }
        if (silenceTimeout) {
          clearTimeout(silenceTimeout);
        }
      };

      this.mediaRecorder.onerror = (event: any) => {
        console.error('[WebRTC] MediaRecorder error:', event.error);
      };

      this.mediaRecorder.start(100); // Capture every 100ms
      this.isRecording = true;

      console.log('[WebRTC] Call started, recording audio');
    } catch (error: any) {
      console.error('[WebRTC] Failed to start call:', error);
      
      // Provide helpful error messages
      if (error.name === 'NotAllowedError') {
        throw new Error('🎤 Microphone permission denied.\n\nOn Android:\n1. Go to Settings\n2. Apps → This Browser\n3. Permissions → Microphone\n4. Select "Allow"');
      } else if (error.name === 'NotFoundError') {
        throw new Error('🎤 No microphone found. Please connect a microphone.');
      } else if (error.name === 'NotReadableError') {
        throw new Error('🎤 Microphone is in use by another application.');
      } else if (error.name === 'SecurityError') {
        throw new Error('🎤 This page must be served over HTTPS or localhost for microphone access.');
      } else {
        throw error;
      }
    }
  }

  private getMediaRecorderMimeType(): string {
    // Try different MIME types in order of preference
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg',
      'audio/wav',
      'audio/aac',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('[WebRTC] Using supported MIME type:', type);
        return type;
      }
    }

    // Fallback to default
    console.warn('[WebRTC] No MIME type supported, using default');
    return 'audio/webm';
  }

  async stopCall() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    console.log('[WebRTC] Call ended');
  }

  private playAudio(base64Audio: string) {
    try {
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const audioBlob = new Blob([bytes], { type: 'audio/mp3' });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.play().catch((err) => console.error('Failed to play audio:', err));

      // Clean up URL after playback
      setTimeout(() => URL.revokeObjectURL(audioUrl), 5000);
    } catch (error) {
      console.error('[WebRTC] Failed to play audio:', error);
    }
  }

  sendTranscription(text: string, isFinal: boolean) {
    this.socket.emit('transcription', {
      text,
      isFinal,
      timestamp: Date.now(),
    });
  }

  isConnected(): boolean {
    return this.socket.connected;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}
