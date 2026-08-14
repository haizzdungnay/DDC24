package application

import (
	"context"
	"encoding/json"
	"fmt"
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
	Task                      *TaskMetricsView
	Points                    []MonitorPointTruth
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

type MonitorPageView struct {
	SchemaVersion    string              `json:"schemaVersion"`
	ActiveRevisionID *string             `json:"activeRevisionId"`
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
		return MonitorPageView{SchemaVersion: "1.0", Items: []MonitorSampleView{}}, nil
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
	for _, object := range revision.Objects {
		switch object.Kind {
		case "VARIABLE":
			var value monitorVariable
			if err := json.Unmarshal(object.PayloadJSON, &value); err != nil {
				return MonitorPageView{}, fmt.Errorf("decode Variable monitor: %w", err)
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
