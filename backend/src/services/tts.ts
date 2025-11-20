import axios from 'axios';
import config from '../config';
import { AudioFragment } from '../types';

export class TTSService {
  private apiKey: string;
  private voiceId: string;
  private requestQueue: Array<() => Promise<void>> = [];
  private isProcessing = false;
  private maxConcurrent = 1; // ElevenLabs free tier: 1 concurrent request
  private activeRequests = 0;

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

    return new Promise((resolve, reject) => {
      const request = async () => {
        try {
          this.activeRequests++;
          
          // Retry logic for rate limiting
          let retries = 3;
          let lastError: any;
          
          while (retries > 0) {
            try {
              const response = await axios.post(
                `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
                {
                  text,
                  model_id: 'eleven_turbo_v2_5',
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
                  timeout: 30000,
                }
              );

              resolve({
                audioBuffer: Buffer.from(response.data),
                timestamp: Date.now(),
                isFinal: true,
              });
              return;
            } catch (error: any) {
              lastError = error;
              
              // If rate limited (429), wait and retry
              if (error.response?.status === 429) {
                retries--;
                if (retries > 0) {
                  const waitTime = Math.pow(2, 4 - retries) * 1000; // 2s, 4s, 8s
                  console.warn(`⏳ Rate limited. Retrying in ${waitTime}ms... (${retries} retries left)`);
                  await new Promise(r => setTimeout(r, waitTime));
                  continue;
                }
              }
              
              throw error;
            }
          }
          
          throw lastError;
        } catch (error) {
          reject(error);
        } finally {
          this.activeRequests--;
          this.processQueue();
        }
      };

      this.requestQueue.push(request);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.activeRequests >= this.maxConcurrent) {
      return;
    }

    if (this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const request = this.requestQueue.shift();

    if (request) {
      await request();
    }

    this.isProcessing = false;
    
    // Process next in queue
    if (this.requestQueue.length > 0) {
      this.processQueue();
    }
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
