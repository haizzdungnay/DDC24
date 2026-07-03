package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	kxShmMagic    = 0x4B584404
	defaultIOShm  = "/dev/shm/mkddc_io_shm"
	defaultPLCShm = "/dev/shm/mkddc_plc_shm"
)

var webCommandID uint64

var errCoreUnavailable = errors.New("core unavailable")

type CoreStatusClient interface {
	ReadStatus(ctx context.Context) (CoreStatus, error)
}

type CoreClient struct {
	SockPath string
	IOShm    string
	PLCShm   string
}

type CoreStatus struct {
	CoreAvailable bool
	IobusPresent  bool
	Versions      VersionStatus
	IOP           IOPStatus
	Scan          ScanStatus
}

type VersionStatus struct {
	MCUFW string `json:"mcu_fw,omitempty"`
	Iobus string `json:"iobus,omitempty"`
	Core  string `json:"core,omitempty"`
	Web   string `json:"web"`
}

type IOPStatus struct {
	Status       string  `json:"status"`
	CRCErrors    uint32  `json:"crc_errors"`
	Timeouts     uint32  `json:"timeouts"`
	SeqErrors    uint32  `json:"seq_errors"`
	LastIORespMS *uint32 `json:"last_io_resp_ms,omitempty"`
}

type ScanStatus struct {
	Count   uint32 `json:"count"`
	Overrun uint32 `json:"overrun"`
}

type webIPCResponse struct {
	ID           uint64           `json:"id"`
	Result       string           `json:"result"`
	AppliedValue any              `json:"applied_value,omitempty"`
	ActiveSource string           `json:"active_source,omitempty"`
	Error        string           `json:"error,omitempty"`
	AlarmID      string           `json:"alarmId,omitempty"`
	Alarms       []coreAlarmState `json:"alarms,omitempty"`
}

type coreAlarmState struct {
	ID             string   `json:"id"`
	AlarmSettingID string   `json:"alarmSettingId"`
	Time           string   `json:"time"`
	Status         string   `json:"status"`
	SourcePointID  string   `json:"sourcePointId"`
	Value          any      `json:"value"`
	TriggerLevel   string   `json:"triggerLevel"`
	Threshold      *float64 `json:"threshold"`
	Priority       string   `json:"priority"`
	Label          string   `json:"label"`
	AlarmType      int      `json:"alarmType"`
	Occurrence     uint64   `json:"occurrence"`
	Active         bool     `json:"active"`
}

func NewCoreClient(cfg Config) *CoreClient {
	return &CoreClient{SockPath: cfg.CoreSock, IOShm: defaultIOShm, PLCShm: defaultPLCShm}
}

func (c *CoreClient) ReadStatus(ctx context.Context) (CoreStatus, error) {
	status := CoreStatus{
		Versions: VersionStatus{},
		IOP:      IOPStatus{Status: "fault"},
		Scan:     ScanStatus{},
	}
	var firstErr error
	if c.coreSocketReady(ctx) {
		status.CoreAvailable = true
	} else {
		firstErr = fmt.Errorf("core socket unavailable")
	}
	if iop, err := c.readIOStatus(); err == nil {
		status.IOP = iop
		status.IobusPresent = true
	} else if firstErr == nil {
		firstErr = err
	}
	if scan, err := c.readPLCStatus(); err == nil {
		status.Scan = scan
		status.CoreAvailable = true
	} else if firstErr == nil {
		firstErr = err
	}
	return status, firstErr
}

func (c *CoreClient) ReadPoints(ctx context.Context) ([]PointDTO, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	plcData, err := os.ReadFile(c.PLCShm)
	if err != nil {
		return []PointDTO{}, nil
	}
	if !validSHM(plcData, kxPlcShmMinLen) {
		return []PointDTO{}, nil
	}
	// Read io_shm for AI unit strings (best-effort; nil on failure = empty units)
	var ioData []byte
	if raw, err2 := os.ReadFile(c.IOShm); err2 == nil && validSHM(raw, kxIOShmMinLen) {
		ioData = raw
	}
	return decodePoints(plcData, ioData), nil
}

