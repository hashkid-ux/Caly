const axios = require('axios');
require('dotenv').config();

const apiKey = process.env.OPENROUTER_API_KEY;

(async () => {
  try {
    console.log('📋 Fetching available models from OpenRouter...\n');
    const response = await axios.get(
      'https://openrouter.ai/api/v1/models',
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    const models = response.data.data;
    console.log(`Total models available: ${models.length}\n`);
    
    // Find free and cheap models
    console.log('🆓 FREE/CHEAPEST MODELS:');
    models
      .filter(m => m.pricing?.prompt === '0' || (m.pricing && parseFloat(m.pricing.prompt) < 0.001))
      .slice(0, 15)
      .forEach(m => {
        console.log(`- ${m.id}`);
        console.log(`  Pricing: $${m.pricing?.prompt || 0}/1K tokens`);
        console.log(`  Context: ${m.context_length}`);
      });

  } catch (error) {
    console.error('❌ Error:', error.response?.status, error.message);
  }
})();
