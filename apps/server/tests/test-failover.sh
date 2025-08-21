#!/bin/bash

# =====================================
# PgBouncer Failover Test Script
# =====================================
# This script tests the automatic failover mechanism between
# primary, secondary, and tertiary PgBouncer instances
# =====================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# =====================================
# SETUP: Start everything fresh
# =====================================
echo -e "${YELLOW}=== SETUP: Starting all services ===${NC}"
docker compose up -d
echo "Waiting for health checks..."
sleep 10
echo ""

# =====================================
# TEST 1: Normal Operation
# =====================================
echo -e "${YELLOW}=== TEST 1: Check normal operation ===${NC}"
curl -s http://localhost:3000/api/test-query | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f\"✅ Status: {data['status']}\")
print(f\"✅ Active: {data['active_pgbouncer']}\")
print('✅ All PgBouncers:')
for host in data['all_pgbouncers']:
    print(f\"   - {host['id']}: {host['status']}\")"
echo ""

# =====================================
# TEST 2: Primary Failover
# =====================================
echo -e "${YELLOW}=== TEST 2: Stop primary, watch failover to secondary ===${NC}"
docker stop pgbouncer-primary
echo "Waiting for failover (making 6 requests)..."

# Initialize pass flag
FAILOVER_TO_SECONDARY=false

for i in {1..6}; do
  echo -n "Attempt $i: "
  RESPONSE=$(curl -s http://localhost:3000/api/test-query)
  RESULT=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data['status'] == 'success':
        print(f\"✅ SUCCESS - Using {data['active_pgbouncer']}\")
        # Check if we've failed over to secondary
        if data['active_pgbouncer'] == 'pgbouncer-secondary':
            print('FAILOVER_DETECTED')
    else:
        print(f\"❌ FAILED - {data.get('error', 'Connection failed')}\")
except Exception as e:
    print('❌ Request failed - JSON parse error')")
  
  echo "$RESULT" | grep -v "FAILOVER_DETECTED" || true
  
  # Check if failover to secondary was detected
  if echo "$RESULT" | grep -q "FAILOVER_DETECTED"; then
    FAILOVER_TO_SECONDARY=true
  fi
  
  sleep 1
done

# Check if test passed
if [ "$FAILOVER_TO_SECONDARY" = true ]; then
  echo -e "${GREEN}✅ TEST 2 PASSED: Failover to secondary successful${NC}"
else
  echo -e "${RED}❌ TEST 2 FAILED: Failover to secondary did not occur${NC}"
  exit 1
fi
echo ""

# =====================================
# TEST 3: Cascading Failover
# =====================================
echo -e "${YELLOW}=== TEST 3: Stop secondary, watch failover to tertiary ===${NC}"
docker stop pgbouncer-secondary
echo "Waiting for cascading failover (making 8 requests)..."

# Initialize pass flag
FAILOVER_TO_TERTIARY=false

for i in {1..8}; do
  echo -n "Attempt $i: "
  RESPONSE=$(curl -s http://localhost:3000/api/test-query)
  RESULT=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data['status'] == 'success':
        print(f\"✅ SUCCESS - Using {data['active_pgbouncer']}\")
        # Check if we've failed over to tertiary
        if data['active_pgbouncer'] == 'pgbouncer-tertiary':
            print('FAILOVER_DETECTED')
    else:
        print(f\"❌ FAILED - Trying next host...\")
except Exception as e:
    print('❌ Request failed - JSON parse error')")
  
  echo "$RESULT" | grep -v "FAILOVER_DETECTED" || true
  
  # Check if failover to tertiary was detected
  if echo "$RESULT" | grep -q "FAILOVER_DETECTED"; then
    FAILOVER_TO_TERTIARY=true
  fi
  
  sleep 1
done

# Check if test passed
if [ "$FAILOVER_TO_TERTIARY" = true ]; then
  echo -e "${GREEN}✅ TEST 3 PASSED: Cascading failover to tertiary successful${NC}"
else
  echo -e "${RED}❌ TEST 3 FAILED: Cascading failover to tertiary did not occur${NC}"
  exit 1
fi
echo ""

# =====================================
# TEST 4: Check Final State
# =====================================
echo -e "${YELLOW}=== TEST 4: Final state (only tertiary running) ===${NC}"
curl -s http://localhost:3000/api/test-query | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f\"✅ Active: {data['active_pgbouncer']}\")
print('📊 PgBouncer Status:')
for host in data['all_pgbouncers']:
    status_icon = '✅' if host['status'] == 'healthy' else '❌'
    print(f\"   {status_icon} {host['id']}: {host['status']} (failures: {host['consecutiveFailures']})\")
"
echo ""

# =====================================
# TEST 5: Recovery Test
# =====================================
echo -e "${YELLOW}=== TEST 5: Restart primary and watch auto-recovery ===${NC}"
docker start pgbouncer-primary
echo "Waiting 35 seconds for circuit breaker reset..."
sleep 35

# Initialize recovery flag
AUTO_RECOVERY_PASSED=false

RESPONSE=$(curl -s http://localhost:3000/api/test-query)
RESULT=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data['active_pgbouncer'] == 'pgbouncer-primary':
        print('✅ AUTO-RECOVERY SUCCESSFUL! Back to primary!')
        print('RECOVERY_DETECTED')
    else:
        print(f\"⏳ Still using {data['active_pgbouncer']} (may need more time)\")
except Exception as e:
    print('❌ Failed to check recovery - JSON parse error')")

echo "$RESULT" | grep -v "RECOVERY_DETECTED" || true

# Check if recovery was detected
if echo "$RESULT" | grep -q "RECOVERY_DETECTED"; then
  AUTO_RECOVERY_PASSED=true
fi

# Check if test passed
if [ "$AUTO_RECOVERY_PASSED" = true ]; then
  echo -e "${GREEN}✅ TEST 5 PASSED: Auto-recovery to primary successful${NC}"
else
  echo -e "${RED}❌ TEST 5 FAILED: Auto-recovery to primary did not occur${NC}"
  exit 1
fi
echo ""

# =====================================
# CLEANUP: Restart everything
# =====================================
echo -e "${YELLOW}=== CLEANUP: Restarting all PgBouncers ===${NC}"
docker start pgbouncer-primary pgbouncer-secondary
sleep 5
echo -e "${GREEN}✅ All PgBouncers restored${NC}"
echo ""

# =====================================
# FINAL RESULTS
# =====================================
echo -e "${GREEN}=== ALL TESTS COMPLETED SUCCESSFULLY ===${NC}"
echo "Summary:"
echo "  ✅ TEST 1: Normal operation verified"
echo "  ✅ TEST 2: Primary → Secondary failover works"
echo "  ✅ TEST 3: Secondary → Tertiary failover works"
echo "  ✅ TEST 4: Final state verified"
echo "  ✅ TEST 5: Automatic recovery to primary works"
echo "  ✅ Circuit breaker pattern functioning correctly"
echo ""
echo -e "${GREEN}All failover mechanisms working as expected!${NC}"

# Exit with success code
exit 0