func (c *CoreClient) ForcePoint(ctx context.Context, id string, value any, release bool) (PointDTO, error) {
	conn, err := c.dialCore(ctx)
	if err != nil {
		return degradedPoint(id, value, "core_unavailable"), nil
	}
	defer conn.Close()
	deadline := time.Now().Add(3 * time.Second)
	_ = conn.SetDeadline(deadline)

	op := "write"
	if release {
		op = "release"
	}
	cmd := map[string]any{
		"id":     atomic.AddUint64(&webCommandID, 1),
		"op":     op,
		"point":  coreCommandPointID(id),
		"source": "manual",
		"user":   "web",
	}
	if !release {
		if b, ok := value.(bool); ok {
			if b {
				cmd["value"] = 1
			} else {
				cmd["value"] = 0
			}
		} else {
			cmd["value"] = value
		}
	}
	line, err := json.Marshal(cmd)
	if err != nil {
		return PointDTO{}, fmt.Errorf("marshal web ipc command: %w", err)
	}
	if _, err := conn.Write(append(line, '\n')); err != nil {
		return degradedPoint(id, value, "core_unavailable"), nil
	}
	respLine, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return degradedPoint(id, value, "core_unavailable"), nil
	}
	var resp webIPCResponse
	if err := json.Unmarshal(respLine, &resp); err != nil {
		return PointDTO{}, fmt.Errorf("parse web ipc response: %w", err)
	}
	if resp.Result == "rejected" {
		return degradedPoint(id, value, "rejected:"+resp.Error), fmt.Errorf("core rejected %s: %s", id, resp.Error)
	}
	point := PointDTO{
		ID:        id,
		Name:      id,
		Kind:      pointKindFromID(id),
		Value:     resp.AppliedValue,
		Quality:   "good",
		Source:    "core",
		Priority:  resp.ActiveSource,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Forced:    !release,
	}
	return point, nil
}

func (c *CoreClient) sendWebIPC(ctx context.Context, cmd map[string]any) (webIPCResponse, error) {
	conn, err := c.dialCore(ctx)
	if err != nil {
		return webIPCResponse{}, errCoreUnavailable
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))

	line, err := json.Marshal(cmd)
	if err != nil {
		return webIPCResponse{}, fmt.Errorf("marshal web ipc command: %w", err)
	}
	if _, err := conn.Write(append(line, '\n')); err != nil {
		return webIPCResponse{}, errCoreUnavailable
	}
	respLine, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return webIPCResponse{}, errCoreUnavailable
	}
	var resp webIPCResponse
	if err := json.Unmarshal(respLine, &resp); err != nil {
		return webIPCResponse{}, fmt.Errorf("parse web ipc response: %w", err)
	}
	return resp, nil
}

