import axios from 'axios';
import config from '../config';
import { TranscriptionResult } from '../types';

export class ASRService {
  private apiKey: string;

  constructor() {
    this.apiKey = config.ASSEMBLYAI_API_KEY || '';

    if (!this.apiKey) {
      console.warn('⚠️  ASSEMBLYAI_API_KEY not set. Get free key at: https://www.assemblyai.com/');
    }
  }

  async streamTranscribe(
    audioStream: AsyncIterable<Buffer>,
    onTranscription: (result: TranscriptionResult) => void
  ): Promise<void> {
    try {
      if (!this.apiKey) {
        throw new Error('AssemblyAI API key not set. Get free key at https://www.assemblyai.com/');
      }

      // Collect audio chunks
      const audioChunks: Buffer[] = [];
      for await (const chunk of audioStream) {
        audioChunks.push(chunk);
      }

      const audioBuffer = Buffer.concat(audioChunks);
      const uploadUrl = await this.uploadAudio(audioBuffer);
      const transcriptId = await this.requestTranscription(uploadUrl);
      await this.pollTranscription(transcriptId, onTranscription);
    } catch (error) {
      console.error('ASR Error:', error);
      throw error;
    }
  }

  private async uploadAudio(audioBuffer: Buffer): Promise<string> {
    const response = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      audioBuffer,
      {
        headers: {
          'Authorization': this.apiKey,
          'Content-Type': 'audio/wav',
        },
      }
    );
    return response.data.upload_url;
  }

  private async requestTranscription(audioUrl: string): Promise<string> {
    const response = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      {
        audio_url: audioUrl,
        language_code: 'hi',
      },
      {
        headers: {
          'Authorization': this.apiKey,
        },
      }
    );
    return response.data.id;
  }

  private async pollTranscription(
    transcriptId: string,
    onTranscription: (result: TranscriptionResult) => void
  ): Promise<void> {
    const maxAttempts = 120;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: {
            'Authorization': this.apiKey,
          },
        }
      );

      if (response.data.status === 'completed') {
        onTranscription({
          text: response.data.text || '',
          isFinal: true,
          timestamp: Date.now(),
          latency: 0,
        });
        return;
      } else if (response.data.status === 'error') {
        throw new Error(`Transcription failed: ${response.data.error}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error('Transcription timeout');
  }
}

export const asrService = new ASRService();
