import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import config from './config';
import { StreamingOrchestrator } from './orchestrator';
import { latencyTracker } from './utils/latencyTracker';
import { asrService } from './services/asr';

console.log('🔥 BACKEND SERVER STARTING UP (CODE VERSION WITH LOGGING)...\n');

// Initialize Express app
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow all origins - ngrok, localhost, network IPs
      callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
  },
});

// Middleware - Add CORS and permission headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Permissions-Policy', 'microphone=*, camera=*');
  res.header('Access-Control-Allow-Credentials', 'false');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());
app.use(express.static('public'));

// Store active orchestrators
const orchestrators = new Map<string, StreamingOrchestrator>();

// REST endpoint to check server health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    targetLatency: config.TARGET_LATENCY_MS,
    server: 'Hindi AI Calling Backend',
    version: '1.0.0',
  });
});

// REST endpoint for diagnostic info
app.get('/status', (req, res) => {
  res.json({
    server: 'online',
    backend: {
      port: 3000,
      status: 'running',
      localIP: '192.168.29.53',
    },
    services: {
      assemblyai: 'configured',
      openrouter: 'configured',
      elevenlabs: 'configured',
    },
    activeSessions: orchestrators.size,
    timestamp: new Date().toISOString(),
  });
});

// REST endpoint to get metrics for a session
app.get('/metrics/:sessionId', (req, res) => {
  const orchestrator = orchestrators.get(req.params.sessionId);
  if (!orchestrator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json(orchestrator.getSessionMetrics());
});

console.log('[INIT] Registering Socket.io connection handler...');

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`[WebSocket] Client connected: ${socket.id}`);

  // Create new orchestrator for this connection
  const orchestrator = new StreamingOrchestrator(socket.id);
  orchestrators.set(socket.id, orchestrator);

  // Buffer to collect audio chunks during a call
  let audioBuffer: Buffer[] = [];
  let isCallActive = false;

  // Client sends audio chunk
  socket.on('audio_chunk', async (data: { buffer: Uint8Array; isFinal: boolean }) => {
    latencyTracker.start(socket.id, 'audio_receive');
    latencyTracker.log(socket.id, `Received audio chunk: ${data.buffer.length} bytes (final: ${data.isFinal})`);

    // Collect audio chunks
    audioBuffer.push(Buffer.from(data.buffer));

    // If final chunk, process with ASR
    if (data.isFinal && audioBuffer.length > 0) {
      // Combine all chunks
      const combinedAudio = Buffer.concat(audioBuffer);
      audioBuffer = [];

      latencyTracker.log(socket.id, `Processing ${combinedAudio.length} bytes through ASR...`);

      try {
        // Process audio with ASR using async generator
        const generator = asrService.streamTranscribe(
          (async function* () {
            yield combinedAudio;
          })(),
          (result: any) => {
            console.log(`[${socket.id}] ASR Result:`, result.text);
            
            // Send transcription to orchestrator
            orchestrator.onTranscriptionResult(
              {
                text: result.text,
                isFinal: result.isFinal,
                timestamp: Date.now(),
                latency: 0,
              },
              (audioFragment) => {
                // Send audio response back to client
                console.log(`[${socket.id}] 📤 Emitting audio_response: ${audioFragment.audioBuffer.length} bytes (final: ${audioFragment.isFinal})`);
                socket.emit('audio_response', {
                  audio: audioFragment.audioBuffer.toString('base64'),
                  timestamp: audioFragment.timestamp,
                  isFinal: audioFragment.isFinal,
                });
                console.log(`[${socket.id}] ✅ Audio response emitted successfully`);
              }
            );
          }
        );
        
        // Wait for ASR to complete
        if (generator instanceof Promise) {
          await generator;
        }
      } catch (error) {
        console.error(`[${socket.id}] ASR Error:`, error);
        socket.emit('error', { message: `ASR processing failed: ${error}` });
      }
    }

    latencyTracker.end(socket.id, 'audio_receive');
    socket.emit('audio_acknowledged', { timestamp: Date.now() });
  });

  // Client sends transcription (alternative method)
  socket.on('transcription', async (data: { text: string; isFinal: boolean }) => {
    latencyTracker.log(socket.id, `Transcription received: ${data.text} (final: ${data.isFinal})`);
    console.log(`[${socket.id}] 📝 Handler called for transcription event`);

    // Process transcription and generate response
    console.log(`[${socket.id}] 🎯 Calling orchestrator.onTranscriptionResult...`);
    await orchestrator.onTranscriptionResult(
      {
        text: data.text,
        isFinal: data.isFinal,
        timestamp: Date.now(),
        latency: 0,
      },
      (audioFragment) => {
        // Send audio back to client
        console.log(`[${socket.id}] 📞 Audio callback triggered! Sending audio_response...`);
        socket.emit('audio_response', {
          audio: audioFragment.audioBuffer.toString('base64'),
          timestamp: audioFragment.timestamp,
          isFinal: audioFragment.isFinal,
        });
        console.log(`[${socket.id}] ✅ audio_response emitted!`);
      },
      (text) => {
        // Send text response as fallback if audio fails
        console.log(`[${socket.id}] 📝 Text callback triggered! Sending text_response: "${text}"`);
        socket.emit('text_response', {
          text: text,
          timestamp: Date.now(),
          isFinal: true,
        });
        console.log(`[${socket.id}] ✅ text_response emitted!`);
      }
    );
    console.log(`[${socket.id}] 🏁 orchestrator.onTranscriptionResult completed`);
  });

  // Request metrics
  socket.on('get_metrics', () => {
    socket.emit('metrics', orchestrator.getSessionMetrics());
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    orchestrator.cleanup();
    orchestrators.delete(socket.id);
  });

  // Error handling
  socket.on('error', (error) => {
    console.error(`[WebSocket] Socket error for ${socket.id}:`, error);
  });
});

// Start server
const PORT = process.env.PORT || config.PORT;

httpServer.listen(PORT, () => {
  console.log(`\n🚀 Server started on port ${PORT}`);
  console.log(`📞 Hindi AI Calling System - Phase 1`);
  console.log(`🎯 Target Latency: ${config.TARGET_LATENCY_MS}ms`);
  console.log(`🔊 Language: Hindi (hi-IN)`);
  console.log(`\n✅ Ready to receive calls!`);
  console.log(`\nAPI Endpoints:`);
  console.log(`  - Health check: http://localhost:${PORT}/health`);
  console.log(`  - Get metrics: http://localhost:${PORT}/metrics/:sessionId`);
  console.log(`\nWebSocket Events:`);
  console.log(`  - audio_chunk: Send raw audio from microphone`);
  console.log(`  - transcription: Send transcribed text`);
  console.log(`  - get_metrics: Request session metrics`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  orchestrators.forEach((orch) => orch.cleanup());
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export { app, io };
