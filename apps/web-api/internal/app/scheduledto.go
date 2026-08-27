package app

// Scheduler Engine v3.1 — kiểu dữ liệu Schedule Object.
//
// Authority máy-đọc là contracts/config/schedule_v3_1.schema.json (FROZEN
// 2026-08-07). Mọi thay đổi hình dạng ở đây phải đi kèm thay đổi ở đó và một
// ADR mới.
//
// Nguyên tắc: cấu hình là Ý ĐỊNH của người dùng, `Runtime` là SỰ THẬT do
// controller trả về. Hai thứ không được trộn — trộn chính là lớp lỗi FE-DIAG-01.

const scheduleSchemaVersion = "3.1"

// Trạng thái Schedule Object (đặc tả §12).
const (
	scheduleStatusDraft     = "DRAFT"
	scheduleStatusValidated = "VALIDATED"
	scheduleStatusPublished = "PUBLISHED"
	scheduleStatusActive    = "ACTIVE"
	scheduleStatusInactive  = "INACTIVE"
	scheduleStatusDisabled  = "DISABLED"
	scheduleStatusError     = "ERROR"
	scheduleStatusOutOfSync = "OUT_OF_SYNC"
)

// Mã lỗi đặc tả §11. Mọi thông báo lỗi hướng người dùng phải mang một mã.
const (
	errSchedMissingDefault   = "SCH-CONFIG-001"
	errSchedBadWeekly        = "SCH-CONFIG-002"
	errSchedExceptionConflit = "SCH-CONFIG-003"
	errSchedTargetNotFound   = "SCH-TARGET-001"
	errSchedTargetNotWrite   = "SCH-TARGET-002"
	errSchedTargetTypeBad    = "SCH-TARGET-003"
	errSchedBadTimezone      = "SCH-TIME-001"
	errSchedTimeNotSynced    = "SCH-TIME-002"
	errSchedWriteFailed      = "SCH-WRITE-001"
	errSchedWriteTimeout     = "SCH-WRITE-002"
	errSchedRuntimeDown      = "SCH-RUNTIME-001"
	errSchedRevisionConflict = "SCH-VERSION-001"
	errSchedPublishFailed    = "SCH-PUBLISH-001"
	errSchedRollbackFailed   = "SCH-ROLLBACK-001"
)

// Trần dung lượng. maxSchedules đã khai báo ở scheduleapi.go.
const (
	maxScheduleTargets    = 32
	maxScheduleExceptions = 32
	maxScheduleDayEvents  = 24
	// Đặc tả §13.3 đòi lưu tối thiểu 10 revision gần nhất.
	maxScheduleRevisions = 10
	// Mức thật trên PriorityResolver 6 mức mà MỌI lịch dùng chung (ADR-023 QĐ-1).
	scheduleCorePriorityLevel = 4
)

// ScheduleObject là một lịch hoàn chỉnh.
type ScheduleObject struct {
	SchemaVersion      string                  `json:"schema_version"`
	ScheduleID         string                  `json:"schedule_id"`
	ScheduleName       string                  `json:"schedule_name"`
	Description        string                  `json:"description,omitempty"`
	Enabled            bool                    `json:"enabled"`
	Status             string                  `json:"status"`
	Timezone           string                  `json:"timezone"`
	EffectivePeriod    ScheduleEffectivePeriod `json:"effective_period"`
	ValueType          string                  `json:"value_type"`
	PriorityForWriting int                     `json:"priority_for_writing"`
	// CorePriorityLevel dẫn xuất, chỉ đọc. Giao diện PHẢI hiển thị nó cạnh
	// PriorityForWriting, nếu không "Priority 16" là con số vô nghĩa với người
	// vận hành đứng trước bo.
	CorePriorityLevel int                    `json:"core_priority_level"`
	ScheduleDefault   ScheduleValue          `json:"schedule_default"`
	WeeklySchedule    ScheduleWeekly         `json:"weekly_schedule"`
	ExceptionSchedule []ScheduleException    `json:"exception_schedule"`
	TargetObjects     []ScheduleTargetObject `json:"target_objects"`
	BacnetObject      *ScheduleBacnetRef     `json:"bacnet_object,omitempty"`
	Revision          uint64                 `json:"revision"`
	MigratedFromV1    bool                   `json:"migrated_from_v1,omitempty"`
	Runtime           *ScheduleRuntimeState  `json:"runtime,omitempty"`
	CreatedAt         string                 `json:"created_at,omitempty"`
	CreatedBy         string                 `json:"created_by,omitempty"`
	UpdatedAt         string                 `json:"updated_at,omitempty"`
	UpdatedBy         string                 `json:"updated_by,omitempty"`
}

