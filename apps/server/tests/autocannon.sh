#!/bin/bash
# failover-test.sh

# Start continuous load
autocannon -c 10000 -d 55 http://localhost:3000/api/health/db &
LOAD_PID=$!

sleep 10

# Kill PgBouncer instances one by one
echo "Killing PgBouncer 1..."
docker kill pgb1  # or however you stop it

sleep 10

echo "Killing PgBouncer 2..."
docker kill pgb2

sleep 10

echo "Killing PgBouncer 3..."
docker kill pgb3

sleep 5

echo "Starting PgBouncer 1..."
docker start pgb1

sleep 10

echo "Starting PgBouncer 2..."
docker start pgb2

sleep 10

echo "Starting PgBouncer 3..."
docker start pgb3

kill $LOAD_PID

# Example output
# Running 55s test @ http://localhost:3000/api/health/db
# 10000 connections

# running [===                 ] 16%Killing PgBouncer 1...
# pgb1
# running [=======             ] 34%Killing PgBouncer 2...
# pgb2
# running [===========         ] 52%Killing PgBouncer 3...
# running [===========         ] 54%pgb3
# running [=============       ] 63%Starting PgBouncer 1...
# pgb1
# running [================    ] 81%Starting PgBouncer 2...
# pgb2

# ┌─────────┬───────┬────────┬─────────┬─────────┬────────────┬────────────┬──────────┐
# │ Stat    │ 2.5%  │ 50%    │ 97.5%   │ 99%     │ Avg        │ Stdev      │ Max      │
# ├─────────┼───────┼────────┼─────────┼─────────┼────────────┼────────────┼──────────┤
# │ Latency │ 92 ms │ 780 ms │ 5548 ms │ 8849 ms │ 1147.91 ms │ 1322.87 ms │ 15719 ms │
# └─────────┴───────┴────────┴─────────┴─────────┴────────────┴────────────┴──────────┘
# ┌───────────┬─────────┬────────┬────────┬─────────┬───────────┬──────────┬─────────┐
# │ Stat      │ 1%      │ 2.5%   │ 50%    │ 97.5%   │ Avg       │ Stdev    │ Min     │
# ├───────────┼─────────┼────────┼────────┼─────────┼───────────┼──────────┼─────────┤
# │ Req/Sec   │ 3,493   │ 3,519  │ 12,687 │ 18,303  │ 12,297.82 │ 2,870.48 │ 3,493   │
# ├───────────┼─────────┼────────┼────────┼─────────┼───────────┼──────────┼─────────┤
# │ Bytes/Sec │ 2.04 MB │ 2.4 MB │ 8.4 MB │ 9.32 MB │ 7.6 MB    │ 1.71 MB  │ 2.04 MB │
# └───────────┴─────────┴────────┴────────┴─────────┴───────────┴──────────┴─────────┘

# Req/Bytes counts sampled once per second.
# # of samples: 55

# 526813 2xx responses, 149532 non 2xx responses
# 716k requests in 55.37s, 418 MB read
# 20k errors (10k timeouts)
# Starting PgBouncer 3...
# pgb3
# ./apps/server/tests/autocannon.sh: line 39: kill: (246709) - No such process