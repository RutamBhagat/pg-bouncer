import http, { type RefinedResponse } from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import type { Options } from 'k6/options';

declare const __ENV: Record<string, string>;

interface TestSummaryData {
  state: {
    testRunDurationMs: number;
  };
  metrics: {
    iterations: { values: { count: number } };
    vus_max: { values: { value: number } };
    http_req_duration: { values: { 'p(95)': number; avg: number } };
    errors?: { values: { rate: number } };
    failover_detected?: { values: { count: number } };
    failover_duration?: { values: { avg: number } };
  };
}

const errorRate = new Rate('errors');
const connectionPoolSaturation = new Gauge('connection_pool_saturation');
const failoverDetected = new Counter('failover_detected');
const queryDuration = new Trend('query_duration');
const failoverDuration = new Trend('failover_duration');

export const options: Options = {
  stages: [
    { duration: '30s', target: 400 },
    { duration: '2m', target: 400 },
    { duration: '1m', target: 400 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL: string = __ENV.BASE_URL || 'http://localhost:3000';
let lastActiveInstance: string | null = null;
let failoverStartTime: number | null = null;

export default function () {
  group('Database Query Test', () => {
    const startTime = Date.now();
    const response = http.get(`${BASE_URL}/api/test-query`, {
      timeout: '5s',
      tags: { name: 'test_query' },
    });
    const duration = Date.now() - startTime;
    queryDuration.add(duration);

    const success = check(response, {
      'status is 200': (r: RefinedResponse<'text'>) => r.status === 200,
      'response has data': (r: RefinedResponse<'text'>) => {
        try {
          const bodyText = typeof r.body === 'string' ? r.body : '';
          const body = JSON.parse(bodyText);
          return body.data !== undefined;
        } catch {
          return false;
        }
      },
      'response time < 500ms': (r: RefinedResponse<'text'>) => r.timings.duration < 500,
    });

    errorRate.add(!success);

    if (success) {
      try {
        const bodyText = typeof response.body === 'string' ? response.body : '';
        const body = JSON.parse(bodyText || '{}');
        const currentInstance = body.activeInstance;
        
        if (lastActiveInstance && lastActiveInstance !== currentInstance) {
          failoverDetected.add(1);
          if (failoverStartTime) {
            const failoverTime = Date.now() - failoverStartTime;
            failoverDuration.add(failoverTime);
            console.log(`Failover detected: ${lastActiveInstance} -> ${currentInstance} (${failoverTime}ms)`);
            failoverStartTime = null;
          }
        } else if (!lastActiveInstance) {
          lastActiveInstance = currentInstance;
        }
        
        if (body.metrics && body.metrics.poolUtilization) {
          connectionPoolSaturation.add(body.metrics.poolUtilization);
        }
      } catch (e) {
        console.error('Failed to parse response:', e);
      }
    } else if (!failoverStartTime) {
      failoverStartTime = Date.now();
    }
  });

  sleep(Math.random() * 0.5 + 0.1);
}

export function handleSummary(data: TestSummaryData) {
  const summary = {
    timestamp: new Date().toISOString(),
    duration: data.state.testRunDurationMs,
    iterations: data.metrics.iterations.values.count,
    vus_max: data.metrics.vus_max.values.value,
    http_req_duration_p95: data.metrics.http_req_duration.values['p(95)'],
    http_req_duration_avg: data.metrics.http_req_duration.values.avg,
    error_rate: data.metrics.errors ? data.metrics.errors.values.rate : 0,
    failovers_detected: data.metrics.failover_detected ? data.metrics.failover_detected.values.count : 0,
    avg_failover_duration: data.metrics.failover_duration ? data.metrics.failover_duration.values.avg : 0,
  };

  return {
    'stdout': textSummary(data, { indent: ' ' }),
    'apps/server/tests/results/k6-summary.json': JSON.stringify(summary, null, 2),
  };
}

function textSummary(data: TestSummaryData, options: { indent: string }) {
  const indent = options.indent || '';
  const summary = [];
  
  summary.push('=== Load Test Summary ===\n');
  summary.push(`${indent}Duration: ${data.state.testRunDurationMs}ms\n`);
  summary.push(`${indent}Iterations: ${data.metrics.iterations.values.count}\n`);
  summary.push(`${indent}Max VUs: ${data.metrics.vus_max.values.value}\n`);
  summary.push(`${indent}Error Rate: ${(data.metrics.errors ? data.metrics.errors.values.rate * 100 : 0).toFixed(2)}%\n`);
  
  if (data.metrics.http_req_duration) {
    summary.push(`\n${indent}Response Times:\n`);
    summary.push(`${indent}  p95: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`);
    summary.push(`${indent}  avg: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`);
  }
  
  if (data.metrics.failover_detected && data.metrics.failover_detected.values.count > 0) {
    summary.push(`\n${indent}Failover Events:\n`);
    summary.push(`${indent}  Count: ${data.metrics.failover_detected.values.count}\n`);
    if (data.metrics.failover_duration) {
      summary.push(`${indent}  Avg Duration: ${data.metrics.failover_duration.values.avg.toFixed(2)}ms\n`);
    }
  }
  
  return summary.join('');
}