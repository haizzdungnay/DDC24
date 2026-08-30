package application

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"mkddc-web/internal/programming/coreipc"
)

// MonitorSnapshotProvider chiếu snapshot bounded đã được Core chụp tại cuối
// scan. BE chỉ nối identity Variable/Binding của Revision active; không tự tính
// lại arbitration, quality hay giá trị điều khiển.
type MonitorSnapshotProvider interface {
	ReadProgrammingMonitorSnapshot(context.Context) (MonitorTruthSnapshot, error)
}

type MonitorTruthSnapshot struct {
	ObservedAt string
	SafeState  bool
	// SafeStateNoControllerOnly: true khi safe-state chỉ do chưa có Program
	// nào đang thật sự điều khiển output (trigger T7 đơn độc), không có lỗi
	// I/O/stale/overrun thật đi kèm. Dùng để RuntimeService không chặn
	// Commission trong đúng trường hợp mà Commission sẽ tự giải quyết.
	SafeStateNoControllerOnly bool
	// CapturedMonotonicNs là mốc đồng hồ monotonic lúc Core chụp snapshot. Nó
	// CÙNG HỌ đồng hồ với `ProgramMetricsView.LastRunMonoNS`, nên tuổi của một
	// lần chạy tính được bằng đúng một phép trừ TRONG CÙNG snapshot — không
	// phải so đồng hồ tường của hai máy khác nhau.
	CapturedMonotonicNs uint64
	Task                *TaskMetricsView
	// Programs: nil KHÁC HẲN slice rỗng, và sự phân biệt đó đi suốt từ JSON của
	// Core tới đây.
	//
	//   nil  ⇒ Core không nói gì về Program (khoá `programs` vắng — Core đời cũ)
	//          ⇒ người đọc phải ra `UNAVAILABLE`.
	//   []   ⇒ Core sống và nói rõ "hệ không có Program nào".
	Programs []ProgramMetricsView
	// ProgramsTruncated: Core đã cắt ở trần `kMaxProgramsTotal` (32) ⇒ danh
	// sách KHÔNG đầy đủ.
	ProgramsTruncated bool
	Points            []MonitorPointTruth
}

// ProgramMetricsView là read-back sống của MỘT Program, giữ nguyên đơn vị và
// nguyên văn trạng thái của Core. Lớp này KHÔNG dịch trạng thái và KHÔNG tính
// `health` — hai việc đó thuộc `ListPrograms` (D-07/D-04) và cần bản nguyên văn
// (`ROLLED_BACK`) mới làm đúng được.
type ProgramMetricsView struct {
	InstanceID string
	// State: nguyên văn `StProgramState`.
	State                    string
	Enabled                  bool
	PeriodMS                 int
	LastExecNS               uint64
	MaxExecNS                uint64
	MissedReleaseCount       uint32
	ConsecutiveMissedRelease uint32
	// LastRunMonoNS: 0 = chưa chạy lần nào kể từ lần activate gần nhất.
	LastRunMonoNS uint64
	Lane          int
	// LÝ DO fault gần nhất do Core cấp.
	//
	// `nil` = Core KHÔNG gửi trường này (bản Core cũ hơn lát
	// `F-PROG-ASBUILT-FAULT-REASON`); chuỗi rỗng = Core có gửi và Program chưa
	// từng fault. Gộp hai câu đó lại sẽ báo "chưa từng hỏng" cho đúng một
	// Program đang FAULTED trên một Core chưa nâng cấp.
	LastFaultCode *string
	LastFaultLine *uint32
	FaultCount    *uint32
}

type MonitorPointTruth struct {
	Category           string
	PointID            string
	DeviceID           string
	ObservedAt         string
	ActualValue        any
	ProgramValue       *float64
	Source             string
	EffectivePriority  *int
	OverrideActor      string
	OverrideRemainingS *int64
	Quality            string
	Unit               string
}

type TaskMetricsView struct {
	TaskID              string `json:"taskId"`
	PeriodMS            int    `json:"periodMs"`
	BudgetMS            int    `json:"budgetMs"`
	State               string `json:"state"`
	RunCount            uint32 `json:"runCount"`
	MissedReleaseCount  uint32 `json:"missedReleaseCount"`
	LastExecNS          uint64 `json:"lastExecNs"`
	MaxExecNS           uint64 `json:"maxExecNs"`
	OverrunCount        uint32 `json:"overrunCount"`
	ConsecutiveOverruns uint32 `json:"consecutiveOverruns"`
}

type MonitorPointRef struct {
	Category string `json:"category"`
	PointID  string `json:"pointId"`
	DeviceID string `json:"deviceId,omitempty"`
}

