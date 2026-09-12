package programminghttp

import (
	"fmt"
	"sort"

	"mkddc-web/internal/programming/domain"
)

type ImpactStatus string

const (
	ImpactNone        ImpactStatus = "NONE"
	ImpactPresent     ImpactStatus = "PRESENT"
	ImpactUnavailable ImpactStatus = "UNAVAILABLE"
)

type ImpactKey string

const (
	ImpactRetain               ImpactKey = "retain"
	ImpactActiveOverrides      ImpactKey = "activeOverrides"
	ImpactCutover              ImpactKey = "cutover"
	ImpactOutputMappingChanges ImpactKey = "outputMappingChanges"
	ImpactPublishedSignals     ImpactKey = "publishedSignals"
	ImpactControlLibrary       ImpactKey = "controlLibrary"
	ImpactProgramSet           ImpactKey = "programSet"
	ImpactEnableIntent         ImpactKey = "enableIntent"
	/* `ISS-PIO-29` — bốn nhóm TÁCH THEO NGUỒN Point (đề bài §33).
	 *
	 * `outputMappingChanges` gộp cả ba nguồn, nên người vận hành thấy "3 thay
	 * đổi ánh xạ" mà không biết đó là ba mapping Modbus hay ba mapping AO —
	 * hai mức rủi ro rất khác nhau khi bấm Commission. */
	ImpactPhysicalMappingChanges  ImpactKey = "physicalMappingChanges"
	ImpactVirtualPointChanges     ImpactKey = "virtualPointChanges"
	ImpactModbusMappingChanges    ImpactKey = "modbusMappingChanges"
	ImpactWritableOutputsAffected ImpactKey = "writableOutputsAffected"
)

var allImpactKeys = []ImpactKey{
	ImpactRetain,
	ImpactActiveOverrides,
	ImpactCutover,
	ImpactOutputMappingChanges,
	ImpactPublishedSignals,
	ImpactControlLibrary,
	ImpactProgramSet,
	ImpactEnableIntent,
	ImpactPhysicalMappingChanges,
	ImpactVirtualPointChanges,
	ImpactModbusMappingChanges,
	ImpactWritableOutputsAffected,
}

type ImpactGroup struct {
	Status ImpactStatus `json:"status"`
	Items  []string     `json:"items"`
	Reason string       `json:"reason,omitempty"`
}

type Impact struct {
	ImpactRef            string      `json:"impactRef"`
	Retain               ImpactGroup `json:"retain"`
	ActiveOverrides      ImpactGroup `json:"activeOverrides"`
	Cutover              ImpactGroup `json:"cutover"`
	OutputMappingChanges ImpactGroup `json:"outputMappingChanges"`
	PublishedSignals     ImpactGroup `json:"publishedSignals"`
	ControlLibrary       ImpactGroup `json:"controlLibrary"`
	ProgramSet           ImpactGroup `json:"programSet"`
	EnableIntent         ImpactGroup `json:"enableIntent"`
	// `ISS-PIO-29` — bốn nhóm tách theo nguồn Point.
	PhysicalMappingChanges  ImpactGroup `json:"physicalMappingChanges"`
	VirtualPointChanges     ImpactGroup `json:"virtualPointChanges"`
	ModbusMappingChanges    ImpactGroup `json:"modbusMappingChanges"`
	WritableOutputsAffected ImpactGroup `json:"writableOutputsAffected"`
}

type CommissionRequest struct {
	SchemaVersion            string      `json:"schemaVersion"`
	RevisionID               string      `json:"revisionId"`
	ExpectedActiveRevisionID *string     `json:"expectedActiveRevisionId"`
	CheckID                  string      `json:"checkId"`
	ImpactRef                string      `json:"impactRef"`
	Acknowledgements         []ImpactKey `json:"acknowledgements"`
	Cutover                  struct {
		Requested     string  `json:"requested"`
		GraphBackupID *string `json:"graphBackupId,omitempty"`
	} `json:"cutover"`
}

type RestoreRequest struct {
	SchemaVersion            string  `json:"schemaVersion"`
	RevisionID               string  `json:"revisionId"`
	ExpectedActiveRevisionID *string `json:"expectedActiveRevisionId"`
	Reason                   string  `json:"reason"`
	// Acknowledgements — `ISS-PIO-38` (#492). RESTORE chịu cùng phép kiểm slot
	// Modbus như COMMISSION; khi bố cục slot đã lệch, đây là đường thoát TƯỜNG
	// MINH: người vận hành gửi token `modbus-slot-mismatch-override` để xác nhận
	// đã đọc cảnh báo lệch slot. Optional — RESTORE không lệch slot thì không
	// cần, và một xác nhận khống bị server từ chối.
	Acknowledgements []string `json:"acknowledgements,omitempty"`
}