func (c *CoreClient) coreSocketReady(ctx context.Context) bool {
	conn, err := c.dialCore(ctx)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func (c *CoreClient) dialCore(ctx context.Context) (net.Conn, error) {
	if c.SockPath == "" {
		return nil, fmt.Errorf("core socket path empty")
	}
	dialer := net.Dialer{Timeout: 100 * time.Millisecond}
	return dialer.DialContext(ctx, "unix", c.SockPath)
}

func (c *CoreClient) readIOStatus() (IOPStatus, error) {
	data, err := os.ReadFile(c.IOShm)
	if err != nil {
		return IOPStatus{Status: "fault"}, err
	}
	if !validSHM(data, kxIOShmMinLen) {
		return IOPStatus{Status: "fault"}, fmt.Errorf("invalid io shm")
	}
	return IOPStatus{
		Status:    mapIOPStatus(data[offIOPStatus]),
		CRCErrors: binary.LittleEndian.Uint32(data[offIOCRCErrors : offIOCRCErrors+4]),
		Timeouts:  binary.LittleEndian.Uint32(data[offIOTimeouts : offIOTimeouts+4]),
		SeqErrors: binary.LittleEndian.Uint32(data[offIOSeqErrors : offIOSeqErrors+4]),
	}, nil
}

func (c *CoreClient) readPLCStatus() (ScanStatus, error) {
	data, err := os.ReadFile(c.PLCShm)
	if err != nil {
		return ScanStatus{}, err
	}
	if !validSHM(data, kxPlcShmMinLen) {
		return ScanStatus{}, fmt.Errorf("invalid plc shm")
	}
	return ScanStatus{
		Count:   binary.LittleEndian.Uint32(data[offPLCScanCount : offPLCScanCount+4]),
		Overrun: binary.LittleEndian.Uint32(data[offPLCScanOverrun : offPLCScanOverrun+4]),
	}, nil
}

func validSHM(data []byte, minLen int) bool {
	return len(data) >= minLen && binary.LittleEndian.Uint32(data[0:4]) == kxShmMagic
}

func degradedPoint(id string, value any, source string) PointDTO {
	return PointDTO{
		ID:        id,
		Name:      id,
		Kind:      pointKindFromID(id),
		Value:     value,
		Quality:   "bad",
		Source:    source,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Fault:     true,
	}
}

func pointKindFromID(id string) string {
	upper := strings.ToUpper(id)
	switch {
	case strings.HasPrefix(upper, "UI"), strings.HasPrefix(upper, "AI"):
		return "UI"
	case strings.HasPrefix(upper, "AO"):
		return "AO"
	case strings.HasPrefix(upper, "DI"), strings.HasPrefix(upper, "BI"):
		return "UI"
	case strings.HasPrefix(upper, "DO"), strings.HasPrefix(upper, "BO"):
		return "DO"
	default:
		return "virtual"
	}
}

func parsePointID(id string) (string, int, bool) {
	raw := strings.ToUpper(strings.TrimSpace(id))
	i := 0
	for i < len(raw) && raw[i] >= 'A' && raw[i] <= 'Z' {
		i++
	}
	if i == 0 || i >= len(raw) {
		return "", 0, false
	}
	digits := raw[i:]
	if strings.HasPrefix(digits, "-") || strings.HasPrefix(digits, "_") {
		digits = digits[1:]
	}
	channel, err := strconv.Atoi(digits)
	return raw[:i], channel, err == nil && channel > 0
}

func formatPointID(prefix string, channel int) string {
	return fmt.Sprintf("%s-%02d", prefix, channel)
}

func canonicalPointID(id string) string {
	prefix, channel, ok := parsePointID(id)
	if !ok {
		return strings.TrimSpace(id)
	}
	switch prefix {
	case "UI", "AI":
		return formatPointID("UI", channel)
	case "DI", "BI":
		return formatPointID("UI", kxNUI+channel)
	case "AO", "DO":
		return formatPointID(prefix, channel)
	default:
		return strings.TrimSpace(id)
	}
}

func legacyPointIDAliases(id string) []string {
	prefix, channel, ok := parsePointID(id)
	if !ok {
		return nil
	}
	switch prefix {
	case "UI":
		if channel <= kxNUI {
			return []string{fmt.Sprintf("AI%d", channel), formatPointID("AI", channel)}
		}
		if channel <= kxNUI+kxNDI {
			diChannel := channel - kxNUI
			return []string{fmt.Sprintf("DI%d", diChannel), formatPointID("DI", diChannel)}
		}
	case "AO", "DO":
		return []string{fmt.Sprintf("%s%d", prefix, channel)}
	}
	return nil
}

func coreCommandPointID(id string) string {
	prefix, channel, ok := parsePointID(id)
	if !ok {
		return strings.TrimSpace(id)
	}
	switch prefix {
	case "UI":
		if channel <= kxNUI {
			return fmt.Sprintf("AI%d", channel)
		}
		if channel <= kxNUI+kxNDI {
			return fmt.Sprintf("DI%d", channel-kxNUI)
		}
	case "AO", "DO", "AI", "DI":
		return fmt.Sprintf("%s%d", prefix, channel)
	}
	return strings.TrimSpace(id)
}

func mapIOPStatus(raw byte) string {
	switch raw {
	case 0:
		return "normal"
	case 2:
		return "safe"
	default:
		return "fault"
	}
}

// ---- kx_plc_shm point table offsets ----

const (
	kxNUI  = 16
	kxNDI  = 8
	kxNAO  = 4
	kxNDO  = 4
	kxNAV  = 32
	kxNBV  = 16
	kxNMSV = 8

	// kx_point_t layout (24 bytes, no padding between fields):
	//   float value(4) + float[16] priority(64) + float relinquish_default(4)
	//   + uint8 quality(1) + uint8 reliability(1) + padding(2) = 76
	kxPointSize = 76

	// kx_plc_shm_t header + point arrays:
	//   header: magic(4)+seq(4)+ts_ns(8) = 16
	//   ai[16]  at offset 16
	//   bi[8]   at offset 1232
	//   ao[4]   at offset 1840
	//   bo[4]   at offset 2144
	//   av[32]  at offset 2448
	//   bv[16]  at offset 4880
	//   msv[8]  at offset 6096
	//   ext[64] at offset 6704 (kx_ext_point_t=40b): 64*40=2560
	//   scan_count at 9268; scan_overrun at 9272; sizeof(kx_plc_shm_t)=9280.
	offAI  = 16
	offBI  = offAI + kxNUI*kxPointSize
	offAO  = offBI + kxNDI*kxPointSize
	offBO  = offAO + kxNAO*kxPointSize
	offAV  = offBO + kxNDO*kxPointSize
	offBV  = offAV + kxNAV*kxPointSize
	offMSV = offBV + kxNBV*kxPointSize

	// kx_point_t field offsets within a point (76 bytes):
	offValue      = 0  // float32
	offPriority   = 4  // float32[16] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â not read for now
	offRelinquish = 68 // float32
	offQuality    = 72 // uint8
	offReliab     = 73 // uint8

	offPLCScanCount   = 9268
	offPLCScanOverrun = 9272
	kxPlcShmMinLen    = 9280

	// kx_io_shm_t v4 offsets used by web:
	//   header16 + ui_value[16]*4 + ui_raw[16]*4 + ui_quality[16]
	//   + ui_reliability[16] + ui_unit[16][8] + ui_raw_unit[16][8] + rest = 528 bytes.
	offIORaw       = 80
	offIOUnit      = 176
	offIORawUnit   = 304
	kxIOUnitSize   = 8
	offIOPStatus   = 502
	offIOCRCErrors = 512
	offIOTimeouts  = 516
	offIOSeqErrors = 520
	kxIOShmMinLen  = 528
)

// kx_quality_t ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ DTO quality string
func mapQuality(raw uint8) string {
	switch raw {
	case 0:
		return "good"
	case 1:
		return "uncertain"
	default:
		return "bad"
	}
}

func decodePoint(data []byte, offset int, id, name string) PointDTO {
	if offset < 0 || offset+kxPointSize > len(data) {
		return PointDTO{ID: id, Name: name, Quality: "bad", Source: "core", Fault: true}
	}
	v := math.Float32frombits(binary.LittleEndian.Uint32(data[offset+offValue:]))
	q := mapQuality(data[offset+offQuality])
	return PointDTO{
		ID:        id,
		Name:      name,
		Kind:      pointKindFromID(id),
		Value:     v,
		Quality:   q,
		Source:    "core",
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Fault:     q == "bad",
	}
}

func ioString(ioData []byte, base int, ch int) string {
	if ioData == nil || ch < 0 || ch >= kxNUI {
		return ""
	}
	start := base + ch*kxIOUnitSize
	if start+kxIOUnitSize > len(ioData) {
		return ""
	}
	b := ioData[start : start+kxIOUnitSize]
	n := 0
	for n < len(b) && b[n] != 0 {
		n++
	}
	return string(b[:n])
}

func ioUnit(ioData []byte, ch int) string {
	return ioString(ioData, offIOUnit, ch)
}

func ioRawUnit(ioData []byte, ch int) string {
	return ioString(ioData, offIORawUnit, ch)
}

func ioRaw(ioData []byte, ch int) (float32, bool) {
	if ioRawUnit(ioData, ch) == "" {
		return 0, false
	}
	start := offIORaw + ch*4
	if ioData == nil || start+4 > len(ioData) {
		return 0, false
	}
	return math.Float32frombits(binary.LittleEndian.Uint32(ioData[start : start+4])), true
}

func pointFloat(value any) (float32, bool) {
	switch v := value.(type) {
	case float32:
		return v, true
	case float64:
		return float32(v), true
	case int:
		return float32(v), true
	default:
		return 0, false
	}
}

func decodePoints(data []byte, ioData []byte) []PointDTO {
	if len(data) < kxPlcShmMinLen {
		return nil
	}
	pts := make([]PointDTO, 0, kxNUI+kxNAO+kxNDO+kxNAV+kxNBV+kxNMSV)

	// UI[0..15]
	for i := 0; i < kxNUI; i++ {
		id := formatPointID("UI", i+1)
		dto := decodePoint(data, offAI+i*kxPointSize, id, id)
		dto.Unit = ioUnit(ioData, i)
		if strings.EqualFold(dto.Unit, "bool") {
			if v, ok := pointFloat(dto.Value); ok {
				dto.Value = v > 0.5
			}
		}
		if raw, ok := ioRaw(ioData, i); ok {
			dto.Raw = &raw
			dto.RawUnit = ioRawUnit(ioData, i)
		}
		pts = append(pts, dto)
	}
	// AO[0..3] analog output (commandable)
	for i := 0; i < kxNAO; i++ {
		id := formatPointID("AO", i+1)
		pts = append(pts, decodePoint(data, offAO+i*kxPointSize, id, id))
	}
	// DO[0..3] digital output feedback (bo[] array)
	for i := 0; i < kxNDO; i++ {
		id := formatPointID("DO", i+1)
		dto := decodePoint(data, offBO+i*kxPointSize, id, id)
		if v, ok := dto.Value.(float32); ok {
			dto.Value = v > 0.5
		}
		pts = append(pts, dto)
	}
	// AV[0..31]
	for i := 0; i < kxNAV; i++ {
		id := fmt.Sprintf("AV%d", i+1)
		pts = append(pts, decodePoint(data, offAV+i*kxPointSize, id, id))
	}
	// BV[0..15]
	for i := 0; i < kxNBV; i++ {
		id := fmt.Sprintf("BV%d", i+1)
		dto := decodePoint(data, offBV+i*kxPointSize, id, id)
		if v, ok := dto.Value.(float32); ok {
			dto.Value = v > 0.5
		}
		pts = append(pts, dto)
	}
	// MSV[0..7]
	for i := 0; i < kxNMSV; i++ {
		id := fmt.Sprintf("MSV%d", i+1)
		pts = append(pts, decodePoint(data, offMSV+i*kxPointSize, id, id))
	}
	return pts
}

// ---- B3 seam: alarms + commissioning (impl by agent B) ----

type alarmReader interface {
	ReadAlarms(ctx context.Context) ([]AlarmDTO, error)
}

type alarmAcker interface {
	AckAlarm(ctx context.Context, id string) error
}

type commissionTester interface {
	CommissionTest(ctx context.Context, id string, value any) (CommissioningTestResult, error)
}

// ReadAlarms returns the current active/unacked alarm list from core (best-effort).
// Core unavailable or SHM absent â†’ returns empty slice, no hard error.
func (c *CoreClient) ReadAlarms(ctx context.Context) ([]AlarmDTO, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	resp, err := c.sendWebIPC(ctx, map[string]any{
		"id":   atomic.AddUint64(&webCommandID, 1),
		"op":   "alarm_list",
		"user": "web",
	})
	if errors.Is(err, errCoreUnavailable) {
		return []AlarmDTO{}, nil
	}
	if err != nil {
		return nil, err
	}
	if resp.Result == "rejected" {
		return []AlarmDTO{}, fmt.Errorf("core rejected alarm_list: %s", resp.Error)
	}
	receivedAt := time.Now().UTC().Format(time.RFC3339Nano)
	alarms := make([]AlarmDTO, 0, len(resp.Alarms))
	for _, alarm := range resp.Alarms {
		alarms = append(alarms, mapCoreAlarm(alarm, receivedAt))
	}
	return alarms, nil
}

// AckAlarm sends an acknowledge command for alarm id to core.
// Core unavailable â†’ returns nil (degraded, no hard error).
func (c *CoreClient) AckAlarm(ctx context.Context, id string) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	id = strings.TrimSpace(id)
	if !validAlarmID(id) {
		return fmt.Errorf("invalid alarm id")
	}
	resp, err := c.sendWebIPC(ctx, map[string]any{
		"id":      atomic.AddUint64(&webCommandID, 1),
		"op":      "alarm_ack",
		"alarmId": id,
		"user":    "web",
	})
	if errors.Is(err, errCoreUnavailable) {
		return nil
	}
	if err != nil {
		return err
	}
	if resp.Result == "rejected" {
		if resp.Error == "unknown_alarm" {
			return fmt.Errorf("unknown alarm")
		}
		return fmt.Errorf("core rejected alarm ack %s: %s", id, resp.Error)
	}
	return nil
}

