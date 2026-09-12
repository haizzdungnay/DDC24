package application

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
)

// Bất biến CẤP PACKAGE (DDD §4.5/§4.6). Loader v2 cũng kiểm hai bất biến này
// (T59-106) vì artifact có thể tới từ nơi khác — nhưng kiểm ở Check là thứ duy
// nhất cho người dùng biết PHẢI SỬA GÌ. Để loader từ chối lúc Commission nghĩa
// là báo lỗi ở chỗ xa nguyên nhân nhất.
//
// Kiểm TRƯỚC khi biên dịch: một package có hai Program cùng ghi một output là
// package sai bất kể từng Program compile sạch hay không, và biên dịch 32
// Program rồi mới báo là lãng phí đúng thứ người dùng đang chờ.

type packageBinding struct {
	bindingID  string
	programID  string
	variableID string
	variable   string
	direction  string
	category   string
	pointID    string
	deviceID   string
	extIndex   int
	writable   bool
	typed      bool
}

type packageSignal struct {
	signalID      string
	name          string
	dataType      string
	unit          string
	publisherID   string
	freshnessMs   float64
	stalePolicy   string
	fallbackValue *float64
	hasFallback   bool
	consumerCount int
}

// packageInvariantDiagnostics gộp mọi vi phạm cấp package. Nó KHÔNG dừng ở lỗi
// đầu tiên vì cùng lý do `compilerInputs` không dừng: người dùng phải thấy hết
// trong một lần Check.
func packageInvariantDiagnostics(objects []revisionObjectView) []DiagnosticView {
	bindings, signals, programIDs := collectPackageObjects(objects)
	diagnostics := make([]DiagnosticView, 0)
	diagnostics = append(diagnostics, outputOwnerDiagnostics(bindings)...)
	diagnostics = append(diagnostics, signalDiagnostics(signals, programIDs)...)
	return diagnostics
}

type revisionObjectView struct {
	ObjectID string
	Kind     string
	Payload  []byte
}

func collectPackageObjects(objects []revisionObjectView) ([]packageBinding, []packageSignal, map[string]struct{}) {
	bindings := make([]packageBinding, 0)
	signals := make([]packageSignal, 0)
	programIDs := make(map[string]struct{})
	programIDByObject := make(map[string]string)
	variableOwner := make(map[string]string)

	// Pha 1 dựng bảng identity. `objectId` sở hữu source/source-map, còn
	// `programId` mới là identity runtime ổn định (DDD §4.2/§4.3). Hai UUID có
	// thể khác nhau; trộn chúng làm signal hợp lệ bị báo mất publisher và làm
	// PROGRAM_TABLE dùng sai instance identity.
	for _, object := range objects {
		if object.Kind != "PROGRAM" && object.Kind != "FUNCTION" && object.Kind != "FUNCTION_BLOCK" {
			continue
		}
		var payload struct {
			ProgramConfig struct {
				ProgramID string `json:"programId"`
			} `json:"programConfig"`
			Locals []struct {
				VariableID string `json:"variableId"`
				ProgramID  string `json:"programId"`
			} `json:"locals"`
		}
		if json.Unmarshal(object.Payload, &payload) != nil {
			continue
		}
		runtimeID := payload.ProgramConfig.ProgramID
		if object.Kind == "PROGRAM" {
			if runtimeID == "" {
				runtimeID = object.ObjectID
			}
			programIDByObject[object.ObjectID] = runtimeID
			programIDs[runtimeID] = struct{}{}
		}
		for _, local := range payload.Locals {
			owner := local.ProgramID
			if owner == "" {
				owner = object.ObjectID
			}
			variableOwner[local.VariableID] = owner
		}
	}
	// Biến v1 là Revision object riêng; giữ đường đọc lịch sử nhưng chuẩn hoá
	// owner về runtime programId nếu payload còn dùng objectId.
	for _, object := range objects {
		if object.Kind != "VARIABLE" {
			continue
		}
		var payload struct {
			VariableID string `json:"variableId"`
			ProgramID  string `json:"programId"`
		}
		if json.Unmarshal(object.Payload, &payload) == nil {
			variableOwner[payload.VariableID] = payload.ProgramID
		}
	}
	normalizeProgramID := func(value string) string {
		if mapped := programIDByObject[value]; mapped != "" {
			return mapped
		}
		return value
	}
	for _, object := range objects {
		switch object.Kind {
		case "BINDING":
			var payload struct {
				BindingID  string `json:"bindingId"`
				ProgramID  string `json:"programId"`
				VariableID string `json:"variableId"`
				Variable   string `json:"variable"`
				Direction  string `json:"direction"`
				PointID    string `json:"pointId"`
				Point      struct {
					Category string `json:"category"`
					PointID  string `json:"pointId"`
					DeviceID string `json:"deviceId"`
					ExtIndex int    `json:"extIndex"`
				} `json:"point"`
				Writable bool `json:"writable"`
			}
			if json.Unmarshal(object.Payload, &payload) != nil {
				continue
			}
			bindingID := payload.BindingID
			if bindingID == "" {
				bindingID = object.ObjectID
			}
			owner := payload.ProgramID
			if owner == "" {
				owner = variableOwner[payload.VariableID]
			}
			owner = normalizeProgramID(owner)
			binding := packageBinding{bindingID: bindingID, programID: owner,
				variableID: payload.VariableID, variable: payload.Variable,
				direction: strings.ToUpper(payload.Direction), category: payload.Point.Category,
				pointID: payload.Point.PointID, deviceID: payload.Point.DeviceID,
				extIndex: payload.Point.ExtIndex, writable: payload.Writable,
				typed: payload.VariableID != "" && payload.Point.Category != ""}
			// Binding v1 để identity điểm ở cấp gốc; v2 gom vào `point`. Đọc cả
			// hai để một Revision seal trước khi nâng model vẫn kiểm được.
			if binding.pointID == "" {
				binding.pointID = payload.PointID
			}
			if binding.category == "" {
				binding.category = "LOCAL"
			}
			// `writable=false` với chiều WRITE là mâu thuẫn nội tại của chính
			// binding, nhưng nó thuộc lớp io_map; ở đây chỉ quan tâm quyền sở hữu.
			bindings = append(bindings, binding)
		case "SIGNAL":
			var payload struct {
				SignalID           string   `json:"signalId"`
				Name               string   `json:"name"`
				Type               string   `json:"type"`
				Unit               string   `json:"unit"`
				PublisherProgramID string   `json:"publisherProgramId"`
				FreshnessMs        float64  `json:"freshnessMs"`
				StalePolicy        string   `json:"stalePolicy"`
				FallbackValue      *float64 `json:"fallbackValue"`
			}
			if json.Unmarshal(object.Payload, &payload) != nil {
				continue
			}
			signals = append(signals, packageSignal{signalID: payload.SignalID, name: payload.Name,
				dataType: payload.Type, unit: payload.Unit,
				publisherID: normalizeProgramID(payload.PublisherProgramID),
				freshnessMs: payload.FreshnessMs, stalePolicy: payload.StalePolicy,
				hasFallback: payload.FallbackValue != nil, fallbackValue: payload.FallbackValue})
		}
	}
	return bindings, signals, programIDs
}