// ScheduleValue bọc giá trị để hợp đồng có chỗ mở rộng mà không phá kiểu.
type ScheduleValue struct {
	Value any `json:"value"`
}

type ScheduleEffectivePeriod struct {
	StartDate *string `json:"start_date"`
	EndDate   *string `json:"end_date"`
}

// ScheduleWeekly luôn đủ bảy ngày, kể cả ngày rỗng (đặc tả §6.1).
type ScheduleWeekly struct {
	Mon []ScheduleTimeValue `json:"MON"`
	Tue []ScheduleTimeValue `json:"TUE"`
	Wed []ScheduleTimeValue `json:"WED"`
	Thu []ScheduleTimeValue `json:"THU"`
	Fri []ScheduleTimeValue `json:"FRI"`
	Sat []ScheduleTimeValue `json:"SAT"`
	Sun []ScheduleTimeValue `json:"SUN"`
}

// Days trả bảy ngày theo thứ tự Thứ Hai → Chủ nhật kèm khoá JSON, để việc duyệt
// không phải lặp lại bảy lần ở mỗi nơi dùng.
func (w *ScheduleWeekly) Days() []struct {
	Key    string
	Events *[]ScheduleTimeValue
} {
	return []struct {
		Key    string
		Events *[]ScheduleTimeValue
	}{
		{"MON", &w.Mon}, {"TUE", &w.Tue}, {"WED", &w.Wed}, {"THU", &w.Thu},
		{"FRI", &w.Fri}, {"SAT", &w.Sat}, {"SUN", &w.Sun},
	}
}

type ScheduleTimeValue struct {
	Time  string `json:"time"`
	Value any    `json:"value"`
}

type ScheduleException struct {
	ExceptionID   string              `json:"exception_id"`
	Name          string              `json:"name"`
	DateRule      ScheduleDateRule    `json:"date_rule"`
	EventPriority int                 `json:"event_priority"`
	TimeValues    []ScheduleTimeValue `json:"time_values"`
}

// ScheduleDateRule gộp năm kiểu quy tắc ngày. Trường nào không thuộc kiểu đang
// dùng thì bỏ trống — validate chịu trách nhiệm bắt trường thiếu.
type ScheduleDateRule struct {
	Type        string `json:"type"`
	Date        string `json:"date,omitempty"`
	StartDate   string `json:"start_date,omitempty"`
	EndDate     string `json:"end_date,omitempty"`
	Month       *int   `json:"month,omitempty"`
	WeekOfMonth *int   `json:"week_of_month,omitempty"`
	DayOfWeek   *int   `json:"day_of_week,omitempty"`
	CalendarID  string `json:"calendar_id,omitempty"`
	GroupID     string `json:"group_id,omitempty"`
}

type ScheduleTargetObject struct {
	TargetID   string `json:"target_id"`
	TargetType string `json:"target_type"`
	// INTERNAL_POINT
	PointKind string `json:"point_kind,omitempty"`
	Channel   *int   `json:"channel,omitempty"`
	PointID   string `json:"point_id,omitempty"`
	// BACNET_OBJECT (P4)
	DeviceID           string `json:"device_id,omitempty"`
	DeviceInstance     *int   `json:"device_instance,omitempty"`
	ObjectType         string `json:"object_type,omitempty"`
	ObjectInstance     *int   `json:"object_instance,omitempty"`
	PropertyIdentifier string `json:"property_identifier,omitempty"`
	ArrayIndex         *int   `json:"array_index,omitempty"`
}

type ScheduleBacnetRef struct {
	ObjectType     string `json:"object_type"`
	ObjectInstance int    `json:"object_instance"`
	Exposed        bool   `json:"exposed"`
}

