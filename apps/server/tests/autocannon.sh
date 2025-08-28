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

# Remove this to test total outage
# echo "Killing PgBouncer 3..."
# docker kill pgb3

# sleep 5

echo "Starting PgBouncer 1..."
docker start pgb1

sleep 10

echo "Starting PgBouncer 2..."
docker start pgb2

# sleep 10

# Remove this to test total outage
# echo "Starting PgBouncer 3..."
# docker start pgb3


# Example output
# ┌─────────┬──────┬───────┬───────┬───────┬──────────┬─────────┬────────┐
# │ Stat    │ 2.5% │ 50%   │ 97.5% │ 99%   │ Avg      │ Stdev   │ Max    │
# ├─────────┼──────┼───────┼───────┼───────┼──────────┼─────────┼────────┤
# │ Latency │ 9 ms │ 10 ms │ 14 ms │ 16 ms │ 10.33 ms │ 4.49 ms │ 249 ms │
# └─────────┴──────┴───────┴───────┴───────┴──────────┴─────────┴────────┘
# ┌───────────┬─────────┬─────────┬─────────┬─────────┬──────────┬──────────┬─────────┐
# │ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg      │ Stdev    │ Min     │
# ├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼──────────┼─────────┤
# │ Req/Sec   │ 12,735  │ 14,895  │ 18,543  │ 19,759  │ 18,401.9 │ 1,203.41 │ 12,731  │
# ├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼──────────┼─────────┤
# │ Bytes/Sec │ 7.67 MB │ 8.97 MB │ 11.2 MB │ 11.9 MB │ 11.1 MB  │ 725 kB   │ 7.67 MB │
# └───────────┴─────────┴─────────┴─────────┴─────────┴──────────┴──────────┴─────────┘

# Req/Bytes counts sampled once per second.
# # of samples: 55

# 1012121 2xx responses, 33 non 2xx responses
# 1012k requests in 55.02s, 609 MB read
