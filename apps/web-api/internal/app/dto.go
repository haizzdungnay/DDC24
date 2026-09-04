package app

import (
	"encoding/json"

	webModbus "mkddc-web/internal/modbusrtu"
)

type ConfigDevice struct {
	DeviceID    int    `json:"device_id"`
	DeviceName  string `json:"device_name"`
	Description string `json:"description"`
	Location    string `json:"location"`
}

type ConfigNetwork struct {
	Eth      map[string]any `json:"eth"`
	Wifi     map[string]any `json:"wifi"`
	Hostname string         `json:"hostname"`
}

type ConfigIO struct {
	Revision uint64           `json:"revision,omitempty"`
	Checksum string           `json:"checksum,omitempty"`
	UI       []map[string]any `json:"ui"`
	AO       []map[string]any `json:"ao"`
	DO       []map[string]any `json:"do"`
}

type ConfigSafeState struct {
	Revision uint64           `json:"revision,omitempty"`
	Checksum string           `json:"checksum,omitempty"`
	AO       []map[string]any `json:"ao"`
	DO       []map[string]any `json:"do"`
}

type ConfigBacnet struct {
	BIP map[string]any `json:"bip"`
}

type ConfigFieldbus = webModbus.Config
type ModbusRTUDevice = webModbus.Device
type ModbusRTUPoint = webModbus.Point
type ModbusRTUDiagnostics = webModbus.Diagnostics

type ConfigIOBundle struct {
	BaseRevision uint64          `json:"base_revision,omitempty"`
	Revision     uint64          `json:"revision"`
	Checksum     string          `json:"checksum"`
	IO           ConfigIO        `json:"io"`
	SafeState    ConfigSafeState `json:"safe_state"`
}

type ConfigTime struct {
	Timezone   string   `json:"timezone"`
	NTPEnabled bool     `json:"ntp_enabled"`
	NTPServers []string `json:"ntp_servers"`
	SystemTime string   `json:"system_time"`
	Revision   uint64   `json:"revision"`
}

type ConfigTimeUpdate struct {
	Timezone     string   `json:"timezone"`
	NTPEnabled   bool     `json:"ntp_enabled"`
	NTPServers   []string `json:"ntp_servers"`
	SystemTime   string   `json:"system_time"`
	BaseRevision uint64   `json:"baseRevision"`
	OperationID  string   `json:"operationId"`
}

type TimeStatus struct {
	NowUTC       string   `json:"nowUtc"`
	NowLocal     string   `json:"nowLocal"`
	Timezone     string   `json:"timezone"`
	Mode         string   `json:"mode"`
	Synchronized bool     `json:"synchronized"`
	Source       *string  `json:"source"`
	OffsetMS     *float64 `json:"offsetMs"`
	LastSyncUTC  *string  `json:"lastSyncUtc"`
	RTCPresent   bool     `json:"rtcPresent"`
	RTCUTC       *string  `json:"rtcUtc"`
	Health       string   `json:"health"`
	Warnings     []string `json:"warnings"`
}

type ConfigVirtualPoints struct {
	Items []VirtualPoint `json:"items"`
}

