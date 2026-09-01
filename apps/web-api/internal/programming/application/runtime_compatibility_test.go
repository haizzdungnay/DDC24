package application

import (
	"context"
	"encoding/json"
	"testing"

	"mkddc-web/internal/programming/domain"
)

// ISS-STED-19: bộ ba tương thích phải ĐI CÙNG NHAU trên endpoint capabilities.
//
// Trước đây ba phiên bản này nằm rải rác (hồ sơ ngôn ngữ ở compiler, registry
// thư viện ở domain, ABI ở profile) và KHÔNG endpoint nào công bố chúng. FE có
// sẵn hằng đã build vào bundle nhưng không có gì để so, nên một bundle cũ vẫn
// vẽ palette/từ khoá của phiên bản khác với phiên bản thiết bị đang biên dịch
// mà không ai biết.
func TestCapabilitiesPublishesCompatibilityTripleFromGeneratedConstants(t *testing.T) {
	service := newRuntimeService(t, &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY"})
	capabilities, err := service.GetCapabilities(context.Background())
	if err != nil {
		t.Fatalf("GetCapabilities: %v", err)
	}
	got := capabilities.Compatibility
	if got.STLanguageProfileVersion != domain.STLanguageProfileVersion {
		t.Fatalf("stLanguageProfileVersion = %q, muốn %q", got.STLanguageProfileVersion, domain.STLanguageProfileVersion)
	}
	if got.STLanguageProfileSHA256 != domain.STLanguageProfileSHA256 {
		t.Fatalf("stLanguageProfileSha256 = %q, muốn %q", got.STLanguageProfileSHA256, domain.STLanguageProfileSHA256)
	}
	if got.LibraryRegistryVersion != domain.SystemLibraryVersion {
		t.Fatalf("libraryRegistryVersion = %q, muốn %q", got.LibraryRegistryVersion, domain.SystemLibraryVersion)
	}
	if got.LibraryRegistrySHA256 != domain.SystemLibraryRegistrySHA256 {
		t.Fatalf("libraryRegistrySha256 = %q, muốn %q", got.LibraryRegistrySHA256, domain.SystemLibraryRegistrySHA256)
	}
	if got.CompilerProfileID != domain.ProfileID {
		t.Fatalf("compilerProfileId = %q, muốn %q", got.CompilerProfileID, domain.ProfileID)
	}
	if got.TargetABI != domain.ProfileTargetABI {
		t.Fatalf("targetAbi = %d, muốn %d", got.TargetABI, domain.ProfileTargetABI)
	}
}

// Không trường nào trong bộ ba được phép rỗng: một chuỗi rỗng ở phía thiết bị
// biến phép so tương thích thành "không so được", và FE sẽ phải đoán. Đây đúng
// là kiểu lệch im lặng mà ISS-STED-19 muốn chấm dứt.
func TestCapabilitiesCompatibilityFieldsAreNeverEmpty(t *testing.T) {
	service := newRuntimeService(t, &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY"})
	capabilities, err := service.GetCapabilities(context.Background())
	if err != nil {
		t.Fatalf("GetCapabilities: %v", err)
	}
	got := capabilities.Compatibility
	for name, value := range map[string]string{
		"stLanguageProfileVersion": got.STLanguageProfileVersion,
		"stLanguageProfileSha256":  got.STLanguageProfileSHA256,
		"libraryRegistryVersion":   got.LibraryRegistryVersion,
		"libraryRegistrySha256":    got.LibraryRegistrySHA256,
		"compilerProfileId":        got.CompilerProfileID,
	} {
		if value == "" {
			t.Fatalf("%s rỗng: FE không có gì để so, lệch phiên bản sẽ đi qua trong im lặng", name)
		}
	}
	if got.TargetABI == 0 {
		t.Fatalf("targetAbi = 0: không phân biệt được 'chưa công bố' với 'ABI số 0'")
	}
}

// Core mất kết nối chỉ làm targetState thành UNAVAILABLE. Bộ ba tương thích là
// hằng ĐÃ BUILD VÀO web-api, không phải thứ hỏi Core mới biết — nếu nó biến mất
// theo Core thì FE mất khả năng cảnh báo lệch phiên bản đúng lúc thiết bị đang
// trục trặc, tức là đúng lúc cần nhất.
func TestCapabilitiesCompatibilitySurvivesCoreUnavailable(t *testing.T) {
	service := newRuntimeService(t, &fakeRuntimeStatusReader{failCall: true})
	capabilities, err := service.GetCapabilities(context.Background())
	if err != nil {
		t.Fatalf("GetCapabilities: %v", err)
	}
	if capabilities.TargetState != "UNAVAILABLE" {
		t.Fatalf("targetState = %q, muốn UNAVAILABLE", capabilities.TargetState)
	}
	if capabilities.Compatibility.STLanguageProfileVersion != domain.STLanguageProfileVersion ||
		capabilities.Compatibility.TargetABI != domain.ProfileTargetABI {
		t.Fatalf("bộ ba tương thích biến mất khi Core mất kết nối: %+v", capabilities.Compatibility)
	}
}

// Khối compatibility phải xuất hiện trong JSON dưới đúng tên FE đọc. Đổi tên
// trường ở Go mà FE không đổi theo sẽ làm phép so im lặng trở lại: FE đọc
// undefined, so undefined với hằng của mình, và không thấy lệch.
func TestCapabilitiesCompatibilityJSONShape(t *testing.T) {
	service := newRuntimeService(t, &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY"})
	capabilities, err := service.GetCapabilities(context.Background())
	if err != nil {
		t.Fatalf("GetCapabilities: %v", err)
	}
	raw, err := json.Marshal(capabilities)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded struct {
		Compatibility map[string]any `json:"compatibility"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, key := range []string{
		"stLanguageProfileVersion", "stLanguageProfileSha256",
		"libraryRegistryVersion", "libraryRegistrySha256",
		"compilerProfileId", "targetAbi",
	} {
		if _, ok := decoded.Compatibility[key]; !ok {
			t.Fatalf("JSON capabilities thiếu compatibility.%s: %s", key, raw)
		}
	}
}
