import io from 'socket.io-client';

export interface CallMetrics {
  asrLatency: number;
  llmLatency: number;
  ttsLatency: number;
  totalLatency: number;
  lastUpdate: number;
}

function getServerUrl(): string {
  const protocol = window.location.protocol; // http: or https:
  const host = window.location.hostname;
  const params = new URLSearchParams(window.location.search);
  const backendParam = params.get('backend');
  
  // If explicitly provided via query param, use it
  if (backendParam) {
    console.log('[WebRTC] ✅ Using backend from query param:', backendParam);
    return backendParam;
  }

  // If on ngrok HTTPS frontend, try HTTP backend on local network
  if (host.includes('ngrok-free.dev') || host.includes('ngrok.io') || host.includes('ngrok.app')) {
    // ngrok frontend can access HTTP backend on local network via query param
    // User must provide: ?backend=http://192.168.29.53:3000
    console.log('[WebRTC] 🌐 On ngrok - expecting backend URL in query param', 'backend=http://YOUR_IP:3000');
    console.log('[WebRTC] ℹ️ Attempting local network IP...');
    return `http://192.168.29.53:3000`; // Fallback to local IP
  }

  // Local network - use same protocol as frontend
  if (host === 'localhost' || host === '127.0.0.1') {
    console.log('[WebRTC] 🏠 Using localhost backend');
    return `${protocol}//localhost:3000`;
  }

  // Same network - use same protocol as frontend (usually http://)
  console.log('[WebRTC] 🔗 Using same-network backend with', protocol);
  return `${protocol}//${host}:3000`;
}

export class WebRTCClient {
  private socket: any;
  private localStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private isRecording: boolean = false;
  private sessionId: string = '';

  // Enhanced audio recording
  private currentRecordingChunks: Blob[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private SILENCE_THRESHOLD_MS = 800; // Increased for better sentence detection
  private MIN_AUDIO_DURATION_MS = 500; // Minimum audio length to process
  private isSpeechActive = false;
  private recordingStartTime = 0;
  private isProcessing = false;

  // Audio playback queue
  private audioQueue: { data: Uint8Array; isLastChunk: boolean; requestId: string }[] = [];
  private isPlayingAudio = false;
  private currentRequestId: string = '';
  private audioContext: AudioContext | null = null;
  lastRequestId: any;

  // Callbacks for UI updates
  public onTranscription: ((text: string) => void) | null = null;
  public onResponse: ((text: string) => void) | null = null;
  public onAudioChunk: ((chunk: Uint8Array, isFinal: boolean) => void) | null = null;
  public onError: ((error: string) => void) | null = null;

  constructor(serverUrl?: string) {
    const url = serverUrl || getServerUrl();
    console.log('[WebRTC] 🔗 Attempting to connect to:', url);

    // Check if we're in a mixed-content scenario (HTTPS frontend → HTTP backend)
    const isMixedContent = window.location.protocol === 'https:' && url.startsWith('http://');
    const transports = isMixedContent 
      ? ['polling'] // Polling is "upgradable" and works with mixed content
      : ['websocket', 'polling']; // Prefer websocket for same-protocol

    if (isMixedContent) {
      console.log('[WebRTC] ⚠️  Mixed content detected (HTTPS→HTTP), using polling transport only');
    }

    this.socket = io(url, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 3000,
      reconnectionAttempts: 10,
      timeout: 15000, // Give polling more time
      transports: transports, // Use polling for mixed content, websocket otherwise
      rememberUpgrade: true,
      autoConnect: true,
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.socket.on('connect', () => {
      console.log('[WebRTC] ✅ CONNECTED to server');
      console.log('[WebRTC] Session ID:', this.socket.id);
      console.log('[WebRTC] Transport:', this.socket.io.engine.transport.name);
      this.sessionId = this.socket.id;
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log('[WebRTC] ❌ DISCONNECTED -', reason);
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('[WebRTC] ❌ Connection error:', error);
      console.error('[WebRTC] Error type:', error?.type);
      console.error('[WebRTC] Error message:', error?.message);
    });

    this.socket.on('error', (error: any) => {
      console.error('[WebRTC] ❌ Socket error:', error);
    });

    this.socket.on('audio_chunk', (data: any) => {
      // Store the request ID for this response sequence
      if (data.requestId) {
        this.lastRequestId = data.requestId;
      }

      console.log(`[WebRTC] 📥 Audio chunk: ${data.buffer.length} bytes, final=${data.isFinal}, requestId=${data.requestId}`);
      this.audioQueue.push({
        data: new Uint8Array(data.buffer),
        isLastChunk: data.isFinal,
        requestId: data.requestId || ''
      });
      this.playQueuedAudio();
    });

    this.socket.on('text_response', (data: any) => {
      console.log(`[WebRTC] 📝 Text response: "${data.text}"`);
      if (this.onResponse) {
        this.onResponse(data.text);
      }
    });

    this.socket.on('transcription', (data: any) => {
      console.log(`[WebRTC] 🎤 Transcription received: "${data.text}"`);
      if (this.onTranscription) {
        this.onTranscription(data.text);
      }
    });

    this.socket.on('audio_acknowledged', (data: any) => {
      console.log(`[WebRTC] ✅ Audio acknowledged - ${data.buffered} chunks in buffer`);
    });

    this.socket.on('transcribe_fallback', (data: any) => {
      console.log(`[WebRTC] ⚠️ Fallback transcription needed: ${data.reason}`);
    });
  }

  async startCall() {
    try {
      const isAndroid = navigator.userAgent.toLowerCase().includes('android');
      const isHttps = window.location.protocol === 'https:';
      
      console.log('[WebRTC] 🎙️ Requesting microphone...');
      console.log(`[WebRTC] 📱 Device: ${isAndroid ? 'Android' : 'Other'}, Protocol: ${window.location.protocol}`);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone not supported in this browser');
      }

      // Android requires HTTPS for microphone access
      if (isAndroid && !isHttps) {
        throw new Error('🔒 Android requires HTTPS connection for microphone access. Please use ngrok or HTTPS server.');
      }

      // Enhanced audio constraints for better quality
      const audioConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 }, // Higher quality
          channelCount: { ideal: 1 }, // Mono
        },
      };

