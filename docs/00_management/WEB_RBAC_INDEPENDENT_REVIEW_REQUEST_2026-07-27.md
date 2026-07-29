# Independent review request - Web RBAC four-role implementation

Use the prompt below with a reviewer who did not implement this change. The review must be read-only and must evaluate the current worktree rather than the earlier pre-code plan.

---

Bạn hãy thực hiện **CODE / SECURITY / RELEASE-EVIDENCE REVIEW hoàn toàn READ-ONLY** cho implementation Web RBAC bốn role trong repository hiện tại.

## Mục tiêu cần review

Xác minh implementation có đúng policy đã chốt hay không:

- `admin`: toàn bộ business capability, vẫn chịu self-delete/last-admin/audit invariants;
- `engineer`: tương đương Admin ngoại trừ toàn bộ Users và database mutation;
- `operator`: vận hành runtime + Program edit/validate/build, không Settings/config/database/Users và không Program activate/deploy/rollback;
- `viewer`: read-only, chỉ ngoại lệ self password và Display/language local.

Enum canonical phải là `engineer`, không dùng `engineering`.

## Phạm vi bắt buộc

1. Đối chiếu ADR-022, requirements, OpenAPI v1.11.0, implementation guide, verification và traceability.
2. Kiểm exact inventory: public login + đúng 61 protected operation; mỗi protected route phải có permission owner và dùng backend enforcement trước handler/side effect.
3. Kiểm capability map và fail-closed behavior cho unknown role/permission; không chấp nhận Web authorization bằng rank/min-role.
4. Kiểm toàn bộ `/users*` và `PUT /trends/config` là Admin-only; Engineer vẫn được Settings nhưng không được tạo hidden Users query.
5. Kiểm Operator bị chặn `PUT /schedules`, `PUT /alarm-settings`, Settings, database và activation nhưng giữ operate + Program edit.
6. Kiểm Viewer không có business mutation.
7. Kiểm persisted `session_version`, unique JWT `jti`, logout isolation, role/password/delete invalidation, restart behavior và persist-failure behavior.
8. Kiểm self-delete, last-admin delete/demotion và concurrent demote/delete không thể làm mất Admin cuối.
9. Kiểm audit denial/result nhưng không log password, bearer token, JWT, firmware payload hoặc secret.
10. Kiểm FE permission map, route/nav/action/read-only/query guards, real Users CRUD và source guard không còn direct role/rank authorization ngoài permission module/test fixture.
11. Kiểm `rbac-users-migrate`/`rbac-users-rollback`: exclusive durable backup, symlink/file/schema/bcrypt/Admin validation, exact preservation, restore-on-failure và rollback byte-for-byte.
12. Kiểm `rbac-target-smoke`: strict credential input, private regular file/symlink race defense, no proxy/redirect, HTTPS default, cleartext chỉ loopback với opt-in, exact full-mode confirmation, no positive Graph-deploy/OTA side effect, temporary-user cleanup và success evidence không lộ username/password/JWT.
13. Kiểm offline `rbac-smoke-users-provision`/`cleanup`: service-presence/schema-2.0/canonical preflight, cryptographic credentials, exclusive durable private credential/receipt, restore-on-failure, exact username/role/bcrypt/password/session ownership, original-store SHA và no-partial-delete khi tamper.
14. Kiểm CI ARM64 job bắt buộc exact revision + `vcs.modified=false`, SHA-256 verify và artifact upload; không coi local artifact `vcs.modified=true` là release binary.
15. Kiểm evidence native Linux race, local Playwright 5/5, target read-only preflight và completion audit có claim đúng mức hay không.
16. Kiểm quyết định tách bảy route đang `501` sang `WEB-FEATURE-AUTH-001`: BACnet objects, Graph validate/deploy, OTA upload/apply/status, log download. Authorization mapping/`401/403` vẫn phải pass trong RBAC, nhưng không được dùng RBAC approval để claim business feature available hoặc kéo missing business authority trở lại làm sai closure boundary của `WEB-RBAC-001`.
17. Đánh giá dependency residual `GHSA-qwww-vcr4-c8h2` trên React Router 7.18.1 theo kiến trúc thực tế (client `BrowserRouter`, không RSC/Actions); không đề xuất downgrade nếu làm tái mở advisory cũ.

## File/evidence trọng tâm

- `web/backend/auth.go`
- `web/backend/http.go`
- `web/backend/rbac_test.go`
- `web/backend/auth_session_test.go`
- `web/backend/rbac_users_migration.go`
- `web/backend/rbac_users_migration_test.go`
- `web/backend/rbac_target_smoke.go`
- `web/backend/rbac_target_smoke_test.go`
- `web/backend/rbac_smoke_users.go`
- `web/backend/rbac_smoke_users_test.go`
- `src/frontend/src/auth/permissions.ts`
- `src/frontend/scripts/check-rbac-source.mjs`
- `src/frontend/e2e/rbac-live.spec.ts`
- `.github/workflows/build-and-test.yml`
- `docs/00_management/evidence/WEB_RBAC_COMPLETION_AUDIT_2026-07-27.md`
- `docs/00_management/evidence/WEB_RBAC_LINUX_RACE_2026-07-27.md`
- `docs/00_management/evidence/WEB_RBAC_ARM64_CANDIDATE_2026-07-27.md`
- `docs/00_management/evidence/WEB_RBAC_TARGET_PREFLIGHT_2026-07-27.md`

## Verification nên chạy

```text
cd web/backend
go test -count=1 ./...
go vet ./...
go build ./...
go mod verify

cd ../../src/frontend
npm test
npm run check:rbac-source
npm run lint
npm run typecheck
npm run build
npm run test:e2e:rbac

git diff --check
```

Nếu có Linux toolchain, chạy thêm `go test -race -count=1 ./...` hoặc xác minh evidence hiện có đủ provenance.

## Format trả lời bắt buộc

1. Findings trước, sắp xếp `P0` → `P3`, mỗi finding có file + line, impact, evidence và fix cụ thể.
2. Bảng PASS/FAIL/BLOCKED cho từng nhóm: policy, backend, session, FE, migration, target-smoke, CI/package, target rollout, dependencies.
3. Nêu test/evidence đã tự chạy và phần chỉ inspect gián tiếp.
4. Liệt kê open questions/assumptions, đặc biệt target deployment evidence và mọi sai lệch giữa `WEB-RBAC-001` với `WEB-FEATURE-AUTH-001`.
5. Verdict duy nhất: `APPROVED`, `APPROVED WITH EXPLICIT RESIDUAL`, hoặc `REJECTED`.
6. Nếu approve, ghi rõ phạm vi approval là code-local hay release/target; không được suy target pass từ fixture local.

Không sửa file, không stage/commit/push, không deploy, không đọc hoặc in credential/secret, và không dùng các báo cáo review kế hoạch cũ làm bằng chứng implementation đã pass.

---
