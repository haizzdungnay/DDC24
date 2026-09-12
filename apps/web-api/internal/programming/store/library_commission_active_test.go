package store

import (
	"context"
	"testing"
	"time"
)

/*
`T61-504` / `ISS-PGM04-17` — hai read model của PGM-04 phải NHÌN THẤY một lần
Commission thật.

## Lỗi mà test này khoá lại

`LibraryCompatibilityFacts` và `ListLibraryUsageRows` cùng hỏi một câu: "Revision
nào của Project này đã Commission thành công?". Cả hai từng trả lời bằng
`commission_records.result='SUCCEEDED'`. Nhưng cột `result` được ghi từ **result
code** của operation, và result code của một lần Commission thành công là
`COMMITTED` (`application/operations.go`: `transition(operation, "SUCCEEDED",
"COMMITTED", "COMMITTED", ...)`). Chuỗi `SUCCEEDED` **không bao giờ** nằm ở cột
đó, nên điều kiện không bao giờ đúng.

Hệ quả không phải một chi tiết hiển thị:

  - `HasActiveRevision` luôn `false` và `PinnedVersions` luôn rỗng, nên
    `compatibility` của **mọi** entry PROJECT trên **mọi** thiết bị luôn là
    `UNKNOWN`. Toàn bộ read model `T61-101` — cả `COMPATIBLE` lẫn
    `REQUIRES_MIGRATION` — chưa từng xuất hiện trong sản phẩm.
  - `isActive` của Used-In luôn `false`, nên PGM-04 chưa từng đánh dấu được
    "bản đang chạy" — đúng dấu hiệu người vận hành dùng để biết một khối có đang
    điều khiển tủ hay không trước khi sửa nó.

## Vì sao không test nào bắt được

`library_compatibility_test.go` dựng `LibraryCompatibilityFacts` **bằng tay**:
nó kiểm bộ phân loại, không kiểm câu truy vấn nuôi bộ phân loại ấy. Còn
`library_usage_test.go` chỉ khẳng định `IsActive == false` cho mục Draft — đúng,
nhưng đúng vì một lý do khác với lý do nó tưởng.

Test này đi qua **đúng đường ghi của sản phẩm** (`BeginOperation` →
`ClaimOperation` → `UpdateOperation` kèm `CommissionRecordInput`), nên nó không
thể xanh nhờ một hằng số chép tay. Và nó khẳng định thẳng rằng giá trị được ghi
vào `result` KHÔNG phải `SUCCEEDED` — chính là lý do điều kiện cũ trượt.
*/
func TestCommissionedRevisionIsVisibleToLibraryReadModels(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	createProjectFixture(t, store)
	publishedLibraryFixture(t, store)
	draft, err := store.GetDraft(ctx, draftID)
	if err != nil {
		t.Fatal(err)
	}

	sealKey, sealRequest := mutationIdentity("t61-504-seal")
	if _, err := store.CreateRevision(ctx, CreateRevisionParams{
		RevisionID: revisionID, ProjectID: projectID, DraftID: draftID, ExpectedDraftETag: draft.ETag,
		ManifestJSON:          []byte(`{"schemaVersion":2,"objects":["` + pouObjectID + `"]}`),
		Objects:               []RevisionObjectInput{{ObjectID: pouObjectID, Kind: "PROGRAM", PayloadJSON: []byte(`{"language":"ST","source":"X:=1;"}`)}},
		DocumentSchemaVersion: 2, ProgramCount: 1, LibraryRevisionID: libraryRevisionA,
		POUObjects: []POUObjectInput{{
			ObjectID: pouObjectID, Kind: "PROGRAM", Name: "AHU_MAIN", Language: "ST",
			InterfaceJSON: []byte(`{"inputs":[]}`), SourceBlob: []byte("PROGRAM AHU_MAIN\nEND_PROGRAM\n"),
			Dependencies: []LibraryDependency{{EntryID: entryScaleID, Version: "1.0.0"}},
		}},
		ActorID: actorID, Role: role, AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1",
		CorrelationID: correlationID, At: fixedNow.Add(2 * time.Second),
		IdempotencyKeySHA256: sealKey, RequestSHA256: sealRequest,
	}); err != nil {
		t.Fatal(err)
	}

	// TRƯỚC khi Commission: chưa có gì để so, nên fail-closed là câu trả lời đúng.
	before, err := store.LibraryCompatibilityFacts(ctx, projectID)
	if err != nil {
		t.Fatal(err)
	}
	if before.HasActiveRevision {
		t.Fatal("chưa Commission mà đã có Revision vận hành")
	}
	if len(before.PinnedVersions) != 0 {
		t.Fatalf("chưa Commission mà đã có pin: %+v", before.PinnedVersions)
	}

	// Commission qua ĐÚNG đường ghi của sản phẩm.
	opKey, opRequest := mutationIdentity("t61-504-commission")
	const operationID = "55555555-5555-4555-8555-55555555550a"
	if _, err := store.BeginOperation(ctx, BeginOperationParams{
		OperationID: operationID, Kind: "COMMISSION", ControllerID: "controller-local",
		RequestedRevisionID: revisionID, IdempotencyKeySHA256: opKey, RequestSHA256: opRequest,
		ContextJSON:   []byte(`{"schemaVersion":"1.0","locator":"/state/staging/candidate"}`),
		CorrelationID: correlationID, ActorID: actorID, Role: role,
		AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2", At: fixedNow.Add(3 * time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	claimed, ok, err := store.ClaimOperation(ctx, ClaimOperationParams{
		Owner: "worker-t61-504", At: fixedNow.Add(4 * time.Second), Lease: time.Minute})
	if err != nil || !ok {
		t.Fatalf("claim ok=%v err=%v", ok, err)
	}
	/* Đi ĐÚNG chuỗi trạng thái mà `UpdateOperation` cho phép
	   (PENDING → VALIDATING → STAGING → ACTIVATING → VERIFYING → SUCCEEDED).
	   Nhảy thẳng sang SUCCEEDED bị store từ chối, và đó là hành vi đúng: một
	   Commission "thành công" mà chưa qua staging/verify là một lần cutover
	   không ai kiểm. */
	for index, step := range []string{"VALIDATING", "STAGING", "ACTIVATING", "VERIFYING"} {
		if _, err := store.UpdateOperation(ctx, UpdateOperationParams{
			OperationID: claimed.OperationID, LeaseOwner: "worker-t61-504",
			LeaseGeneration: claimed.LeaseGeneration, State: step, Step: step,
			At: fixedNow.Add(time.Duration(5+index) * time.Second),
		}); err != nil {
			t.Fatalf("chuyển sang %s: %v", step, err)
		}
	}

	keeps := false
	/* `Result: "COMMITTED"` KHÔNG phải một lựa chọn của test: đó đúng giá trị mà
	   `OperationService.transition` truyền xuống ở nhánh thành công. Đặt
	   `"SUCCEEDED"` ở đây sẽ làm test xanh trên cả bản mã cũ — tức biến nó thành
	   một test không kiểm gì. */
	if _, err := store.UpdateOperation(ctx, UpdateOperationParams{
		OperationID: claimed.OperationID, LeaseOwner: "worker-t61-504",
		LeaseGeneration: claimed.LeaseGeneration, State: "SUCCEEDED", Step: "COMMITTED",
		ResultCode: "COMMITTED", KeepsRunningRevision: &keeps, ActualActive: revisionID,
		At: fixedNow.Add(10 * time.Second), ReleaseLease: true,
		AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab3", AuditAction: "programming.commission",
		AuditRole: role,
		CommissionRecord: &CommissionRecordInput{
			NewRevisionID: revisionID, ArtifactSHA256: [32]byte{1}, RuntimeReadbackJSON: []byte(`{}`),
			ImpactJSON: []byte(`{}`), OverrideInventorySHA256: [32]byte{2}, Result: "COMMITTED",
		},
	}); err != nil {
		t.Fatal(err)
	}

	/* Neo chống-hồi-quy: giá trị THẬT trong cột `result` không phải `SUCCEEDED`.
	   Đây là toàn bộ lý do điều kiện cũ trượt, nên nó phải được khẳng định ra
	   chứ không nằm im trong một chú thích. */
	var storedResult string
	if err := store.db.QueryRow(`SELECT result FROM commission_records WHERE operation_id=?`,
		operationID).Scan(&storedResult); err != nil {
		t.Fatal(err)
	}
	if storedResult == "SUCCEEDED" {
		t.Fatal("giả định của test sai: cột result nay giữ 'SUCCEEDED' — đọc lại hai truy vấn read model")
	}
	if storedResult != "COMMITTED" {
		t.Fatalf("result = %q; đường ghi thật của sản phẩm dùng 'COMMITTED'", storedResult)
	}

	// SAU khi Commission: cả hai read model phải thấy.
	after, err := store.LibraryCompatibilityFacts(ctx, projectID)
	if err != nil {
		t.Fatal(err)
	}
	if !after.HasActiveRevision {
		t.Fatal("Commission thành công nhưng compatibility vẫn không thấy Revision vận hành " +
			"— mọi entry PROJECT sẽ mãi mãi UNKNOWN")
	}
	if got := after.PinnedVersions[entryScaleID]; got != "1.0.0" {
		t.Fatalf("PinnedVersions[%s] = %q; want 1.0.0 (pin đọc từ library_usages của Revision vận hành)",
			entryScaleID, got)
	}

	rows, err := store.ListLibraryUsageRows(ctx, ListLibraryUsageParams{
		LibraryRevisionID: libraryRevisionA, EntryID: entryScaleID, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("usage rows = %d; want 1: %+v", len(rows), rows)
	}
	if !rows[0].IsActive {
		t.Fatal("Used-In không đánh dấu Revision vừa Commission là bản đang chạy " +
			"— PGM-04 mất đúng dấu hiệu người vận hành cần trước khi sửa một khối")
	}
	if rows[0].ObjectID != pouObjectID || rows[0].RequiredVersion != "1.0.0" {
		t.Fatalf("usage row sai mảnh deep link/pin: %+v", rows[0])
	}
}
