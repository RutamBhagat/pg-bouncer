#!/bin/bash

# PgBouncer Chaos Testing Framework
# Tests failover scenarios and measures MTTR (Mean Time To Recovery)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/../results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BASE_URL="${BASE_URL:-http://localhost:3000}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Container names
PRIMARY_CONTAINER="pg-bouncer-pgbouncer-primary-1"
SECONDARY_CONTAINER="pg-bouncer-pgbouncer-secondary-1"
TERTIARY_CONTAINER="pg-bouncer-pgbouncer-tertiary-1"

# Metrics file
METRICS_FILE="${RESULTS_DIR}/mttr-metrics-${TIMESTAMP}.json"

echo -e "${BLUE}=== PgBouncer Chaos Testing Framework ===${NC}"
echo -e "${YELLOW}Results will be saved to: ${RESULTS_DIR}${NC}"

# Initialize metrics
init_metrics() {
    mkdir -p "${RESULTS_DIR}"
    cat > "${METRICS_FILE}" << EOF
{
  "test_start": "$(date -Iseconds)",
  "base_url": "${BASE_URL}",
  "scenarios": []
}
EOF
}

# Log metrics for a scenario
log_metrics() {
    local scenario="$1"
    local failure_start="$2"
    local detection_time="$3"
    local failover_complete="$4"
    local recovery_time="$5"
    
    local detection_duration=$((detection_time - failure_start))
    local failover_duration=$((failover_complete - detection_time))
    local total_mttr=$((failover_complete - failure_start))
    
    # Add to metrics file
    jq --arg scenario "$scenario" \
       --argjson failure_start "$failure_start" \
       --argjson detection_time "$detection_time" \
       --argjson failover_complete "$failover_complete" \
       --argjson recovery_time "$recovery_time" \
       --argjson detection_duration "$detection_duration" \
       --argjson failover_duration "$failover_duration" \
       --argjson total_mttr "$total_mttr" \
       '.scenarios += [{
         "scenario": $scenario,
         "timestamps": {
           "failure_start": $failure_start,
           "detection_time": $detection_time,
           "failover_complete": $failover_complete,
           "recovery_time": $recovery_time
         },
         "durations_ms": {
           "detection": $detection_duration,
           "failover": $failover_duration,
           "total_mttr": $total_mttr
         }
       }]' "${METRICS_FILE}" > "${METRICS_FILE}.tmp" && mv "${METRICS_FILE}.tmp" "${METRICS_FILE}"
    
    echo -e "${GREEN}MTTR Metrics for ${scenario}:${NC}"
    echo -e "  Detection Time: ${detection_duration}ms"
    echo -e "  Failover Time: ${failover_duration}ms"
    echo -e "  Total MTTR: ${total_mttr}ms"
}

# Check if container is running
container_running() {
    docker ps --format "{{.Names}}" | grep -q "^${1}$"
}

# Check if PgBouncer instance is healthy
pgbouncer_healthy() {
    local instance_name="$1"
    curl -s "${BASE_URL}/monitoring/health/detailed" | jq -r ".instances[] | select(.name == \"${instance_name}\") | .status" | grep -q "healthy"
}

# Wait for failover detection
wait_for_failover() {
    local expected_active="$1"
    local timeout=30
    local count=0
    
    while [[ $count -lt $timeout ]]; do
        if curl -s "${BASE_URL}/api/test-query" | jq -r '.activeInstance' | grep -q "${expected_active}"; then
            return 0
        fi
        sleep 1
        ((count++))
    done
    return 1
}

# Get current active instance
get_active_instance() {
    curl -s "${BASE_URL}/api/test-query" | jq -r '.activeInstance' 2>/dev/null || echo "unknown"
}

# Test scenario: Single instance failure
test_single_failure() {
    echo -e "${BLUE}=== Testing Single Instance Failure ===${NC}"
    
    # Ensure all containers are running
    docker start "${PRIMARY_CONTAINER}" "${SECONDARY_CONTAINER}" "${TERTIARY_CONTAINER}" >/dev/null 2>&1 || true
    sleep 5
    
    local initial_instance=$(get_active_instance)
    echo -e "${YELLOW}Initial active instance: ${initial_instance}${NC}"
    
    # Kill primary container
    echo -e "${YELLOW}Killing primary container...${NC}"
    local failure_start=$(date +%s%3N)
    docker stop "${PRIMARY_CONTAINER}" >/dev/null 2>&1
    
    # Wait for failover detection
    echo -e "${YELLOW}Waiting for failover detection...${NC}"
    local detection_time=$(date +%s%3N)
    if wait_for_failover "secondary"; then
        local failover_complete=$(date +%s%3N)
        echo -e "${GREEN}Failover to secondary successful${NC}"
        
        # Restart primary and wait for recovery
        echo -e "${YELLOW}Restarting primary container...${NC}"
        docker start "${PRIMARY_CONTAINER}" >/dev/null 2>&1
        sleep 10
        
        local recovery_time=$(date +%s%3N)
        log_metrics "single_failure" "$failure_start" "$detection_time" "$failover_complete" "$recovery_time"
    else
        echo -e "${RED}Failover failed or timed out${NC}"
        return 1
    fi
}

