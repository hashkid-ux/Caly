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

  /**
   * REAL FIX: Transcribe audio buffer directly (NEW METHOD)
   */
  async transcribeBuffer(
    audioBuffer: Buffer,
    onTranscription: (result: TranscriptionResult) => void
  ): Promise<void> {
    try {
      if (!this.apiKey) {
        throw new Error('AssemblyAI API key not set. Get free key at https://www.assemblyai.com/');
      }

      console.log(`[ASR] Uploading ${audioBuffer.length} bytes...`);
      const uploadUrl = await this.uploadAudio(audioBuffer);
      
      console.log(`[ASR] Requesting transcription...`);
      const transcriptId = await this.requestTranscription(uploadUrl);
      
      console.log(`[ASR] Polling for results...`);
      await this.pollTranscription(transcriptId, onTranscription);
    } catch (error) {
      console.error('ASR Buffer Transcription Error:', error);
      throw error;
    }
  }

  /**
   * REAL FIX: Detect audio format and handle properly
   */
  private detectAudioFormat(buffer: Buffer): { mimeType: string; extension: string } {
    if (buffer.length < 4) {
      console.warn(`[ASR] ⚠️ Buffer too small (${buffer.length} bytes) - might not be audio!`);
    }

    // Check for WebM signature (WebM starts with 0x1A 0x45 0xDF 0xA3)
    if (buffer.length > 4 && 
        buffer[0] === 0x1A && buffer[1] === 0x45 && 
        buffer[2] === 0xDF && buffer[3] === 0xA3) {
      console.log(`[ASR] ✅ Detected: WebM (Opus codec)`);
      return { mimeType: 'audio/webm', extension: '.webm' };
    }

    // Check for WAV signature (RIFF....WAVE)
    if (buffer.length > 12 && 
        buffer[0] === 0x52 && buffer[1] === 0x49 && 
        buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x41 && 
        buffer[10] === 0x56 && buffer[11] === 0x45) {
      console.log(`[ASR] ✅ Detected: WAV`);
      return { mimeType: 'audio/wav', extension: '.wav' };
    }

    // Check for MP3 signature (FF FB or FF FA)
    if (buffer.length > 2 && buffer[0] === 0xFF && (buffer[1] === 0xFB || buffer[1] === 0xFA)) {
      console.log(`[ASR] ✅ Detected: MP3`);
      return { mimeType: 'audio/mp3', extension: '.mp3' };
    }

    // Check for OGG signature
    if (buffer.length > 3 && buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67) {
      console.log(`[ASR] ✅ Detected: OGG`);
      return { mimeType: 'audio/ogg', extension: '.ogg' };
    }

    // If no signature detected, log first bytes for debugging
    const hexBytes = Array.from(buffer.slice(0, 8)).map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' ');
    console.warn(`[ASR] ⚠️ Unknown format - first bytes: ${hexBytes}`);
    return { mimeType: 'audio/webm', extension: '.webm' };
  }

  private async uploadAudio(audioBuffer: Buffer): Promise<string> {
    const { mimeType } = this.detectAudioFormat(audioBuffer);
    
    console.log(`[ASR] 📤 Uploading ${audioBuffer.length} bytes as ${mimeType}...`);
    const response = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      audioBuffer,
      {
        headers: {
          'Authorization': this.apiKey,
          'Content-Type': mimeType,
        },
      }
    );
    return response.data.upload_url;
  }

  private async requestTranscription(audioUrl: string): Promise<string> {
    console.log(`[ASR] 📝 Submitting to AssemblyAI: ${audioUrl}`);
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
    
    if (!response.data.id) {
      throw new Error(`No transcript ID returned: ${JSON.stringify(response.data)}`);
    }
    
    console.log(`[ASR] ✅ Transcript ID: ${response.data.id}`);
    return response.data.id;
  }

  private async pollTranscription(
    transcriptId: string,
    onTranscription: (result: TranscriptionResult) => void
  ): Promise<void> {
    const maxAttempts = 20; // 20 attempts max
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(
          `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
          {
            headers: {
              'Authorization': this.apiKey,
            },
          }
        );

        console.log(`[ASR] 🔄 Attempt ${attempts + 1}/${maxAttempts}: ${response.data.status}`)

        if (response.data.status === 'completed') {
          const transcribedText = response.data.text || '';
          console.log(`[ASR] ✅ SUCCESS (${attempts + 1}s): "${transcribedText.substring(0, 60)}..."`);
          
          onTranscription({
            text: transcribedText,
            isFinal: true,
            timestamp: Date.now(),
            latency: 0,
          });
          return;
        } 
        
        if (response.data.status === 'error') {
          // ⚡ INSTANT FAIL on API error - don't retry
          const error = response.data.error || 'Unknown error';
          console.error(`[ASR] ⚡ API ERROR (FAIL FAST): ${error}`);
          throw new Error(`AssemblyAI API error: ${error}`);
        }

        // Still processing - wait and retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      } catch (error: any) {
        // Any error = throw immediately (no retry logic)
        console.error(`[ASR] 🛑 STOPPING: ${error.message}`);
        throw error;
      }
    }

    throw new Error(`Timeout: No response after 20 seconds`);
  }
}

export const asrService = new ASRService();
