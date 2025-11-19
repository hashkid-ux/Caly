import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import config from './config';
import { StreamingOrchestrator } from './orchestrator';
import { latencyTracker } from './utils/latencyTracker';

console.log('🔥 BACKEND SERVER STARTING UP - OPTIMIZED FOR <300MS LATENCY\n');

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
  },
  maxHttpBufferSize: 1e7, // 10MB for large audio chunks
});

// Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Permissions-Policy', 'microphone=*, camera=*');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Store active orchestrators
const orchestrators = new Map<string, StreamingOrchestrator>();

// REST endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    targetLatency: config.TARGET_LATENCY_MS,
    activeSessions: orchestrators.size,
  });
});

app.get('/status', (req, res) => {
  res.json({
    server: 'online',
    port: config.PORT,
    services: {
      assemblyai: 'configured',
      openrouter: 'configured',
      elevenlabs: 'configured',
    },
    activeSessions: orchestrators.size,
    timestamp: new Date().toISOString(),
  });
});

app.get('/metrics/:sessionId', (req, res) => {
  const orchestrator = orchestrators.get(req.params.sessionId);
  if (!orchestrator) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(orchestrator.getSessionMetrics());
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`\n[WebSocket] ✅ Client connected: ${socket.id}`);

  // Create new orchestrator for this connection
  const orchestrator = new StreamingOrchestrator(socket.id);
  orchestrators.set(socket.id, orchestrator);

  let audioBuffer: Buffer[] = [];
  let isWaitingForFinalAudio = false;
  let lastProcessedRequestId: string = ''; // Track to prevent duplicates

  /**
   * Client sends audio chunk (with silence detection on frontend)
   * Only receives final chunks when user stops speaking
   */
  socket.on('audio_chunk', async (data: { buffer: Uint8Array; isFinal: boolean; requestId?: string }) => {
    const chunkSize = data.buffer.length;
    const requestId = data.requestId || 'unknown';
    console.log(`[${socket.id}] 📥 Audio chunk: ${chunkSize} bytes (final: ${data.isFinal}) [${requestId}]`);

    // Prevent duplicate processing
    if (data.requestId && data.requestId === lastProcessedRequestId) {
      console.log(`[${socket.id}] ⚠️ DUPLICATE REQUEST - Ignoring [${requestId}]`);
      return;
    }

    // Prevent simultaneous processing
    if (isWaitingForFinalAudio) {
      console.log(`[${socket.id}] ⚠️ Already processing, rejecting [${requestId}]`);
      return;
    }

    latencyTracker.start(socket.id, 'audio_receive');

    // Collect audio chunks
    audioBuffer.push(Buffer.from(data.buffer));

    // Process only when final chunk arrives (complete sentence)
    if (data.isFinal && audioBuffer.length > 0) {
      const totalSize = audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
      console.log(`[${socket.id}] 🎤 Processing complete sentence: ${totalSize} bytes [${requestId}]`);

      lastProcessedRequestId = requestId; // Track this request to prevent duplicates
      const combinedAudio = Buffer.concat(audioBuffer);
      audioBuffer = [];

      isWaitingForFinalAudio = true;

      try {
        // Send transcription for processing
        await orchestrator.onTranscriptionResult(
          {
            text: 'Processing audio...', // Placeholder - actual transcription happens in ASR
            isFinal: true,
            timestamp: Date.now(),
            latency: 0,
          },
          // Callback for audio chunks
          (audioFragment) => {
            console.log(
              `[${socket.id}] 📤 Emitting audio_chunk: ${audioFragment.audioBuffer.length} bytes (final: ${audioFragment.isFinal}) [${requestId}]`
            );
            socket.emit('audio_chunk', {
              buffer: audioFragment.audioBuffer,
              timestamp: audioFragment.timestamp,
              isFinal: audioFragment.isFinal,
              requestId: requestId, // Send request ID so frontend knows which response this is for
            });
          },
          // Callback for text fallback
          (text) => {
            console.log(`[${socket.id}] 📝 Emitting text_response: "${text}"`);
            socket.emit('text_response', {
              text: text,
              timestamp: Date.now(),
              isFinal: true,
            });
          }
        );
      } catch (error) {
        console.error(`[${socket.id}] ❌ Error processing audio:`, error);
        socket.emit('error', {
          message: `Processing failed: ${error}`,
        });
      } finally {
        isWaitingForFinalAudio = false;
        latencyTracker.end(socket.id, 'audio_receive');
      }
    }

    // Send acknowledgment
    socket.emit('audio_acknowledged', {
      timestamp: Date.now(),
      buffered: audioBuffer.length,
    });
  });

  /**
   * Alternative: Client sends pre-transcribed text
   * (for testing without ASR)
   */
  socket.on('transcription', async (data: { text: string; isFinal: boolean }) => {
    if (!data.isFinal) {
      console.log(`[${socket.id}] ⏳ Partial: "${data.text}"`);
      return;
    }

    console.log(`[${socket.id}] 📝 Final transcription: "${data.text}"`);

    try {
      await orchestrator.onTranscriptionResult(
        {
          text: data.text,
          isFinal: true,
          timestamp: Date.now(),
          latency: 0,
        },
        // Emit audio chunks as they arrive
        (audioFragment) => {
          console.log(
            `[${socket.id}] 🔊 Streaming audio: ${audioFragment.audioBuffer.length} bytes (final: ${audioFragment.isFinal})`
          );
          socket.emit('audio_chunk', {
            buffer: audioFragment.audioBuffer,
            timestamp: audioFragment.timestamp,
            isFinal: audioFragment.isFinal,
          });
        },
        // Text fallback
        (text) => {
          console.log(`[${socket.id}] 📋 Text response: "${text}"`);
          socket.emit('text_response', {
            text: text,
            timestamp: Date.now(),
            isFinal: true,
          });
        }
      );
    } catch (error) {
      console.error(`[${socket.id}] ❌ Error:`, error);
      socket.emit('error', {
        message: `Error: ${error}`,
      });
    }
  });

  // Request metrics
  socket.on('get_metrics', () => {
    socket.emit('metrics', orchestrator.getSessionMetrics());
  });

  // Disconnection
  socket.on('disconnect', () => {
    console.log(`[${socket.id}] 🔌 Client disconnected`);
    orchestrator.cleanup();
    orchestrators.delete(socket.id);
  });

  socket.on('error', (error) => {
    console.error(`[${socket.id}] ❌ Socket error:`, error);
  });
});

// Start server
const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) || parseInt(String(config.PORT), 10) : (typeof config.PORT === 'number' ? config.PORT : parseInt(String(config.PORT), 10));

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 SERVER READY ON PORT ${PORT}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📞 Hindi AI Calling System - Optimized`);
  console.log(`🎯 Target Latency: <${config.TARGET_LATENCY_MS}ms`);
  console.log(`⚙️  Architecture: Streaming + Predictive TTS`);
  console.log(`🔊 Language: Hindi (hi-IN)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n📍 API Endpoints:`);
  console.log(`   GET  /health      - Health check`);
  console.log(`   GET  /status      - Server status`);
  console.log(`   GET  /metrics/:id - Session metrics`);
  console.log(`\n📡 WebSocket Events:`);
  console.log(`   → audio_chunk     - Send audio (final only)`);
  console.log(`   → transcription   - Send text`);
  console.log(`   ← audio_chunk     - Receive audio stream`);
  console.log(`   ← text_response   - Receive text response`);
  console.log(`\n✅ System ready for calls!\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n⏹️  SIGTERM - Shutting down gracefully...');
  orchestrators.forEach((orch) => orch.cleanup());
  httpServer.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

export { app, io };