#!/bin/bash

# Integrated Load + Chaos Testing Script
# Runs k6 load test while triggering chaos scenarios

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000}"
LOAD_SCENARIO="${1:-failover}"
CHAOS_SCENARIO="${2:-single}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Integrated Load + Chaos Testing ===${NC}"
echo -e "${YELLOW}Load Scenario: ${LOAD_SCENARIO}${NC}"
echo -e "${YELLOW}Chaos Scenario: ${CHAOS_SCENARIO}${NC}"
echo -e "${YELLOW}Base URL: ${BASE_URL}${NC}"

# Check prerequisites
check_prerequisites() {
    if ! command -v k6 &> /dev/null; then
        echo -e "${RED}Error: k6 is not installed${NC}"
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: docker is not installed${NC}"
        exit 1
    fi
    
    if ! curl -s "${BASE_URL}/monitoring/health" > /dev/null; then
        echo -e "${RED}Error: Server at ${BASE_URL} is not responding${NC}"
        exit 1
    fi
}

# Start MTTR monitoring in background
start_mttr_monitoring() {
    local mttr_log="results/mttr-integrated-${TIMESTAMP}.log"
    echo -e "${BLUE}Starting MTTR monitoring...${NC}"
    
    OUTPUT_FILE="${SCRIPT_DIR}/${mttr_log}" \
    "${SCRIPT_DIR}/chaos/mttr-measure.sh" &
    
    MTTR_PID=$!
    echo -e "${GREEN}MTTR monitoring started (PID: ${MTTR_PID})${NC}"
    sleep 2
}

# Stop MTTR monitoring
stop_mttr_monitoring() {
    if [[ -n "$MTTR_PID" ]]; then
        echo -e "${YELLOW}Stopping MTTR monitoring...${NC}"
        kill "$MTTR_PID" 2>/dev/null || true
        wait "$MTTR_PID" 2>/dev/null || true
        echo -e "${GREEN}MTTR monitoring stopped${NC}"
    fi
}

# Start k6 load test in background
start_load_test() {
    echo -e "${BLUE}Starting k6 load test (${LOAD_SCENARIO})...${NC}"
    
    BASE_URL="${BASE_URL}" \
    "${SCRIPT_DIR}/load/run-load-test.sh" "${LOAD_SCENARIO}" &
    
    LOAD_TEST_PID=$!
    echo -e "${GREEN}Load test started (PID: ${LOAD_TEST_PID})${NC}"
    
    # Wait for load test to ramp up
    echo -e "${YELLOW}Waiting for load test ramp-up (45s)...${NC}"
    sleep 45
}

# Wait for load test completion
wait_for_load_test() {
    if [[ -n "$LOAD_TEST_PID" ]]; then
        echo -e "${YELLOW}Waiting for load test completion...${NC}"
        wait "$LOAD_TEST_PID" 2>/dev/null || true
        echo -e "${GREEN}Load test completed${NC}"
    fi
}

# Run chaos scenario during load test
run_chaos_during_load() {
    echo -e "${BLUE}Triggering chaos scenario (${CHAOS_SCENARIO}) during load test...${NC}"
    
    # Run chaos test
    "${SCRIPT_DIR}/chaos/chaos-test.sh" "${CHAOS_SCENARIO}"
    
    echo -e "${GREEN}Chaos scenario completed${NC}"
}

