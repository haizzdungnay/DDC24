package application

import (
	"testing"

	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
)

// ISS-STED-18 — mỗi diagnostic phải TỰ CHỨNG MINH nó thuộc về nguồn nào.
//
// Không có bốn trường này thì việc gạch lỗi trong trình soạn thảo tạo ra một
// lỗi nguy hiểm hơn lỗi đang có: gạch một chỗ trên buffer đã đổi, tức chỉ vào
// dòng KHÔNG CÒN là dòng sinh ra lỗi đó.
func TestProvenanceStampsAllFourFields(t *testing.T) {
	inputs := []programmingcompiler.Input{
		{SourceID: "P_ahu", Source: []byte("PROGRAM P_ahu\nEND_PROGRAM\n")},
	}
	provenance := newDiagnosticProvenance("rev-1", inputs)

	view := DiagnosticView{Location: map[string]any{"programId": "P_ahu"}}
	provenance.stamp(&view)

	if got, _ := view.Location["revisionId"].(string); got != "rev-1" {
		t.Fatalf("revisionId = %q", got)
	}
	if got, _ := view.Location["pouId"].(string); got != "P_ahu" {
		t.Fatalf("pouId = %q", got)
	}
	hash, _ := view.Location["sourceSha256"].(string)
	if len(hash) != 64 {
		t.Fatalf("sourceSha256 phải là 64 ký tự hex, nhận %q", hash)
	}
	if got, _ := view.Location["stLanguageProfileVersion"].(string); got != domain.STLanguageProfileVersion {
		t.Fatalf("stLanguageProfileVersion = %q", got)
	}
}

// Tiêu chí chấp nhận: hash so theo POU, KHÔNG theo cả gói — sửa POU A không
// được làm lỗi POU B thành STALE. Băm cả gói thì người dùng mất luôn kết quả
// còn đúng của mọi POU khác chỉ vì sửa một POU.
func TestProvenanceHashesEachPOUSeparately(t *testing.T) {
	shared := []byte("FUNCTION Scale : REAL\nEND_FUNCTION\n")
	inputs := []programmingcompiler.Input{
		{
			SourceID: "P_ahu", Source: []byte("PROGRAM P_ahu\nEND_PROGRAM\n"),
			LinkedPOUs: []programmingcompiler.LinkedPOUSource{{Name: "Scale", Source: shared}},
		},
		{
			SourceID: "P_boiler", Source: []byte("PROGRAM P_boiler\nEND_PROGRAM\n"),
			LinkedPOUs: []programmingcompiler.LinkedPOUSource{{Name: "Scale", Source: shared}},
		},
	}
	provenance := newDiagnosticProvenance("rev-1", inputs)

	ahu := DiagnosticView{Location: map[string]any{"programId": "P_ahu"}}
	boiler := DiagnosticView{Location: map[string]any{"programId": "P_boiler"}}
	provenance.stamp(&ahu)
	provenance.stamp(&boiler)

	ahuHash, _ := ahu.Location["sourceSha256"].(string)
	boilerHash, _ := boiler.Location["sourceSha256"].(string)
	if ahuHash == boilerHash {
		t.Fatal("hai POU khác nội dung mà cùng hash — đang băm cả gói chứ không băm từng POU")
	}

	// Sửa MỘT ký tự trong P_ahu: hash của nó đổi, hash của P_boiler không.
	inputs[0].Source = []byte("PROGRAM P_ahu\n\nEND_PROGRAM\n")
	after := newDiagnosticProvenance("rev-1", inputs)
	afterAhu := DiagnosticView{Location: map[string]any{"programId": "P_ahu"}}
	afterBoiler := DiagnosticView{Location: map[string]any{"programId": "P_boiler"}}
	after.stamp(&afterAhu)
	after.stamp(&afterBoiler)

	if got, _ := afterAhu.Location["sourceSha256"].(string); got == ahuHash {
		t.Fatal("sửa một ký tự mà hash không đổi")
	}
	if got, _ := afterBoiler.Location["sourceSha256"].(string); got != boilerHash {
		t.Fatal("sửa POU A làm đổi hash của POU B — lỗi của B sẽ thành STALE oan")
	}
}

// POU liên kết được băm theo TÊN: đó là định danh compiler đặt vào `sourceId`
// khi lỗi nằm trong thân POU đó.
func TestProvenanceCoversLinkedPOUs(t *testing.T) {
	inputs := []programmingcompiler.Input{
		{
			SourceID: "P_ahu", Source: []byte("PROGRAM P_ahu\nEND_PROGRAM\n"),
			LinkedPOUs: []programmingcompiler.LinkedPOUSource{
				{Name: "Scale", Source: []byte("FUNCTION Scale : REAL\nEND_FUNCTION\n")},
			},
		},
	}
	provenance := newDiagnosticProvenance("rev-1", inputs)
	view := DiagnosticView{Location: map[string]any{"programId": "Scale"}}
	provenance.stamp(&view)
	if hash, _ := view.Location["sourceSha256"].(string); len(hash) != 64 {
		t.Fatalf("lỗi trong POU liên kết không có hash riêng: %q", hash)
	}
}

// Không tra được hash thì BỎ TRỐNG, không điền hash của gói: một hash sai làm
// phép so khớp phía FE trả lời sai, tệ hơn hẳn một hash vắng mặt mà FE biết là
// "không kiểm được".
func TestProvenanceLeavesHashEmptyWhenPOUUnknown(t *testing.T) {
	provenance := newDiagnosticProvenance("rev-1", []programmingcompiler.Input{
		{SourceID: "P_ahu", Source: []byte("PROGRAM P_ahu\nEND_PROGRAM\n")},
	})
	view := DiagnosticView{Location: map[string]any{"programId": "khong-ton-tai"}}
	provenance.stamp(&view)
	if _, present := view.Location["sourceSha256"]; present {
		t.Fatal("điền hash cho một POU không tra được — phép so khớp sẽ trả lời sai")
	}
	// Ba trường còn lại vẫn phải có: chúng vẫn đúng và vẫn dùng được.
	if got, _ := view.Location["revisionId"].(string); got != "rev-1" {
		t.Fatalf("revisionId bị bỏ theo: %q", got)
	}
}

func TestProvenanceCreatesLocationWhenMissing(t *testing.T) {
	provenance := newDiagnosticProvenance("rev-1", nil)
	view := DiagnosticView{}
	provenance.stamp(&view)
	if view.Location == nil {
		t.Fatal("stamp() không dựng location cho diagnostic chưa có")
	}
	if got, _ := view.Location["revisionId"].(string); got != "rev-1" {
		t.Fatalf("revisionId = %q", got)
	}
}