// RetainResetRequest (WP-12). `ExpectedActiveRevisionID` bắt buộc (không như
// Restore) — Core dùng chính giá trị này để từ chối reset một Revision không
// còn Active (business rule §9 "không reset non-active Revision"). `Reason`
// đóng vai trò xác nhận mạnh (strong confirmation) như Restore, vì đây cũng
// là một hành động Admin-only không thể hoàn tác.
type RetainResetRequest struct {
	SchemaVersion            string `json:"schemaVersion"`
	ExpectedActiveRevisionID string `json:"expectedActiveRevisionId"`
	Reason                   string `json:"reason"`
}

func (i Impact) groups() map[ImpactKey]ImpactGroup {
	return map[ImpactKey]ImpactGroup{
		ImpactRetain:               i.Retain,
		ImpactActiveOverrides:      i.ActiveOverrides,
		ImpactCutover:              i.Cutover,
		ImpactOutputMappingChanges: i.OutputMappingChanges,
		ImpactPublishedSignals:     i.PublishedSignals,
		ImpactControlLibrary:       i.ControlLibrary,
		ImpactProgramSet:           i.ProgramSet,
		ImpactEnableIntent:         i.EnableIntent,

		ImpactPhysicalMappingChanges:  i.PhysicalMappingChanges,
		ImpactVirtualPointChanges:     i.VirtualPointChanges,
		ImpactModbusMappingChanges:    i.ModbusMappingChanges,
		ImpactWritableOutputsAffected: i.WritableOutputsAffected,
	}
}

// ValidateImpactAcknowledgements thực thi đúng một bất biến của FE/BE/QA:
// acknowledgement phải bằng chính xác tập nhóm PRESENT. Thiếu/null/status lạ
// được xử lý như UNAVAILABLE để Commission fail-closed.
func ValidateImpactAcknowledgements(current Impact, request CommissionRequest) *domain.PublicError {
	if request.ImpactRef == "" || current.ImpactRef == "" || request.ImpactRef != current.ImpactRef {
		err := domain.NewPublicError(domain.ErrImpactStale)
		err.Field = "impactRef"
		err.Args = map[string]any{"expected": current.ImpactRef, "actual": request.ImpactRef}
		return &err
	}

	provided := make(map[ImpactKey]struct{}, len(request.Acknowledgements))
	for _, key := range request.Acknowledgements {
		if !knownImpactKey(key) {
			return acknowledgementError(domain.ErrAckUnexpected, key)
		}
		if _, duplicate := provided[key]; duplicate {
			return acknowledgementError(domain.ErrAckUnexpected, key)
		}
		provided[key] = struct{}{}
	}

	groups := current.groups()
	missing := make([]string, 0)
	unexpected := make([]string, 0)
	for _, key := range allImpactKeys {
		group := groups[key]
		switch group.Status {
		case ImpactPresent:
			if len(group.Items) == 0 {
				return impactUnavailableError(key, "present_without_items")
			}
			if _, ok := provided[key]; !ok {
				missing = append(missing, string(key))
			}
		case ImpactNone:
			if _, ok := provided[key]; ok {
				unexpected = append(unexpected, string(key))
			}
		case ImpactUnavailable:
			return impactUnavailableError(key, group.Reason)
		default:
			return impactUnavailableError(key, "missing_or_unknown_status")
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		err := domain.NewPublicError(domain.ErrAckMissing)
		err.Field = "acknowledgements"
		err.Args = map[string]any{"keys": missing}
		return &err
	}
	if len(unexpected) > 0 {
		sort.Strings(unexpected)
		err := domain.NewPublicError(domain.ErrAckUnexpected)
		err.Field = "acknowledgements"
		err.Args = map[string]any{"keys": unexpected}
		return &err
	}
	return nil
}

func knownImpactKey(candidate ImpactKey) bool {
	for _, key := range allImpactKeys {
		if candidate == key {
			return true
		}
	}
	return false
}

func acknowledgementError(code domain.ErrorCode, key ImpactKey) *domain.PublicError {
	err := domain.NewPublicError(code)
	err.Field = "acknowledgements"
	err.Args = map[string]any{"key": string(key)}
	return &err
}

func impactUnavailableError(key ImpactKey, reason string) *domain.PublicError {
	err := domain.NewPublicError(domain.ErrImpactUnavailable)
	err.Field = fmt.Sprintf("impact.%s", key)
	err.Args = map[string]any{"key": string(key)}
	// reason là detail nội bộ, có thể chứa path/host; không đưa ra public args.
	_ = reason
	return &err
}