// outputOwnerDiagnostics: một binding OUTPUT có ĐÚNG MỘT Program owner (DDD
// §4.6). Hai Program cùng ghi một điểm vật lý là hai nguồn lệnh cho một cơ cấu
// chấp hành — trọng tài ưu tiên không giải quyết được vì cả hai ở cùng mức.
func outputOwnerDiagnostics(bindings []packageBinding) []DiagnosticView {
	owners := make(map[string][]string)
	legacyKeys := make(map[string]bool)
	for _, binding := range bindings {
		if binding.direction != "WRITE" && binding.direction != "OUTPUT" {
			continue
		}
		key := physicalPointKey(binding)
		owners[key] = appendUnique(owners[key], binding.programID)
		legacyKeys[key] = legacyKeys[key] || !binding.typed
	}
	keys := make([]string, 0, len(owners))
	for key := range owners {
		// Cặp binding typed đã được validator server-authoritative báo bằng
		// PGM-MAP-OWNER-001. Chỉ chạy fallback ST-OWN-001 khi chính Point xung
		// đột có ít nhất một binding lịch sử, tránh hai diagnostic cho cùng lỗi
		// chỉ vì package còn một binding legacy không liên quan ở Point khác.
		if legacyKeys[key] && len(owners[key]) > 1 {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	diagnostics := make([]DiagnosticView, 0, len(keys))
	for _, key := range keys {
		programs := owners[key]
		sort.Strings(programs)
		diagnostics = append(diagnostics, packageDiagnostic("ST-OWN-001",
			map[string]any{"pointId": key, "programId": programs[0]},
			map[string]any{"pointId": key, "owners": programs}))
	}
	return diagnostics
}

// physicalPointKey nhận diện ĐIỂM VẬT LÝ, không phải chuỗi `pointId`. Với
// MB_RTU, hai binding cùng `(deviceId, extIndex)` là cùng một thanh ghi kể cả khi
// tên điểm được viết khác nhau — so bằng tên sẽ bỏ lọt đúng trường hợp nguy hiểm.
func physicalPointKey(binding packageBinding) string {
	if binding.category == "MB_RTU" {
		return fmt.Sprintf("MB_RTU:%s#%d", binding.deviceID, binding.extIndex)
	}
	return binding.category + ":" + strings.ToUpper(binding.pointID)
}

// signalDiagnostics kiểm bốn luật của Published Signal (DDD §4.5/§10).
func signalDiagnostics(signals []packageSignal, programIDs map[string]struct{}) []DiagnosticView {
	sorted := append([]packageSignal(nil), signals...)
	sort.Slice(sorted, func(left, right int) bool {
		if !strings.EqualFold(sorted[left].name, sorted[right].name) {
			return strings.ToUpper(sorted[left].name) < strings.ToUpper(sorted[right].name)
		}
		return sorted[left].signalID < sorted[right].signalID
	})

	diagnostics := make([]DiagnosticView, 0)
	publishers := make(map[string]string, len(sorted))
	for _, signal := range sorted {
		folded := strings.ToUpper(signal.name)
		// 1. Một signal có ĐÚNG MỘT publisher. Hai publisher nghĩa là hai nguồn
		// sự thật cho cùng một tên, và consumer không có cách nào biết đọc cái nào.
		if previous, exists := publishers[folded]; exists {
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-001",
				map[string]any{"signalId": signal.signalID, "programId": signal.publisherID},
				map[string]any{"name": signal.name, "publishers": []string{previous, signal.publisherID}}))
			continue
		}
		publishers[folded] = signal.publisherID

		// 2. Publisher phải là một Program có thật trong package. Signal mất
		// publisher là signal không ai ghi — consumer sẽ chờ vĩnh viễn.
		if _, exists := programIDs[signal.publisherID]; !exists {
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-004",
				map[string]any{"signalId": signal.signalID, "programId": signal.publisherID},
				map[string]any{"name": signal.name}))
		}
		// 3. Freshness nằm trong dải mà store và runtime cùng dùng. Ngoài dải
		// nghĩa là một chính sách stale không thực thi được.
		if signal.freshnessMs < 1000 || signal.freshnessMs > 90000 {
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-003",
				map[string]any{"signalId": signal.signalID, "programId": signal.publisherID},
				map[string]any{"name": signal.name, "freshnessMs": int(signal.freshnessMs)}))
		}
		// 4. Kiểu phải nằm trong hệ kiểu ST, và `USE_FALLBACK` phải đi kèm giá
		// trị dự phòng — ba chính sách còn lại thì không. Đây đúng lối "im lặng
		// thay bằng 0" mà DDD §10 cấm.
		if !validSignalType(signal.dataType) {
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-002",
				map[string]any{"signalId": signal.signalID, "programId": signal.publisherID},
				map[string]any{"name": signal.name, "type": signal.dataType}))
		} else if signal.hasFallback &&
			(signal.fallbackValue == nil || !validSignalFallback(signal.dataType, *signal.fallbackValue)) {
			// JSON number là float64 nhưng StCell chỉ có biểu diễn hữu hạn theo
			// từng kiểu. Chặn tại Check để giá trị an toàn không bị làm tròn hoặc
			// wrap âm thầm trong worker/package writer.
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-002",
				map[string]any{"signalId": signal.signalID, "programId": signal.publisherID},
				map[string]any{"name": signal.name, "type": signal.dataType}))
		}
		// Enum ĐÓNG. Trước bản vá này chỉ có phép kiểm cặp đôi bên dưới, nên một
		// chính sách bịa (`"MAGIC"`, chuỗi rỗng, hay `"HOLD_LAST "` thừa khoảng
		// trắng) đi lọt xuống package và buộc runtime phải ĐOÁN thiết bị làm gì
		// khi mất dữ liệu — tức là chọn thay người thiết kế.
		if !validStalePolicy(signal.stalePolicy) {
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-003",
				map[string]any{"signalId": signal.signalID, "programId": signal.publisherID},
				map[string]any{"name": signal.name, "stalePolicy": signal.stalePolicy}))
		} else if (signal.stalePolicy == "USE_FALLBACK") != signal.hasFallback {
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-003",
				map[string]any{"signalId": signal.signalID, "programId": signal.publisherID},
				map[string]any{"name": signal.name, "stalePolicy": signal.stalePolicy}))
		}
	}
	return diagnostics
}

