import { llmService } from './services/llm';
import { ttsService } from './services/tts';
import { latencyTracker } from './utils/latencyTracker';
import { LLMStreamToken, TranscriptionResult, AudioFragment } from './types';

export class StreamingOrchestrator {
  private sessionId: string;
  private transcriptionBuffer: string = '';
  private responseBuffer: string = '';
  private isProcessing = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Process incoming transcription from ASR
   * Only process when transcription is marked as final (user stopped speaking)
   */
  async onTranscriptionResult(
    result: TranscriptionResult,
    onAudioChunk: (audio: AudioFragment) => void,
    onTextResponse?: (text: string) => void
  ): Promise<void> {
    latencyTracker.start(this.sessionId, 'full_pipeline');

    // Only process final transcriptions (complete sentences)
    if (!result.isFinal) {
      console.log(`[${this.sessionId}] ⏳ Partial transcription: "${result.text}" (waiting for complete sentence)`);
      return;
    }

    // Prevent duplicate processing
    if (this.isProcessing) {
      console.log(`[${this.sessionId}] ⚠️ Already processing, skipping duplicate request`);
      return;
    }

    this.isProcessing = true;
    this.transcriptionBuffer = result.text;

    console.log(`[${this.sessionId}] ✅ Final transcription received: "${this.transcriptionBuffer}"`);

    try {
      await this.generateAndStreamResponse(
        this.transcriptionBuffer,
        onAudioChunk,
        onTextResponse
      );
    } catch (error) {
      console.error(`[${this.sessionId}] Error in orchestrator:`, error);
    } finally {
      this.isProcessing = false;
      latencyTracker.end(this.sessionId, 'full_pipeline');
    }
  }

  /**
   * Generate LLM response and stream TTS audio in real-time
   * This uses predictive audio generation:
   * - As LLM generates tokens, start TTS synthesis
   * - Stream audio chunks to client immediately
   * - Queue them for playback
   */
  private async generateAndStreamResponse(
    userInput: string,
    onAudioChunk: (audio: AudioFragment) => void,
    onTextResponse?: (text: string) => void
  ): Promise<void> {
    if (!userInput.trim()) {
      console.log(`[${this.sessionId}] ❌ Empty input, skipping`);
      return;
    }

    latencyTracker.start(this.sessionId, 'llm_stream');

    let fullResponse = '';
    let tokenBuffer = '';
    let audioSent = false;
    const minTokensForTTS = 5; // Synthesize after accumulating ~5 tokens or punctuation

    console.log(`[${this.sessionId}] 🚀 Starting LLM stream for: "${userInput}"`);

    try {
      await llmService.streamResponse(userInput, async (token: LLMStreamToken) => {
        if (token.token && !token.isFinal) {
          // Accumulate tokens
          fullResponse += token.token;
          tokenBuffer += token.token;

          console.log(`[${this.sessionId}] 📝 LLM Token: "${token.token}" | Buffer: "${tokenBuffer}"`);

          // Trigger TTS synthesis when we have enough tokens or hit punctuation
          const shouldSynthesize =
            tokenBuffer.length >= minTokensForTTS ||
            tokenBuffer.includes('.') ||
            tokenBuffer.includes('।') ||
            tokenBuffer.includes('?') ||
            tokenBuffer.includes('!') ||
            tokenBuffer.includes('\n');

          if (shouldSynthesize && tokenBuffer.trim()) {
            await this.synthesizeAndStreamAudio(
              tokenBuffer.trim(),
              onAudioChunk,
              false
            );
            audioSent = true;
            tokenBuffer = ''; // Clear buffer after synthesis
          }
        } else if (token.isFinal) {
          // Process any remaining tokens
          if (tokenBuffer.trim()) {
            await this.synthesizeAndStreamAudio(
              tokenBuffer.trim(),
              onAudioChunk,
              true
            );
            audioSent = true;
          } else if (!audioSent && fullResponse.trim()) {
            // Fallback: synthesize entire response if streaming didn't work
            await this.synthesizeAndStreamAudio(
              fullResponse.trim(),
              onAudioChunk,
              true
            );
            audioSent = true;
          }

          this.responseBuffer = fullResponse;
          console.log(`[${this.sessionId}] ✅ LLM stream complete: "${fullResponse}"`);

          // Send text response as fallback
          if (!audioSent && onTextResponse) {
            console.log(`[${this.sessionId}] 📝 Sending text fallback: "${fullResponse}"`);
            onTextResponse(fullResponse);
          }

          latencyTracker.end(this.sessionId, 'llm_stream');
        }
      });
    } catch (error) {
      console.error(`[${this.sessionId}] LLM Error:`, error);
      throw error;
    }
  }

  /**
   * Synthesize text to audio and stream chunks to client
   */
  private async synthesizeAndStreamAudio(
    text: string,
    onAudioChunk: (audio: AudioFragment) => void,
    isFinal: boolean
  ): Promise<void> {
    if (!text.trim()) return;

    const ttsSyncKey = `tts_${Date.now()}`;
    latencyTracker.start(this.sessionId, ttsSyncKey);

    try {
      console.log(`[${this.sessionId}] 🔊 TTS: Synthesizing "${text}" (final: ${isFinal})`);

      // Synthesize audio
      const audioFragment = await ttsService.synthesize(text);

      // Send to client immediately
      onAudioChunk({
        audioBuffer: audioFragment.audioBuffer,
        timestamp: audioFragment.timestamp,
        isFinal: isFinal,
      });

      console.log(
        `[${this.sessionId}] ✅ Audio sent: ${audioFragment.audioBuffer.length} bytes (final: ${isFinal})`
      );

      latencyTracker.end(this.sessionId, ttsSyncKey);
    } catch (error) {
      console.error(`[${this.sessionId}] TTS Error for "${text}":`, error);
    }
  }

  getSessionMetrics() {
    return {
      sessionId: this.sessionId,
      transcriptionBuffer: this.transcriptionBuffer,
      responseBuffer: this.responseBuffer,
      isProcessing: this.isProcessing,
      metrics: latencyTracker.getMetrics(this.sessionId),
    };
  }

  cleanup(): void {
    this.isProcessing = false;
    latencyTracker.clear(this.sessionId);
  }
}