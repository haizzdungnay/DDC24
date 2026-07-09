package main

import "encoding/json"

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
	UI []map[string]any `json:"ui"`
	AO []map[string]any `json:"ao"`
}

type ConfigSafeState struct {
	AO []map[string]any `json:"ao"`
	DO []map[string]any `json:"do"`
}

type ConfigBacnet struct {
	BIP map[string]any `json:"bip"`
}

type ConfigFieldbus struct {
	RS485         map[string]any   `json:"rs485"`
	PollDefaultMs int              `json:"poll_default_ms"`
	Slaves        []map[string]any `json:"slaves"`
}

type ConfigTime struct {
	Timezone   string   `json:"timezone"`
	NTPEnabled bool     `json:"ntp_enabled"`
	NTPServers []string `json:"ntp_servers"`
	SystemTime string   `json:"system_time"`
}

type ConfigVirtualPoints struct {
	Items []VirtualPoint `json:"items"`
}

type VirtualPoint struct {
	ID              string  `json:"id"`
	Label           string  `json:"label"`
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

type UserDTO struct {
	Username string `json:"username"`
	Role     Role   `json:"role"`
}

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

type PointDTO struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Kind          string   `json:"kind"`
	Value         any      `json:"value"`
	Unit          string   `json:"unit,omitempty"`
	Raw           *float32 `json:"raw,omitempty"`
	RawUnit       string   `json:"rawUnit,omitempty"`
	Quality       string   `json:"quality"`
	Source        string   `json:"source"`
	Priority      string   `json:"priority,omitempty"`
	UpdatedAt     string   `json:"updatedAt"`
	Fault         bool     `json:"fault,omitempty"`
	Forced        bool     `json:"forced,omitempty"`
	SignalType    string   `json:"signalType,omitempty"`
	Writable      bool     `json:"writable,omitempty"`
	LogEnabled    bool     `json:"logEnabled,omitempty"`
	LogIntervalMs *int     `json:"logIntervalMs,omitempty"`
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