      this.localStream = await navigator.mediaDevices
        .getUserMedia(audioConstraints)
        .catch((err) => {
          console.warn('[WebRTC] ⚠️ Enhanced constraints failed, trying basic audio:', err.message);
          return navigator.mediaDevices.getUserMedia({ audio: true });
        });

      console.log('[WebRTC] ✅ Microphone access granted');

      // Initialize AudioContext for better audio handling
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      await this.startRecording();
      
      console.log('[WebRTC] ✅ CALL STARTED - Ready to listen');
    } catch (error: any) {
      console.error('[WebRTC] ❌ Start call failed:', error);
      const errorMsg = error.message || error.name || 'Unknown error';
      throw new Error(`Microphone access failed: ${errorMsg}`);
    }
  }

  private async startRecording() {
    if (!this.localStream) return;

    const mimeType = this.getBestMimeType();
    console.log('[WebRTC] 🎤 Starting recorder with:', mimeType);

    try {
      this.mediaRecorder = new MediaRecorder(this.localStream, {
        mimeType,
        audioBitsPerSecond: 128000, // Higher bitrate for quality
      });
    } catch (e) {
      // Fallback without bitrate
      this.mediaRecorder = new MediaRecorder(this.localStream, { mimeType });
    }

    this.currentRecordingChunks = [];
    this.isSpeechActive = false;
    this.recordingStartTime = 0;

    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.handleAudioChunk(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      console.log('[WebRTC] 🛑 Recorder stopped');
      this.currentRecordingChunks = [];
    };

    this.mediaRecorder.onerror = (event: any) => {
      console.error('[WebRTC] ❌ Recorder error:', event.error);
    };

    // Use 300ms timeslice for complete audio packets with headers
    this.mediaRecorder.start(300);
    this.isRecording = true;
  }

  private handleAudioChunk(chunk: Blob) {
    const now = Date.now();
    
    // Start recording time on first chunk
    if (this.recordingStartTime === 0) {
      this.recordingStartTime = now;
    }

    this.currentRecordingChunks.push(chunk);
    
    // Detect speech activity
    if (!this.isSpeechActive && chunk.size > 1000) { // Minimum size threshold
      this.isSpeechActive = true;
      console.log('[WebRTC] 🗣️ Speech detected');
    }

    // Reset silence timer on each chunk
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }

    // Start silence detection
    if (this.isSpeechActive) {
      this.silenceTimer = setTimeout(() => {
        this.onSilenceDetected();
      }, this.SILENCE_THRESHOLD_MS);
    }
  }

  private async onSilenceDetected() {
    if (this.isProcessing || !this.isSpeechActive) return;

    const recordingDuration = Date.now() - this.recordingStartTime;
    
    // Validate minimum duration
    if (recordingDuration < this.MIN_AUDIO_DURATION_MS) {
      console.log(`[WebRTC] ⏭️ Audio too short (${recordingDuration}ms), skipping`);
      this.resetRecordingStatePartially(); // Keep recording, just reset flags
      return;
    }

    if (this.currentRecordingChunks.length === 0) {
      console.log('[WebRTC] ⚠️ No chunks to process');
      this.resetRecordingStatePartially(); // Keep recording
      return;
    }

    console.log('[WebRTC] 🔇 Silence detected - processing utterance');
    await this.processUtterance();
    
    // Continue listening for next utterance instead of stopping
    this.resetRecordingStatePartially();
  }

  private async processUtterance() {
    if (this.isProcessing) {
      console.log('[WebRTC] ⚠️ Already processing, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      // Generate unique request ID
      this.currentRequestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const mimeType = this.getBestMimeType();
      const audioBlob = new Blob(this.currentRecordingChunks, { type: mimeType });
      
      const totalSize = audioBlob.size;
      console.log(`[WebRTC] 📦 Created audio blob: ${totalSize} bytes, ${this.currentRecordingChunks.length} chunks`);

      // Validate blob
      if (!this.isValidAudioBlob(audioBlob)) {
        console.error('[WebRTC] ❌ Invalid audio blob, skipping');
        this.resetRecordingState();
        this.isProcessing = false;
        return;
      }

      // Convert to ArrayBuffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Validate audio signature
      if (!this.hasValidAudioSignature(uint8Array)) {
        console.error('[WebRTC] ❌ Invalid audio signature, skipping');
        this.resetRecordingState();
        this.isProcessing = false;
        return;
      }

      console.log(`[WebRTC] 🚀 Sending ${uint8Array.length} bytes to backend [${this.currentRequestId}]`);

      // Send to backend
      this.socket.emit('audio_chunk', {
        buffer: uint8Array,
        isFinal: true,
        requestId: this.currentRequestId,
        timestamp: Date.now(),
      });

      console.log('[WebRTC] ✅ Audio sent successfully');
    } catch (error) {
      console.error('[WebRTC] ❌ Error processing utterance:', error);
    } finally {
      // Don't fully reset - keep recording for next utterance
      this.isProcessing = false;
    }
  }

  private resetRecordingState() {
    this.currentRecordingChunks = [];
    this.isSpeechActive = false;
    this.recordingStartTime = 0;
    
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private resetRecordingStatePartially() {
    // Reset only the chunks and speech state, keep recording active
    this.currentRecordingChunks = [];
    this.isSpeechActive = false;
    this.recordingStartTime = 0;
    
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private isValidAudioBlob(blob: Blob): boolean {
    return blob.size > 5000 && blob.type.includes('audio');
  }

  private hasValidAudioSignature(buffer: Uint8Array): boolean {
    if (buffer.length < 4) return false;

    // Check for valid audio signatures
    const signatures = [
      [0x1A, 0x45, 0xDF, 0xA3], // WebM
      [0x52, 0x49, 0x46, 0x46], // WAV (RIFF)
      [0xFF, 0xFB], // MP3
      [0xFF, 0xFA], // MP3
      [0x4F, 0x67, 0x67], // OGG
    ];

    for (const sig of signatures) {
      let match = true;
      for (let i = 0; i < sig.length; i++) {
        if (buffer[i] !== sig[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        console.log('[WebRTC] ✅ Valid audio signature detected');
        return true;
      }
    }

    const hexBytes = Array.from(buffer.slice(0, 8))
      .map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`)
      .join(' ');
    console.warn('[WebRTC] ⚠️ Unknown signature:', hexBytes);
    
    return false;
  }

  private getBestMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return 'audio/webm';
  }

  private async playQueuedAudio() {
    if (this.isPlayingAudio || this.audioQueue.length === 0) return;

    this.isPlayingAudio = true;

    while (this.audioQueue.length > 0) {
      const { data, isLastChunk, requestId } = this.audioQueue.shift()!;

      // Skip if from old request
      if (requestId && requestId !== this.currentRequestId) {
        console.log('[WebRTC] ⏭️ Skipping old audio chunk');
        continue;
      }

      try {
        console.log(`[WebRTC] 🔊 Playing ${data.length} bytes`);
        await this.playAudioBuffer(data);
        
        if (isLastChunk) {
          console.log('[WebRTC] 🏁 Playback complete');
          break;
        }
      } catch (error) {
        console.error('[WebRTC] ❌ Playback error:', error);
      }
    }

    this.isPlayingAudio = false;
  }

  private playAudioBuffer(buffer: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Create a new Uint8Array with a regular ArrayBuffer (safe for Blob)
      const safeBuffer = new Uint8Array(buffer);
      const audioBlob = new Blob([safeBuffer], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        reject(new Error('Audio playback failed'));
      };

      audio.play().catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

  async stopCall() {
    console.log('[WebRTC] 🛑 Stopping call...');
    
    this.resetRecordingState();
    this.isProcessing = false;

    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.mediaRecorder = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.audioQueue = [];
    this.isPlayingAudio = false;

    console.log('[WebRTC] ✅ Call stopped cleanly');
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  disconnect() {
    this.stopCall();
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}