import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // OpenRouter LLM (FREE)
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  LLM_MODEL: 'mistralai/mistral-7b-instruct:free', // Free model

  // AssemblyAI ASR (FREE - 600 min/month)
  ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY,

  // ElevenLabs TTS (FREE - 10K chars/month)
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || 'Xb7hH8MSUJpSbvxk5HLt',

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // Audio
  SAMPLE_RATE: 16000,
  AUDIO_ENCODING: 'LINEAR16',

  // Latency targets
  TARGET_LATENCY_MS: 300,
  SILENCE_THRESHOLD_MS: 300,

  // System prompt for Hindi AI agent
  SYSTEM_PROMPT: `You are a helpful Hindi-speaking sales and customer service representative. 
Your personality is friendly, professional, and natural - like a real person.
Keep responses short (2-3 sentences maximum).
Use natural Hindi expressions and colloquialisms.
Show empathy and understanding.
Be concise and direct.
Respond in Hindi unless asked otherwise.`,
};

export default config;
