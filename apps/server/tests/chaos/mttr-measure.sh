#!/bin/bash

# MTTR (Mean Time To Recovery) Measurement Script
# Continuously monitors PgBouncer health and measures recovery times

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
INTERVAL="${INTERVAL:-1}"
OUTPUT_FILE="${OUTPUT_FILE:-/tmp/mttr-monitor.log}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# State tracking
LAST_STATUS=""
FAILURE_START=""
FAILURE_DETECTED=""
RECOVERY_START=""

echo -e "${BLUE}=== MTTR Monitor Started ===${NC}"
echo -e "${YELLOW}Monitoring: ${BASE_URL}${NC}"
echo -e "${YELLOW}Interval: ${INTERVAL}s${NC}"
echo -e "${YELLOW}Output: ${OUTPUT_FILE}${NC}"

# Initialize log file
cat > "${OUTPUT_FILE}" << EOF
# MTTR Monitoring Log
# Format: timestamp,status,active_instance,response_time_ms,event
$(date -Iseconds),MONITOR_START,unknown,0,monitor_started
EOF

# Get current status
get_status() {
    local start_time=$(date +%s%3N)
    local response
    local status="FAILED"
    local active_instance="unknown"
    local response_time=0
    
    if response=$(curl -s --max-time 5 "${BASE_URL}/api/test-query" 2>/dev/null); then
        if echo "$response" | jq -e '.data' >/dev/null 2>&1; then
            status="HEALTHY"
            active_instance=$(echo "$response" | jq -r '.activeInstance // "unknown"')
        fi
    fi
    
    local end_time=$(date +%s%3N)
    response_time=$((end_time - start_time))
    
    echo "${status},${active_instance},${response_time}"
}

# Log event with timestamp
log_event() {
    local status="$1"
    local instance="$2" 
    local response_time="$3"
    local event="$4"
    
    local timestamp=$(date -Iseconds)
    local epoch_ms=$(date +%s%3N)
    
    echo "${timestamp},${status},${instance},${response_time},${event}" >> "${OUTPUT_FILE}"
    
    # Console output
    case $event in
        "failure_detected")
            echo -e "${RED}[${timestamp}] FAILURE DETECTED - Instance: ${instance} (${response_time}ms)${NC}"
            ;;
        "recovery_started") 
            echo -e "${YELLOW}[${timestamp}] RECOVERY STARTED - Instance: ${instance} (${response_time}ms)${NC}"
            ;;
        "recovery_complete")
            echo -e "${GREEN}[${timestamp}] RECOVERY COMPLETE - Instance: ${instance} (${response_time}ms)${NC}"
            ;;
        "status_change")
            echo -e "${BLUE}[${timestamp}] STATUS CHANGE - ${status} on ${instance} (${response_time}ms)${NC}"
            ;;
        *)
            echo -e "[${timestamp}] ${event} - ${status} on ${instance} (${response_time}ms)"
            ;;
    esac
}

# Calculate MTTR for completed failure/recovery cycle
calculate_mttr() {
    local failure_start="$1"
    local recovery_complete="$2"
    
    local mttr=$((recovery_complete - failure_start))
    echo -e "${GREEN}=== MTTR CALCULATED ===${NC}"
    echo -e "${YELLOW}Failure Start: $(date -d @$((failure_start/1000)) -Iseconds)${NC}"
    echo -e "${YELLOW}Recovery Complete: $(date -d @$((recovery_complete/1000)) -Iseconds)${NC}"
    echo -e "${GREEN}MTTR: ${mttr}ms${NC}"
    
    # Log MTTR event
    log_event "MTTR_CALCULATED" "system" "$mttr" "mttr_complete"
    
    # Check if MTTR meets target
    if [[ $mttr -lt 5000 ]]; then
        echo -e "${GREEN}✅ MTTR meets target (<5000ms)${NC}"
    else
        echo -e "${RED}❌ MTTR exceeds target (>5000ms)${NC}"
    fi
}

# Signal handler for graceful shutdown
cleanup() {
    echo -e "${YELLOW}Shutting down MTTR monitor...${NC}"
    log_event "MONITOR_STOP" "unknown" "0" "monitor_stopped"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Main monitoring loop
while true; do
    IFS=',' read -r current_status current_instance response_time <<< "$(get_status)"
    current_time=$(date +%s%3N)
    
    # State machine for failure/recovery detection
    case "${LAST_STATUS}" in
        "")
            # First run - establish baseline
            LAST_STATUS="$current_status"
            log_event "$current_status" "$current_instance" "$response_time" "initial_status"
            ;;
        "HEALTHY")
            if [[ "$current_status" == "FAILED" ]]; then
                # Failure detected
                FAILURE_START="$current_time"
                FAILURE_DETECTED="$current_time" 
                log_event "$current_status" "$current_instance" "$response_time" "failure_detected"
            elif [[ "$current_status" == "HEALTHY" ]]; then
                # Still healthy - check for instance change
                if [[ -n "$LAST_INSTANCE" && "$current_instance" != "$LAST_INSTANCE" ]]; then
                    log_event "$current_status" "$current_instance" "$response_time" "instance_change"
                fi
            fi
            ;;
        "FAILED")
            if [[ "$current_status" == "HEALTHY" ]]; then
                # Recovery detected
                RECOVERY_START="$current_time"
                log_event "$current_status" "$current_instance" "$response_time" "recovery_complete"
                
                # Calculate MTTR if we have a failure start time
                if [[ -n "$FAILURE_START" ]]; then
                    calculate_mttr "$FAILURE_START" "$current_time"
                    FAILURE_START=""
                    FAILURE_DETECTED=""
                fi
            fi
            ;;
    esac
    
    LAST_STATUS="$current_status"
    LAST_INSTANCE="$current_instance"
    
    sleep "$INTERVAL"
done