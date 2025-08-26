#!/bin/bash
# failover-test.sh

# Start continuous load
autocannon -c 10500 -d 300 http://localhost:3000/api/health/db &
LOAD_PID=$!

sleep 10

# Kill PgBouncer instances one by one
echo "Killing PgBouncer 1..."
docker kill pgb1  # or however you stop it

sleep 30

echo "Killing PgBouncer 2..."
docker kill pgb2

sleep 30

echo "Killing PgBouncer 3..."
docker kill pgb3

sleep 5

echo "Starting PgBouncer 1..."
docker start pgb1

sleep 30

echo "Starting PgBouncer 2..."
docker start pgb2

sleep 30

echo "Starting PgBouncer 3..."
docker start pgb3

kill $LOAD_PID