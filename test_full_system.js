const io = require('socket.io-client');
require('dotenv').config();

const backendUrl = 'http://localhost:3000';

console.log('🔗 Connecting to backend...');
const socket = io(backendUrl);

let isPlaying = false;

socket.on('connect', () => {
  console.log('✅ Connected to backend\n');
  
  // Send a test transcription
  const testText = 'नमस्ते';
  console.log(`📤 Sending transcription: "${testText}"\n`);
  
  socket.emit('transcription', {
    text: testText,
    isFinal: true,
  });
});

socket.on('audio_chunk', (data) => {
  console.log(`📥 Received audio chunk: ${data.buffer.length} bytes (final: ${data.isFinal})`);
  
  if (data.isFinal) {
    console.log('\n✅ SUCCESS! Full response received!');
    console.log(`   Total audio: ${data.buffer.length} bytes`);
    
    setTimeout(() => {
      socket.disconnect();
      console.log('❌ Test completed, disconnecting...\n');
      process.exit(0);
    }, 1000);
  }
});

socket.on('text_response', (data) => {
  console.log(`📝 Text response: ${data.text}`);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error);
  process.exit(1);
});

socket.on('error', (error) => {
  console.error('❌ Socket error:', error);
  process.exit(1);
});

// Timeout after 30 seconds
setTimeout(() => {
  console.error('\n⏱️ Test timeout - no response received');
  socket.disconnect();
  process.exit(1);
}, 30000);
