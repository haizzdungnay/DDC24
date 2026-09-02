package application

import (
	"encoding/json"
	"fmt"
	"testing"

	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

func programObject(index int) programmingstore.RevisionObject {
	objectID := fmt.Sprintf("prog-%04d", index)
	payload, _ := json.Marshal(map[string]any{
		"programId": objectID,
		"language":  "ST",
		"document":  "PROGRAM p\nEND_PROGRAM\n",
	})
	return programmingstore.RevisionObject{ObjectID: objectID, Kind: "PROGRAM", PayloadJSON: payload}
}

func snapshotWithPrograms(count int) programmingstore.RevisionSnapshot {
	objects := make([]programmingstore.RevisionObject, 0, count)
	for index := 0; index < count; index++ {
		objects = append(objects, programObject(index))
	}
	return programmingstore.RevisionSnapshot{Objects: objects}
}

// Một-trên-trần capacity phải bị từ chối ổn định và báo đúng trần sản phẩm.
// Trước T59-002, mọi số Program khác 1 đều bị gộp thành cùng một lỗi "limit: 1",
// tức là API tuyên bố sai capacity sản phẩm.
// firstDiagnostic lấy diagnostic đầu của bộ đã GỘP. T59-302 đổi API từ "một lỗi
// đầu tiên" sang "mọi lỗi của package", nên test cũ giữ nguyên ý nghĩa bằng cách
// đọc phần tử đầu thay vì đổi thứ đang được khoá.
func firstDiagnostic(diagnostics []DiagnosticView) *DiagnosticView {
	if len(diagnostics) == 0 {
		return nil
	}
	return &diagnostics[0]
}

func TestCompilerInputRejectsOneOverProductCapacity(t *testing.T) {
	_, diagnostics := compilerInputs(snapshotWithPrograms(domain.MaxProgramsTotal + 1), nil)
	diagnostic := firstDiagnostic(diagnostics)
	if diagnostic == nil {
		t.Fatalf("%d Program phải bị từ chối", domain.MaxProgramsTotal+1)
	}
	// DDD §5.2 dành mã riêng cho trần package; không được gộp vào scope chung.
	if diagnostic.Code != string(domain.ErrProgramLimit) || diagnostic.DetailCode != "ST-LIM-009" {
		t.Fatalf("code/detail = %s/%s; want %s/ST-LIM-009", diagnostic.Code, diagnostic.DetailCode, domain.ErrProgramLimit)
	}
	if actual, ok := diagnostic.Args["actual"].(int); !ok || actual != domain.MaxProgramsTotal+1 {
		t.Fatalf("actual báo về = %v; want %d", diagnostic.Args["actual"], domain.MaxProgramsTotal+1)
	}
	limit, ok := diagnostic.Args["limit"].(int)
	if !ok || limit != domain.MaxProgramsTotal {
		t.Fatalf("limit báo về = %v; want %d", diagnostic.Args["limit"], domain.MaxProgramsTotal)
	}
}

func TestCompilerInputRejectsEmptyProgramSet(t *testing.T) {
	diagnostic := firstDiagnostic(secondOf(compilerInputs(snapshotWithPrograms(0), nil)))
	if diagnostic == nil {
		t.Fatal("Revision không có PROGRAM nào phải bị từ chối")
	}
	if limit, ok := diagnostic.Args["limit"].(int); !ok || limit != domain.MaxProgramsTotal {
		t.Fatalf("limit báo về = %v; want %d", diagnostic.Args["limit"], domain.MaxProgramsTotal)
	}
}

// T59-302 gỡ trần pipeline "một Program mỗi lần chạy": Check nay biên dịch MỌI
// Program của Revision. Test cũ khoá đúng trần giai đoạn đó nên nó được thay
// bằng phép kiểm mới — hai Program phải cho HAI input, không phải một lỗi.
func TestCompilerInputsBuildEveryProgramInStableOrder(t *testing.T) {
	inputs, diagnostics := compilerInputs(snapshotWithPrograms(3), nil)
	if len(diagnostics) != 0 {
		t.Fatalf("ba Program hợp lệ vẫn bị từ chối: %+v", diagnostics)
	}
	if len(inputs) != 3 {
		t.Fatalf("số input=%d; want 3", len(inputs))
	}
	// Thứ tự phải theo `objectId`, không theo thứ tự đọc DB: Check chạy lại trên
	// cùng Revision phải cho đúng cùng dãy kết quả.
	for index := 1; index < len(inputs); index++ {
		if inputs[index-1].SourceID >= inputs[index].SourceID {
			t.Fatalf("thứ tự input không ổn định: %+v", inputs)
		}
	}
}

func TestCompilerInputAcceptsSingleProgramAtProductProfile(t *testing.T) {
	inputs, diagnostics := compilerInputs(snapshotWithPrograms(1), nil)
	if len(diagnostics) != 0 {
		t.Fatalf("một Program hợp lệ bị từ chối: %+v", diagnostics)
	}
	if len(inputs) != 1 || inputs[0].SourceID != "prog-0000" || inputs[0].Language != "ST" {
		t.Fatalf("input compiler sai: %+v", inputs)
	}
}

// Payload sai dạng không phải vi phạm trần: không được bịa arg `limit`.
func TestMalformedPayloadDoesNotReportFakeLimit(t *testing.T) {
	snapshot := snapshotWithPrograms(1)
	snapshot.Objects[0].PayloadJSON = []byte(`{"programId":"khong-khop","language":"ST","document":"x"}`)
	diagnostic := firstDiagnostic(secondOf(compilerInputs(snapshot, nil)))
	if diagnostic == nil {
		t.Fatal("payload sai phải bị từ chối")
	}
	if _, present := diagnostic.Args["limit"]; present {
		t.Fatalf("từ chối không do trần nhưng vẫn báo limit: %+v", diagnostic.Args)
	}
}

func TestSourceOverProfileLimitReportsProfileSourceBytes(t *testing.T) {
	snapshot := snapshotWithPrograms(1)
	oversized := make([]byte, domain.MaxSourceBytes+1)
	for index := range oversized {
		oversized[index] = 'x'
	}
	document, _ := json.Marshal(string(oversized))
	payload, _ := json.Marshal(map[string]any{
		"programId": "prog-0000",
		"language":  "ST",
		"document":  json.RawMessage(document),
	})
	snapshot.Objects[0].PayloadJSON = payload
	diagnostic := firstDiagnostic(secondOf(compilerInputs(snapshot, nil)))
	if diagnostic == nil {
		t.Fatal("source vượt trần phải bị từ chối")
	}
	if limit, ok := diagnostic.Args["limit"].(int); !ok || limit != domain.MaxSourceBytes {
		t.Fatalf("limit = %v; want %d", diagnostic.Args["limit"], domain.MaxSourceBytes)
	}
}

func secondOf(_ []programmingcompiler.Input, diagnostics []DiagnosticView) []DiagnosticView {
	return diagnostics
}

// T59-302: một Program hỏng KHÔNG được che các Program hỏng khác. Người dùng
// phải thấy hết lỗi của package trong một lần Check, không phải sửa từng cái rồi
// chạy lại 32 vòng.
func TestCompilerInputsAggregateDiagnosticsAcrossPrograms(t *testing.T) {
	snapshot := snapshotWithPrograms(3)
	snapshot.Objects[0].PayloadJSON = []byte(`{"programId":"khong-khop","language":"ST","document":"x"}`)
	snapshot.Objects[2].PayloadJSON = []byte(`{"programId":"cung-khong-khop","language":"ST","document":"x"}`)
	inputs, diagnostics := compilerInputs(snapshot, nil)
	if inputs != nil {
		t.Fatal("có lỗi thì không được trả input nửa vời")
	}
	if len(diagnostics) != 2 {
		t.Fatalf("số diagnostic gộp=%d; want 2: %+v", len(diagnostics), diagnostics)
	}
	// Mỗi diagnostic phải trỏ đúng Program của nó, nếu không người đọc không
	// biết mở file nào.
	seen := map[string]struct{}{}
	for _, diagnostic := range diagnostics {
		programID, _ := diagnostic.Location["programId"].(string)
		if programID == "" {
			t.Fatalf("diagnostic không nêu Program: %+v", diagnostic)
		}
		seen[programID] = struct{}{}
	}
	if len(seen) != 2 {
		t.Fatalf("hai lỗi phải thuộc hai Program khác nhau: %+v", seen)
	}
}
