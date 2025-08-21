# PgBouncer Testing Suite

Comprehensive load testing and chaos engineering suite for validating PgBouncer failover mechanisms under real-world conditions.

## Overview

This testing suite implements Phase 5 of the PgBouncer project, providing:

- **Load Testing**: k6-based performance testing with multiple scenarios
- **Chaos Engineering**: Container-based failure injection and recovery testing
- **MTTR Measurement**: Real-time monitoring and metrics collection
- **Integration Testing**: Combined load and chaos testing

## Directory Structure

```
tests/
├── load/
│   ├── k6-pgbouncer-test.ts      # Main k6 test script with TypeScript
│   ├── k6-config.json            # Scenario configurations
│   └── run-load-test.sh          # Load test runner script
├── chaos/
│   ├── chaos-test.sh             # Main chaos testing framework
│   ├── mttr-measure.sh           # MTTR monitoring script
│   └── chaos-scenarios.md        # Detailed scenario documentation
├── results/                      # Generated test outputs
│   ├── k6-*.json                # k6 load test results
│   ├── mttr-*.json              # Chaos test metrics
│   ├── *-report.md              # Generated reports
│   └── *.log                    # Monitoring logs
├── run-integrated-test.sh        # Combined load + chaos testing
├── test-failover.sh              # Original failover validation script
└── README.md                     # This file
```

## Prerequisites

### Required Tools

```bash
# Install k6 (load testing)
curl https://github.com/grafana/k6/releases/download/v0.47.0/k6-v0.47.0-linux-amd64.tar.gz -L | tar xvz --strip-components 1

# Install jq (JSON processing)
sudo apt-get install jq

# Docker should already be available
docker --version
```

### System Requirements

- Running PgBouncer infrastructure: `pnpm db:start`
- API server running: `pnpm dev:server`
- Sufficient resources for 400+ concurrent connections

## Quick Start

### 1. Basic Load Test

```bash
# Run normal load test (100 users, 2 minutes)
./load/run-load-test.sh normal

# Run spike test (sudden increase to 400 users)
./load/run-load-test.sh spike

# Run stress test (up to 500 users)  
./load/run-load-test.sh stress

# Run soak test (200 users, 10 minutes)
./load/run-load-test.sh soak
```

### 2. Chaos Testing

```bash
# Test single instance failure
./chaos/chaos-test.sh single

# Test cascading failures
./chaos/chaos-test.sh cascading

# Test full system recovery
./chaos/chaos-test.sh recovery

# Run all chaos scenarios
./chaos/chaos-test.sh all
```

### 3. Integrated Testing

```bash
# Default: failover load test + single failure
./run-integrated-test.sh

# Custom scenarios
./run-integrated-test.sh stress cascading
./run-integrated-test.sh soak recovery
```

## Test Scenarios

### Load Testing Scenarios

| Scenario | Virtual Users | Duration | Purpose |
|----------|---------------|----------|---------|
| `normal` | 100 | 2.5 min | Baseline performance |
| `spike` | 50→400→0 | 1.75 min | Sudden load increase |
| `stress` | 0→500 | 6 min | Beyond capacity testing |
| `soak` | 200 | 10.5 min | Memory leak detection |
| `failover` | 400 | 4 min | Failover testing load |

### Chaos Testing Scenarios

| Scenario | Description | Target MTTR |
|----------|-------------|-------------|
| `single` | Kill primary, failover to secondary | < 5s |
| `cascading` | Kill primary, then secondary | < 10s total |
| `recovery` | Kill all, restart sequentially | < 10s |

## Success Criteria

### Load Testing Thresholds

- **P95 Response Time**: < 500ms
- **Error Rate**: < 1%
- **Request Success Rate**: > 99%
- **Concurrent Connections**: 400 (matching max_client_conn)

### Chaos Testing Thresholds

- **MTTR (Mean Time To Recovery)**: < 5000ms
- **Detection Time**: < 1000ms
- **Failover Time**: < 3000ms
- **Zero Data Loss**: All transactions complete successfully

### Integration Testing Goals

- Maintain load testing thresholds during failover events
- Demonstrate automatic recovery without manual intervention
- Validate circuit breaker and connection pooling behavior
- Measure real-world performance under failure conditions

## Monitoring and Metrics

### Real-time Monitoring

```bash
# Start continuous MTTR monitoring
./chaos/mttr-measure.sh

# Monitor with custom interval (default: 1s)
INTERVAL=0.5 ./chaos/mttr-measure.sh

# Custom output file
OUTPUT_FILE=/tmp/my-monitor.log ./chaos/mttr-measure.sh
```

### Available Endpoints

- **Health Check**: `GET /monitoring/health`
- **Detailed Health**: `GET /monitoring/health/detailed`  
- **Test Query**: `GET /api/test-query`
- **Metrics**: `GET /monitoring/metrics`

