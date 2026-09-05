package application

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

// sealSingleProgramRevision dựng một project mới với đúng một Program ST rồi
// niêm một revision. `seed` chỉ để mọi UUID/idempotency key trong một lần gọi
// khác lần gọi khác — hai project phải thật sự tách nhau.
func sealSingleProgramRevision(t *testing.T, service *ProjectService, seed byte, name string) string {
	t.Helper()
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	key := func(n byte) string {
		return "7" + string("0123456789abcdef"[seed%16]) + "000000-0000-4000-8000-00000000000" +
			string("0123456789abcdef"[n%16])
	}
	created, err := service.CreateProject(ctx, actor, CreateProjectCommand{SchemaVersion: "1.0", Name: name,
		IdempotencyKey: key(1), CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "6" + string("0123456789abcdef"[seed%16]) + "555555-5555-4555-8555-555555555555"
	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{
		"programId": programID, "name": name, "kind": "PROGRAM", "language": "ST",
		"document": "PROGRAM " + name + "\nVAR_OUTPUT Fan : BOOL; END_VAR\nFan := TRUE;\nEND_PROGRAM\n"}})
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{
		"taskId": "66666666-6666-4666-8666-666666666666", "periodMs": 1000, "programOrder": []string{programID}}})
	saved, err := service.SaveDraft(ctx, actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0",
		BaseRevisionID: draftID, Operations: []json.RawMessage{program, task}, IfMatch: created.ETag,
		IdempotencyKey: key(2), CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := service.SealRevision(ctx, actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0",
		BaseRevisionID: draftID, Label: "R1", IfMatch: saved.ETag,
		IdempotencyKey: key(3), CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	return sealed.Resource["revisionId"].(string)
}

/* `ISS-PRG-CTRL-001`: một DDC là MỘT project, nhưng Core có thể đang giữ
 * revision của một hàng project khác — trên bo thật là đồ thừa của các đợt test
 * mà `projects.archived` không nhả được (`F-SHELL-01`).
 *
 * Đường Commission hỏi *"cài `to` trong khi `from` đang chạy thì đổi những gì"*,
 * và câu đó luôn có nghĩa. Từ chối nó bằng `ErrInvalidRequest` làm thiết bị kẹt
 * vĩnh viễn ở chương trình rác: Commission project thật trả lỗi không kèm lý do
 * nào người dùng hiểu được, và không một đường nào trong sản phẩm gỡ ra được. */
func TestCommissionImpactChapNhanRevisionCuaProjectKhac(t *testing.T) {
	service, _ := openDiffService(t)
	ctx := context.Background()
	running := sealSingleProgramRevision(t, service, 1, "SOAKRAC")
	target := sealSingleProgramRevision(t, service, 2, "THATSU")

	view, err := service.GetRevisionChanges(ctx, running, target)
	if err != nil {
		t.Fatalf("Commission impact qua project khác phải tính được, nhận: %v", err)
	}
	if view.Impact.ImpactRef == "" {
		t.Fatal("impactRef rỗng — Commission không có gì để đối chiếu")
	}

	// Khác project ⇒ không có gì mang sang được, nên impact phải BẰNG ĐÚNG
	// impact của "thay mới toàn bộ". Không được là một nhánh impact thứ hai.
	fresh, err := service.GetRevisionChanges(ctx, "none", target)
	if err != nil {
		t.Fatal(err)
	}
	if view.Impact.ImpactRef != fresh.Impact.ImpactRef {
		t.Fatalf("impactRef qua project khác = %s, nhưng thay-mới-toàn-bộ = %s — hai đường phải trùng",
			view.Impact.ImpactRef, fresh.Impact.ImpactRef)
	}
}

/* Nới ở trên phải HẸP. Mọi lý do `ErrInvalidRequest` khác vẫn phải giữ nguyên
 * lỗi — nuốt chúng sẽ biến một yêu cầu sai thành một bản Commission "thay mới
 * toàn bộ" chạy êm, đúng loại sai lặng lẽ mà đường này phải chặn. */
func TestCommissionImpactVanTuChoiYeuCauSai(t *testing.T) {
	service, _ := openDiffService(t)
	ctx := context.Background()
	target := sealSingleProgramRevision(t, service, 3, "THATSU2")

	// `from` không tồn tại trả lỗi NOT FOUND chứ không phải `ErrInvalidRequest`
	// — và đó mới đúng: guard chỉ hạ về "thay mới toàn bộ" khi CẢ HAI revision
	// có thật mà khác project. Điều phải khoá ở đây là "vẫn hỏng", không phải
	// hỏng bằng mã nào.
	cases := map[string]struct{ from, to string }{
		"from không tồn tại": {"7f000000-0000-4000-8000-00000000ffff", target},
		"from trùng to":      {target, target},
		"from sai dạng":      {"khong-phai-uuid", target},
	}
	for name, tc := range cases {
		view, err := service.GetRevisionChanges(ctx, tc.from, tc.to)
		if err == nil {
			t.Fatalf("%s: phải bị từ chối, nhưng đã tính ra impactRef %q", name, view.Impact.ImpactRef)
		}
	}

	// Và cụ thể: hai ca hoàn toàn nằm trong tầm kiểm của `revisionChanges` phải
	// giữ nguyên `ErrInvalidRequest`.
	for name, tc := range map[string]struct{ from, to string }{
		"from trùng to": {target, target},
		"from sai dạng": {"khong-phai-uuid", target},
	} {
		if _, err := service.GetRevisionChanges(ctx, tc.from, tc.to); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("%s: chờ ErrInvalidRequest, nhận %v", name, err)
		}
	}
}