# Test scenario: Cascading failures
test_cascading_failure() {
    echo -e "${BLUE}=== Testing Cascading Failure ===${NC}"
    
    # Ensure all containers are running
    docker start "${PRIMARY_CONTAINER}" "${SECONDARY_CONTAINER}" "${TERTIARY_CONTAINER}" >/dev/null 2>&1 || true
    sleep 5
    
    local initial_instance=$(get_active_instance)
    echo -e "${YELLOW}Initial active instance: ${initial_instance}${NC}"
    
    # Kill primary container
    echo -e "${YELLOW}Killing primary container...${NC}"
    local failure_start=$(date +%s%3N)
    docker stop "${PRIMARY_CONTAINER}" >/dev/null 2>&1
    
    # Wait for failover to secondary
    sleep 5
    local first_failover=$(date +%s%3N)
    
    # Kill secondary after 30 seconds
    echo -e "${YELLOW}Killing secondary container after failover...${NC}"
    sleep 5
    docker stop "${SECONDARY_CONTAINER}" >/dev/null 2>&1
    
    # Wait for failover to tertiary
    echo -e "${YELLOW}Waiting for failover to tertiary...${NC}"
    if wait_for_failover "tertiary"; then
        local final_failover=$(date +%s%3N)
        echo -e "${GREEN}Cascading failover to tertiary successful${NC}"
        
        # Restart all containers
        echo -e "${YELLOW}Restarting all containers...${NC}"
        docker start "${PRIMARY_CONTAINER}" "${SECONDARY_CONTAINER}" >/dev/null 2>&1
        sleep 15
        
        local recovery_time=$(date +%s%3N)
        log_metrics "cascading_failure" "$failure_start" "$first_failover" "$final_failover" "$recovery_time"
    else
        echo -e "${RED}Cascading failover failed${NC}"
        return 1
    fi
}

# Test scenario: Recovery test
test_recovery() {
    echo -e "${BLUE}=== Testing Recovery ===${NC}"
    
    # Kill all PgBouncer containers
    echo -e "${YELLOW}Stopping all PgBouncer containers...${NC}"
    local failure_start=$(date +%s%3N)
    docker stop "${PRIMARY_CONTAINER}" "${SECONDARY_CONTAINER}" "${TERTIARY_CONTAINER}" >/dev/null 2>&1
    
    sleep 5
    
    # Restart containers one by one
    echo -e "${YELLOW}Restarting primary container...${NC}"
    docker start "${PRIMARY_CONTAINER}" >/dev/null 2>&1
    local primary_start=$(date +%s%3N)
    
    # Wait for primary to be healthy
    sleep 10
    if wait_for_failover "primary"; then
        local recovery_complete=$(date +%s%3N)
        echo -e "${GREEN}Primary recovery successful${NC}"
        
        # Restart other containers
        docker start "${SECONDARY_CONTAINER}" "${TERTIARY_CONTAINER}" >/dev/null 2>&1
        sleep 10
        
        local full_recovery=$(date +%s%3N)
        log_metrics "full_recovery" "$failure_start" "$primary_start" "$recovery_complete" "$full_recovery"
    else
        echo -e "${RED}Recovery failed${NC}"
        return 1
    fi
}

# Generate final report
generate_report() {
    local report_file="${RESULTS_DIR}/chaos-test-report-${TIMESTAMP}.md"
    
    cat > "${report_file}" << EOF
# PgBouncer Chaos Test Report

**Test Date:** $(date -Iseconds)
**Base URL:** ${BASE_URL}

## Summary

$(jq -r '
.scenarios[] | 
"### \(.scenario | gsub("_"; " ") | ascii_upcase)
- **Detection Time:** \(.durations_ms.detection)ms
- **Failover Time:** \(.durations_ms.failover)ms  
- **Total MTTR:** \(.durations_ms.total_mttr)ms
- **Success:** \(if .durations_ms.total_mttr < 5000 then "✅ PASS" else "❌ FAIL" end)
"
' "${METRICS_FILE}")

## Success Criteria Analysis

$(jq -r '
[.scenarios[].durations_ms.total_mttr] as $mttrs |
($mttrs | add / length) as $avg_mttr |
"- **Average MTTR:** \($avg_mttr | floor)ms
- **Target MTTR:** < 5000ms  
- **Overall Result:** \(if $avg_mttr < 5000 then "✅ PASS" else "❌ FAIL" end)"
' "${METRICS_FILE}")

## Detailed Metrics

\`\`\`json
$(cat "${METRICS_FILE}")
\`\`\`
EOF

    echo -e "${GREEN}Report generated: ${report_file}${NC}"
}

# Main execution
main() {
    local scenario="${1:-all}"
    
    init_metrics
    
    case $scenario in
        "single")
            test_single_failure
            ;;
        "cascading")
            test_cascading_failure
            ;;
        "recovery")
            test_recovery
            ;;
        "all")
            test_single_failure
            test_cascading_failure  
            test_recovery
            ;;
        *)
            echo -e "${RED}Unknown scenario: ${scenario}${NC}"
            echo "Available scenarios: single, cascading, recovery, all"
            exit 1
            ;;
    esac
    
    generate_report
    
    echo -e "${GREEN}Chaos testing completed!${NC}"
    echo -e "${YELLOW}Results saved to: ${RESULTS_DIR}${NC}"
}

# Check prerequisites
check_prerequisites() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: docker is not installed${NC}"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq is not installed${NC}"
        exit 1
    fi
    
    if ! curl -s "${BASE_URL}/monitoring/health" > /dev/null; then
        echo -e "${RED}Error: Server at ${BASE_URL} is not responding${NC}"
        exit 1
    fi
}

# Run checks and execute main function
check_prerequisites
main "$@"