func mapCoreAlarm(alarm coreAlarmState, fallbackTime string) AlarmDTO {
	id := alarm.ID
	if id == "" {
		id = alarm.AlarmSettingID
	}
	timestamp := alarm.Time
	if timestamp == "" {
		timestamp = fallbackTime
	}
	status := alarmStatus(alarm.Status)
	source := alarm.SourcePointID
	if source == "" {
		source = "SYSTEM"
	}
	message := alarm.Label
	if message == "" {
		message = "Alarm " + id
	}
	value := formatAlarmValue(alarm.Value)
	triggerLevel := normalizeTriggerLevel(alarm.TriggerLevel)
	threshold := formatAlarmThreshold(alarm.Threshold)
	return AlarmDTO{
		ID:           id,
		Time:         timestamp,
		Severity:     alarmSeverity(alarm.Priority),
		Status:       status,
		Message:      message,
		Source:       source,
		Value:        value,
		Detail:       formatAlarmDetail(alarm, source, status, value, triggerLevel, threshold),
		TriggerLevel: triggerLevel,
		Threshold:    threshold,
	}
}

func formatAlarmDetail(alarm coreAlarmState, source, status, value, triggerLevel, threshold string) string {
	if triggerLevel == "" {
		return fmt.Sprintf("type=%d source=%s status=%s occurrence=%d",
			alarm.AlarmType, source, status, alarm.Occurrence)
	}
	if threshold != "" {
		return fmt.Sprintf("trip=%s threshold=%s current=%s (%s); occurrence=%d",
			triggerLevel, threshold, value, triggerLabel(triggerLevel), alarm.Occurrence)
	}
	return fmt.Sprintf("trip=%s current=%s (%s); occurrence=%d",
		triggerLevel, value, triggerLabel(triggerLevel), alarm.Occurrence)
}

