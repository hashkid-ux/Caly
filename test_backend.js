const io = require('socket.io-client');

console.log('🔌 Testing Backend Response System...\n');

const socket = io('http://localhost:3000', {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  transports: ['websocket']
});

let responseReceived = false;

socket.on('connect', () => {
  console.log('✅ Connected to backend');
  console.log('📍 Session ID:', socket.id, '\n');
  
  // Send a test transcription
  console.log('📤 Sending transcription test...');
  console.log('   Text: "नमस्ते"');
  console.log('   IsFinal: true\n');
  
  socket.emit('transcription', {
    text: 'नमस्ते',
    isFinal: true
  });
  
  console.log('✉️  Message sent! Waiting for response...\n');
});

socket.on('audio_response', (data) => {
  responseReceived = true;
  console.log('✅ RESPONSE RECEIVED! 🎉\n');
  console.log('   Audio size:', data.audio.length, 'characters (base64)');
  console.log('   Decoded size:', Math.floor(data.audio.length * 0.75), 'bytes');
  console.log('   Is final:', data.isFinal);
  console.log('   Timestamp:', new Date(data.timestamp).toISOString());
  console.log('\n✅ TEST PASSED - Response is working!');
  
  socket.disconnect();
});

socket.on('audio_acknowledged', (data) => {
  console.log('🔔 Audio acknowledged at', new Date(data.timestamp).toISOString());
});

socket.on('error', (error) => {
  console.error('❌ Socket error:', error);
});

socket.on('disconnect', () => {
  console.log('\n🔌 Disconnected from backend');
  if (!responseReceived) {
    console.log('❌ TEST FAILED - No response received within timeout');
  }
  process.exit(responseReceived ? 0 : 1);
});

// Timeout after 60 seconds
setTimeout(() => {
  console.log('\n⏱️  Timeout after 60 seconds');
  if (!responseReceived) {
    console.log('❌ TEST FAILED - No response received');
  }
  socket.disconnect();
  process.exit(responseReceived ? 0 : 1);
}, 60000);

console.log('🔌 Connecting to backend...\n');