/* `ISS-PGUI-01` — hai đường đọc diff CỐ Ý xử khác nhau, và không gì đang khoá
 * sự khác nhau ấy.
 *
 * `GetRevisionChanges` (đường Commission) hạ ca khác-project về "thay mới toàn
 * bộ", theo `ISS-PRG-CTRL-001` ngay phía trên. `GetRevisionChangesDetail` —
 * đường mà `GET /revisions/{from}/changes/{to}` của FE gọi — thì KHÔNG: nó
 * phải giữ `ErrInvalidRequest` (HTTP 400 `PRG-ERR-REQ-001`).
 *
 * Lý do khác nhau: Commission hỏi "cài `to` trong khi `from` đang chạy thì đổi
 * những gì", câu ấy luôn có nghĩa. FE hỏi "bản nháp của Project này khác gì bản
 * đang vận hành của Project này", và một cặp khác Project làm câu hỏi đó vô
 * nghĩa — trả về một diff "thêm mới toàn bộ" ở đây là dựng một bảng thay đổi
 * trông hợp lệ cho hai bản không liên quan, đúng thứ người vận hành sẽ ký duyệt.
 *
 * Nới `revisionChanges` cho khớp đường Commission sẽ làm chốt chặn này biến mất
 * lặng lẽ, nên nó phải có test riêng: FE (`ISS-PGUI-01`) đã ngừng phát request
 * chéo Project, nhưng invariant phía máy chủ vẫn phải đứng cho client xấu. */
func TestGetRevisionChangesDetailTuChoiCapKhacProject(t *testing.T) {
	service, _ := openDiffService(t)
	ctx := context.Background()
	running := sealSingleProgramRevision(t, service, 4, "SOAKRAC2")
	target := sealSingleProgramRevision(t, service, 5, "THATSU3")

	if _, err := service.GetRevisionChangesDetail(ctx, running, target, 0); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("cặp khác Project trên đường FE phải là ErrInvalidRequest (HTTP 400), nhận %v", err)
	}

	// Chốt chặn ngược: cùng Project vẫn tính được, nếu không test trên chỉ
	// chứng minh rằng đường này đã hỏng với mọi đầu vào.
	same := sealSingleProgramRevision(t, service, 6, "CUNGPROJ")
	if _, err := service.GetRevisionChangesDetail(ctx, "none", same, 0); err != nil {
		t.Fatalf("cặp hợp lệ vẫn phải tính được, nhận %v", err)
	}

	// Và đường Commission GIỮ NGUYÊN cách nới của `ISS-PRG-CTRL-001` — hai
	// đường phải tách nhau, không phải cùng thắt hay cùng nới.
	if _, err := service.GetRevisionChanges(ctx, running, target); err != nil {
		t.Fatalf("đường Commission vẫn phải chấp nhận cặp khác Project, nhận %v", err)
	}
}
