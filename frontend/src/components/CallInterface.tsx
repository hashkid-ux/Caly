import React, { useState, useEffect, useRef } from 'react';
import { WebRTCClient } from '../services/webrtcClient';
import '../styles/CallInterface.css';

export const CallInterface: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [latency, setLatency] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [metrics, setMetrics] = useState({
    asrLatency: 0,
    llmLatency: 0,
    ttsLatency: 0,
    totalLatency: 0,
  });

  const clientRef = useRef<WebRTCClient | null>(null);

  useEffect(() => {
    // Get backend URL from query params or auto-detect
    const params = new URLSearchParams(window.location.search);
    const backendUrl = params.get('backend');
    
    if (backendUrl) {
      console.log('[CallInterface] Using backend URL from query param:', backendUrl);
      (window as any).__BACKEND_URL__ = backendUrl;
    }
    
    // Initialize WebRTC client - auto-detects server URL
    clientRef.current = new WebRTCClient(backendUrl || undefined);

    const interval = setInterval(() => {
      if (clientRef.current) {
        setIsConnected(clientRef.current.isConnected());
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  const handleStartCall = async () => {
    if (!clientRef.current || !clientRef.current.isConnected()) {
      setErrorMessage('❌ Not connected to server. Refresh the page.');
      return;
    }

    try {
      setErrorMessage('');
      await clientRef.current.startCall();
      setIsCalling(true);
      setTranscript('');
      setResponse('');
    } catch (error: any) {
      console.error('Failed to start call:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setErrorMessage(`❌ ${errorMsg}`);
      alert(errorMsg);
    }
  };

  const handleStopCall = async () => {
    if (clientRef.current) {
      await clientRef.current.stopCall();
      setIsCalling(false);
    }
  };

  return (
    <div className="call-interface">
      <header>
        <h1>🎯 Hindi AI Calling System</h1>
        <p>Real-time streaming • Sub-300ms latency</p>
      </header>

      <section className="status-panel">
        <div className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className="indicator"></span>
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
        <div className="target-latency">Target: 300ms</div>
      </section>

      <section className="call-controls">
        <button
          className={`btn btn-primary ${isCalling ? 'active' : ''}`}
          onClick={isCalling ? handleStopCall : handleStartCall}
          disabled={!isConnected}
        >
          {isCalling ? '📞 Stop Call' : '📞 Start Call'}
        </button>
        {errorMessage && (
          <div className="error-message">
            {errorMessage}
          </div>
        )}
      </section>

      <section className="transcript-section">
        <div className="transcript-box">
          <h3>Your Speech</h3>
          <div className="transcript-content">
            {transcript || '(Waiting for input...)'}
          </div>
        </div>

        <div className="response-box">
          <h3>AI Response</h3>
          <div className="response-content">{response || '(Waiting...)'}</div>
        </div>
      </section>

      <section className="metrics-section">
        <h3>Latency Metrics (ms)</h3>
        <div className="metrics-grid">
          <div className="metric">
            <span className="label">ASR</span>
            <span className="value">{metrics.asrLatency}</span>
          </div>
          <div className="metric">
            <span className="label">LLM</span>
            <span className="value">{metrics.llmLatency}</span>
          </div>
          <div className="metric">
            <span className="label">TTS</span>
            <span className="value">{metrics.ttsLatency}</span>
          </div>
          <div className="metric total">
            <span className="label">Total</span>
            <span className="value">{metrics.totalLatency}</span>
          </div>
        </div>
        {latency !== null && (
          <div className="latency-status">
            Status: {latency <= 300 ? '✅ OK' : '❌ SLOW'} ({latency}ms)
          </div>
        )}
      </section>

      <footer>
        <p>Phase 1: MVP Testing | Sub-300ms Latency Target</p>
      </footer>
    </div>
  );
};