func normalizeTriggerLevel(level string) string {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case "HH", "H", "L", "LL", "RUNTIME":
		return strings.ToUpper(strings.TrimSpace(level))
	default:
		return ""
	}
}

func triggerLabel(level string) string {
	switch level {
	case "HH":
		return "High-high"
	case "H":
		return "High"
	case "L":
		return "Low"
	case "LL":
		return "Low-low"
	case "RUNTIME":
		return "Runtime"
	default:
		return "Alarm"
	}
}

func formatAlarmThreshold(value *float64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatFloat(*value, 'f', -1, 64)
}

func alarmSeverity(priority string) string {
	switch strings.ToLower(priority) {
	case "critical", "high", "medium", "low":
		return strings.ToLower(priority)
	default:
		return "info"
	}
}

func alarmStatus(status string) string {
	switch strings.ToLower(status) {
	case "active", "unack", "acked", "shelved":
		return strings.ToLower(status)
	default:
		return "active"
	}
}

func formatAlarmValue(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 32)
	case int:
		return strconv.Itoa(v)
	case string:
		return v
	case bool:
		if v {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprint(v)
	}
}

// CommissionTest sends a commissioning test command for point id with the given value
// via core web_ipc (Local manual level 2, per 07 §8 + openapi.yaml).
// Implemented as ForcePoint(write) mapped to CommissioningTestResult.
// Core unavailable -> degraded result, no hard error.
func (c *CoreClient) CommissionTest(ctx context.Context, id string, value any) (CommissioningTestResult, error) {
	select {
	case <-ctx.Done():
		return CommissioningTestResult{}, ctx.Err()
	default:
	}
	start := time.Now()
	pt, err := c.ForcePoint(ctx, id, value, false)
	if err != nil {
		return CommissioningTestResult{
			Result:  "failed",
			PointID: id,
			Message: "core rejected: " + err.Error(),
		}, nil
	}
	elapsed := int(time.Since(start).Milliseconds())
	result := "passed"
	msg := "accepted"
	switch {
	case pt.Source == "core_unavailable":
		result = "failed"
		msg = "core unavailable"
	case pt.Fault || pt.Quality == "bad":
		result = "failed"
		msg = "point fault or bad quality"
	}
	return CommissioningTestResult{
		Result:       result,
		PointID:      id,
		AppliedValue: pt.Value,
		Message:      msg,
		ScanMs:       &elapsed,
	}, nil
}
