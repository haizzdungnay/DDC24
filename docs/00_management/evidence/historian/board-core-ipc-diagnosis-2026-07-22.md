# Board Core IPC diagnosis - 2026-07-22

## Scope and safety

- Read-only inspection of `mkddc-web-pi`, `mkddc-core`, `mkddc-iobus`, journals and Unix socket state while the historian Trends-cache soak remained active.
- No service restart, config write, historian authority change, migration, prune, database mutation or deployment occurred.
- The live physical observation still represents UI-01 only; local Playwright UI/AO/DO/VP fixtures are browser-contract evidence, not physical-channel evidence.

## Bounded observations

- All three production services were active with `NRestarts=0`; `core.sock` was listening under `mkddc-core`.
- A 30-minute web-journal window contained 27 `alarms_read degraded err=core unavailable` warnings.
- A five-minute Core-journal window contained 360 accepted WebIpc connections, including 300 accepted `alarm_list` commands. The remaining cadence matched historian snapshots and health/status traffic.
- Warning windows showed one-shot clients rotating through fds 5, 6, 7 and 8, which is the configured four-client bound. Core logged no WebIpc busy/reject/error event in the sampled five-minute window.
- Soak sample 85 at `2026-07-22T05:26:50Z` reported both web and Core active with zero restarts, binary SHA-256 `319236d08c02be8712b0d49680cccb420e78528ea64fb1a619ecc674e21d5dad`, RSS `32,172 KiB`, hot rows `467,942`, gaps `3,356`, legacy rows `596,284`, storage warnings `0`, Core warnings `0`, and no sample errors. Hourly `quick_check` was not due in this sample.

## Code finding and regression

`CoreClient.ReadStatus` opened a dial-only `core.sock` connection before reading PLC shared memory. A browser health poll could therefore consume a scarce WebIpc slot even when valid PLC scan state already proved Core liveness, alongside background alarm history, browser alarm polling and historian snapshots.

The local fix makes valid PLC shared memory the primary liveness evidence and retains socket probing only as a fallback when PLC shared memory is unavailable. The regression creates valid PLC/IO shared memory plus a listening Unix socket and proves status is healthy without the listener receiving a connection.

- RED before fix: `ReadStatus err = core socket unavailable, want valid shared-memory status`.
- GREEN after fix: focused regression passes.
- Full backend verification: `go test -count=1 ./...` passes in `54.471s`; `go vet ./...` and `go build ./...` pass.

## Gate status

The fix is code-local and not deployed during the active soak. It removes one demonstrated source of client pressure, but production runtime-source stability remains open until an ARM64 package/checkpoint rollout and post-rollout warning/gap comparison are completed after the soak.
