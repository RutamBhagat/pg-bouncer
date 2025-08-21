import { Counter, Rate, Trend } from 'k6/metrics';
import { check, sleep } from 'k6';

import type { Options } from 'k6/options';
import http from 'k6/http';

const errorRate = new Rate('errors');
const failoverDetected = new Counter('failover_detected');
const queryDuration = new Trend('query_duration');
const failoverDuration = new Trend('failover_duration');

export const options: Options = {
  stages: [
    { duration: '30s', target: 400 }, // Ramp up to 400 users
    { duration: '2m', target: 400 },  // Stay at 400 users
    { duration: '1m', target: 400 },  // Failover window
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],        // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],          // Error rate under 1%
    errors: ['rate<0.01'],                   // Custom error metric under 1%
    failover_duration: ['avg<5000'],         // Failover duration under 5s
  },
};

declare const __ENV: Record<string, string>;
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

let lastActiveInstance: string | null = null;
let failoverStartTime: number | null = null;

export default function () {
  const startTime = Date.now();
  
  const response = http.get(`${BASE_URL}/api/test-query`, {
    timeout: '5s',
    tags: { name: 'pgbouncer_query' },
  });
  
  const duration = Date.now() - startTime;
  queryDuration.add(duration);
  
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'has response data': (r) => {
      try {
        const body = JSON.parse(r.body as string);
        return body.data !== undefined;
      } catch {
        return false;
      }
    },
    'response time OK': (r) => r.timings.duration < 500,
  });
  
  if (!success) {
    errorRate.add(1);
    
    if (!failoverStartTime) {
      failoverStartTime = Date.now();
      console.log('Potential failover detected - tracking recovery time');
    }
  } else {
    errorRate.add(0);
    
    try {
      const body = JSON.parse(response.body as string);
      const currentInstance = body.active_pgbouncer;
      
      if (lastActiveInstance && lastActiveInstance !== currentInstance) {
        failoverDetected.add(1);
        
        if (failoverStartTime) {
          const failoverTime = Date.now() - failoverStartTime;
          failoverDuration.add(failoverTime);
          console.log(`Failover completed: ${lastActiveInstance} -> ${currentInstance} (${failoverTime}ms)`);
          failoverStartTime = null;
        }
        
        lastActiveInstance = currentInstance;
      } else if (!lastActiveInstance) {
        lastActiveInstance = currentInstance;
      }
      
    } catch (e) {
      console.error('Failed to parse response body:', e);
    }
  }
  
  sleep(Math.random() * 0.3 + 0.1);
}

interface TestSummary {
  timestamp: string;
  test_duration_ms: number;
  total_requests: number;
  max_users: number;
  avg_response_time: number;
  p95_response_time: number;
  error_rate: number;
  failovers_detected: number;
  avg_failover_duration: number;
  success_criteria: {
    p95_under_500ms: boolean;
    error_rate_under_1pct: boolean;
    failover_under_5s: boolean;
  };
}

export function handleSummary(data: any): Record<string, string> {
  const summary: TestSummary = {
    timestamp: new Date().toISOString(),
    test_duration_ms: data.state.testRunDurationMs,
    total_requests: data.metrics.iterations.values.count,
    max_users: data.metrics.vus_max.values.value,
    avg_response_time: Math.round(data.metrics.http_req_duration.values.avg),
    p95_response_time: Math.round(data.metrics.http_req_duration.values['p(95)']),
    error_rate: data.metrics.http_req_failed.values.rate,
    failovers_detected: data.metrics.failover_detected ? data.metrics.failover_detected.values.count : 0,
    avg_failover_duration: data.metrics.failover_duration ? Math.round(data.metrics.failover_duration.values.avg) : 0,
    success_criteria: {
      p95_under_500ms: data.metrics.http_req_duration.values['p(95)'] < 500,
      error_rate_under_1pct: data.metrics.http_req_failed.values.rate < 0.01,
      failover_under_5s: data.metrics.failover_duration ? data.metrics.failover_duration.values.avg < 5000 : true
    }
  };
  
  return {
    'stdout': generateTextSummary(summary),
    'tests/k6-results.json': JSON.stringify(summary, null, 2),
  };
}

function generateTextSummary(summary: TestSummary): string {
  const passed = summary.success_criteria.p95_under_500ms && 
                 summary.success_criteria.error_rate_under_1pct && 
                 summary.success_criteria.failover_under_5s;
  
  return `
=== PgBouncer Failover Load Test Results ===

Duration: ${Math.round(summary.test_duration_ms / 1000)}s
Total Requests: ${summary.total_requests}
Max Users: ${summary.max_users}

Performance:
  Average Response Time: ${summary.avg_response_time}ms
  P95 Response Time: ${summary.p95_response_time}ms ${summary.success_criteria.p95_under_500ms ? 'PASS' : 'FAIL'}
  Error Rate: ${(summary.error_rate * 100).toFixed(2)}% ${summary.success_criteria.error_rate_under_1pct ? 'PASS' : 'FAIL'}

Failover:
  Failovers Detected: ${summary.failovers_detected}
  Avg Failover Duration: ${summary.avg_failover_duration}ms ${summary.success_criteria.failover_under_5s ? 'PASS' : 'FAIL'}

Overall Result: ${passed ? 'PASS' : 'FAIL'}
`;
}