// validStalePolicy giữ đúng ba chính sách mà runtime cài đặt
// (`st_signal_bus.hpp`). Danh sách nằm ở đây chứ không ở một hằng dùng chung vì
// phía Go và phía Core là hai cài đặt độc lập của cùng một hợp đồng — chỗ để
// chúng lệch nhau là chỗ cần một phép kiểm ở CẢ HAI, không phải một biến chung
// làm cả hai cùng sai một lúc.
func validStalePolicy(policy string) bool {
	switch policy {
	case "HOLD_LAST", "USE_FALLBACK", "WAIT":
		return true
	default:
		return false
	}
}

// packageSignals dựng danh sách signal ĐI TRONG container từ chính các object đã
// qua `packageInvariantDiagnostics`. Sắp theo tên để hai lần Check trên cùng
// Revision cho cùng một package — thứ tự đọc DB không phải là dữ liệu.
func packageSignals(objects []revisionObjectView) []programmingcompiler.PackageSignal {
	_, signals, _ := collectPackageObjects(objects)
	sort.Slice(signals, func(left, right int) bool { return signals[left].name < signals[right].name })
	result := make([]programmingcompiler.PackageSignal, 0, len(signals))
	for _, signal := range signals {
		policy := 0
		switch signal.stalePolicy {
		case "USE_FALLBACK":
			policy = 1
		case "WAIT":
			policy = 2
		}
		item := programmingcompiler.PackageSignal{
			Name: signal.name, Publisher: programPackageName(signal.publisherID), Type: signalTypeCode(signal.dataType),
			FreshnessMs: int(signal.freshnessMs), StalePolicy: policy,
		}
		if signal.fallbackValue != nil {
			// Giá trị dự phòng đi xuống runtime dưới dạng BIT của `StCell`, không
			// phải dưới dạng số thập phân đọc lại: mọi lần đổi biểu diễn là một
			// lần làm tròn, và làm tròn giá trị an toàn là đúng thứ không được
			// phép xảy ra âm thầm.
			if bits, ok := encodeSignalFallback(signal.dataType, *signal.fallbackValue); ok {
				item.FallbackBits = &bits
			}
		}
		result = append(result, item)
	}
	return result
}