type MonitorSampleView struct {
	VariableID         string          `json:"variableId"`
	VariableName       string          `json:"variableName"`
	ProgramID          string          `json:"programId"`
	Point              MonitorPointRef `json:"point"`
	Direction          string          `json:"direction"`
	DataType           string          `json:"dataType"`
	Unit               string          `json:"unit,omitempty"`
	ProgramValue       any             `json:"programValue"`
	ActualValue        any             `json:"actualValue"`
	OverriddenBy       *string         `json:"overriddenBy"`
	EffectivePriority  *int            `json:"effectivePriority"`
	OverrideActor      *string         `json:"overrideActor"`
	OverrideRemainingS *int64          `json:"overrideRemainingS"`
	Quality            string          `json:"quality"`
	ObservedAt         string          `json:"observedAt"`
	Freshness          string          `json:"freshness"`
}

// ProducerStampView — `T59-810`. `activeRevisionId` một mình KHÔNG giữ được
// mạch: hai snapshot cùng một Revision vẫn có thể tới sai thứ tự (poll chồng
// nhau, retry), và khi đó giá trị đi lùi mà không ai biết.
//
// `CapturedMonotonicNs` là chuỗi thập phân chứ không phải số, có chủ đích:
// nanosecond kể từ boot vượt `Number.MAX_SAFE_INTEGER` sau ~104 ngày uptime,
// nên truyền dạng number sẽ khiến client JavaScript làm tròn im lặng đúng lúc
// thiết bị chạy lâu nhất — tức đúng lúc dấu này cần thiết nhất.
type ProducerStampView struct {
	CapturedMonotonicNs string `json:"capturedMonotonicNs"`
}

type MonitorPageView struct {
	SchemaVersion    string              `json:"schemaVersion"`
	ActiveRevisionID *string             `json:"activeRevisionId"`
	Producer         ProducerStampView   `json:"producer"`
	SafeState        bool                `json:"safeState"`
	Task             *TaskMetricsView    `json:"task"`
	Items            []MonitorSampleView `json:"items"`
}

type monitorVariable struct {
	VariableID string `json:"variableId"`
	ProgramID  string `json:"programId"`
	Name       string `json:"name"`
}

type monitorBinding struct {
	VariableID string          `json:"variableId"`
	Point      MonitorPointRef `json:"point"`
	Direction  string          `json:"direction"`
	DataType   string          `json:"dataType"`
	Unit       string          `json:"unit"`
}