// ScheduleRuntimeState là SỰ THẬT do controller trả về. Client không bao giờ
// được ghi khối này; thiếu trường nào thì giao diện hiển thị gạch ngang.
type ScheduleRuntimeState struct {
	EffectiveValue    any                     `json:"effective_value"`
	ValueSource       *string                 `json:"value_source"`
	SourceExceptionID *string                 `json:"source_exception_id"`
	NextTransitionAt  *string                 `json:"next_transition_at"`
	AppliedRevision   *uint64                 `json:"applied_revision"`
	LastEvaluatedAt   *string                 `json:"last_evaluated_at"`
	ErrorCode         *string                 `json:"error_code"`
	Targets           []ScheduleTargetRuntime `json:"targets"`
}

type ScheduleTargetRuntime struct {
	TargetID     string  `json:"target_id"`
	WriteResult  *string `json:"write_result"`
	WrittenValue any     `json:"written_value"`
	ActualValue  any     `json:"actual_value"`
	// OverriddenBy trả lời câu hỏi tốn nhiều thời gian hiện trường nhất:
	// "lịch bật rồi mà sao thiết bị không chạy".
	OverriddenBy *string `json:"overridden_by"`
	ErrorCode    *string `json:"error_code"`
	LastWriteAt  *string `json:"last_write_at"`
}

// ── Kiểu phụ trợ cho API ──────────────────────────────────────────────────

type ScheduleValidationFinding struct {
	Code     string `json:"code"`
	Path     string `json:"path"`
	Message  string `json:"message"`
	Severity string `json:"severity,omitempty"`
}

type ScheduleValidationResult struct {
	Valid    bool                        `json:"valid"`
	Status   string                      `json:"status,omitempty"`
	Findings []ScheduleValidationFinding `json:"findings"`
}

type SchedulePublishRequest struct {
	Revision      uint64 `json:"revision"`
	Reason        string `json:"reason"`
	CorrelationID string `json:"correlation_id,omitempty"`
}

type SchedulePublishResult struct {
	Result        string  `json:"result"` // ACCEPTED | REJECTED | TIMEOUT
	Revision      uint64  `json:"revision"`
	CorrelationID string  `json:"correlation_id,omitempty"`
	ErrorCode     *string `json:"error_code"`
	ErrorMessage  *string `json:"error_message"`
	AppliedAt     *string `json:"applied_at"`
	Attempts      int     `json:"attempts,omitempty"`
}

type ScheduleRevisionInfo struct {
	Revision   uint64  `json:"revision"`
	CreatedAt  string  `json:"created_at"`
	CreatedBy  string  `json:"created_by"`
	Reason     string  `json:"reason,omitempty"`
	Published  bool    `json:"published"`
	RollbackOf *uint64 `json:"rollback_of"`
}

type ScheduleRollbackRequest struct {
	TargetRevision uint64 `json:"target_revision"`
	Reason         string `json:"reason"`
}

type ScheduleSimulateRequest struct {
	Range     string `json:"range"` // 7_DAYS | 30_DAYS | SPECIFIC_DAY
	StartDate string `json:"start_date,omitempty"`
}

type ScheduleSimulateTransition struct {
	At                 string   `json:"at"`
	Source             string   `json:"source"`
	SourceExceptionID  *string  `json:"source_exception_id"`
	Value              any      `json:"value"`
	TargetIDs          []string `json:"target_ids"`
	PriorityForWriting int      `json:"priority_for_writing"`
}

type ScheduleSimulateGap struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type ScheduleSimulateResult struct {
	Transitions []ScheduleSimulateTransition `json:"transitions"`
	Conflicts   []ScheduleValidationFinding  `json:"conflicts"`
	Gaps        []ScheduleSimulateGap        `json:"gaps"`
}

// ScheduleAuditEntry — append-only, đặc tả §20 cấm sửa và xoá.
type ScheduleAuditEntry struct {
	At             string  `json:"at"`
	Actor          string  `json:"actor"`
	Action         string  `json:"action"`
	ScheduleID     string  `json:"schedule_id"`
	RevisionBefore *uint64 `json:"revision_before"`
	RevisionAfter  *uint64 `json:"revision_after"`
	Reason         string  `json:"reason,omitempty"`
	Changes        string  `json:"changes,omitempty"`
	ControllerID   string  `json:"controller_id,omitempty"`
	Result         string  `json:"result,omitempty"`
	ErrorCode      *string `json:"error_code"`
	SourceIP       string  `json:"source_ip,omitempty"`
}