// encodeSignalFallback mã hoá đúng layout 8 byte của StCell. Phần byte không
// thuộc field đang dùng luôn bằng 0 để package có một biểu diễn canonical.
func encodeSignalFallback(dataType string, value float64) (uint64, bool) {
	if !validSignalFallback(dataType, value) {
		return 0, false
	}
	switch dataType {
	case "BOOL":
		return uint64(value), true
	case "INT", "DINT":
		return uint64(uint32(int32(value))), true
	case "UINT":
		return uint64(uint32(value)), true
	case "REAL":
		return uint64(math.Float32bits(float32(value))), true
	case "TIME":
		// Hợp đồng Draft/REST dùng millisecond; runtime StCell dùng nanosecond.
		return uint64(int64(value) * 1_000_000), true
	default:
		return 0, false
	}
}

// compilerPublishedSignals dùng cùng ảnh đã validate với package writer, nhưng
// giữ type dạng tên vì semantic compiler làm việc ở tầng ST. Mọi Program nhận
// cùng contract; quyền publish được kiểm bằng ProgramID riêng của job.
func compilerPublishedSignals(objects []revisionObjectView) []programmingcompiler.PublishedSignalContract {
	_, signals, _ := collectPackageObjects(objects)
	sort.Slice(signals, func(left, right int) bool { return signals[left].name < signals[right].name })
	result := make([]programmingcompiler.PublishedSignalContract, 0, len(signals))
	for _, signal := range signals {
		result = append(result, programmingcompiler.PublishedSignalContract{
			Name: signal.name, Type: signal.dataType,
			PublisherProgramID: programPackageName(signal.publisherID),
		})
	}
	return result
}

// signalTypeCode ánh xạ tên kiểu ST sang mã `StType` của runtime. Danh sách này
// và `validSignalType` phải cùng một tập — kiểu lọt qua validate mà không có mã
// sẽ đi xuống package với mã 0, tức là một kiểu không tồn tại.
func signalTypeCode(name string) int {
	switch name {
	case "BOOL":
		return 1
	case "DINT":
		return 2
	case "REAL":
		return 3
	case "TIME":
		return 4
	case "INT":
		return 5
	case "UINT":
		return 6
	default:
		return 0
	}
}

func packageDiagnostic(detailCode string, location, args map[string]any) DiagnosticView {
	code := domain.MapComponentError("compiler", detailCode)
	public := domain.NewPublicError(code)
	return DiagnosticView{Code: string(code), DetailCode: detailCode, Severity: "ERROR",
		MessageKey: public.MessageKey, Location: location, Args: domain.SanitizeErrorArgs(code, args)}
}

func appendUnique(values []string, candidate string) []string {
	for _, value := range values {
		if value == candidate {
			return values
		}
	}
	return append(values, candidate)
}
