const axios = require('axios');
require('dotenv').config();

const apiKey = process.env.OPENROUTER_API_KEY;

// Try different free models
const models = [
  'openchat/openchat-7b:free',
  'microsoft/phi-3-medium-128k-instruct:free',
  'meta-llama/llama-3-8b-instruct:free',
  'gryphe/mythomist-7b:free',
  'undi95/toppy-m-7b:free',
];

(async () => {
  for (const model of models) {
    console.log(`\n🧪 Testing model: ${model}`);
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: 'नमस्ते' }],
          max_tokens: 10,
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
          },
          timeout: 5000,
        }
      );
      
      console.log('✅ WORKING! Response:', response.data.choices[0]?.message?.content?.substring(0, 50));
      console.log(`\n🎯 USE THIS MODEL: ${model}`);
      break;
    } catch (error) {
      console.log('❌ Error:', error.response?.status, error.response?.data?.error?.message?.substring(0, 80));
    }
  }
})();
