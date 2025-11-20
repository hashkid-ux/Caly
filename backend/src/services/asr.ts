import axios from 'axios';
import config from '../config';
import { TranscriptionResult } from '../types';

export class ASRService {
  private apiKey: string;
  private uploadCache = new Map<string, string>(); // Cache upload URLs

  constructor() {
    this.apiKey = config.ASSEMBLYAI_API_KEY || '';

    if (!this.apiKey) {
      console.warn('⚠️  ASSEMBLYAI_API_KEY not set. Get free key at: https://www.assemblyai.com/');
    }
  }

  /**
   * Enhanced transcription with better audio validation
   */
  async transcribeBuffer(
    audioBuffer: Buffer,
    onTranscription: (result: TranscriptionResult) => void
  ): Promise<void> {
    try {
      if (!this.apiKey) {
        throw new Error('AssemblyAI API key not configured');
      }

      // Validate buffer size
      if (audioBuffer.length < 5000) {
        console.warn(`[ASR] ⚠️ Buffer too small (${audioBuffer.length} bytes) - likely not valid audio`);
        throw new Error('Audio buffer too small to transcribe');
      }

      // Detect and validate format
      const audioInfo = this.detectAudioFormat(audioBuffer);
      if (!audioInfo.isValid) {
        console.error(`[ASR] ❌ Invalid audio format detected`);
        throw new Error('Invalid audio format - cannot transcribe');
      }

      console.log(`[ASR] ✅ Valid ${audioInfo.format} detected (${audioBuffer.length} bytes)`);

      // Upload audio
      const uploadUrl = await this.uploadAudio(audioBuffer, audioInfo.mimeType);
      
      // Request transcription
      const transcriptId = await this.requestTranscription(uploadUrl);
      
      // Poll for results with optimized timing
      await this.pollTranscription(transcriptId, onTranscription);
    } catch (error) {
      console.error('[ASR] Transcription Error:', error);
      throw error;
    }
  }

  /**
   * Enhanced format detection with validation
   */
  private detectAudioFormat(buffer: Buffer): { 
    format: string; 
    mimeType: string; 
    isValid: boolean;
  } {
    if (buffer.length < 12) {
      return { format: 'unknown', mimeType: 'audio/webm', isValid: false };
    }

    // WebM (Matroska) - 0x1A 0x45 0xDF 0xA3
    if (buffer[0] === 0x1A && buffer[1] === 0x45 && 
        buffer[2] === 0xDF && buffer[3] === 0xA3) {
      console.log(`[ASR] ✅ WebM/Matroska container detected`);
      return { format: 'WebM', mimeType: 'audio/webm', isValid: true };
    }

    // WAV - "RIFF....WAVE"
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && 
        buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x41 && 
        buffer[10] === 0x56 && buffer[11] === 0x45) {
      console.log(`[ASR] ✅ WAV (RIFF) detected`);
      return { format: 'WAV', mimeType: 'audio/wav', isValid: true };
    }

    // MP3 - 0xFF 0xFB or 0xFF 0xFA (MPEG Layer 3)
    if (buffer[0] === 0xFF && (buffer[1] === 0xFB || buffer[1] === 0xFA)) {
      console.log(`[ASR] ✅ MP3 (MPEG) detected`);
      return { format: 'MP3', mimeType: 'audio/mpeg', isValid: true };
    }

    // OGG - "OggS"
    if (buffer[0] === 0x4F && buffer[1] === 0x67 && 
        buffer[2] === 0x67 && buffer[3] === 0x53) {
      console.log(`[ASR] ✅ OGG container detected`);
      return { format: 'OGG', mimeType: 'audio/ogg', isValid: true };
    }

    // M4A/AAC - "ftyp"
    if (buffer[4] === 0x66 && buffer[5] === 0x74 && 
        buffer[6] === 0x79 && buffer[7] === 0x70) {
      console.log(`[ASR] ✅ M4A/AAC (MP4) detected`);
      return { format: 'M4A', mimeType: 'audio/mp4', isValid: true };
    }