# Generate integrated report
generate_integrated_report() {
    local report_file="${SCRIPT_DIR}/results/integrated-test-report-${TIMESTAMP}.md"
    
    cat > "${report_file}" << EOF
# Integrated Load + Chaos Test Report

**Test Date:** $(date -Iseconds)
**Load Scenario:** ${LOAD_SCENARIO}
**Chaos Scenario:** ${CHAOS_SCENARIO}
**Base URL:** ${BASE_URL}

## Test Overview

This test combines k6 load testing with chaos engineering to validate PgBouncer failover behavior under realistic load conditions.

### Test Sequence
1. MTTR monitoring started
2. k6 load test initiated (${LOAD_SCENARIO} scenario)
3. 45-second ramp-up period
4. Chaos scenario triggered (${CHAOS_SCENARIO})
5. Load test continued through failover
6. All monitoring stopped

## Load Test Results

EOF

    # Include k6 summary if available
    local k6_summary="${SCRIPT_DIR}/results/k6-summary.json"
    if [[ -f "$k6_summary" ]]; then
        cat >> "${report_file}" << EOF
### Performance Metrics

$(jq -r '
"- **Total Duration:** \(.duration)ms
- **Total Iterations:** \(.iterations)  
- **Max Virtual Users:** \(.vus_max)
- **Average Response Time:** \(.http_req_duration_avg | floor)ms
- **P95 Response Time:** \(.http_req_duration_p95 | floor)ms
- **Error Rate:** \(.error_rate * 100 | floor)%
- **Failovers Detected:** \(.failovers_detected)
- **Average Failover Duration:** \(.avg_failover_duration | floor)ms"
' "$k6_summary" 2>/dev/null || echo "Load test metrics not available")

### Success Criteria Analysis

$(jq -r '
if .http_req_duration_p95 < 500 then "✅ **P95 Response Time:** PASS (<500ms)" else "❌ **P95 Response Time:** FAIL (≥500ms)" end,
if .error_rate < 0.01 then "✅ **Error Rate:** PASS (<1%)" else "❌ **Error Rate:** FAIL (≥1%)" end,  
if .failovers_detected > 0 then "✅ **Failover Detection:** PASS (detected)" else "⚠️ **Failover Detection:** No failovers detected during test" end,
if .avg_failover_duration < 5000 then "✅ **Failover Speed:** PASS (<5000ms)" else "❌ **Failover Speed:** FAIL (≥5000ms)" end
' "$k6_summary" 2>/dev/null || echo "Unable to analyze success criteria")

EOF
    fi

    # Include chaos test results if available
    local chaos_metrics="${SCRIPT_DIR}/results/mttr-metrics-${TIMESTAMP}.json"
    if [[ -f "$chaos_metrics" ]]; then
        cat >> "${report_file}" << EOF
## Chaos Test Results

### Failover Scenarios

$(jq -r '
.scenarios[]? | 
"#### \(.scenario | gsub("_"; " ") | ascii_upcase)
- **Detection Time:** \(.durations_ms.detection)ms
- **Failover Time:** \(.durations_ms.failover)ms
- **Total MTTR:** \(.durations_ms.total_mttr)ms  
- **Result:** \(if .durations_ms.total_mttr < 5000 then "✅ PASS" else "❌ FAIL" end)
"
' "$chaos_metrics" 2>/dev/null || echo "Chaos test metrics not available")

EOF
    fi

    cat >> "${report_file}" << EOF
## Integration Analysis

### Key Findings

1. **System Resilience**: How well did the system handle failover under load?
2. **Performance Impact**: What was the impact on response times during failover?
3. **Error Handling**: Were errors properly handled during the transition?
4. **Recovery Speed**: How quickly did the system recover to normal operation?

### Recommendations

Based on the test results:
- Monitor P95 latency spikes during failover events
- Validate error rates remain under 1% during transitions
- Ensure MTTR consistently stays under 5 seconds
- Consider load balancing optimizations if needed

## Raw Data Files

- K6 Load Test Results: \`results/k6-summary.json\`
- Chaos Test Metrics: \`results/mttr-metrics-${TIMESTAMP}.json\`  
- MTTR Monitoring Log: \`results/mttr-integrated-${TIMESTAMP}.log\`
- Integrated Test Report: \`$(basename "$report_file")\`
EOF

    echo -e "${GREEN}Integrated report generated: ${report_file}${NC}"
}

# Cleanup function
cleanup() {
    echo -e "${YELLOW}Cleaning up processes...${NC}"
    stop_mttr_monitoring
    
    # Kill load test if still running
    if [[ -n "$LOAD_TEST_PID" ]]; then
        kill "$LOAD_TEST_PID" 2>/dev/null || true
        wait "$LOAD_TEST_PID" 2>/dev/null || true
    fi
    
    echo -e "${GREEN}Cleanup completed${NC}"
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Main execution
main() {
    check_prerequisites
    
    # Create results directory
    mkdir -p "${SCRIPT_DIR}/results"
    
    echo -e "${BLUE}Starting integrated test sequence...${NC}"
    
    # Start monitoring
    start_mttr_monitoring
    
    # Start load test
    start_load_test
    
    # Trigger chaos scenario
    run_chaos_during_load
    
    # Wait for load test to complete
    wait_for_load_test
    
    # Stop monitoring
    stop_mttr_monitoring
    
    # Generate report
    generate_integrated_report
    
    echo -e "${GREEN}Integrated testing completed successfully!${NC}"
}

# Show usage
show_usage() {
    echo "Usage: $0 [load_scenario] [chaos_scenario]"
    echo ""
    echo "Load Scenarios:"
    echo "  normal    - 100 users, 2 minutes"
    echo "  spike     - Spike to 400 users"  
    echo "  stress    - Up to 500 users"
    echo "  soak      - 200 users, 10 minutes"
    echo "  failover  - 400 users with failover testing (default)"
    echo ""
    echo "Chaos Scenarios:"
    echo "  single     - Single instance failure (default)"
    echo "  cascading  - Multiple consecutive failures"
    echo "  recovery   - Full system recovery test"
    echo ""
    echo "Example:"
    echo "  $0 failover single    # Default integrated test"
    echo "  $0 stress cascading   # Stress test with cascading failures"
}

# Check for help flag
if [[ "${1}" == "--help" || "${1}" == "-h" ]]; then
    show_usage
    exit 0
fi

# Run main function
main "$@"