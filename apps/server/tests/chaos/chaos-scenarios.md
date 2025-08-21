# PgBouncer Chaos Testing Scenarios

This document describes the chaos testing scenarios implemented for the PgBouncer failover system.

## Scenario 1: Single Instance Failure

**Objective**: Test automatic failover when the primary PgBouncer instance fails.

**Steps**:
1. Ensure all PgBouncer instances are running (primary, secondary, tertiary)
2. Verify system is using primary instance (port 6432)
3. Kill primary container (`pg-bouncer-pgbouncer-primary-1`)
4. Monitor for automatic failover to secondary instance (port 6433)
5. Restart primary container
6. Monitor for recovery detection

**Success Criteria**:
- Failover to secondary occurs within 5 seconds
- Zero data loss during transition
- Primary instance rejoins when restarted
- MTTR < 5000ms

**Metrics Measured**:
- Detection time (failure → detection)
- Failover time (detection → active secondary)
- Recovery time (primary restart → rejoin)
- Total MTTR

## Scenario 2: Cascading Failures

**Objective**: Test system behavior under multiple consecutive failures.

**Steps**:
1. Start with all instances healthy, primary active
2. Kill primary container
3. Wait for failover to secondary (5s)
4. Kill secondary container after 30 seconds
5. Monitor failover to tertiary instance (port 6434)
6. Restart primary and secondary containers
7. Monitor full system recovery

**Success Criteria**:
- First failover (primary → secondary) < 5s
- Second failover (secondary → tertiary) < 5s
- System remains available throughout
- All instances rejoin when restarted
- Total degraded time < 10s

**Stress Factors**:
- Multiple failure points
- Rapid successive failures
- Load balancing across remaining capacity

## Scenario 3: Full Recovery Test

**Objective**: Test system recovery from complete service outage.

**Steps**:
1. Kill all PgBouncer instances simultaneously
2. Wait 10 seconds (complete outage)
3. Restart primary instance only
4. Monitor recovery and active instance detection
5. Restart secondary and tertiary instances
6. Verify all instances are healthy and available

**Success Criteria**:
- Primary instance becomes active within 10s of restart
- System responds to queries once primary is up
- Secondary/tertiary instances rejoin without issues
- No manual intervention required

**Recovery Patterns**:
- Cold start recovery
- Partial capacity restoration
- Full capacity restoration

## Scenario 4: Network Partition Simulation

**Objective**: Test behavior during network connectivity issues.

**Implementation**: 
```bash
# Block traffic to specific PgBouncer ports
iptables -A OUTPUT -p tcp --dport 6432 -j DROP
# Restore after test
iptables -D OUTPUT -p tcp --dport 6432 -j DROP
```

**Steps**:
1. Start with healthy system
2. Block network access to primary instance port
3. Monitor failover behavior
4. Restore network connectivity
5. Verify primary rejoins automatically

**Success Criteria**:
- Failover occurs within network timeout period
- No connection errors propagated to clients
- Automatic recovery when connectivity restored

## Load Integration Testing

### K6 + Chaos Integration

**Objective**: Measure failover performance under active load.

**Setup**:
1. Start k6 load test (400 concurrent users)
2. During sustained load phase, trigger chaos scenario
3. Monitor both load test metrics and failover metrics
4. Measure impact on response times and error rates

**Key Metrics**:
- P95 latency during normal operation
- P95 latency spike during failover
- Error rate during failover window
- Request success rate throughout test
- Failover detection time under load

**Expected Behavior**:
- P95 latency < 500ms during normal operation  
- Temporary latency spike during failover (< 2s)
- Error rate < 1% throughout entire test
- Zero dropped connections during failover

## MTTR Measurement Strategy

### Continuous Monitoring

The MTTR measurement script (`mttr-measure.sh`) provides:

1. **Real-time Health Monitoring**
   - 1-second polling interval
   - Response time measurement
   - Active instance tracking
   - Status change detection

2. **Event Timeline Tracking**
   - Failure detection timestamp
   - Failover completion timestamp  
   - Recovery start timestamp
   - Full recovery timestamp

3. **Automated MTTR Calculation**
   - Detection time: failure → detected
   - Failover time: detected → active backup
   - Recovery time: primary restart → rejoin
   - Total MTTR: failure → full recovery

### Target MTTR Breakdown

- **Detection**: < 1000ms (health check interval)
- **Failover**: < 3000ms (circuit breaker + connection establishment)  
- **Recovery**: < 1000ms (rejoin detection)
- **Total MTTR**: < 5000ms

## Running the Tests

### Individual Scenarios
```bash
# Single failure test
./chaos-test.sh single

# Cascading failure test  
./chaos-test.sh cascading

# Recovery test
./chaos-test.sh recovery
```

### Complete Test Suite
```bash
# Run all scenarios
./chaos-test.sh all
```

### With Load Testing
```bash
# Terminal 1: Start MTTR monitoring
./mttr-measure.sh

# Terminal 2: Start load test  
../load/run-load-test.sh failover

# Terminal 3: Trigger chaos during load
./chaos-test.sh single
```

## Expected Outputs

1. **JSON Metrics File**: Detailed timing measurements
2. **Markdown Report**: Human-readable summary with pass/fail status
3. **MTTR Log**: Continuous monitoring data
4. **K6 Results**: Load test performance data with failover events

## Troubleshooting

### Common Issues

1. **Containers not found**: Ensure containers are named correctly
2. **Permission denied**: Run scripts with appropriate Docker permissions  
3. **Network timeout**: Adjust timeout values for slower environments
4. **JQ not found**: Install jq package for JSON processing

### Debug Mode

Add `set -x` to scripts for detailed execution logging:
```bash
# Enable debug output
export DEBUG=1
./chaos-test.sh single
```