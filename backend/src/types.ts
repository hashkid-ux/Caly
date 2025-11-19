export interface LatencyMetrics {
  asrStartTime: number;
  asrEndTime?: number;
  llmStartTime?: number;
  llmFirstTokenTime?: number;
  ttsStartTime?: number;
  ttsEndTime?: number;
  totalTime?: number;
}

export interface StreamingAudioChunk {
  timestamp: number;
  data: Buffer;
  isFinal: boolean;
}

export interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  timestamp: number;
  latency: number;
}

export interface LLMStreamToken {
  token: string;
  isFinal: boolean;
  timestamp: number;
}

export interface AudioFragment {
  audioBuffer: Buffer;
  timestamp: number;
  isFinal: boolean;
}

export interface CallSession {
  sessionId: string;
  startTime: number;
  userId: string;
  transcriptionHistory: string[];
  responseHistory: string[];
  metrics: LatencyMetrics;
}
