import React, { useState, useEffect, useRef } from 'react';
import { WebRTCClient } from '../services/webrtcClient';
import '../styles/CallInterface.css';

export const CallInterface: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [latency, setLatency] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [callStatus, setCallStatus] = useState('');
  
  const [metrics, setMetrics] = useState({
    asrLatency: 0,
    llmLatency: 0,
    ttsLatency: 0,
    totalLatency: 0,
  });

  const clientRef = useRef<WebRTCClient | null>(null);
  const connectionCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const backendUrl = params.get('backend');

    // Initialize WebRTC client
    clientRef.current = new WebRTCClient(backendUrl || undefined);

    // Set up callbacks for responses
    clientRef.current.onResponse = (text: string) => {
      console.log('[CallInterface] Received response:', text);
      setResponse(text);
    };

    clientRef.current.onTranscription = (text: string) => {
      console.log('[CallInterface] Received transcription:', text);
      setTranscript(text);
    };

    clientRef.current.onError = (error: string) => {
      console.error('[CallInterface] Received error:', error);
      setErrorMessage(`❌ ${error}`);
    };

    // Check connection status
    const checkConnection = () => {
      if (clientRef.current) {
        const connected = clientRef.current.isConnected();
        setIsConnected(connected);
        if (connected) {
          setErrorMessage('');
        }
      }
    };

    // Initial check
    checkConnection();

    // Periodic checks
    connectionCheckRef.current = setInterval(checkConnection, 1000);

    return () => {
      if (connectionCheckRef.current) clearInterval(connectionCheckRef.current);
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  const handleStartCall = async () => {
    if (!clientRef.current || !clientRef.current.isConnected()) {
      setErrorMessage('❌ Not connected to server. Refresh page.');
      return;
    }

    try {
      setErrorMessage('');
      setTranscript('');
      setResponse('');
      setCallStatus('🎤 Listening...');
      
      await clientRef.current.startCall();
      setIsCalling(true);
      setIsSpeaking(true);
    } catch (error: any) {
      console.error('Failed to start call:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setErrorMessage(`❌ ${errorMsg}`);
      setCallStatus('');
      alert(errorMsg);
    }
  };

  const handleStopCall = async () => {
    if (clientRef.current) {
      await clientRef.current.stopCall();
      setIsCalling(false);
      setIsSpeaking(false);
      setCallStatus('');
    }
  };

  return (
    <div className="call-interface">
      <header>
        <h1>🎯 Hindi AI Calling System</h1>
        <p>Real-time Streaming • Predictive Audio • Sub-300ms Latency</p>
      </header>

      <section className="status-panel">
        <div className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className="indicator"></span>
          {isConnected ? '✅ Connected' : '❌ Disconnected'}
        </div>
        <div className="target-latency">⏱️ Target: {'<300ms'}</div>
      </section>

      {callStatus && (
        <section className="call-status-banner">
          {callStatus}
        </section>
      )}

      <section className="call-controls">
        <button
          className={`btn btn-primary ${isCalling ? 'active' : ''}`}
          onClick={isCalling ? handleStopCall : handleStartCall}
          disabled={!isConnected}
        >
          {isCalling ? '⏹️ Stop Call' : '📞 Start Call'}
        </button>
        {errorMessage && (
          <div className="error-message">
            {errorMessage}
          </div>
        )}
      </section>

      <section className="content-area">
        <div className="transcript-section">
          <div className="box transcript-box">
            <h3>🎤 Your Speech</h3>
            <div className={`content ${isSpeaking ? 'active' : ''}`}>
              {transcript || '(Waiting for input...)'}
            </div>
          </div>

          <div className="box response-box">
            <h3>🤖 AI Response</h3>
            <div className={`content ${response ? 'active' : ''}`}>
              {response || '(Waiting for AI response...)'}
            </div>
          </div>
        </div>

        <section className="metrics-section">
          <h3>📊 Latency Metrics (ms)</h3>
          <div className="metrics-grid">
            <div className="metric-card">
              <span className="metric-label">🎤 ASR</span>
              <span className="metric-value">{metrics.asrLatency}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">🧠 LLM</span>
              <span className="metric-value">{metrics.llmLatency}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">🔊 TTS</span>
              <span className="metric-value">{metrics.ttsLatency}</span>
            </div>
            <div className="metric-card total">
              <span className="metric-label">⏱️ Total</span>
              <span className="metric-value">{metrics.totalLatency}</span>
            </div>
          </div>
          
          {latency !== null && (
            <div className={`latency-status ${latency <= 300 ? 'good' : 'slow'}`}>
              {latency <= 300 ? '✅ OPTIMAL' : '⚠️ SLOW'} ({latency}ms)
            </div>
          )}
        </section>
      </section>

      <footer>
        <p>🚀 Phase 1: MVP with Predictive Streaming</p>
        <small>Uses real-time token streaming + audio buffering for lowest latency</small>
      </footer>
    </div>
  );
};