type VirtualPoint struct {
	ID              string  `json:"id"`
	Generation      uint64  `json:"generation"`
	Channel         int     `json:"channel"`
	Tag             string  `json:"tag"`
	Label           string  `json:"label,omitempty"`
	SignalType      string  `json:"signalType"`
	Enabled         bool    `json:"enabled"`
	Writable        bool    `json:"writable"`
	LogEnabled      bool    `json:"logEnabled"`
	LogIntervalMs   *int    `json:"logIntervalMs,omitempty"`
	RetentionS      int     `json:"retentionS,omitempty"`
	Value           any     `json:"value,omitempty"`
	Unit            string  `json:"unit,omitempty"`
	DisplayMin      float64 `json:"displayMin,omitempty"`
	DisplayMax      float64 `json:"displayMax,omitempty"`
	RangeMultiplier int     `json:"rangeMultiplier,omitempty"`
	FilterSamples   int     `json:"filterSamples,omitempty"`
	SensorCal       float64 `json:"sensorCal,omitempty"`
	MathFunction    int     `json:"mathFunction,omitempty"`
	Note            string  `json:"note,omitempty"`
	UpdatedAt       string  `json:"updatedAt,omitempty"`
	/* `ISS-PIO-14` — chính sách giá trị sau khởi động lại (đề bài §13).
	 *
	 * TRIỆU CHỨNG trước bản vá: `Value` gánh HAI nghĩa cùng lúc — "giá trị khởi
	 * tạo do người dùng đặt" và "giá trị hiện hành". Mỗi lệnh ghi runtime ghi đè
	 * nó trong `virtual_points.conf`, nên giá trị khởi tạo BIẾN MẤT ngay lần ghi
	 * đầu tiên và không có đường nào lấy lại. Người dùng đặt 20 °C làm mặc định,
	 * ai đó ép 35 để thử, và sau lần khởi động kế tiếp điểm khởi động ở 35.
	 *
	 * `RestartPolicy`:
	 *   `retain`  — giữ giá trị cuối cùng (mặc định, GIỮ NGUYÊN hành vi cũ).
	 *   `initial` — quay về `InitialValue` khi web-api khởi động.
	 *
	 * Mặc định là `retain` CÓ CHỦ Ý: đây là hành vi các cấu hình đang chạy vẫn
	 * có, nên nạp một tệp cũ không được âm thầm đổi cách thiết bị khởi động. */
	RestartPolicy string `json:"restartPolicy,omitempty"`
	/* InitialValue là giá trị khởi tạo, TÁCH khỏi `Value`.
	 *
	 * Lệnh ghi runtime KHÔNG chạm vào trường này — đó là toàn bộ lý do nó tồn
	 * tại. Vắng mặt nghĩa là "chưa đặt riêng", và khi đó `defaultVirtualPointValue`
	 * theo kiểu tín hiệu là câu trả lời; KHÔNG rơi về `Value`, vì `Value` chính
	 * là thứ đã bị lệnh ghi làm bẩn. */
	InitialValue any `json:"initialValue,omitempty"`
	// BoundPointID nối VP này tới một slot AV/BV thật của Core ("AV-1".."AV-32",
	// "BV-1".."BV-16"), rỗng = chỉ là overlay cấu hình như trước (F-PROG-ASBUILT-014).
	// Khi đặt, giá trị VP được đồng bộ sang Core qua WebIpc mỗi lần ghi
	// (xem syncVirtualPointToCore ở virtualpoint.go) để ST Program bind được
	// category VP hướng READ (resolve_io_bindings chấp nhận từ 2026-08-17).
	BoundPointID string `json:"boundPointId,omitempty"`
	// Source — AI sở hữu giá trị của slot đã bind.
	//
	//   ""/"WEB"  : web-api đồng bộ giá trị cấu hình xuống Core (mặc định,
	//               giữ nguyên hành vi cũ);
	//   "PROGRAM" : ST Program GHI slot này (`VAR_OUTPUT` bind category VP).
	//               web-api KHÔNG đồng bộ nữa.
	//
	// Không có trường này thì hai bên cùng ghi một ô: chương trình đặt giá trị
	// mỗi chu kỳ, còn web-api đẩy lại giá trị cấu hình mỗi lần khởi động hoặc
	// mỗi lần ai đó sửa VP — và ô điểm sẽ nhấp nháy giữa hai nguồn mà không ai
	// thấy nguyên nhân.
	Source string `json:"source,omitempty"`
	// Equipment — `T57-3.1` (`ADR-042`). Rỗng = chưa gán, KHÔNG đoán theo tên.
	Equipment string `json:"equipment,omitempty"`
}

type SystemConfig struct {
	Device        ConfigDevice        `json:"device"`
	Network       ConfigNetwork       `json:"network"`
	IO            ConfigIO            `json:"io"`
	SafeState     ConfigSafeState     `json:"safe_state"`
	VirtualPoints ConfigVirtualPoints `json:"virtual_points"`
	Bacnet        ConfigBacnet        `json:"bacnet"`
	Fieldbus      ConfigFieldbus      `json:"fieldbus"`
	Time          ConfigTime          `json:"time"`
}

