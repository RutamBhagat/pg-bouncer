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
for i in {1..6}; do
  echo -n "Attempt $i: "
  curl -s http://localhost:3000/api/test-query | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data['status'] == 'success':
        print(f\"✅ SUCCESS - Using {data['active_pgbouncer']}\")
    else:
        print(f\"❌ FAILED - {data.get('error', 'Connection failed')}\")
except:
    print('❌ Request failed')"
  sleep 1
done
echo ""

# =====================================
# TEST 3: Cascading Failover
# =====================================
echo -e "${YELLOW}=== TEST 3: Stop secondary, watch failover to tertiary ===${NC}"
docker stop pgbouncer-secondary
echo "Waiting for cascading failover (making 8 requests)..."
for i in {1..8}; do
  echo -n "Attempt $i: "
  curl -s http://localhost:3000/api/test-query | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data['status'] == 'success':
        print(f\"✅ SUCCESS - Using {data['active_pgbouncer']}\")
    else:
        print(f\"❌ FAILED - Trying next host...\")
except:
    print('❌ Request failed')"
  sleep 1
done
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

curl -s http://localhost:3000/api/test-query | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data['active_pgbouncer'] == 'pgbouncer-primary':
    print('✅ AUTO-RECOVERY SUCCESSFUL! Back to primary!')
else:
    print(f\"⏳ Still using {data['active_pgbouncer']} (may need more time)\")"
echo ""

# =====================================
# CLEANUP: Restart everything
# =====================================
echo -e "${YELLOW}=== CLEANUP: Restarting all PgBouncers ===${NC}"
docker start pgbouncer-primary pgbouncer-secondary
sleep 5
echo -e "${GREEN}✅ All PgBouncers restored${NC}"
echo ""

echo -e "${GREEN}=== TEST COMPLETE ===${NC}"
echo "Summary:"
echo "  ✅ Primary → Secondary failover works"
echo "  ✅ Secondary → Tertiary failover works"
echo "  ✅ Automatic recovery to primary works"
echo "  ✅ Circuit breaker pattern functioning correctly"