### Metrics Collected

1. **Load Testing Metrics**
   - Request duration (avg, p95, p99)
   - Error rates and status codes
   - Virtual user ramp-up/down
   - Connection pool utilization
   - Failover detection events

2. **Chaos Testing Metrics**
   - Failure injection timestamps
   - Failover detection timing
   - Recovery completion timing
   - Instance health transitions
   - MTTR calculations

3. **System Metrics**
   - Active PgBouncer instance
   - Connection pool status
   - Circuit breaker state
   - Database connectivity

## Advanced Usage

### Custom Load Patterns

Create custom k6 scenarios by modifying `k6-config.json`:

```json
{
  "scenarios": {
    "custom_pattern": {
      "executor": "ramping-vus",
      "stages": [
        { "duration": "1m", "target": 200 },
        { "duration": "5m", "target": 200 },
        { "duration": "1m", "target": 0 }
      ]
    }
  }
}
```

### Environment Variables

```bash
# Custom API endpoint
export BASE_URL="http://localhost:8080"

# Custom monitoring interval
export INTERVAL=2

# Custom output paths
export OUTPUT_FILE="/path/to/custom.log"
```

### Debugging

Enable debug output for detailed execution logs:

```bash
# Enable debug mode
export DEBUG=1

# Run with verbose output
set -x
./chaos/chaos-test.sh single
```

## Interpreting Results

### Load Test Results

```json
{
  "timestamp": "2024-08-21T17:30:00Z",
  "duration": 180000,
  "iterations": 12000,
  "vus_max": 400,
  "http_req_duration_p95": 450.2,
  "error_rate": 0.003,
  "failovers_detected": 1,
  "avg_failover_duration": 2800
}
```

**Analysis**:
- ✅ P95 < 500ms (450.2ms)
- ✅ Error rate < 1% (0.3%)  
- ✅ Failover detected and handled
- ✅ Fast failover (2.8s)

### Chaos Test Results

```json
{
  "scenarios": [{
    "scenario": "single_failure",
    "durations_ms": {
      "detection": 800,
      "failover": 2200,
      "total_mttr": 3000
    }
  }]
}
```

**Analysis**:
- ✅ Fast detection (800ms)
- ✅ Quick failover (2.2s)
- ✅ Total MTTR under target (3s < 5s)

## Troubleshooting

### Common Issues

1. **"k6 not found"**
   ```bash
   # Install k6
   sudo apt update && sudo apt install k6
   ```

2. **"Container not found"**
   ```bash
   # Check running containers
   docker ps
   # Restart infrastructure
   pnpm db:start
   ```

3. **"Connection refused"**
   ```bash
   # Check server status
   curl http://localhost:3000/monitoring/health
   # Start server
   pnpm dev:server
   ```

4. **"Permission denied"**
   ```bash
   # Make scripts executable
   chmod +x ./load/run-load-test.sh
   chmod +x ./chaos/chaos-test.sh
   ```

### Debug Checklist

- [ ] All PgBouncer containers running
- [ ] API server responding on port 3000
- [ ] Docker permissions configured
- [ ] Required tools installed (k6, jq, curl)
- [ ] Sufficient system resources available

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: PgBouncer Load Tests

on: [push, pull_request]

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install k6
        run: |
          sudo apt-get update
          sudo apt-get install k6 jq
      - name: Start infrastructure
        run: pnpm db:start
      - name: Start server
        run: pnpm dev:server &
      - name: Run load tests
        run: ./tests/load/run-load-test.sh normal
      - name: Run chaos tests
        run: ./tests/chaos/chaos-test.sh single
```

## Performance Benchmarks

Based on the current infrastructure configuration:

### Expected Performance
- **Normal Load**: 100 users → P95 ~200ms
- **High Load**: 400 users → P95 ~400ms  
- **Stress Load**: 500 users → P95 ~600ms (degraded)

### Failover Performance
- **Detection**: ~500-1000ms (health check interval)
- **Failover**: ~2000-3000ms (connection establishment)
- **Recovery**: ~1000-2000ms (rejoin detection)

### Resource Usage
- **Memory**: ~100MB per PgBouncer instance
- **CPU**: ~10-20% under normal load
- **Connections**: 200 per pool, 400 max clients

## Next Steps

1. **Automated Testing**: Integrate with CI/CD pipelines
2. **Custom Metrics**: Add business-specific performance indicators  
3. **Alert Integration**: Connect with monitoring/alerting systems
4. **Load Balancing**: Test different routing strategies
5. **Performance Tuning**: Optimize based on test results

## References

- [k6 Documentation](https://k6.io/docs/)
- [PgBouncer Configuration](https://www.pgbouncer.org/config.html)
- [Chaos Engineering Principles](https://principlesofchaos.org/)
- [MTTR Best Practices](https://www.atlassian.com/incident-management/kpis/common-metrics)