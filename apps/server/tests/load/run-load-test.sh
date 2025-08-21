#!/bin/bash

# PgBouncer Load Testing Script
# Usage: ./run-load-test.sh [scenario] [base_url]
# Scenarios: normal, spike, stress, soak, failover

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${2:-http://localhost:3000}"
SCENARIO="${1:-normal}"
RESULTS_DIR="${SCRIPT_DIR}/../results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== PgBouncer Load Testing Suite ===${NC}"
echo -e "${YELLOW}Scenario: ${SCENARIO}${NC}"
echo -e "${YELLOW}Base URL: ${BASE_URL}${NC}"
echo -e "${YELLOW}Results will be saved to: ${RESULTS_DIR}${NC}"

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}Error: k6 is not installed${NC}"
    echo "Please install k6 from https://k6.io/docs/getting-started/installation/"
    exit 1
fi

# Check if server is running
echo -e "${BLUE}Checking server availability...${NC}"
if ! curl -s "${BASE_URL}/monitoring/health" > /dev/null; then
    echo -e "${RED}Error: Server at ${BASE_URL} is not responding${NC}"
    echo "Please ensure the server is running with: pnpm db:start && pnpm dev:server"
    exit 1
fi

# Create results directory
mkdir -p "${RESULTS_DIR}"

# Define scenario configurations
case $SCENARIO in
    "normal")
        STAGES='[{"duration":"30s","target":100},{"duration":"2m","target":100},{"duration":"30s","target":0}]'
        ;;
    "spike")
        STAGES='[{"duration":"10s","target":50},{"duration":"5s","target":400},{"duration":"1m","target":400},{"duration":"30s","target":0}]'
        ;;
    "stress")
        STAGES='[{"duration":"1m","target":200},{"duration":"1m","target":400},{"duration":"1m","target":500},{"duration":"2m","target":500},{"duration":"1m","target":0}]'
        ;;
    "soak")
        STAGES='[{"duration":"30s","target":200},{"duration":"10m","target":200},{"duration":"30s","target":0}]'
        ;;
    "failover")
        STAGES='[{"duration":"30s","target":400},{"duration":"2m","target":400},{"duration":"1m","target":400},{"duration":"30s","target":0}]'
        ;;
    *)
        echo -e "${RED}Unknown scenario: ${SCENARIO}${NC}"
        echo "Available scenarios: normal, spike, stress, soak, failover"
        exit 1
        ;;
esac

# Prepare k6 options
K6_OPTIONS=$(cat <<EOF
{
  "stages": ${STAGES},
  "thresholds": {
    "http_req_duration": ["p(95)<500"],
    "http_req_failed": ["rate<0.01"],
    "errors": ["rate<0.01"]
  }
}
EOF
)

# Run the test
echo -e "${GREEN}Starting ${SCENARIO} load test...${NC}"
echo "Test configuration: ${K6_OPTIONS}"

RESULT_FILE="${RESULTS_DIR}/k6-${SCENARIO}-${TIMESTAMP}.json"
HTML_REPORT="${RESULTS_DIR}/k6-${SCENARIO}-${TIMESTAMP}.html"

k6 run \
  --env BASE_URL="${BASE_URL}" \
  --out json="${RESULT_FILE}" \
  --summary-export="${RESULTS_DIR}/summary-${SCENARIO}-${TIMESTAMP}.json" \
  "${SCRIPT_DIR}/k6-pgbouncer-test.ts" \
  <<< "${K6_OPTIONS}"

echo -e "${GREEN}Test completed!${NC}"
echo -e "${YELLOW}Results saved to:${NC}"
echo "  - JSON: ${RESULT_FILE}"
echo "  - Summary: ${RESULTS_DIR}/summary-${SCENARIO}-${TIMESTAMP}.json"

# Display quick summary
if [[ -f "${RESULTS_DIR}/k6-summary.json" ]]; then
    echo -e "${BLUE}Quick Summary:${NC}"
    cat "${RESULTS_DIR}/k6-summary.json" | jq -r '
        "Duration: \(.duration)ms",
        "Iterations: \(.iterations)",
        "Error Rate: \(.error_rate * 100)%",
        "P95 Response Time: \(.http_req_duration_p95)ms",
        "Failovers Detected: \(.failovers_detected)"
    '
fi

echo -e "${GREEN}Load test completed successfully!${NC}"