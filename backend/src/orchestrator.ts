import { llmService } from './services/llm';
import { ttsService } from './services/tts';
import { asrService } from './services/asr';
import { latencyTracker } from './utils/latencyTracker';
import { LLMStreamToken, TranscriptionResult, AudioFragment } from './types';

export class StreamingOrchestrator {
  private sessionId: string;
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  private isProcessing = false;
  private audioQueue: Promise<void>[] = [];

  // Performance optimization
  private readonly MIN_TEXT_LENGTH = 3; // Minimum chars to process
  private readonly TTS_CHUNK_SIZE = 8; // Tokens before TTS (ultra-fast)
  private readonly MAX_RESPONSE_TOKENS = 150;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Transcribe audio to text
   */
  async transcribeAudio(
    audioBuffer: Buffer,
    onResult: (result: TranscriptionResult) => void
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log(`[${this.sessionId}] 🎤 Transcribing ${audioBuffer.length} bytes...`);
      
      await asrService.transcribeBuffer(audioBuffer, (result) => {
        const latency = Date.now() - startTime;
        console.log(`[${this.sessionId}] ✅ Transcribed in ${latency}ms: "${result.text}"`);
        onResult({ ...result, latency });
      });
    } catch (error) {
      console.error(`[${this.sessionId}] ❌ Transcription failed:`, error);
      throw error;
    }
  }

  /**
   * Process transcription result and generate response
   */
  async onTranscriptionResult(
    result: TranscriptionResult,
    onAudioChunk: (audio: AudioFragment) => void,
    onTextResponse?: (text: string) => void
  ): Promise<void> {
    if (!result.isFinal || this.isProcessing) {
      return;
    }

    const userText = result.text.trim();
    
    // Validate input
    if (userText.length < this.MIN_TEXT_LENGTH) {
      console.log(`[${this.sessionId}] ⏭️ Input too short (${userText.length} chars)`);
      return;
    }

    this.isProcessing = true;
    latencyTracker.start(this.sessionId, 'full_pipeline');

    try {
      console.log(`[${this.sessionId}] 💬 User: "${userText}"`);
      
      // Add to conversation history
      this.conversationHistory.push({ role: 'user', content: userText });
      
      // Keep only last 6 messages (3 turns) for context
      if (this.conversationHistory.length > 6) {
        this.conversationHistory = this.conversationHistory.slice(-6);
      }

      await this.generateStreamingResponse(userText, onAudioChunk, onTextResponse);
    } catch (error) {
      console.error(`[${this.sessionId}] ❌ Processing error:`, error);
      
      if (onTextResponse) {
        onTextResponse('Sorry, I encountered an error. Please try again.');
      }
    } finally {
      this.isProcessing = false;
      latencyTracker.end(this.sessionId, 'full_pipeline');
    }
  }

  /**
   * Generate response with ultra-fast streaming
   */
  private async generateStreamingResponse(
    userInput: string,
    onAudioChunk: (audio: AudioFragment) => void,
    onTextResponse?: (text: string) => void
  ): Promise<void> {
    latencyTracker.start(this.sessionId, 'llm_generation');

    let fullResponse = '';
    let tokenBuffer = '';
    let firstTokenReceived = false;
    let audioChunkCount = 0;

    console.log(`[${this.sessionId}] 🧠 Starting LLM stream...`);

    try {
      await llmService.streamResponse(
        userInput,
        async (token: LLMStreamToken) => {
          if (token.isFinal) {
            // Process any remaining text
            if (tokenBuffer.trim().length > 0) {
              await this.synthesizeAndStream(
                tokenBuffer.trim(),
                onAudioChunk,
                true
              );
              audioChunkCount++;
            }

            // Add to conversation history
            this.conversationHistory.push({
              role: 'assistant',
              content: fullResponse,
            });

            console.log(`[${this.sessionId}] ✅ Response complete (${audioChunkCount} audio chunks)`);
            console.log(`[${this.sessionId}] 🤖 AI: "${fullResponse}"`);

            // Fallback text
            if (audioChunkCount === 0 && onTextResponse) {
              onTextResponse(fullResponse);
            }

            latencyTracker.end(this.sessionId, 'llm_generation');
            return;
          }

          if (token.token) {
            // Track first token time
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              latencyTracker.end(this.sessionId, 'llm_first_token');
              console.log(`[${this.sessionId}] ⚡ First token received`);
            }

            fullResponse += token.token;
            tokenBuffer += token.token;

            // Ultra-fast TTS trigger conditions
            const shouldSynthesize =
              tokenBuffer.length >= this.TTS_CHUNK_SIZE ||
              this.isPunctuation(token.token) ||
              tokenBuffer.includes('\n');

            if (shouldSynthesize && tokenBuffer.trim().length > 0) {
              const textToSynthesize = tokenBuffer.trim();
              tokenBuffer = ''; // Clear immediately
              
              // Synthesize in parallel (non-blocking)
              this.synthesizeAndStream(
                textToSynthesize,
                onAudioChunk,
                false
              ).then(() => {
                audioChunkCount++;
              }).catch(error => {
                console.error(`[${this.sessionId}] TTS error:`, error);
              });
            }
          }
        },
        this.conversationHistory // Pass conversation context
      );
    } catch (error) {
      console.error(`[${this.sessionId}] ❌ LLM error:`, error);
      throw error;
    }
  }

  /**
   * Synthesize text to audio and stream immediately
   */
  private async synthesizeAndStream(
    text: string,
    onAudioChunk: (audio: AudioFragment) => void,
    isFinal: boolean
  ): Promise<void> {
    if (!text || text.length < 2) return;

    const ttsKey = `tts_${Date.now()}`;
    latencyTracker.start(this.sessionId, ttsKey);

    try {
      console.log(`[${this.sessionId}] 🔊 TTS: "${text}" (final: ${isFinal})`);
      
      // Synthesize audio
      const audioFragment = await ttsService.synthesize(text);

      // Stream immediately
      onAudioChunk({
        audioBuffer: audioFragment.audioBuffer,
        timestamp: Date.now(),
        isFinal,
      });

      console.log(`[${this.sessionId}] ✅ Audio streamed: ${audioFragment.audioBuffer.length} bytes`);
      latencyTracker.end(this.sessionId, ttsKey);
    } catch (error) {
      console.error(`[${this.sessionId}] ❌ TTS failed for "${text}":`, error);
      throw error;
    }
  }

  /**
   * Check if character is punctuation
   */
  private isPunctuation(char: string): boolean {
    return /[।.!?;,\n]/.test(char);
  }

  /**
   * Get session metrics
   */
  getSessionMetrics() {
    return {
      sessionId: this.sessionId,
      conversationLength: this.conversationHistory.length,
      isProcessing: this.isProcessing,
      metrics: latencyTracker.getMetrics(this.sessionId),
      lastMessages: this.conversationHistory.slice(-4),
    };
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
    console.log(`[${this.sessionId}] 🗑️ Conversation history cleared`);
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.isProcessing = false;
    this.audioQueue = [];
    latencyTracker.clear(this.sessionId);
    console.log(`[${this.sessionId}] 🧹 Cleaned up`);
  }
}