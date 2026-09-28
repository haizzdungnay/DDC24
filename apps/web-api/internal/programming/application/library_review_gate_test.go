package application

import (
	"context"
	"testing"

	programmingstore "mkddc-web/internal/programming/store"
)

/*
Issue #802 — `featureState` mà API thư viện trả cho client là trạng thái duyệt
HIỆU LỰC. Bộ test tách hai thứ giống phía Core:

  - CƠ CHẾ: với một bảng mà PID chưa duyệt, entry SYSTEM `REVIEW_REQUIRED` giữ
    nguyên nhãn (UI khoá Chèn); PROJECT và AVAILABLE không bị phủ.
  - TRẠNG THÁI production: PID đã ký token nên API trả `AVAILABLE`.
*/

func TestEffectiveLibraryFeatureStateKeepsGateForUnapprovedFeature(t *testing.T) {
	pidPending := func(string) bool { return false }
	if got := effectiveLibraryFeatureState(programmingstore.LibraryScopeSystem, "PID",
		"REVIEW_REQUIRED", pidPending); got != "REVIEW_REQUIRED" {
		t.Fatalf("PID chưa duyệt mà API trả %q", got)
	}
	pidApproved := func(featureID string) bool { return featureID == "PID" }
	if got := effectiveLibraryFeatureState(programmingstore.LibraryScopeSystem, "PID",
		"REVIEW_REQUIRED", pidApproved); got != "AVAILABLE" {
		t.Fatalf("PID đã duyệt mà API trả %q", got)
	}
	// Fail-closed: bảng duyệt PID không được mở một entry REVIEW_REQUIRED khác.
	if got := effectiveLibraryFeatureState(programmingstore.LibraryScopeSystem, "PID_CASCADE",
		"REVIEW_REQUIRED", pidApproved); got != "REVIEW_REQUIRED" {
		t.Fatalf("entry chưa có trong bảng bị mở nhầm: %q", got)
	}
	// Chỉ SYSTEM: PROJECT không có đường mang REVIEW_REQUIRED hợp lệ, và nếu có
	// thì bảng profile không phải thứ được phép mở nó.
	if got := effectiveLibraryFeatureState(programmingstore.LibraryScopeProject, "PID",
		"REVIEW_REQUIRED", pidApproved); got != "REVIEW_REQUIRED" {
		t.Fatalf("PROJECT bị phủ nhầm: %q", got)
	}
	if got := effectiveLibraryFeatureState(programmingstore.LibraryScopeSystem, "TON",
		"AVAILABLE", pidPending); got != "AVAILABLE" {
		t.Fatalf("AVAILABLE bị đổi: %q", got)
	}
}

func TestProductionProfileApprovesPid(t *testing.T) {
	if !reviewGateApproved("PID") {
		t.Fatal("PID phải được duyệt trong profile sau #802")
	}
	if reviewGateApproved("TON") || reviewGateApproved("KHONG_CO_TRONG_BANG") {
		t.Fatal("chỉ feature có trong bảng và mang token mới được coi là đã duyệt")
	}
}

// Đầu-cuối qua store thật: trang SYSTEM của API thư viện trả PID là AVAILABLE,
// còn danh tính thực thi (contentSha256) vẫn là của registry — không đổi.
func TestSearchLibrariesReportsApprovedPidAsAvailable(t *testing.T) {
	library, _, _ := openLibraryServices(t)
	page, err := library.SearchLibraries(context.Background(), SearchLibrariesCommand{
		ProjectID: libraryProjectID, Scope: "SYSTEM", Query: "PID", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range page.Items {
		if item.EntryID != "PID" {
			continue
		}
		found = true
		if item.FeatureState != "AVAILABLE" {
			t.Fatalf("PID featureState=%q; want AVAILABLE", item.FeatureState)
		}
		if len(item.ContentSHA256) != 64 {
			t.Fatalf("contentSha256 hỏng: %q", item.ContentSHA256)
		}
	}
	if !found {
		t.Fatalf("không thấy PID trong trang SYSTEM: %+v", page.Items)
	}
}
