const axios = require('axios');
require('dotenv').config();

const apiKey = process.env.OPENROUTER_API_KEY;
const model = 'openrouter/sherlock-dash-alpha';

console.log(`🧪 Testing model: ${model}\n`);

(async () => {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that responds in Hindi. Keep responses short (1-2 sentences).',
          },
          {
            role: 'user',
            content: 'नमस्ते, आप कैसे हैं?',
          },
        ],
        max_tokens: 100,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
        },
        timeout: 10000,
      }
    );

    console.log('✅ SUCCESS!');
    console.log('Model:', model);
    console.log('Response:', response.data.choices[0].message.content);
    console.log('Tokens used:', response.data.usage.total_tokens);
    console.log('\n🎯 Model is working! Backend updated to use this model.');
  } catch (error) {
    console.error('❌ Error:', error.response?.status, error.response?.statusText);
    console.error('Details:', error.response?.data?.error?.message);
  }
})();
