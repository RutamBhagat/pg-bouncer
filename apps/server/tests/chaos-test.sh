#!/bin/bash

# PgBouncer Chaos Testing Script
# Tests failover scenarios and measures MTTR (Mean Time To Recovery)

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
SCENARIO="${1:-single}"

# Container names
PRIMARY_CONTAINER="pgbouncer-primary"
SECONDARY_CONTAINER="pgbouncer-secondary"
TERTIARY_CONTAINER="pgbouncer-tertiary"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== PgBouncer Chaos Testing ===${NC}"
echo -e "${YELLOW}Scenario: ${SCENARIO}${NC}"
echo -e "${YELLOW}Base URL: ${BASE_URL}${NC}"

# Check prerequisites
check_prerequisites() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: docker is not installed${NC}"
        exit 1
    fi
    
    if ! curl -s "${BASE_URL}/monitoring/health" > /dev/null; then
        echo -e "${RED}Error: Server at ${BASE_URL} is not responding${NC}"
        exit 1
    fi
}

# Get current active instance
get_active_instance() {
    curl -s "${BASE_URL}/api/test-query" | jq -r '.activeInstance' 2>/dev/null || echo "unknown"
}

# Wait for system to be healthy on specific instance
wait_for_healthy() {
    local expected_instance="$1"
    local timeout=30
    local count=0
    
    echo -e "${YELLOW}Waiting for system to be healthy on ${expected_instance}...${NC}"
    
    while [[ $count -lt $timeout ]]; do
        local current_instance=$(get_active_instance)
        if [[ "$current_instance" == "$expected_instance" ]]; then
            echo -e "${GREEN}System healthy on ${expected_instance}${NC}"
            return 0
        fi
        sleep 1
        ((count++))
    done
    
    echo -e "${RED}Timeout waiting for ${expected_instance} to be healthy${NC}"
    return 1
}

# Test single instance failure
test_single_failure() {
    echo -e "${BLUE}=== Testing Single Instance Failure ===${NC}"
    
    # Ensure all containers are running
    docker start "${PRIMARY_CONTAINER}" "${SECONDARY_CONTAINER}" "${TERTIARY_CONTAINER}" >/dev/null 2>&1 || true
    sleep 5
    
    local initial_instance=$(get_active_instance)
    echo -e "${YELLOW}Initial active instance: ${initial_instance}${NC}"
    
    # Record failure start time
    local failure_start=$(date +%s%3N)
    echo -e "${YELLOW}Killing primary container at $(date)${NC}"
    
    # Kill primary container
    docker stop "${PRIMARY_CONTAINER}" >/dev/null 2>&1
    
    # Wait for failover to secondary
    if wait_for_healthy "secondary"; then
        local failover_complete=$(date +%s%3N)
        local mttr=$((failover_complete - failure_start))
        
        echo -e "${GREEN}Failover successful in ${mttr}ms${NC}"
        
        # Restart primary
        echo -e "${YELLOW}Restarting primary container...${NC}"
        docker start "${PRIMARY_CONTAINER}" >/dev/null 2>&1
        sleep 10
        
        # Check if primary rejoins
        local final_instance=$(get_active_instance)
        echo -e "${YELLOW}Final active instance: ${final_instance}${NC}"
        
        # Output results
        echo -e "${BLUE}=== Single Failure Results ===${NC}"
        echo "MTTR: ${mttr}ms"
        echo "Target: < 5000ms"
        
        if [[ $mttr -lt 5000 ]]; then
            echo -e "${GREEN}RESULT: PASS${NC}"
            return 0
        else
            echo -e "${RED}RESULT: FAIL (MTTR too high)${NC}"
            return 1
        fi
    else
        echo -e "${RED}Failover failed${NC}"
        return 1
    fi
}

# Test cascading failures
test_cascading_failure() {
    echo -e "${BLUE}=== Testing Cascading Failure ===${NC}"
    
    # Ensure all containers are running
    docker start "${PRIMARY_CONTAINER}" "${SECONDARY_CONTAINER}" "${TERTIARY_CONTAINER}" >/dev/null 2>&1 || true
    sleep 5
    
    echo -e "${YELLOW}Initial state: $(get_active_instance)${NC}"
    
    # Kill primary
    local start_time=$(date +%s%3N)
    echo -e "${YELLOW}Killing primary container...${NC}"
    docker stop "${PRIMARY_CONTAINER}" >/dev/null 2>&1
    
    # Wait for failover to secondary
    if wait_for_healthy "secondary"; then
        local secondary_active=$(date +%s%3N)
        local first_failover=$((secondary_active - start_time))
        echo -e "${GREEN}First failover completed in ${first_failover}ms${NC}"
        
        # Kill secondary after brief delay
        sleep 5
        echo -e "${YELLOW}Killing secondary container...${NC}"
        docker stop "${SECONDARY_CONTAINER}" >/dev/null 2>&1
        
        # Wait for failover to tertiary
        if wait_for_healthy "tertiary"; then
            local tertiary_active=$(date +%s%3N)
            local total_time=$((tertiary_active - start_time))
            
            echo -e "${GREEN}Cascading failover completed${NC}"
            
            # Restart all containers
            echo -e "${YELLOW}Restarting all containers...${NC}"
            docker start "${PRIMARY_CONTAINER}" "${SECONDARY_CONTAINER}" >/dev/null 2>&1
            sleep 15
            
            echo -e "${BLUE}=== Cascading Failure Results ===${NC}"
            echo "First failover: ${first_failover}ms"
            echo "Total cascade time: ${total_time}ms"
            echo "Target: < 10000ms total"
            
            if [[ $total_time -lt 10000 ]]; then
                echo -e "${GREEN}RESULT: PASS${NC}"
                return 0
            else
                echo -e "${RED}RESULT: FAIL (cascade too slow)${NC}"
                return 1
            fi
        else
            echo -e "${RED}Second failover failed${NC}"
            return 1
        fi
    else
        echo -e "${RED}First failover failed${NC}"
        return 1
    fi
}

