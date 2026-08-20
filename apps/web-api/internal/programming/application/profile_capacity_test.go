package application

import (
	"encoding/json"
	"fmt"
	"testing"

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
func TestCompilerInputRejectsOneOverProductCapacity(t *testing.T) {
	_, diagnostic := compilerInput(snapshotWithPrograms(domain.MaxProgramsTotal + 1))
	if diagnostic == nil {
		t.Fatalf("%d Program phải bị từ chối", domain.MaxProgramsTotal+1)
	}
	if diagnostic.DetailCode != "ST-CLI-LIMIT" {
		t.Fatalf("detailCode = %s; want ST-CLI-LIMIT", diagnostic.DetailCode)
	}
	limit, ok := diagnostic.Args["limit"].(int)
	if !ok || limit != domain.MaxProgramsTotal {
		t.Fatalf("limit báo về = %v; want %d", diagnostic.Args["limit"], domain.MaxProgramsTotal)
	}
}

func TestCompilerInputRejectsEmptyProgramSet(t *testing.T) {
	_, diagnostic := compilerInput(snapshotWithPrograms(0))
	if diagnostic == nil {
		t.Fatal("Revision không có PROGRAM nào phải bị từ chối")
	}
	if limit, ok := diagnostic.Args["limit"].(int); !ok || limit != domain.MaxProgramsTotal {
		t.Fatalf("limit báo về = %v; want %d", diagnostic.Args["limit"], domain.MaxProgramsTotal)
	}
}

// Trong trần capacity nhưng trên trần pipeline: đây là giới hạn giai đoạn của
// compiler runner (multi-Program là T59-302/T59-305), phải báo riêng chứ không
// mượn con số capacity sản phẩm.
func TestCompilerInputSeparatesStagedPipelineLimitFromProductCapacity(t *testing.T) {
	_, diagnostic := compilerInput(snapshotWithPrograms(2))
	if diagnostic == nil {
		t.Fatal("hai Program hiện chưa compile được, phải có diagnostic")
	}
	if limit, ok := diagnostic.Args["limit"].(int); !ok || limit != 1 {
		t.Fatalf("limit giai đoạn = %v; want 1", diagnostic.Args["limit"])
	}
	if limit := diagnostic.Args["limit"]; limit == domain.MaxProgramsTotal {
		t.Fatal("giới hạn pipeline không được báo bằng capacity sản phẩm")
	}
}

func TestCompilerInputAcceptsSingleProgramAtProductProfile(t *testing.T) {
	input, diagnostic := compilerInput(snapshotWithPrograms(1))
	if diagnostic != nil {
		t.Fatalf("một Program hợp lệ bị từ chối: %+v", diagnostic)
	}
	if input.SourceID != "prog-0000" || input.Language != "ST" {
		t.Fatalf("input compiler sai: %+v", input)
	}
}

// Payload sai dạng không phải vi phạm trần: không được bịa arg `limit`.
func TestMalformedPayloadDoesNotReportFakeLimit(t *testing.T) {
	snapshot := snapshotWithPrograms(1)
	snapshot.Objects[0].PayloadJSON = []byte(`{"programId":"khong-khop","language":"ST","document":"x"}`)
	_, diagnostic := compilerInput(snapshot)
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
	_, diagnostic := compilerInput(snapshot)
	if diagnostic == nil {
		t.Fatal("source vượt trần phải bị từ chối")
	}
	if limit, ok := diagnostic.Args["limit"].(int); !ok || limit != domain.MaxSourceBytes {
		t.Fatalf("limit = %v; want %d", diagnostic.Args["limit"], domain.MaxSourceBytes)
	}
}
