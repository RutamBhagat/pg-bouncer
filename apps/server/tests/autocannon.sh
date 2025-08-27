#!/bin/bash
# failover-test.sh

# Start continuous load
# Realistic
autocannon -c 200 -d 55 http://localhost:3000/api/health/db &
# Peak stress test
# autocannon -c 10000 -d 55 http://localhost:3000/api/health/db &
LOAD_PID=$!

docker start pgb1 pgb2 pgb3

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


# Example output
# ➜  pgbouncer-csf git:(feat/simple-circuit-breaker) ✗ ./apps/server/tests/autocannon.sh
# pgb1
# pgb2
# pgb3
# Running 55s test @ http://localhost:3000/api/health/db
# 200 connections

# running [===                 ] 16%Killing PgBouncer 1...
# running [====                ] 18%pgb1
# running [=======             ] 36%Killing PgBouncer 2...
# pgb2
# running [===========         ] 54%Killing PgBouncer 3...
# pgb3
# running [=============       ] 63%Starting PgBouncer 1...
# pgb1
# running [================    ] 81%Starting PgBouncer 2...
# pgb2

# ┌─────────┬──────┬──────┬───────┬───────┬─────────┬─────────┬────────┐
# │ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%   │ Avg     │ Stdev   │ Max    │
# ├─────────┼──────┼──────┼───────┼───────┼─────────┼─────────┼────────┤
# │ Latency │ 8 ms │ 9 ms │ 13 ms │ 18 ms │ 9.34 ms │ 4.68 ms │ 414 ms │
# └─────────┴──────┴──────┴───────┴───────┴─────────┴─────────┴────────┘
# ┌───────────┬─────────┬─────────┬─────────┬─────────┬──────────┬─────────┬─────────┐
# │ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg      │ Stdev   │ Min     │
# ├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼─────────┼─────────┤
# │ Req/Sec   │ 10,343  │ 15,207  │ 20,655  │ 22,319  │ 20,263.2 │ 1,850.5 │ 10,341  │
# ├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼─────────┼─────────┤
# │ Bytes/Sec │ 5.77 MB │ 7.08 MB │ 14.1 MB │ 14.9 MB │ 13.2 MB  │ 2.2 MB  │ 5.76 MB │
# └───────────┴─────────┴─────────┴─────────┴─────────┴──────────┴─────────┴─────────┘

# Req/Bytes counts sampled once per second.
# # of samples: 55

# 987344 2xx responses, 127099 non 2xx responses
# 1115k requests in 55.02s, 724 MB read