# Test network partition simulation
test_network_partition() {
    echo -e "${BLUE}=== Testing Network Partition ===${NC}"
    
    # Get primary container port
    local primary_port=$(docker port "${PRIMARY_CONTAINER}" 5432 | cut -d':' -f2)
    
    echo -e "${YELLOW}Simulating network partition on port ${primary_port}...${NC}"
    
    # Block traffic to primary port (requires sudo)
    if command -v iptables &> /dev/null && [[ $EUID -eq 0 ]]; then
        local start_time=$(date +%s%3N)
        
        # Block outbound connections to primary
        iptables -A OUTPUT -p tcp --dport "${primary_port}" -j DROP
        
        # Wait for failover detection
        if wait_for_healthy "secondary"; then
            local failover_time=$(date +%s%3N)
            local mttr=$((failover_time - start_time))
            
            # Restore network
            iptables -D OUTPUT -p tcp --dport "${primary_port}" -j DROP
            sleep 10
            
            echo -e "${BLUE}=== Network Partition Results ===${NC}"
            echo "Network failover time: ${mttr}ms"
            
            if [[ $mttr -lt 5000 ]]; then
                echo -e "${GREEN}RESULT: PASS${NC}"
                return 0
            else
                echo -e "${RED}RESULT: FAIL${NC}"
                return 1
            fi
        else
            # Clean up
            iptables -D OUTPUT -p tcp --dport "${primary_port}" -j DROP 2>/dev/null || true
            echo -e "${RED}Network partition test failed${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}Skipping network partition test (requires root/iptables)${NC}"
        return 0
    fi
}

# Test recovery scenario
test_recovery() {
    echo -e "${BLUE}=== Testing Full Recovery ===${NC}"
    
    # Kill all PgBouncer containers
    echo -e "${YELLOW}Stopping all PgBouncer containers...${NC}"
    docker stop "${PRIMARY_CONTAINER}" "${SECONDARY_CONTAINER}" "${TERTIARY_CONTAINER}" >/dev/null 2>&1
    sleep 5
    
    # Start primary first
    local start_time=$(date +%s%3N)
    echo -e "${YELLOW}Starting primary container...${NC}"
    docker start "${PRIMARY_CONTAINER}" >/dev/null 2>&1
    
    # Wait for primary to be healthy
    if wait_for_healthy "primary"; then
        local recovery_time=$(date +%s%3N)
        local mttr=$((recovery_time - start_time))
        
        # Start other containers
        docker start "${SECONDARY_CONTAINER}" "${TERTIARY_CONTAINER}" >/dev/null 2>&1
        sleep 10
        
        echo -e "${BLUE}=== Recovery Results ===${NC}"
        echo "Recovery time: ${mttr}ms"
        echo "Target: < 10000ms"
        
        if [[ $mttr -lt 10000 ]]; then
            echo -e "${GREEN}RESULT: PASS${NC}"
            return 0
        else
            echo -e "${RED}RESULT: FAIL${NC}"
            return 1
        fi
    else
        echo -e "${RED}Recovery test failed${NC}"
        return 1
    fi
}

# Main execution
main() {
    check_prerequisites
    
    case $SCENARIO in
        "single")
            test_single_failure
            ;;
        "cascading")
            test_cascading_failure
            ;;
        "network")
            test_network_partition
            ;;
        "recovery")
            test_recovery
            ;;
        "all")
            test_single_failure
            echo ""
            test_cascading_failure
            echo ""
            test_recovery
            ;;
        *)
            echo -e "${RED}Unknown scenario: ${SCENARIO}${NC}"
            echo "Available scenarios: single, cascading, network, recovery, all"
            exit 1
            ;;
    esac
}

# Show usage
if [[ "${1}" == "--help" || "${1}" == "-h" ]]; then
    echo "Usage: $0 [scenario]"
    echo ""
    echo "Scenarios:"
    echo "  single     - Test primary instance failure (default)"
    echo "  cascading  - Test multiple consecutive failures"
    echo "  network    - Test network partition simulation"
    echo "  recovery   - Test full system recovery"
    echo "  all        - Run all scenarios"
    echo ""
    echo "Environment:"
    echo "  BASE_URL   - API server URL (default: http://localhost:3000)"
    exit 0
fi

# Run main function
main "$@"
