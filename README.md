# Hindi AI Calling System - Phase 1

Real-time streaming AI calling system specialized for Hindi language with sub-300ms latency target.

## Project Structure

```
.
├── backend/              # Node.js backend
│   ├── src/
│   │   ├── index.ts      # Main server & WebSocket
│   │   ├── config.ts     # Configuration
│   │   ├── types.ts      # TypeScript interfaces
│   │   ├── orchestrator.ts # Streaming pipeline
│   │   ├── services/
│   │   │   ├── llm.ts    # OpenRouter LLM
│   │   │   ├── asr.ts    # Google Cloud Speech-to-Text
│   │   │   └── tts.ts    # Google Cloud Text-to-Speech
│   │   └── utils/
│   │       └── latencyTracker.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/             # React frontend
│   ├── src/
│   │   ├── App.tsx       # Main UI component
│   │   ├── App.css       # Styling
│   │   └── main.tsx      # Entry point
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── config/               # Credentials (gitignored)
│   └── google-cloud-key.json
├── .env                  # Environment variables (gitignored)
├── docker-compose.yml    # Docker setup
├── Dockerfile            # Backend Docker image
└── README.md             # This file
```

## Setup Instructions

### 1. Prerequisites

- Node.js 18+ installed
- Docker (optional)
- Google Cloud account with Speech-to-Text & Text-to-Speech APIs enabled
- OpenRouter API key

### 2. Environment Setup

Create a `.env` file in the root directory:

```bash
OPENROUTER_API_KEY=your_openrouter_key_here
GOOGLE_CLOUD_PROJECT_ID=your_gcp_project_id
GOOGLE_APPLICATION_CREDENTIALS=./config/google-cloud-key.json
NODE_ENV=development
PORT=3000
REDIS_URL=redis://localhost:6379
```

### 3. Google Cloud Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable APIs:
   - Speech-to-Text API v1 (free tier: 60 min/month)
   - Text-to-Speech API (free tier: 4M chars/month)
4. Create a service account
5. Download JSON key and save to `config/google-cloud-key.json`

### 4. Install Dependencies

**Backend:**
```bash
cd backend
npm install
```

**Frontend:**
```bash
cd frontend
npm install
```

### 5. Run Locally

**Option A: Development Mode (Recommended)**

Terminal 1 - Backend:
```bash
cd backend
npm run dev
```

Terminal 2 - Frontend:
```bash
cd frontend
npm run dev
```

Then open http://localhost:5173

**Option B: Docker (All-in-one)**

```bash
docker-compose up --build
```

- Backend: http://localhost:3000
- Frontend: http://localhost:5173
- Redis: localhost:6379

## Architecture

### Streaming Pipeline (Target: <300ms)

```
User Speech (Microphone)
         ↓
    [WebRTC Audio]
         ↓
Google Cloud Speech-to-Text (ASR)  ~100-150ms
         ↓
OpenRouter LLM (Streaming)         ~30-50ms per token
         ↓
Google Cloud Text-to-Speech        ~80-150ms
         ↓
WebRTC Audio to Speaker (Playback)
```

### Key Features

✅ **Real-time Streaming**: Token-by-token processing without buffering
✅ **Sub-300ms Latency**: Full response within 300ms of silence
✅ **Hindi Native**: ASR, LLM, and TTS optimized for Hindi
✅ **Natural Speech**: Emotion-aware prosody (Phase 2)
✅ **Free Tier**: All APIs use free/trial tier
✅ **Scalable**: Docker + Kubernetes ready

## API Endpoints

### REST

- `GET /health` - Server health check
- `GET /metrics/:sessionId` - Get session metrics

### WebSocket Events

**Client → Server:**
- `audio_chunk` - Send raw audio bytes
- `transcription` - Send transcribed text
- `get_metrics` - Request performance metrics

**Server → Client:**
- `audio_response` - Receive synthesized audio
- `audio_acknowledged` - Audio chunk received
- `metrics` - Performance metrics response

## Testing

### Test Mode

1. Open http://localhost:5173
2. Click "Test Mode" button
3. View response in real-time
4. Check latency metrics

### Manual Testing

```bash
# Health check
curl http://localhost:3000/health

# Get metrics for session
curl http://localhost:3000/metrics/{sessionId}
```

## Performance Targets

| Stage | Target | Current |
|-------|--------|---------|
| ASR Latency | <150ms | Pending |
| LLM First Token | <50ms | Pending |
| TTS Synthesis | <150ms | Pending |
| Total Latency | <300ms | Pending |

## Free Tier Quotas

| Service | Free Quota | Usage/Call |
|---------|-----------|-----------|
| Google Speech-to-Text | 60 min/month | 10 min = 100% usage |
| Google TTS | 4M chars/month | 500 chars = <0.02% |
| OpenRouter Trial | $5 credit | ~$0.0001/call |

**Recommendation**: Use test mode or local data during development to preserve quota.

## Cost Analysis

**Phase 1 (MVP/Testing)**
- Cost: $0 (all free tiers)
- Calls: 1000+ test calls

**Phase 2+ (Production)**
- ASR: ~$0.016/min = ~$16 for 1000 calls
- TTS: ~$0.00003/char = ~$0.15 for 1000 calls
- LLM: ~$0.0001/call (OpenRouter Mistral)
- **Total: ~$16-50 per 1000 calls**

## Roadmap

- [ ] Phase 1: Streaming infrastructure ✅ (IN PROGRESS)
- [ ] Phase 2: Emotion detection & prosody injection
- [ ] Phase 3: Specialized agents (customer support, sales, booking)
- [ ] Phase 4: Scale to 100+ concurrent calls
- [ ] Phase 5: Business dashboard & analytics

## Troubleshooting

### "Cannot connect to server"
- Check if backend is running: `curl http://localhost:3000/health`
- Check CORS settings in index.ts

### "Google Cloud authentication failed"
- Verify `google-cloud-key.json` exists and has correct permissions
- Check `GOOGLE_APPLICATION_CREDENTIALS` path in .env

### "OpenRouter API error"
- Verify `OPENROUTER_API_KEY` is set in .env
- Check if trial credits are available

### High latency (>500ms)
- Check network connection quality
- Monitor CPU/RAM usage
- Review detailed metrics in UI

## Contributing

This is an MVP project. Contributions welcome!

## License

MIT

## Support

For issues and questions, please check the GitHub issues or contact the team.

---

**Built with ❤️ for real-time Hindi AI conversations**
