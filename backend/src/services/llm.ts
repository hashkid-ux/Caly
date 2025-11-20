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
    this.apiKey = config.GROQ_API_KEY || '';
    this.model = config.LLM_MODEL;

    if (!this.apiKey) {
      console.warn('⚠️  GROQ_API_KEY not set. LLM will not work.');
      console.warn('Get free key at https://console.groq.com/keys');
    }
  }

  async streamResponse(
    userMessage: string,
    onToken: (token: LLMStreamToken) => void,
    conversationHistory?: { role: "user" | "assistant"; content: string; }[]
  ): Promise<string> {
    console.log(`[LLM] Starting stream for: "${userMessage}"`);
    
    // 🔧 FIX: Include conversation history!
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: config.SYSTEM_PROMPT,
      },
    ];

    // 🔧 FIX: Add conversation history if provided
    if (conversationHistory && conversationHistory.length > 0) {
      console.log(`[LLM] Adding ${conversationHistory.length} messages from history`);
      conversationHistory.forEach(msg => {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      });
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    const payload = {
      model: this.model,
      messages,
      stream: true,
      max_tokens: 150,
      temperature: 0.7,
    };

    try {
      console.log(`[LLM] Calling Groq API with model: ${this.model}`);
      console.log(`[LLM] Total messages in context: ${messages.length}`);
      
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LLM] API Error: ${response.statusText} - ${response.status}`);
        console.error(`[LLM] Error details: ${errorText}`);
        throw new Error(`Groq API error: ${response.statusText}`);
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