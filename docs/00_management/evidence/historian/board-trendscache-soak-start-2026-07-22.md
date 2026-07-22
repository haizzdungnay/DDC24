# Historian Trends Cache Soak — 2026-07-22

- Board: `orangepi@192.168.1.18`; unit `mkddc-historian-soak-trendscache.service`.
- Window: `historian-trendscache-20260722T034500Z`.
- Monitor: `/data/config/historian-v2-migration/historian-trendscache-20260722T034500Z/historian_soak_monitor.py`.
- Output: `/data/config/historian-v2-migration/historian-trendscache-20260722T034500Z/soak-24h/metadata.json`, `samples.jsonl`, `summary.json`.
- Cadence: 60 seconds for service state/restarts, deployed SHA, frontiers, hot/gap/legacy counts, journal warnings, RSS and free space; `quick_check` every 60 samples.
- Expected deployed web SHA-256: `319236d08c02be8712b0d49680cccb420e78528ea64fb1a619ecc674e21d5dad`.
- First sample at `2026-07-22T04:01:50Z`: all three services active, `NRestarts=0`, web RSS `32,480 KiB`, `hot=467,270`, `gaps=3,335`, `legacy=596,284`, `quick_check=ok`, storage warnings `0`, core warnings `0`.
- The soak summary does not claim release GREEN while core degradation, physical power-cut, target eMMC/endurance, browser/manual E2E and exact 48-hour boundary gates remain open.