type ConfigPutResult struct {
	Result   string   `json:"result"`
	Applied  bool     `json:"applied"`
	Reload   string   `json:"reload"`
	Warnings []string `json:"warnings"`
	Revision uint64   `json:"revision,omitempty"`
	Checksum string   `json:"checksum,omitempty"`
	// Activation là bước Read-back Verify (`ISS-PIO-33`). LUÔN có mặt ở đường
	// ghi I/O: yêu cầu "không có trạng thái trung gian mà người vận hành không
	// nhìn thấy" nghĩa là im lặng không phải một lựa chọn — kể cả khi không
	// kiểm chứng được thì vẫn phải nói ra là không kiểm chứng được.
	Activation *ActivationReport `json:"activation,omitempty"`
}
type TrendSample map[string]any

type TrendConfig struct {
	Enabled          bool     `json:"enabled"`
	PointIDs         []string `json:"pointIds"`
	IntervalS        int      `json:"intervalS"`
	RetentionRecords int      `json:"retentionRecords"`
}

type ScheduleRow struct {
	ID           string          `json:"id"`
	Label        string          `json:"label"`
	Notes        string          `json:"notes,omitempty"`
	Enabled      bool            `json:"enabled"`
	ScheduleType string          `json:"scheduleType"`
	TimeOfDay    string          `json:"timeOfDay,omitempty"`
	StartTime    string          `json:"startTime,omitempty"`
	EndTime      string          `json:"endTime,omitempty"`
	StartDate    string          `json:"startDate,omitempty"`
	EndDate      string          `json:"endDate,omitempty"`
	Weekdays     []string        `json:"weekdays"`
	Target       *ScheduleTarget `json:"target,omitempty"`
	Value        *float64        `json:"value,omitempty"`
}

type ScheduleTarget struct {
	Kind    string `json:"kind"`
	Channel *int   `json:"channel,omitempty"`
	PointID string `json:"pointId,omitempty"`
}

const (
	maxAlarms                  = 64
	maxSourcesPerAlarm         = 16
	maxBacnetPublishedAlarms   = 8
	alarmTypeDisabled          = 0
	alarmTypeHighLowInput      = 1
	alarmTypeSetpointDeviation = 2
	alarmTypeRuntimeHours      = 3
	alarmTypeFanState          = 4
	alarmTypeDigitalOutput     = 5
	alarmTypeAnalogOutput      = 6
	alarmTypePISequence        = 7
)

type AlarmSource struct {
	Kind    string `json:"kind"`
	Channel int    `json:"channel"`
	PointID string `json:"pointId"`
}

// AlarmParams keeps known numeric params type-safe while allowing type-specific optional fields.
type AlarmParams struct {
	HH            *float64       `json:"hh,omitempty"`
	H             *float64       `json:"h,omitempty"`
	L             *float64       `json:"l,omitempty"`
	LL            *float64       `json:"ll,omitempty"`
	Hysteresis    *float64       `json:"hysteresis,omitempty"`
	RuntimeHours  *float64       `json:"runtimeHours,omitempty"`
	SeverityRules []SeverityRule `json:"severityRules,omitempty"`
}

type SeverityRule struct {
	Severity string  `json:"severity"`
	Op       string  `json:"op"`
	Value    float64 `json:"value"`
}

type AlarmSetting struct {
	ID                string        `json:"id"`
	Label             string        `json:"label"`
	Enabled           bool          `json:"enabled"`
	AlarmType         int           `json:"alarmType"`
	Sources           []AlarmSource `json:"sources"`
	Priority          string        `json:"priority"`
	ClearMode         string        `json:"clearMode,omitempty"`
	DelayS            float64       `json:"delayS"`
	PublishBacnet     bool          `json:"publishBacnet"`
	NotificationClass *int          `json:"notificationClass,omitempty"`
	Params            *AlarmParams  `json:"params"`
}

// AlarmSetting mirrors ADR-013/openapi.yaml alarm entity schema.

type CreateUserRequest struct {
	Username string `json:"username"`
	Role     Role   `json:"role"`
	Password string `json:"password"`
}

type ResetPasswordRequest struct {
	NewPassword string `json:"new_password"`
}

type ChangePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

