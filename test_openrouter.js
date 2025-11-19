const axios = require('axios');
require('dotenv').config();

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error('❌ OPENROUTER_API_KEY not found in .env');
  process.exit(1);
}

console.log('🔍 Testing OpenRouter API Key...');
console.log('Key (first 20 chars):', apiKey.substring(0, 20) + '...');
console.log('');

const testMessage = 'नमस्ते, आप कैसे हैं?';

const payload = {
  model: 'mistralai/mistral-7b-instruct:free',
  messages: [
    {
      role: 'system',
      content: 'You are a helpful assistant that responds in Hindi.',
    },
    {
      role: 'user',
      content: testMessage,
    },
  ],
  stream: false,
  max_tokens: 50,
};

(async () => {
  try {
    console.log('📤 Sending request to OpenRouter...');
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      payload,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Hindi AI Calling System',
        },
      }
    );

    console.log('✅ SUCCESS! OpenRouter is working!');
    console.log('Full Response:', JSON.stringify(response.data, null, 2));
    console.log('\nActual Response Text:', response.data.choices[0]?.message?.content || 'NO CONTENT');
    console.log('Finish Reason:', response.data.choices[0]?.finish_reason);
  } catch (error) {
    console.error('❌ ERROR:', error.response?.status, error.response?.statusText);
    console.error('Details:', error.response?.data || error.message);

    if (error.response?.status === 401) {
      console.error('\n🚨 401 Unauthorized - Possible causes:');
      console.error('1. API key is invalid or disabled');
      console.error('2. Account has no credits remaining');
      console.error('3. OAuth session expired');
      console.error('\nAction: Log in to https://openrouter.ai and check:');
      console.error('- Your API key is active');
      console.error('- Your account has available credits');
      console.error('- Your free trial hasn\'t expired');
    } else if (error.response?.status === 402) {
      console.error('\n💳 402 Payment Required - Your account has no credits!');
      console.error('Visit https://openrouter.ai to add credits or check your trial status');
    }
  }
})();