    // Unknown format
    const hexBytes = Array.from(buffer.slice(0, 16))
      .map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`)
      .join(' ');
    console.error(`[ASR] ❌ INVALID AUDIO - First bytes: ${hexBytes}`);
    
    return { format: 'unknown', mimeType: 'audio/webm', isValid: false };
  }

  /**
   * Upload audio with retry logic
   */
  private async uploadAudio(
    audioBuffer: Buffer, 
    mimeType: string,
    retries = 3
  ): Promise<string> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[ASR] 📤 Upload attempt ${attempt}/${retries}: ${audioBuffer.length} bytes as ${mimeType}`);
        
        const response = await axios.post(
          'https://api.assemblyai.com/v2/upload',
          audioBuffer,
          {
            headers: {
              'Authorization': this.apiKey,
              'Content-Type': mimeType,
            },
            timeout: 15000, // 15s timeout
          }
        );

        if (!response.data?.upload_url) {
          throw new Error('No upload URL returned');
        }

        console.log(`[ASR] ✅ Upload successful: ${response.data.upload_url.substring(0, 60)}...`);
        return response.data.upload_url;
      } catch (error: any) {
        console.error(`[ASR] ❌ Upload attempt ${attempt} failed:`, error.message);
        
        if (attempt === retries) {
          throw new Error(`Upload failed after ${retries} attempts: ${error.message}`);
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    throw new Error('Upload failed');
  }

  /**
   * Request transcription with Hindi language
   */
  private async requestTranscription(audioUrl: string): Promise<string> {
    console.log(`[ASR] 📝 Requesting Hindi transcription...`);
    
    try {
      const response = await axios.post(
        'https://api.assemblyai.com/v2/transcript',
        {
          audio_url: audioUrl,
          language_code: 'hi', // Hindi
          speech_model: 'best', // Use best model for accuracy
          punctuate: true,
          format_text: true,
        },
        {
          headers: {
            'Authorization': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      if (!response.data?.id) {
        throw new Error(`Invalid response: ${JSON.stringify(response.data)}`);
      }

      console.log(`[ASR] ✅ Transcript queued: ${response.data.id}`);
      return response.data.id;
    } catch (error: any) {
      console.error(`[ASR] ❌ Request failed:`, error.message);
      throw new Error(`Transcription request failed: ${error.message}`);
    }
  }

  /**
   * Poll for transcription with optimized timing
   */
  private async pollTranscription(
    transcriptId: string,
    onTranscription: (result: TranscriptionResult) => void
  ): Promise<void> {
    const maxAttempts = 30; // 30 seconds max
    const pollInterval = 500; // Check every 500ms (faster)
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const response = await axios.get(
          `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
          {
            headers: { 'Authorization': this.apiKey },
            timeout: 5000,
          }
        );

        const { status, text, error } = response.data;

        // Success
        if (status === 'completed') {
          const transcribedText = (text || '').trim();
          console.log(`[ASR] ✅ SUCCESS (${(attempts * pollInterval / 1000).toFixed(1)}s): "${transcribedText.substring(0, 100)}${transcribedText.length > 100 ? '...' : ''}"`);
          
          onTranscription({
            text: transcribedText,
            isFinal: true,
            timestamp: Date.now(),
            latency: attempts * pollInterval,
          });
          return;
        }

        // Error
        if (status === 'error') {
          const errorMsg = error || 'Unknown transcription error';
          console.error(`[ASR] ❌ Transcription error: ${errorMsg}`);
          throw new Error(`AssemblyAI error: ${errorMsg}`);
        }

        // Still processing
        if (attempts % 4 === 0) { // Log every 2 seconds
          console.log(`[ASR] ⏳ Processing... (${(attempts * pollInterval / 1000).toFixed(1)}s)`);
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error: any) {
        if (error.message.includes('AssemblyAI error')) {
          throw error; // Don't retry on API errors
        }
        
        console.error(`[ASR] ❌ Poll error:`, error.message);
        
        if (attempts >= maxAttempts) {
          throw new Error('Polling timeout - transcription took too long');
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error(`Timeout: No response after ${maxAttempts * pollInterval / 1000}s`);
  }

  /**
   * Stream transcription (for real-time use cases)
   */
  async streamTranscribe(
    audioStream: AsyncIterable<Buffer>,
    onTranscription: (result: TranscriptionResult) => void
  ): Promise<void> {
    try {
      // Collect stream into buffer
      const audioChunks: Buffer[] = [];
      for await (const chunk of audioStream) {
        audioChunks.push(chunk);
      }

      const audioBuffer = Buffer.concat(audioChunks);
      await this.transcribeBuffer(audioBuffer, onTranscription);
    } catch (error) {
      console.error('[ASR] Stream Error:', error);
      throw error;
    }
  }
}

export const asrService = new ASRService();