func (s *RuntimeService) GetMonitor(ctx context.Context) (MonitorPageView, error) {
	if s.monitor == nil || s.store == nil {
		return MonitorPageView{}, fmt.Errorf("Programming monitor provider chưa cấu hình")
	}
	status, err := s.callStatus(ctx)
	if err != nil {
		return MonitorPageView{}, err
	}
	var impact runtimeImpactPayload
	if err := coreipcDecodeRuntimePayload(status, &impact); err != nil {
		return MonitorPageView{}, err
	}
	activeRevisionID := firstNonNil(impact.ActiveRevisionID, status.ActiveRevisionID)
	if activeRevisionID == nil {
		/* Chưa có Revision active thì cũng chưa có producer nào để đóng dấu.
		 * Trả `"0"` chứ không bỏ trống: hợp đồng khai `producer` là bắt buộc,
		 * và `"0"` không bao giờ lớn hơn một mốc thật nên nó không thể vô tình
		 * qua được phép so thứ tự ở client. */
		return MonitorPageView{SchemaVersion: "1.0", Producer: ProducerStampView{CapturedMonotonicNs: "0"}, Items: []MonitorSampleView{}}, nil
	}
	revision, err := s.store.GetRevision(ctx, *activeRevisionID)
	if err != nil {
		return MonitorPageView{}, err
	}
	truth, err := s.monitor.ReadProgrammingMonitorSnapshot(ctx)
	if err != nil {
		return MonitorPageView{}, err
	}
	variables := make(map[string]monitorVariable)
	bindings := make([]monitorBinding, 0)
	// Draft v2 KHÔNG seal biến thành Revision object `VARIABLE` riêng — biến
	// nằm trong `locals` của chính POU (`draft.go` chỉ ghi METADATA/POU/SIGNAL/
	// BINDING). Bản trước chỉ đọc nhánh `VARIABLE` v1, nên bảng `variables`
	// LUÔN rỗng, mọi Binding bị `continue` bỏ qua và Runtime Monitor trả
	// `items: []` cho MỌI Revision — màn Theo dõi không bao giờ hiện được một
	// biến ánh xạ nào. Đọc cả hai nguồn như `checks_invariants.go` đã làm:
	// `locals` của POU cho Draft v2, object `VARIABLE` cho Revision v1 cũ.
	programIDByObject := make(map[string]string)
	for _, object := range revision.Objects {
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
				Name       string `json:"name"`
			} `json:"locals"`
		}
		if err := json.Unmarshal(object.PayloadJSON, &payload); err != nil {
			return MonitorPageView{}, fmt.Errorf("decode POU monitor: %w", err)
		}
		// `objectId` sở hữu source; `programId` mới là identity runtime ổn
		// định (DDD §4.2/§4.3). Trộn hai UUID này làm Monitor gắn biến vào một
		// Program không tồn tại ở runtime.
		runtimeID := payload.ProgramConfig.ProgramID
		if object.Kind == "PROGRAM" {
			if runtimeID == "" {
				runtimeID = object.ObjectID
			}
			programIDByObject[object.ObjectID] = runtimeID
		}
		for _, local := range payload.Locals {
			owner := local.ProgramID
			if owner == "" {
				owner = runtimeID
			}
			if owner == "" {
				owner = object.ObjectID
			}
			variables[local.VariableID] = monitorVariable{
				VariableID: local.VariableID, ProgramID: owner, Name: local.Name,
			}
		}
	}
	for _, object := range revision.Objects {
		switch object.Kind {
		case "VARIABLE":
			var value monitorVariable
			if err := json.Unmarshal(object.PayloadJSON, &value); err != nil {
				return MonitorPageView{}, fmt.Errorf("decode Variable monitor: %w", err)
			}
			if mapped := programIDByObject[value.ProgramID]; mapped != "" {
				value.ProgramID = mapped
			}
			variables[value.VariableID] = value
		case "BINDING":
			var value monitorBinding
			if err := json.Unmarshal(object.PayloadJSON, &value); err != nil {
				return MonitorPageView{}, fmt.Errorf("decode Binding monitor: %w", err)
			}
			bindings = append(bindings, value)
		}
	}
	truthByPoint := make(map[string]MonitorPointTruth, len(truth.Points))
	for _, point := range truth.Points {
		truthByPoint[monitorPointKey(point.Category, point.DeviceID, point.PointID)] = point
	}
	page := MonitorPageView{
		SchemaVersion: "1.0", ActiveRevisionID: activeRevisionID,
		// Dấu producer đi CÙNG payload, không phải header: nó là thuộc tính của
		// dữ liệu, nên nó phải sống sót qua mọi lần chuyển tiếp/cache.
		Producer:  ProducerStampView{CapturedMonotonicNs: strconv.FormatUint(truth.CapturedMonotonicNs, 10)},
		SafeState: truth.SafeState, Task: truth.Task,
		Items: make([]MonitorSampleView, 0, len(bindings)),
	}
	for _, binding := range bindings {
		variable, ok := variables[binding.VariableID]
		if !ok {
			continue
		}
		point, present := truthByPoint[monitorPointKey(binding.Point.Category, binding.Point.DeviceID, binding.Point.PointID)]
		sample := MonitorSampleView{
			VariableID: variable.VariableID, VariableName: variable.Name, ProgramID: variable.ProgramID,
			Point: binding.Point, Direction: binding.Direction, DataType: binding.DataType,
			Unit: binding.Unit, Quality: "UNKNOWN", Freshness: "UNAVAILABLE",
		}
		if present {
			sample.ActualValue = point.ActualValue
			sample.Quality = point.Quality
			sample.ObservedAt = point.ObservedAt
			if sample.ObservedAt == "" {
				sample.ObservedAt = truth.ObservedAt
			}
			sample.Freshness = monitorFreshness(s.now(), sample.ObservedAt)
			sample.EffectivePriority = point.EffectivePriority
			sample.OverrideRemainingS = point.OverrideRemainingS
			if point.OverrideActor != "" {
				actor := point.OverrideActor
				sample.OverrideActor = &actor
			}
			if point.EffectivePriority != nil && *point.EffectivePriority < 5 {
				source := point.Source
				sample.OverriddenBy = &source
			}
			if binding.Direction == "WRITE" || binding.Direction == "READ_WRITE" {
				if point.ProgramValue != nil {
					sample.ProgramValue = *point.ProgramValue
				}
			} else {
				sample.ProgramValue = point.ActualValue
			}
			if sample.Unit == "" {
				sample.Unit = point.Unit
			}
		}
		page.Items = append(page.Items, sample)
	}
	return page, nil
}

func coreipcDecodeRuntimePayload(response coreipc.Response, target *runtimeImpactPayload) error {
	return coreipc.DecodePayload(response.Payload, target)
}

func monitorPointKey(category, deviceID, pointID string) string {
	return category + "\x00" + deviceID + "\x00" + pointID
}

func monitorFreshness(now time.Time, observedAt string) string {
	observed, err := time.Parse(time.RFC3339Nano, observedAt)
	if err != nil {
		return "UNAVAILABLE"
	}
	age := now.Sub(observed)
	if age < 0 {
		age = -age
	}
	if age > 3*time.Second {
		return "STALE"
	}
	return "LIVE"
}
