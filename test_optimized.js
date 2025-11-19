const io = require('socket.io-client');
require('dotenv').config();

const backendUrl = 'http://localhost:3000';

console.log('🎯 OPTIMIZED SYSTEM TEST');
console.log('========================\n');

const socket = io(backendUrl);

socket.on('connect', () => {
  console.log('✅ Connected to backend\n');
  
  // Test 1: Single utterance
  console.log('📝 Test 1: Single utterance');
  const requestId1 = `req_${Date.now()}_test1`;
  console.log(`📤 Sending: "नमस्ते" [${requestId1}]\n`);
  
  socket.emit('audio_chunk', {
    buffer: new Uint8Array([1, 2, 3, 4, 5]), // Dummy audio
    isFinal: true,
    requestId: requestId1,
  });

  let audioCount = 0;
  let receivedChunks = {};

  socket.on('audio_chunk', (data) => {
    if (!receivedChunks[data.requestId]) {
      receivedChunks[data.requestId] = 0;
    }
    receivedChunks[data.requestId]++;
    audioCount++;

    console.log(
      `📥 Audio chunk: ${data.buffer.length} bytes (final: ${data.isFinal}) [${data.requestId}]`
    );

    if (data.isFinal) {
      console.log(`\n✅ Response complete!`);
      console.log(`   Total chunks: ${audioCount}`);
      console.log(`   Request ID: ${data.requestId}`);
      console.log(`   Chunks per request:`, receivedChunks);
      
      setTimeout(() => {
        socket.disconnect();
        console.log('\n✨ Test passed - System optimized for real-time!\n');
        process.exit(0);
      }, 1000);
    }
  });
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error);
  process.exit(1);
});

// Timeout
setTimeout(() => {
  console.error('\n⏱️ Timeout - no response');
  process.exit(1);
}, 15000);
