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

  // 🔧 FIX: Simplified audio recording - no chunking!
  private isProcessing: boolean = false;
  private isSpeechActive: boolean = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private SILENCE_THRESHOLD_MS = 1000; // 1 second of silence
  private MIN_AUDIO_DURATION_MS = 500; // Minimum 500ms to process
  private recordingStartTime = 0;
  private audioLevel = 0;

  // Audio playback queue
  private audioQueue: { data: Uint8Array; isLastChunk: boolean; requestId: string }[] = [];
  private isPlayingAudio = false;
  private currentRequestId: string = '';
  private processingTimeout: ReturnType<typeof setTimeout> | null = null;

  // Callbacks for UI updates
  public onTranscription: ((text: string) => void) | null = null;
  public onResponse: ((text: string) => void) | null = null;
  public onAudioChunk: ((chunk: Uint8Array, isFinal: boolean) => void) | null = null;
  public onError: ((error: string) => void) | null = null;
  public onMetrics: ((metrics: CallMetrics) => void) | null = null;

  constructor(serverUrl?: string) {
    const url = serverUrl || getServerUrl();
    console.log('[WebRTC] 🔗 Attempting to connect to:', url);

    const isMixedContent = window.location.protocol === 'https:' && url.startsWith('http://');
    const transports = isMixedContent ? ['polling'] : ['websocket', 'polling'];

    if (isMixedContent) {
      console.log('[WebRTC] ⚠️  Mixed content detected (HTTPS→HTTP), using polling transport only');
    }

    this.socket = io(url, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 3000,
      reconnectionAttempts: 10,
      timeout: 15000,
      transports: transports,
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
      if (this.onError) {
        this.onError(`Connection failed: ${error.message || 'Unknown error'}`);
      }
    });

    this.socket.on('error', (error: any) => {
      console.error('[WebRTC] ❌ Socket error:', error);
    });

    // 🔧 FIX: Simplified audio playback - no requestId filtering
    this.socket.on('audio_chunk', (data: any) => {
      console.log(`[WebRTC] 📥 Audio chunk: ${data.buffer.length} bytes, final=${data.isFinal}`);
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
      
      // 🔧 FIX: Reset processing state on response
      this.clearProcessingTimeout();
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

    // 🔧 FIX: Add metrics listener
    this.socket.on('metrics', (data: any) => {
      console.log('[WebRTC] 📊 Metrics received:', data);
      if (this.onMetrics && data.metrics) {
        this.onMetrics({
          asrLatency: data.metrics.asr || 0,
          llmLatency: data.metrics.llm_generation || 0,
          ttsLatency: data.metrics.tts || 0,
          totalLatency: data.metrics.full_pipeline || 0,
          lastUpdate: Date.now()
        });
      }
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

      if (isAndroid && !isHttps) {
        throw new Error('🔒 Android requires HTTPS connection for microphone access. Please use ngrok or HTTPS server.');
      }

      const audioConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 },
        },
      };

      this.localStream = await navigator.mediaDevices
        .getUserMedia(audioConstraints)
        .catch((err) => {
          console.warn('[WebRTC] ⚠️ Enhanced constraints failed, trying basic audio:', err.message);
          return navigator.mediaDevices.getUserMedia({ audio: true });
        });

      console.log('[WebRTC] ✅ Microphone access granted');

      // 🔧 FIX: Setup audio level monitoring for better silence detection
      this.setupAudioLevelMonitoring();

      await this.startRecording();
      
      console.log('[WebRTC] ✅ CALL STARTED - Ready to listen');
    } catch (error: any) {
      console.error('[WebRTC] ❌ Start call failed:', error);
      const errorMsg = error.message || error.name || 'Unknown error';
      if (this.onError) {
        this.onError(`Microphone access failed: ${errorMsg}`);
      }
      throw new Error(`Microphone access failed: ${errorMsg}`);
    }
  }

  // 🔧 NEW: Audio level monitoring for better silence detection
  private setupAudioLevelMonitoring() {
    if (!this.localStream) return;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(this.localStream);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;
    microphone.connect(analyser);

    const checkAudioLevel = () => {
      if (!this.isRecording) return;

      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      this.audioLevel = average;

      // Detect speech start
      if (average > 10 && !this.isSpeechActive) { // Threshold for speech
        console.log('[WebRTC] 🗣️ Speech detected');
        this.isSpeechActive = true;
        this.recordingStartTime = Date.now();
      }

      // Reset silence timer if speech is active
      if (this.isSpeechActive && average > 10) {
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
        }
        this.silenceTimer = setTimeout(() => this.onSilenceDetected(), this.SILENCE_THRESHOLD_MS);
      }

      requestAnimationFrame(checkAudioLevel);
    };

    checkAudioLevel();
  }

  // 🔧 FIX: Completely rewritten recording logic
  private async startRecording() {
    if (!this.localStream) return;

    const mimeType = this.getBestMimeType();
    console.log('[WebRTC] 🎤 Starting recorder with:', mimeType);

    try {
      this.mediaRecorder = new MediaRecorder(this.localStream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
    } catch (e) {
      this.mediaRecorder = new MediaRecorder(this.localStream, { mimeType });
    }

    this.isSpeechActive = false;
    this.recordingStartTime = 0;

    // 🔧 FIX: Only handle complete recordings (when stop() is called)
    this.mediaRecorder.ondataavailable = async (event: BlobEvent) => {
      if (event.data.size > 0 && !this.isProcessing) {
        console.log(`[WebRTC] 🎤 Complete recording received: ${event.data.size} bytes`);
        await this.processRecording(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      console.log('[WebRTC] 🛑 Recorder stopped, restarting for next utterance...');
      
      // 🔧 FIX: Automatically restart recorder for continuous listening
      if (this.isRecording && this.localStream) {
        setTimeout(() => {
          if (this.mediaRecorder && this.isRecording) {
            this.isSpeechActive = false;
            this.recordingStartTime = 0;
            this.mediaRecorder.start(); // Start fresh recording
            console.log('[WebRTC] ✅ Recorder restarted');
          }
        }, 100);
      }
    };

    this.mediaRecorder.onerror = (event: any) => {
      console.error('[WebRTC] ❌ Recorder error:', event.error);
      if (this.onError) {
        this.onError(`Recording error: ${event.error}`);
      }
    };

    // 🔧 FIX: Start without timeslice - only fires ondataavailable when stop() is called
    this.mediaRecorder.start();
    this.isRecording = true;
    console.log('[WebRTC] ✅ Recorder started (no chunking)');
  }

  // 🔧 FIX: Trigger recording stop on silence
  private async onSilenceDetected() {
    if (this.isProcessing || !this.isSpeechActive || !this.mediaRecorder) return;

    const recordingDuration = Date.now() - this.recordingStartTime;
    
    // Validate minimum duration
    if (recordingDuration < this.MIN_AUDIO_DURATION_MS) {
      console.log(`[WebRTC] ⏭️ Audio too short (${recordingDuration}ms), ignoring`);
      this.isSpeechActive = false;
      return;
    }

    console.log('[WebRTC] 🔇 Silence detected after speech - stopping recorder');
    
    // 🔧 FIX: Stop recorder - this triggers ondataavailable with complete blob
    if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
  }

  // 🔧 FIX: Process complete recording blob
  private async processRecording(audioBlob: Blob) {
    if (this.isProcessing) {
      console.log('[WebRTC] ⚠️ Already processing, skipping');
      return;
    }

    // Validate blob
    if (!this.isValidAudioBlob(audioBlob)) {
      console.error('[WebRTC] ❌ Invalid audio blob, skipping');
      return;
    }

    this.isProcessing = true;

    // 🔧 FIX: Set timeout for processing
    this.setProcessingTimeout();

    try {
      this.currentRequestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Validate audio signature
      if (!this.hasValidAudioSignature(uint8Array)) {
        console.error('[WebRTC] ❌ Invalid audio signature, skipping');
        this.isProcessing = false;
        this.clearProcessingTimeout();
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
      
      // Request metrics after sending
      setTimeout(() => {
        this.socket.emit('get_metrics');
      }, 100);

    } catch (error) {
      console.error('[WebRTC] ❌ Error processing recording:', error);
      this.isProcessing = false;
      this.clearProcessingTimeout();
      if (this.onError) {
        this.onError(`Processing failed: ${error}`);
      }
    }
  }

  // 🔧 NEW: Processing timeout management
  private setProcessingTimeout() {
    this.clearProcessingTimeout();
    this.processingTimeout = setTimeout(() => {
      console.error('[WebRTC] ⏱️ Processing timeout - resetting state');
      this.isProcessing = false;
      if (this.onError) {
        this.onError('Processing timeout - please try again');
      }
    }, 30000); // 30 second timeout
  }

  private clearProcessingTimeout() {
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
    this.isProcessing = false;
  }

  private isValidAudioBlob(blob: Blob): boolean {
    const isValid = blob.size > 5000 && blob.type.includes('audio');
    if (!isValid) {
      console.warn(`[WebRTC] Invalid blob: size=${blob.size}, type=${blob.type}`);
    }
    return isValid;
  }

  private hasValidAudioSignature(buffer: Uint8Array): boolean {
    if (buffer.length < 4) return false;

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

  // 🔧 FIX: Simplified playback - no requestId filtering
  private async playQueuedAudio() {
    if (this.isPlayingAudio || this.audioQueue.length === 0) return;

    this.isPlayingAudio = true;

    try {
      while (this.audioQueue.length > 0) {
        const { data, isLastChunk } = this.audioQueue.shift()!;

        try {
          console.log(`[WebRTC] 🔊 Playing ${data.length} bytes`);
          await this.playAudioBuffer(data);
          
          if (isLastChunk) {
            console.log('[WebRTC] 🏁 Playback complete');
            this.clearProcessingTimeout(); // Reset processing state
            break;
          }
        } catch (error) {
          console.error('[WebRTC] ❌ Playback error:', error);
        }
      }
    } finally {
      this.isPlayingAudio = false;
    }
  }

  private playAudioBuffer(buffer: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
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
    
    this.isSpeechActive = false;
    this.isProcessing = false;
    this.clearProcessingTimeout();

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.mediaRecorder = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
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