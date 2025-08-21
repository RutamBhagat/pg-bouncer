# PgBouncer Testing Suite

Load testing and chaos engineering for PgBouncer failover validation.

## Prerequisites

- Install k6: `curl https://github.com/grafana/k6/releases/download/v0.47.0/k6-v0.47.0-linux-amd64.tar.gz -L | tar xvz --strip-components 1`
- Install jq: `sudo apt-get install jq`
- Running infrastructure: `pnpm db:start`
- API server: `pnpm dev:server`

## Quick Start

### Load Testing
```bash
# Run k6 load test with 400 concurrent users
k6 run tests/k6-failover-test.ts

# With custom server URL
BASE_URL=http://localhost:8080 k6 run tests/k6-failover-test.ts
```

### Chaos Testing
```bash
# Test single instance failure
./tests/chaos-test.sh single

# Test cascading failures
./tests/chaos-test.sh cascading

# Test full system recovery
./tests/chaos-test.sh recovery

# Run all scenarios
./tests/chaos-test.sh all
```

## Success Criteria

### Load Testing
- **P95 Response Time**: < 500ms
- **Error Rate**: < 1%
- **Failover Detection**: Automatic failover during test
- **Failover Duration**: < 5000ms average

### Chaos Testing
- **Single Failure MTTR**: < 5000ms
- **Cascading Failure**: < 10000ms total
- **Recovery Time**: < 10000ms from complete outage

## Test Results

Results are saved to:
- `tests/k6-results.json` - Load test metrics
- Console output with PASS/FAIL status

## Example Output

### Load Test
```
=== PgBouncer Failover Load Test Results ===

Duration: 240s
Total Requests: 48000
Max Users: 400

Performance:
  Average Response Time: 245ms
  P95 Response Time: 387ms PASS
  Error Rate: 0.12% PASS

Failover:
  Failovers Detected: 1
  Avg Failover Duration: 2800ms PASS

Overall Result: PASS
```

### Chaos Test
```
=== Single Failure Results ===
MTTR: 2950ms
Target: < 5000ms
RESULT: PASS
```