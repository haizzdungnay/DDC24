# PGM-05 — Check & Commission — FE Handoff

**Route canonical:** `/eng/programming/projects/:projectId/commission`<br>
**Authority trực quan:** [`assets/PGM-05_commission.png`](assets/PGM-05_commission.png) theo `AUTH-UX-PROG-2026-09-08-01`<br>
**Giới hạn bằng chứng:** Target visual; không phải As-Built/runtime evidence.<br>
**Primary goal:** Safe release gate: validate Draft, review impact/diff, commission it, then verify the authoritative runtime state.

## 1. Workflow

Normal user-facing sequence:

`1 Check → 2 Review Impact → 3 Commission → Verify`

`FAILED` and `UNKNOWN` are states of a step, not extra lifecycle steps.

## 2. Step 1 — Check

Groups:
- Syntax
- Types
- Mapping
- Program/execution configuration
- Library/dependency
- Runtime compatibility
- Safety/interlocks
- Resource limits when runtime exposes them

Each issue:
`severity | human message | entity | location | technical code`

Click → deep-link to Programs/Mapping/Library.

Check SHALL NOT change Active runtime.

## 3. Step 2 — Review Impact

Summary:
- Programs changed
- FBD/ST objects changed
- mappings changed
- cycle/execution settings changed
- library version changes
- retained-state impact
- safety/interlock impact
- output mapping impact

Provide `View Detailed Diff`.

Groups with no impact may be collapsed:
`5 groups have no impact ▾`

Missing required impact data = **blocking/unknown**, not “no impact”.

## 4. Step 3 — Commission

Before CTA becomes enabled:
- Check PASS / no blocking diagnostic
- controller/core connected
- correct target
- safe-state requirements satisfied
- required permission
- required re-auth/auth context
- impact data complete
- no unresolved unknown/reconciling state

CTA example:
`Commission Draft v14`

Confirmation must show:
- target controller
- Active revision being replaced
- candidate Draft revision
- key risk/impact summary

## 5. Verify after Commission

Commission success is not inferred from HTTP success.

Required read-back:
- Active revision now equals candidate
- runtime state
- Programs expected enabled/running state
- authoritative commission record/timestamp if supplied
- mapping/config checksum/readback when supported

Only then show SUCCESS.

## 6. Fail-closed states

The following never render as successful:
- timeout
- unknown
- reconciling
- missing impact group
- controller offline
- unsafe
- read-back mismatch
- backend/core reports failure

If candidate fails:
- old Active remains visible
- explain that old runtime continues
- show retry / diagnostics / return to editor

## 7. State machine suggestion

```ts
type CommissionUiState =
  | "idle"
  | "checking"
  | "check_failed"
  | "ready_for_review"
  | "review_blocked"
  | "ready_to_commission"
  | "commissioning"
  | "verifying"
  | "succeeded"
  | "failed"
  | "reconciling";
```

Do not collapse into `isLoading/isSuccess`.

## 8. Error messaging

Good:
`Không thể kết nối Programming Core. Check và Commission đang bị khóa.`  
`Technical details: PRG-CORE-UNAVAILABLE`

Bad:
`PRG-CORE-UNAVAILABLE` as headline.

## 9. Permissions

viewer/operator:
- view Check/Impact/Commission history/result
- no Check/Commission mutation

admin:
- Check
- Commission
- Restore/other dangerous action subject to separate policy

## 10. Acceptance criteria

- `AC-PGM05-01` Check failure does not modify Active.
- `AC-PGM05-02` blocking diagnostic disables Commission.
- `AC-PGM05-03` missing/unknown impact blocks Commission.
- `AC-PGM05-04` exact target and Active→Draft replacement are visible before confirmation.
- `AC-PGM05-05` timeout enters reconciling/unknown and triggers authoritative refresh.
- `AC-PGM05-06` success only after runtime read-back confirms candidate Active.
- `AC-PGM05-07` failed candidate preserves and displays previous Active/LKG.
- `AC-PGM05-08` all diagnostics deep-link to owning workspace.

## 11. E2E minimum

1. Check pass → review → commission → verify success.
2. Mapping error → blocked.
3. Core offline → blocked.
4. Commission timeout → reconciling → authoritative result.
5. Read-back mismatch → failed.
6. Viewer cannot commission.
