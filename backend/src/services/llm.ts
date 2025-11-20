import config from '../config';
import { LLMStreamToken } from '../types';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LLMService {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.OPENROUTER_API_KEY || '';
    this.model = config.LLM_MODEL;

    if (!this.apiKey) {
      console.warn('⚠️  OPENROUTER_API_KEY not set. LLM will not work.');
      console.warn('Set OPENROUTER_API_KEY in .env to use LLM features');
    }
  }

  async streamResponse(
    userMessage: string,
    onToken: (token: LLMStreamToken) => void,
    conversationHistory?: { role: "user" | "assistant"; content: string; }[]
  ): Promise<string> {
    console.log(`[LLM] Starting stream for: "${userMessage}"`);
    
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: config.SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userMessage,
      },
    ];

    const payload = {
      model: this.model,
      messages,
      stream: true,
      max_tokens: 150,
      temperature: 0.7,
    };

    try {
      console.log(`[LLM] Calling OpenRouter API with model: ${this.model}`);
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Hindi AI Calling System',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`[LLM] API Error: ${response.statusText} - ${response.status}`);
        throw new Error(`OpenRouter API error: ${response.statusText}`);
      }

      console.log(`[LLM] Response received, starting to read stream...`);
      let fullResponse = '';
      let tokenCount = 0;
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              console.log(`[LLM] ✅ Stream done. Total tokens: ${tokenCount}`);
              onToken({
                token: '',
                isFinal: true,
                timestamp: Date.now(),
              });
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const token = parsed.choices?.[0]?.delta?.content || '';

              if (token) {
                tokenCount++;
                fullResponse += token;
                console.log(`[LLM] Token #${tokenCount}: "${token}"`);
                onToken({
                  token,
                  isFinal: false,
                  timestamp: Date.now(),
                });
              }
            } catch (e) {
              // Parse error, skip
            }
          }
        }
      }

      console.log(`[LLM] Complete response: "${fullResponse}"`);
      return fullResponse;
    } catch (error) {
      console.error('[LLM] Service Error:', error);
      throw error;
    }
  }
}

export const llmService = new LLMService();
