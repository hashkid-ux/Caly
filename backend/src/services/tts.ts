import axios from 'axios';
import config from '../config';
import { AudioFragment } from '../types';

export class TTSService {
  private apiKey: string;
  private voiceId: string;

  constructor() {
    this.apiKey = config.ELEVENLABS_API_KEY || '';
    this.voiceId = config.ELEVENLABS_VOICE_ID || 'Xb7hH8MSUJpSbvxk5HLt';

    if (!this.apiKey) {
      console.warn('⚠️  ELEVENLABS_API_KEY not set. Get free key at: https://elevenlabs.io/');
    }
  }

  async synthesize(text: string): Promise<AudioFragment> {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not set. Get free key at https://elevenlabs.io/');
    }

    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        text,
        model_id: 'eleven_turbo_v2_5', // Latest free tier model (was: eleven_monolingual_v1)
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      },
      {
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
      }
    );

    return {
      audioBuffer: Buffer.from(response.data),
      timestamp: Date.now(),
      isFinal: true,
    };
  }

  async synthesizeWithProsody(text: string, intensity: 'low' | 'medium' | 'high' = 'medium'): Promise<AudioFragment> {
    // Map intensity to stability settings for ElevenLabs
    const stabilityMap = {
      low: 0.3,
      medium: 0.5,
      high: 0.75,
    };

    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not set');
    }

    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: stabilityMap[intensity],
          similarity_boost: 0.75,
        },
      },
      {
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
      }
    );

    return {
      audioBuffer: Buffer.from(response.data),
      timestamp: Date.now(),
      isFinal: true,
    };
  }
}

export const ttsService = new TTSService();
