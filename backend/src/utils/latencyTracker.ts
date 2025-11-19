export class LatencyTracker {
  private metrics: Map<string, any> = new Map();

  start(sessionId: string, stage: string): void {
    const key = `${sessionId}:${stage}`;
    this.metrics.set(key, { startTime: Date.now() });
  }

  end(sessionId: string, stage: string): number {
    const key = `${sessionId}:${stage}`;
    const entry = this.metrics.get(key);
    if (!entry) return 0;

    const latency = Date.now() - entry.startTime;
    entry.endTime = Date.now();
    entry.latency = latency;

    console.log(`[LATENCY] ${stage}: ${latency}ms`);
    return latency;
  }

  getMetrics(sessionId: string): any {
    const result: any = {};
    this.metrics.forEach((value, key) => {
      if (key.startsWith(sessionId)) {
        const stage = key.split(':')[1];
        result[stage] = value.latency || 0;
      }
    });
    return result;
  }

  log(sessionId: string, message: string): void {
    console.log(`[${sessionId}] ${message}`);
  }

  clear(sessionId: string): void {
    Array.from(this.metrics.keys())
      .filter(key => key.startsWith(sessionId))
      .forEach(key => this.metrics.delete(key));
  }
}

export const latencyTracker = new LatencyTracker();