type RuntimePoint struct {
	ID                   string   `json:"id"`
	Kind                 string   `json:"kind"`
	Value                any      `json:"value"`
	Quality              string   `json:"quality"`
	Source               string   `json:"source"`
	Role                 string   `json:"role"`
	Unit                 string   `json:"unit,omitempty"`
	SignalType           string   `json:"signalType,omitempty"`
	Enabled              bool     `json:"enabled,omitempty"`
	LogEnabled           bool     `json:"logEnabled,omitempty"`
	LogIntervalMs        *int     `json:"logIntervalMs,omitempty"`
	RetentionS           int      `json:"retentionS,omitempty"`
	UpdatedAtMonotonicNs uint64   `json:"updatedAtMonotonicNs"`
	Generation           uint64   `json:"generation"`
	ProgramValue         *float64 `json:"programValue"`
	EffectivePriority    *int     `json:"effectivePriority"`
}

type RuntimeTaskSnapshot struct {
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

// RuntimeProgramSnapshot là một dòng của mảng `programs[]` mà Core serialize
// trong `point_snapshot` (T60-001..003, apps/core/domain/graph/
// runtime_point_snapshot.cpp). Tên field khớp NGUYÊN VĂN JSON của Core.
//
// Hai chỗ cực dễ đọc nhầm, đã ghi lại ngay đây để không phải tra ngược:
//
//   - `LastExecNS` là THỜI LƯỢNG một lần chạy (`wall_clock_() - program_start`),
//     KHÔNG phải mốc thời gian. Mốc nằm ở `LastRunMonoNS`, cùng họ đồng hồ với
//     `RuntimePointSnapshot.CapturedMonotonicNs` nên "tuổi" của số đo tính được
//     bằng đúng một phép trừ trong cùng một snapshot.
//   - `MissedReleaseCount` là bộ đếm TÍCH LUỸ; công thức `health` (Plan 60 §4.2
//     điều 4) phải dùng `ConsecutiveMissedRelease` — bộ đếm reset về 0 mỗi lần
//     release đúng hạn. Dùng bộ tích luỹ sẽ ghim Program ở DEGRADED vĩnh viễn.
type RuntimeProgramSnapshot struct {
	InstanceID string `json:"instanceId"`
	// State giữ NGUYÊN VĂN `StProgramState` của Core (RUNNING/STOPPED/ACTIVE/
	// ROLLED_BACK/DISABLED/FAULTED/REJECTED/EMPTY/STAGED/VALIDATED/READY).
	// Ánh xạ sang hợp đồng FE làm ở lớp application (D-07) — dịch sớm ở đây sẽ
	// mất thông tin mà công thức `health` còn cần (ROLLED_BACK).
	State                    string `json:"state"`
	Enabled                  bool   `json:"enabled"`
	PeriodMS                 int    `json:"periodMs"`
	LastExecNS               uint64 `json:"lastExecNs"`
	MaxExecNS                uint64 `json:"maxExecNs"`
	MissedReleaseCount       uint32 `json:"missedReleaseCount"`
	ConsecutiveMissedRelease uint32 `json:"consecutiveMissedRelease"`
	// LastRunMonoNS: 0 = chưa chạy lần nào kể từ lần activate gần nhất. KHÔNG
	// được hiểu 0 là "chạy lúc mốc 0" — đó là dữ liệu bịa.
	LastRunMonoNS uint64 `json:"lastRunMonoNs"`
	Lane          int    `json:"lane"`
	// LÝ DO fault gần nhất, do Core cung cấp.
	//
	// Chuỗi rỗng = chưa từng fault. Khoá VẮNG MẶT lại là câu khác: "Core đời cũ
	// chưa biết trường này" — phía đọc phải ra UNAVAILABLE chứ không kết luận
	// là Program khoẻ. Trước lát này Core ghi lý do rồi bỏ đó, nên một Program
	// nằm FAULTED hai ngày mà không nơi nào nói vì sao.
	LastFaultCode *string `json:"lastFaultCode"`
	LastFaultLine *uint32 `json:"lastFaultLine"`
	FaultCount    *uint32 `json:"faultCount"`
}

type RuntimePointSnapshot struct {
	SnapshotID            uint64 `json:"snapshotId"`
	SnapshotObservedAtUTC string `json:"snapshotObservedAtUtc"`
	CapturedMonotonicNs   uint64 `json:"capturedMonotonicNs"`
	SafeState             bool   `json:"safeState"`
	// SafeStateNoControllerOnly: xem chú thích cùng tên ở core_client.go —
	// true khi safe-state chỉ do chưa có Program nào điều khiển output,
	// không có lỗi thật đi kèm.
	SafeStateNoControllerOnly bool                 `json:"safeStateNoControllerOnly"`
	Task                      *RuntimeTaskSnapshot `json:"task"`
	// Programs: nil KHÁC HẲN slice rỗng và sự khác biệt đó là hợp đồng.
	//
	//   nil  ⇒ khoá `programs` VẮNG trong JSON của Core ⇒ Core đời cũ chưa biết
	//          trường này ⇒ phía đọc phải ra `UNAVAILABLE`.
	//   []   ⇒ Core sống và nói rõ "hệ không có Program nào".
	//
	// Gộp hai tình huống đó lại sẽ báo "không có Program nào" cho một bo mà ta
	// thật ra không đọc được gì (Plan 60 §4.2 điều 1).
	Programs []RuntimeProgramSnapshot `json:"programs"`
	// ProgramsTruncated: Core đã cắt danh sách ở trần `kMaxProgramsTotal` (32).
	// Danh sách khi đó KHÔNG đầy đủ và phải nói ra, không im lặng bỏ bớt.
	ProgramsTruncated bool           `json:"programsTruncated"`
	Points            []RuntimePoint `json:"points"`
}

type HistorianPolicyPatch struct {
	PointID          string `json:"pointId"`
	Generation       uint64 `json:"generation"`
	DBLoggingEnabled bool   `json:"dbLoggingEnabled"`
	DBInterval       string `json:"dbInterval,omitempty"`
	// RetentionDays is optional for backwards-compatible callers. A non-zero
	// value selects a rolling retention window bounded by the interval maximum.
	RetentionDays    int     `json:"retentionDays,omitempty"`
	StartAtUTC       *string `json:"startAtUtc"`
	retentionDaysSet bool
}

type HistorianConfigUpdate struct {
	BaseRevision          uint64                 `json:"baseRevision"`
	BaseNamespaceRevision uint64                 `json:"baseNamespaceRevision"`
	Points                []HistorianPolicyPatch `json:"points"`
}

type HistorianPolicy struct {
	PointID          string `json:"pointId"`
	Generation       uint64 `json:"generation"`
	DBLoggingEnabled bool   `json:"dbLoggingEnabled"`
	DBInterval       string `json:"dbInterval"`
	RetentionDays    int    `json:"retentionDays"`
	MaxRetentionDays int    `json:"maxRetentionDays"`
	HotCacheEnabled  bool   `json:"hotCacheEnabled"`
	HotCacheHours    int    `json:"hotCacheHours"`
	StartAtUTC       string `json:"startAtUtc"`
	State            string `json:"state"`
	Health           string `json:"health"`
	LastError        string `json:"lastError,omitempty"`
}

type HistorianCapacity struct {
	EnabledPoints     int    `json:"enabledPoints"`
	ReservedBytes     uint64 `json:"reservedBytes"`
	BudgetBytes       uint64 `json:"budgetBytes"`
	FreeBytes         uint64 `json:"freeBytes"`
	RequiredFreeBytes uint64 `json:"requiredFreeBytes"`
}

type HistorianConfig struct {
	Revision                   uint64            `json:"revision"`
	ServerNowUTC               string            `json:"serverNowUtc"`
	Points                     []HistorianPolicy `json:"points"`
	Capacity                   HistorianCapacity `json:"capacity"`
	NamespaceState             string            `json:"namespaceState,omitempty"`
	NamespaceRevision          uint64            `json:"namespaceRevision"`
	RetentionMaxDaysByInterval map[string]int    `json:"retentionMaxDaysByInterval"`
}

type PointConfigPatch struct {
	Tag          *string `json:"tag,omitempty"`
	Name         *string `json:"name,omitempty"`
	Unit         *string `json:"unit,omitempty"`
	TrendEnabled *bool   `json:"trendEnabled,omitempty"`
	// Equipment — `T57-3.1` (`ADR-042`): thiết bị công nghệ mà điểm này thuộc
	// về (AHU-1, FCU-03…). Chuỗi tự do đã chuẩn hoá, KHÔNG phải khoá ngoại tới
	// một bảng thiết bị: mô hình thiết bị đầy đủ là quyết định Rev B, còn đây là
	// đường tối thiểu để nhóm điểm theo cách người vận hành nghĩ.
	//
	// Chuỗi rỗng là lệnh GỠ thẻ; `nil` là "không đụng tới".
	Equipment *string `json:"equipment,omitempty"`
}

type PointDTO struct {
	ID                 string   `json:"id"`
	Channel            int      `json:"channel"`
	Tag                string   `json:"tag"`
	Name               string   `json:"name"`
	Kind               string   `json:"kind"`
	Value              any      `json:"value"`
	Unit               string   `json:"unit,omitempty"`
	Raw                *float32 `json:"raw,omitempty"`
	RawUnit            string   `json:"rawUnit,omitempty"`
	Quality            string   `json:"quality"`
	Source             string   `json:"source"`
	Priority           string   `json:"priority,omitempty"`
	OverrideExpiresInS *uint32  `json:"overrideExpiresInS,omitempty"`
	UpdatedAt          string   `json:"updatedAt"`
	// VirtualSource — với point ảo, AI sở hữu slot (`WEB` mặc định vs
	// `PROGRAM`). Point Catalog cần nó để trả đúng hướng binding: chỉ VP do
	// chương trình sở hữu mới là đích ghi hợp lệ của `VAR_OUTPUT`.
	VirtualSource string `json:"virtualSource,omitempty"`
	Fault         bool   `json:"fault,omitempty"`
	Forced        bool   `json:"forced,omitempty"`
	SignalType    string `json:"signalType,omitempty"`
	Writable      bool   `json:"writable,omitempty"`
	LogEnabled    bool   `json:"logEnabled,omitempty"`
	LogIntervalMs *int   `json:"logIntervalMs,omitempty"`
	// BoundPointID — chỉ đặt cho Kind=="virtual" khi VP đã bind vào slot Core
	// AV/BV thật (F-PROG-ASBUILT-014); Programming Point Catalog dùng field
	// này thay cho ID thân thiện ("VP1") khi build binding cho ST Program.
	BoundPointID string `json:"boundPointId,omitempty"`
	// Equipment — `T57-3.1` (`ADR-042`): thiết bị công nghệ mà điểm thuộc về.
	// Rỗng ⇒ giao diện xếp vào nhóm "Chưa gán"; CẤM đoán từ tên điểm.
	Equipment string `json:"equipment,omitempty"`
	// Note — mô tả tự do người vận hành nhập (`ISS-PIO-07`). Có ở cả
	// `io_config` lẫn Virtual Point; điểm Modbus KHÔNG có trường tương ứng
	// trong `fieldbus.conf`, nên nó rỗng ở đó và đó là sự thật, không phải
	// thiếu sót của đường chở.
	Note string `json:"note,omitempty"`
	// Enabled — điểm có đang được dùng không. KHÔNG `omitempty`: `false` là
	// một câu trả lời có nghĩa, và bỏ nó đi sẽ khiến consumer đọc thành
	// "không biết".
	Enabled      bool   `json:"enabled"`
	PointID      string `json:"point_id"`
	TagName      string `json:"tag_name"`
	DisplayName  string `json:"display_name"`
	DataType     string `json:"data_type"`
	Timestamp    string `json:"timestamp"`
	ReadWrite    string `json:"read_write"`
	DefaultValue any    `json:"default_value"`
	SafeValue    any    `json:"safe_value"`

	// MBR-B103/B309: chi tiết chẩn đoán của Point Modbus RTU. Tất cả đến TỪ
	// producer; FE hiển thị nguyên văn và hiện `unknown` khi thiếu, tuyệt đối
	// không suy diễn (D-07).
	QualityReason string `json:"quality_reason,omitempty"`
	BusID         uint8  `json:"bus_id,omitempty"`
	SlaveAddr     uint8  `json:"slave_addr,omitempty"`
	ExceptionCode uint8  `json:"exception_code,omitempty"`
	Online        bool   `json:"online,omitempty"`
}

// AlarmDTO mirrors FE Alarm (types.ts).
type AlarmDTO struct {
	ID           string `json:"id"`
	Time         string `json:"time"`
	Severity     string `json:"severity"` // critical | high | medium | low | info
	Status       string `json:"status"`   // active | unack | acked | shelved
	Message      string `json:"message"`
	Source       string `json:"source"`
	Value        string `json:"value"`
	Detail       string `json:"detail"`
	TriggerLevel string `json:"triggerLevel,omitempty"`
	Threshold    string `json:"threshold,omitempty"`
	Active       bool   `json:"active,omitempty"`
	Returnable   *bool  `json:"returnable,omitempty"`
}

type AlarmActionRequest struct {
	DurationS *float64 `json:"durationS,omitempty"`
	Permanent *bool    `json:"permanent,omitempty"`
}

type AlarmHistoryEvent struct {
	EventID      string        `json:"eventId"`
	Time         string        `json:"time"`
	Event        string        `json:"event"`
	AlarmID      string        `json:"alarmId,omitempty"`
	User         string        `json:"user,omitempty"`
	Severity     string        `json:"severity,omitempty"`
	Status       string        `json:"status,omitempty"`
	Message      string        `json:"message,omitempty"`
	Source       string        `json:"source,omitempty"`
	Value        string        `json:"value,omitempty"`
	Detail       string        `json:"detail,omitempty"`
	TriggerLevel string        `json:"triggerLevel,omitempty"`
	Threshold    string        `json:"threshold,omitempty"`
	Active       bool          `json:"active,omitempty"`
	Before       *AlarmSetting `json:"before,omitempty"`
	After        *AlarmSetting `json:"after,omitempty"`
}

func boolPtr(value bool) *bool {
	return &value
}

// CommissioningTestResult mirrors FE CommissioningTestResult (types.ts) and openapi.yaml.
type CommissioningTestResult struct {
	Result       string `json:"result"` // passed | failed | running
	PointID      string `json:"pointId"`
	AppliedValue any    `json:"appliedValue,omitempty"` // number | bool
	Message      string `json:"message"`
	ScanMs       *int   `json:"scanMs,omitempty"`
	/* ISS-PIO-26 — hai con số KHÁC NHAU, không gộp làm một:
	 *
	 * `TTLS` là thời hạn ĐÃ YÊU CẦU, luôn có mặt khi lệnh được nhận, để biên bản
	 * nghiệm thu ghi được "đã ép 5 phút" chứ không phải "đã ép".
	 * `ExpiresInS` là thời hạn CÒN LẠI do Core báo. Vắng mặt nghĩa là Core không
	 * báo — KHÔNG phải "còn 0 giây". Giao diện phải phân biệt được hai điều đó,
	 * nếu không nó sẽ đếm ngược một con số không ai cưỡng chế (PA3-107). */
	TTLS       *uint32 `json:"ttlS,omitempty"`
	ExpiresInS *uint32 `json:"expiresInS,omitempty"`
}

type WSOp string

const (
	WSOpSubscribe    WSOp = "subscribe"
	WSOpUpdate       WSOp = "update"
	WSOpForce        WSOp = "force"
	WSOpError        WSOp = "error"
	WSOpForceExpired WSOp = "force_expired"
)

type WSSubscribeRequest struct {
	Op     WSOp            `json:"op"`
	Points SubscribePoints `json:"points"`
}

type SubscribePoints struct {
	All bool
	IDs []string
}

func (p *SubscribePoints) UnmarshalJSON(data []byte) error {
	var all string
	if err := json.Unmarshal(data, &all); err == nil {
		p.All = all == "*"
		p.IDs = nil
		return nil
	}
	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return err
	}
	p.All = false
	p.IDs = ids
	return nil
}

func (p SubscribePoints) MarshalJSON() ([]byte, error) {
	if p.All {
		return json.Marshal("*")
	}
	return json.Marshal(p.IDs)
}

type WSUpdateMessage struct {
	Op     WSOp       `json:"op"`
	TS     string     `json:"ts"`
	Points []PointDTO `json:"points"`
}

type WSForceRequest struct {
	Op      WSOp            `json:"op"`
	ID      string          `json:"id"`
	Value   json.RawMessage `json:"value,omitempty"`
	ExpireS *int            `json:"expire_s,omitempty"`
}

type WSErrorMessage struct {
	Op   WSOp   `json:"op"`
	Code int    `json:"code"`
	Msg  string `json:"msg"`
}

type WSForceExpiredMessage struct {
	Op WSOp   `json:"op"`
	ID string `json:"id"`
}
