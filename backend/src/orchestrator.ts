import { llmService } from './services/llm';
import { asrService } from './services/asr';
import { ttsService } from './services/tts';
import { latencyTracker } from './utils/latencyTracker';
import { LLMStreamToken, TranscriptionResult, AudioFragment } from './types';

export class StreamingOrchestrator {
  private sessionId: string;
  private transcriptionBuffer: string = '';
  private responseBuffer: string = '';
  private silenceTimer: NodeJS.Timeout | null = null;
  private silenceThreshold: number = 300; // ms

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Process incoming transcription from ASR
   * Immediately stream to LLM without waiting for full response
   */
  async onTranscriptionResult(result: TranscriptionResult, onAudioChunk: (audio: AudioFragment) => void, onTextResponse?: (text: string) => void): Promise<void> {
    latencyTracker.start(this.sessionId, 'transcription_process');

    if (result.isFinal) {
      this.transcriptionBuffer += result.text + ' ';
      latencyTracker.log(this.sessionId, `Final transcription: ${result.text}`);

      // Clear silence timer if it exists
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      // Generate response immediately (don't wait for 300ms silence)
      console.log(`[${this.sessionId}] 📞 Generating response immediately for: "${this.transcriptionBuffer.trim()}"`);
      await this.generateAndStreamResponse(this.transcriptionBuffer.trim(), onAudioChunk, onTextResponse);
    } else {
      latencyTracker.log(this.sessionId, `Partial transcription: ${result.text}`);
    }

    latencyTracker.end(this.sessionId, 'transcription_process');
  }

  /**
   * Generate LLM response and stream audio in parallel
   */
  private async generateAndStreamResponse(userInput: string, onAudioChunk: (audio: AudioFragment) => void, onTextResponse?: (text: string) => void): Promise<void> {
    if (!userInput.trim()) return;

    latencyTracker.start(this.sessionId, 'llm_response');

    let fullResponse = '';
    let audioQueue: string[] = [];
    let hasAnyToken = false;
    let audioSent = false;

    // Stream tokens from LLM
    const tokenHandler = async (token: LLMStreamToken) => {
      if (token.token && !token.isFinal) {
        hasAnyToken = true;
        fullResponse += token.token;
        audioQueue.push(token.token);
        
        console.log(`[${this.sessionId}] LLM Token: "${token.token}" | Full response: "${fullResponse}"`);

        // Generate audio for complete words (words ending with space or punctuation)
        if (token.token.includes(' ') || token.token.includes('।') || token.token.includes('\n')) {
          const wordToSynthesize = audioQueue.join('').trim();

          if (wordToSynthesize) {
            try {
              console.log(`[${this.sessionId}] TTS: Synthesizing "${wordToSynthesize}"...`);
              latencyTracker.start(this.sessionId, `tts_${wordToSynthesize.slice(0, 5)}`);

              const audioFragment = await ttsService.synthesize(wordToSynthesize);
              console.log(`[${this.sessionId}] TTS: Successfully synthesized ${audioFragment.audioBuffer.length} bytes`);
              audioSent = true;
              onAudioChunk(audioFragment);

              latencyTracker.end(this.sessionId, `tts_${wordToSynthesize.slice(0, 5)}`);
            } catch (error) {
              console.error(`[${this.sessionId}] TTS Error for "${wordToSynthesize}":`, error);
            }
          }

          audioQueue = [];
        }
      } else if (token.isFinal) {
        // Synthesize any remaining tokens
        const remaining = audioQueue.join('').trim();
        if (remaining) {
          try {
            console.log(`[${this.sessionId}] TTS: Synthesizing final remaining "${remaining}"...`);
            const audioFragment = await ttsService.synthesize(remaining);
            console.log(`[${this.sessionId}] TTS: Successfully synthesized final ${audioFragment.audioBuffer.length} bytes`);
            audioSent = true;
            onAudioChunk(audioFragment);
          } catch (error) {
            console.error(`[${this.sessionId}] TTS Error for final "${remaining}":`, error);
          }
        }

        this.responseBuffer = fullResponse;
        latencyTracker.end(this.sessionId, 'llm_response');
        
        console.log(`[${this.sessionId}] ✅ LLM Response completed: "${fullResponse}"`);
        console.log(`[${this.sessionId}] 📊 Tokens received: ${hasAnyToken ? 'YES' : 'NO'}`);
        console.log(`[${this.sessionId}] 🔊 Audio sent: ${audioSent ? 'YES' : 'NO'}`);
        
        // Send text response as fallback if audio failed
        if (!audioSent && onTextResponse) {
          console.log(`[${this.sessionId}] 📝 Sending text response as fallback: "${fullResponse}"`);
          onTextResponse(fullResponse);
        }
        
        latencyTracker.log(this.sessionId, `Response completed: ${fullResponse}`);
      }
    };

    try {
      console.log(`[${this.sessionId}] 🤖 Starting LLM stream for: "${userInput}"`);
      await llmService.streamResponse(userInput, tokenHandler);
      console.log(`[${this.sessionId}] 🤖 LLM stream handler completed`);
      
      if (!hasAnyToken) {
        console.error(`[${this.sessionId}] ⚠️  WARNING: No tokens received from LLM!`);
      }
    } catch (error) {
      console.error(`[${this.sessionId}] Orchestrator Error:`, error);
    }
  }

  getSessionMetrics() {
    return {
      sessionId: this.sessionId,
      transcriptionBuffer: this.transcriptionBuffer,
      responseBuffer: this.responseBuffer,
      metrics: latencyTracker.getMetrics(this.sessionId),
    };
  }

  cleanup(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }
    latencyTracker.clear(this.sessionId);
  }
}
