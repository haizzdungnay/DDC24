package application

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

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
	programID string
	variable  string
	direction string
	category  string
	pointID   string
	deviceID  string
	extIndex  int
}

type packageSignal struct {
	signalID      string
	name          string
	dataType      string
	publisherID   string
	freshnessMs   float64
	stalePolicy   string
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
	for _, object := range objects {
		switch object.Kind {
		case "PROGRAM":
			programIDs[object.ObjectID] = struct{}{}
		case "BINDING":
			var payload struct {
				ProgramID string `json:"programId"`
				Variable  string `json:"variable"`
				Direction string `json:"direction"`
				PointID   string `json:"pointId"`
				Point     struct {
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
			binding := packageBinding{programID: payload.ProgramID, variable: payload.Variable,
				direction: strings.ToUpper(payload.Direction), category: payload.Point.Category,
				pointID: payload.Point.PointID, deviceID: payload.Point.DeviceID, extIndex: payload.Point.ExtIndex}
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
				PublisherProgramID string   `json:"publisherProgramId"`
				FreshnessMs        float64  `json:"freshnessMs"`
				StalePolicy        string   `json:"stalePolicy"`
				FallbackValue      *float64 `json:"fallbackValue"`
			}
			if json.Unmarshal(object.Payload, &payload) != nil {
				continue
			}
			signals = append(signals, packageSignal{signalID: payload.SignalID, name: payload.Name,
				dataType: payload.Type, publisherID: payload.PublisherProgramID,
				freshnessMs: payload.FreshnessMs, stalePolicy: payload.StalePolicy,
				hasFallback: payload.FallbackValue != nil})
		}
	}
	return bindings, signals, programIDs
}

// outputOwnerDiagnostics: một binding OUTPUT có ĐÚNG MỘT Program owner (DDD
// §4.6). Hai Program cùng ghi một điểm vật lý là hai nguồn lệnh cho một cơ cấu
// chấp hành — trọng tài ưu tiên không giải quyết được vì cả hai ở cùng mức.
func outputOwnerDiagnostics(bindings []packageBinding) []DiagnosticView {
	owners := make(map[string][]string)
	for _, binding := range bindings {
		if binding.direction != "WRITE" && binding.direction != "OUTPUT" {
			continue
		}
		owners[physicalPointKey(binding)] = appendUnique(owners[physicalPointKey(binding)], binding.programID)
	}
	keys := make([]string, 0, len(owners))
	for key := range owners {
		if len(owners[key]) > 1 {
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
		}
		if (signal.stalePolicy == "USE_FALLBACK") != signal.hasFallback {
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-003",
				map[string]any{"signalId": signal.signalID, "programId": signal.publisherID},
				map[string]any{"name": signal.name, "stalePolicy": signal.stalePolicy}))
		}
	}
	return diagnostics
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
