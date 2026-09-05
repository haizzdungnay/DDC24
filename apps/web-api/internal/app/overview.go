package app

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"time"

	"mkddc-web/internal/capabilities"
)

// OverviewSchemaVersion tăng khi hình dạng `OverviewResponse` đổi theo cách phá
// tương thích. FE so version và fail-closed thay vì đoán giá trị mặc định —
// guardrail §10.3 "backend cũ / FE mới".
const OverviewSchemaVersion = 1

// Trạng thái sức khoẻ dùng chung cho overall và từng domain.
//
// `unknown` KHÔNG phải `good`. Đây là điểm mà bản Dashboard cũ làm sai: không
// đọc được `/system/status` thì nó vẫn vẽ vòng tròn xanh ONLINE.
const (
	HealthGood     = "good"
	HealthDegraded = "degraded"
	HealthFault    = "fault"
	HealthOffline  = "offline"
	HealthUnknown  = "unknown"
)

type OverviewController struct {
	DeviceName string `json:"deviceName,omitempty"`
	Location   string `json:"location,omitempty"`
	Firmware   string `json:"firmware,omitempty"`
	WebVersion string `json:"webVersion,omitempty"`
	IP         string `json:"ip,omitempty"`
	MAC        string `json:"mac,omitempty"`
	SystemTime string `json:"systemTime,omitempty"`
	UptimeS    uint64 `json:"uptimeS,omitempty"`
}

// OverviewDomainHealth — mỗi ô của Health Strip. Bốn trường bắt buộc theo §5.1:
// không có `source`/`observedAt` thì người trực không biết con số đến từ đâu và
// cũ tới mức nào.
type OverviewDomainHealth struct {
	Domain     string `json:"domain"`
	State      string `json:"state"`
	ReasonCode string `json:"reasonCode"`
	Source     string `json:"source"`
	ObservedAt string `json:"observedAt"`
	// Detail CHỈ mang giá trị KHÔNG phụ thuộc ngôn ngữ (địa chỉ IP, định danh).
	//
	// `ISS-PGUI-02`: trường này từng chứa câu tiếng Việt dựng sẵn ("Chưa cấu
	// hình thiết bị Modbus RTU", "{n} điểm đang ghi"), và Dashboard in thẳng nó
	// ra — nên giao diện English hiện tiếng Việt (`pm-014`). Máy chủ không biết
	// người dùng đang xem bằng ngôn ngữ nào, nên nó không phải nơi viết câu:
	// nó phát `reasonCode` (mã đóng) kèm `DetailCount` (tham số typed), còn
	// client dựng câu theo locale của chính nó.
	Detail string `json:"detail,omitempty"`
	// DetailCount là tham số của `reasonCode` khi mã ấy đếm được (số điểm BAD,
	// số bus không mở, số thiết bị offline, số điểm đang ghi). `nil` = mã này
	// không có tham số đếm — KHÁC với 0, vốn là một con số thật.
	DetailCount *int   `json:"detailCount,omitempty"`
	Link        string `json:"link,omitempty"`
}

type OverviewAlarmCounts struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
	Info     int `json:"info"`
	Unacked  int `json:"unacked"`
	Total    int `json:"total"`
}

// OverviewPointGroup là một hàng của Operating Summary (§7). Không có hàng DI:
// base SKU Rev A không có DI công nghiệp riêng, và đếm DI giả là finding
// PA3-F01 trong bảng review.
type OverviewPointGroup struct {
	Kind      string `json:"kind"`
	Total     int    `json:"total"`
	Good      int    `json:"good"`
	Uncertain int    `json:"uncertain"`
	Bad       int    `json:"bad"`
	Stale     int    `json:"stale"`
	Offline   int    `json:"offline"`
	Forced    int    `json:"forced"`
}

type OverviewPointSummary struct {
	Total     int                  `json:"total"`
	Good      int                  `json:"good"`
	Uncertain int                  `json:"uncertain"`
	Bad       int                  `json:"bad"`
	Stale     int                  `json:"stale"`
	Offline   int                  `json:"offline"`
	Forced    int                  `json:"forced"`
	Groups    []OverviewPointGroup `json:"groups"`
}

// OverviewAttentionItem là một dòng của Attention Panel. `targetType`/`targetId`
// đi qua resolver ở FE (PA3-D06) — backend KHÔNG trả URL tuỳ ý.
type OverviewAttentionItem struct {
	ID       string `json:"id"`
	Severity string `json:"severity"` // critical|high|medium|low|info
	Category string `json:"category"` // alarm|communication|quality|forced
	// Title/Detail là DIAGNOSTIC FALLBACK cho client đời cũ (`ISS-PGUI-02`).
	//
	// Client biết `titleCode`/`detailCode` PHẢI dựng câu từ mã + tham số bên
	// dưới. Hai trường này giữ nguyên hình dạng cũ để không phá client đã phát
	// hành, nhưng chúng là tiếng Việt và không được coi là copy chính.
	Title  string `json:"title"`
	Detail string `json:"detail,omitempty"`
	// TitleCode là mã ổn định của dòng tiêu đề. Rỗng nghĩa là `Title` đến từ
	// một authority thượng nguồn (thông điệp alarm của Core) và là văn bản ĐỤC:
	// client hiển thị nguyên văn, không dịch, không diễn giải.
	TitleCode string `json:"titleCode,omitempty"`
	// Subject là TÊN/ĐỊNH DANH cần chèn vào câu (tên điểm, tên thiết bị). Không
	// dịch: đây là thứ người dùng tra trong tủ và trong cấu hình.
	Subject string `json:"subject,omitempty"`
	// DetailCode là mã ổn định của dòng chi tiết; rỗng ⇒ `Detail` là văn bản đục.
	DetailCode   string                 `json:"detailCode,omitempty"`
	DetailParams *AttentionDetailParams `json:"detailParams,omitempty"`
	TargetType   string                 `json:"targetType"` // point|alarm|modbus_device|bus|subsystem
	TargetID     string                 `json:"targetId"`
	ObservedAt   string                 `json:"observedAt,omitempty"`
}

// AttentionDetailParams là tham số TYPED của `detailCode`. Mỗi trường `nil` khi
// mã hiện tại không dùng tới nó — `nil` khác 0, và 0 là một giá trị thật (bus 0,
// còn 0 giây).
type AttentionDetailParams struct {
	BusID      *int `json:"busId,omitempty"`
	SlaveAddr  *int `json:"slaveAddr,omitempty"`
	ExpiresInS *int `json:"expiresInS,omitempty"`
}

func overviewIntPtr(value int) *int { return &value }

type OverviewResponse struct {
	SchemaVersion     int                     `json:"schemaVersion"`
	GeneratedAt       string                  `json:"generatedAt"`
	Controller        OverviewController      `json:"controller"`
	Connected         bool                    `json:"connected"`
	LastDataAt        *string                 `json:"lastDataAt"`
	OverallState      string                  `json:"overallState"`
	OverallReasonCode string                  `json:"overallReasonCode"`
	Alarms            OverviewAlarmCounts     `json:"alarms"`
	Points            OverviewPointSummary    `json:"points"`
	Health            []OverviewDomainHealth  `json:"health"`
	Attention         []OverviewAttentionItem `json:"attention"`
	Capabilities      OverviewCapabilities    `json:"capabilities"`
	Degraded          []string                `json:"degraded"`
}

// OverviewCapabilities nói cho FE biết phần cứng/feature nào CÓ THẬT, để giao
// diện không dựng ô cho thứ không tồn tại (DI, RS485-2, BACnet MS/TP…).
type OverviewCapabilities struct {
	DigitalInputs   int  `json:"digitalInputs"`
	UniversalInputs int  `json:"universalInputs"`
	AnalogOutputs   int  `json:"analogOutputs"`
	DigitalOutputs  int  `json:"digitalOutputs"`
	ModbusRTUBuses  int  `json:"modbusRtuBuses"`
	BacnetIPEnabled bool `json:"bacnetIpEnabled"`
	// BoardCapKnown = false ⇒ bốn con số kênh ở trên là suy ra từ ABI chứ không
	// phải đọc từ bo. Không có trường này thì một `digitalInputs: 0` do "chưa
	// hỏi được" trông y hệt một `0` do "bo thật sự không có DI" — và trang
	// Overview không có cách nào nói ra sự khác biệt đó.
	BoardCapKnown bool `json:"boardCapKnown"`
}

func (a *App) handleOverview(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.buildOverview(r.Context()))
}

// buildOverview tổng hợp MỘT snapshot từ các authority đang có.
//
// Đây là read model duy nhất của Landing (PA3-D02). Trước PA3, Dashboard và
// AppShell mỗi bên tự poll `/system/status` + `/points` + `/alarms` mỗi giây,
// nên hai vùng của cùng một màn hình có thể nói hai điều khác nhau về cùng một
// thời điểm — và không vùng nào biết dữ liệu của mình cũ bao lâu (PA3-F12).
func (a *App) buildOverview(ctx context.Context) OverviewResponse {
	now := time.Now().UTC()
	nowIso := now.Format(time.RFC3339Nano)
	out := OverviewResponse{
		SchemaVersion: OverviewSchemaVersion,
		GeneratedAt:   nowIso,
		OverallState:  HealthUnknown,
		Health:        []OverviewDomainHealth{},
		Attention:     []OverviewAttentionItem{},
		Degraded:      []string{},
		Points:        OverviewPointSummary{Groups: []OverviewPointGroup{}},
	}

	core, coreErr := a.core.ReadStatus(ctx)
	metrics, _ := a.os.ReadMetrics(ctx)
	device, _ := readConfig(a, configGroupDevice, ConfigDevice{})
	ip, mac := primaryInterface()
	versions := core.Versions
	versions.Web = a.cfg.WebVersion

	out.Controller = OverviewController{
		DeviceName: strings.TrimSpace(device.DeviceName),
		Location:   strings.TrimSpace(device.Location),
		Firmware:   strings.TrimSpace(versions.MCUFW),
		WebVersion: versions.Web,
		IP:         ip,
		MAC:        mac,
		SystemTime: time.Now().Format(time.RFC3339),
	}
	if metrics.UptimeS != nil {
		out.Controller.UptimeS = *metrics.UptimeS
	}
	out.Connected = core.CoreAvailable
	if coreErr != nil {
		out.Degraded = append(out.Degraded, "core_status")
	}

	points, pointsErr := a.ReadPoints(ctx)
	if pointsErr != nil {
		out.Degraded = append(out.Degraded, "points")
	}
	if len(points) > 0 {
		latest := newestPointTimestamp(points)
		if latest != "" {
			out.LastDataAt = &latest
		}
	}
	out.Points = summarizePoints(points)

	alarms, alarmsDegraded := a.currentAlarms(ctx)
	if alarmsDegraded {
		out.Degraded = append(out.Degraded, "alarms")
	}
	out.Alarms = summarizeAlarms(alarms)

	modbus, modbusOK := a.readModbusHealthInput(ctx)
	if !modbusOK {
		out.Degraded = append(out.Degraded, "modbus_telemetry")
	}

	out.Capabilities = a.overviewCapabilities(modbus, core.BoardCap)
	out.Health = a.overviewHealth(nowIso, core, coreErr, pointsErr, points, modbus, modbusOK, ip)
	out.Attention = buildAttention(alarms, points, modbus)
	out.OverallState, out.OverallReasonCode = overallFromParts(out)
	return out
}

type modbusHealthInput struct {
	published  bool
	slaves     []SlaveTelemetry
	buses      []BusTelemetry
	configured int
	// deviceIDFor tra `bus:slave` → deviceID đã cấu hình, và nameFor tra
	// deviceID → tên hiển thị. Attention cần cả hai: drill-down đi theo ID,
	// còn người đọc cần tên.
	deviceIDFor map[string]string
	nameFor     map[string]string
}

func overviewSlaveKey(busID, addr uint8) string {
	return itoaInt(int(busID)) + ":" + itoaInt(int(addr))
}

func (a *App) readModbusHealthInput(ctx context.Context) (modbusHealthInput, bool) {
	input := modbusHealthInput{deviceIDFor: map[string]string{}, nameFor: map[string]string{}}
	cfg, _ := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	input.configured = len(cfg.Devices)
	index := newModbusDeviceIndex(cfg.Devices)
	for _, device := range cfg.Devices {
		if strings.TrimSpace(device.DisplayName) != "" {
			input.nameFor[device.DeviceID] = device.DisplayName
		}
	}
	reader, ok := a.core.(interface {
		ReadFieldbusTelemetry(context.Context) (FieldbusTelemetry, error)
	})
	if !ok {
		return input, false
	}
	telemetry, err := reader.ReadFieldbusTelemetry(ctx)
	if err != nil || !telemetry.Published {
		return input, false
	}
	input.published = true
	input.slaves = telemetry.Slaves
	input.buses = telemetry.Buses
	for _, slave := range telemetry.Slaves {
		if id := index.lookup(int(slave.BusID), int(slave.Addr)); id != "" {
			input.deviceIDFor[overviewSlaveKey(slave.BusID, slave.Addr)] = id
		}
	}
	return input, true
}

func (a *App) overviewCapabilities(modbus modbusHealthInput, boardCap capabilities.BoardCap) OverviewCapabilities {
	bacnet, _ := readConfig(a, configGroupBacnet, ConfigBacnet{})
	enabled := false
	if bacnet.BIP != nil {
		if value, ok := bacnet.BIP["enabled"].(bool); ok {
			enabled = value
		}
	}
	buses := len(modbus.buses)
	if buses == 0 && modbus.configured > 0 {
		// Có thiết bị được cấu hình nghĩa là có ít nhất một sợi dây, kể cả khi
		// iobus chưa publish telemetry.
		buses = 1
	}
	// `F-PIO-008`: bốn con số kênh TỪNG được viết cứng ở đây, kèm một chú thích
	// khẳng định `DigitalInputs: 0` là "hằng của SKU". Nó không phải hằng —
	// `IOP_BOARD_CAP_DI_8` tồn tại đúng vì có SKU cắm module DI, và
	// `DS_MK-DDC-24_VI` §174 hứa tạo point DI "khi capability map xác nhận".
	// Viết cứng 0 là trả lời thay cho bo một câu hỏi chỉ bo mới trả lời được.
	doc := capabilities.Build(boardCap)
	return OverviewCapabilities{
		DigitalInputs:   doc.Count("DI"),
		UniversalInputs: doc.Count("UI"),
		AnalogOutputs:   doc.Count("AO"),
		DigitalOutputs:  doc.Count("DO"),
		ModbusRTUBuses:  buses,
		BacnetIPEnabled: enabled,
		BoardCapKnown:   doc.BoardCapKnown,
	}
}

func newestPointTimestamp(points []PointDTO) string {
	var newest time.Time
	var newestRaw string
	for _, point := range points {
		raw := strings.TrimSpace(point.UpdatedAt)
		if raw == "" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			continue
		}
		if parsed.After(newest) {
			newest = parsed
			newestRaw = raw
		}
	}
	return newestRaw
}

func summarizePoints(points []PointDTO) OverviewPointSummary {
	order := []string{"UI", "AO", "DO", "virtual", "modbus_rtu"}
	byKind := map[string]*OverviewPointGroup{}
	for _, kind := range order {
		byKind[kind] = &OverviewPointGroup{Kind: kind}
	}
	summary := OverviewPointSummary{}
	for _, point := range points {
		kind := point.Kind
		group, ok := byKind[kind]
		if !ok {
			group = &OverviewPointGroup{Kind: kind}
			byKind[kind] = group
			order = append(order, kind)
		}
		group.Total++
		summary.Total++
		if point.Forced {
			group.Forced++
			summary.Forced++
		}
		switch strings.ToLower(point.Quality) {
		case "good":
			group.Good++
			summary.Good++
		case "uncertain":
			group.Uncertain++
			summary.Uncertain++
		case "bad":
			group.Bad++
			summary.Bad++
		case "stale":
			group.Stale++
			summary.Stale++
		case "offline":
			group.Offline++
			summary.Offline++
		default:
			// Quality producer không nói rõ ⇒ uncertain, KHÔNG phải good.
			group.Uncertain++
			summary.Uncertain++
		}
	}
	groups := make([]OverviewPointGroup, 0, len(order))
	for _, kind := range order {
		group := byKind[kind]
		if group == nil || group.Total == 0 {
			continue
		}
		groups = append(groups, *group)
	}
	summary.Groups = groups
	return summary
}

func summarizeAlarms(alarms []AlarmDTO) OverviewAlarmCounts {
	counts := OverviewAlarmCounts{}
	for _, alarm := range alarms {
		if strings.EqualFold(alarm.Status, "cleared") {
			continue
		}
		counts.Total++
		if strings.EqualFold(alarm.Status, "unack") {
			counts.Unacked++
		}
		switch strings.ToLower(alarm.Severity) {
		case "critical":
			counts.Critical++
		case "high":
			counts.High++
		case "medium":
			counts.Medium++
		case "low":
			counts.Low++
		default:
			counts.Info++
		}
	}
	return counts
}

func (a *App) overviewHealth(nowIso string, core CoreStatus, coreErr, pointsErr error, points []PointDTO, modbus modbusHealthInput, modbusOK bool, ip string) []OverviewDomainHealth {
	health := make([]OverviewDomainHealth, 0, 5)

	controller := OverviewDomainHealth{Domain: "controller", Source: "core_shm+core_socket", ObservedAt: nowIso, Link: "/diagnostics"}
	switch {
	case !core.CoreAvailable:
		controller.State = HealthOffline
		controller.ReasonCode = "core_unreachable"
	case core.IOP.Status != "normal":
		controller.State = HealthDegraded
		controller.ReasonCode = "iop_" + core.IOP.Status
	case coreErr != nil:
		controller.State = HealthDegraded
		controller.ReasonCode = "core_partial_read"
	default:
		controller.State = HealthGood
		controller.ReasonCode = "ok"
	}
	health = append(health, controller)

	localIO := OverviewDomainHealth{Domain: "local_io", Source: "plc_shm", ObservedAt: nowIso, Link: "/monitor?group=local"}
	switch {
	case pointsErr != nil:
		localIO.State = HealthUnknown
		localIO.ReasonCode = "points_unreadable"
	case len(points) == 0:
		localIO.State = HealthUnknown
		localIO.ReasonCode = "no_points_reported"
	default:
		bad, stale, total := 0, 0, 0
		for _, point := range points {
			if point.Kind != "UI" && point.Kind != "AO" && point.Kind != "DO" {
				continue
			}
			// Kênh Signal Type = "none" ("Không hoạt động") là do người dùng
			// chủ ý chưa nối cảm biến — Core trả quality=bad đúng thiết kế
			// (không có dữ liệu thật để báo), nhưng đó không phải một FAULT
			// phần cứng. Gộp chung khiến board luôn đỏ FAULT dù mọi kênh đang
			// dùng đều tốt, y hệt họ lỗi FE-DIAG-01/FE-DATA-01 (báo sai mức độ
			// nghiêm trọng) đã sửa trước đây trong feature này.
			if strings.EqualFold(point.SignalType, "none") {
				continue
			}
			total++
			switch strings.ToLower(point.Quality) {
			case "bad":
				bad++
			case "stale", "offline":
				stale++
			}
		}
		switch {
		case total == 0:
			localIO.State = HealthUnknown
			localIO.ReasonCode = "no_local_points"
		case bad > 0:
			localIO.State = HealthFault
			localIO.ReasonCode = "bad_quality_points"
			localIO.DetailCount = overviewIntPtr(bad)
		case stale > 0:
			localIO.State = HealthDegraded
			localIO.ReasonCode = "stale_points"
			localIO.DetailCount = overviewIntPtr(stale)
		default:
			localIO.State = HealthGood
			localIO.ReasonCode = "ok"
		}
	}
	health = append(health, localIO)

	modbusHealth := OverviewDomainHealth{Domain: "modbus", Source: "iobus_telemetry", ObservedAt: nowIso, Link: "/eng/modbus-rtu"}
	switch {
	case modbus.configured == 0:
		modbusHealth.State = HealthUnknown
		modbusHealth.ReasonCode = "not_configured"
	case !modbusOK:
		modbusHealth.State = HealthUnknown
		modbusHealth.ReasonCode = "telemetry_unpublished"
	default:
		offline := 0
		for _, slave := range modbus.slaves {
			if !slave.Online {
				offline++
			}
		}
		busFault := 0
		for _, bus := range modbus.buses {
			if bus.State != "" && !strings.EqualFold(bus.State, "open") && !strings.EqualFold(bus.State, "ok") {
				busFault++
			}
		}
		switch {
		case busFault > 0:
			modbusHealth.State = HealthFault
			modbusHealth.ReasonCode = "bus_not_open"
			modbusHealth.DetailCount = overviewIntPtr(busFault)
		case offline > 0:
			modbusHealth.State = HealthDegraded
			modbusHealth.ReasonCode = "slave_offline"
			modbusHealth.DetailCount = overviewIntPtr(offline)
		default:
			modbusHealth.State = HealthGood
			modbusHealth.ReasonCode = "ok"
		}
	}
	health = append(health, modbusHealth)

	network := OverviewDomainHealth{Domain: "network", Source: "kernel_interfaces", ObservedAt: nowIso, Link: "/settings/network"}
	if strings.TrimSpace(ip) == "" {
		network.State = HealthFault
		network.ReasonCode = "no_ipv4_address"
	} else {
		network.State = HealthGood
		network.ReasonCode = "ok"
		network.Detail = ip
	}
	health = append(health, network)

	historian := OverviewDomainHealth{Domain: "historian", Source: "historian_policy", ObservedAt: nowIso, Link: "/trends"}
	switch {
	case a.historian == nil:
		historian.State = HealthUnknown
		historian.ReasonCode = "historian_disabled"
	default:
		config, err := a.historian.Get()
		switch {
		case err != nil:
			historian.State = HealthUnknown
			historian.ReasonCode = "policy_unreadable"
		default:
			enabled, failing := 0, 0
			for _, policy := range config.Points {
				if !policy.DBLoggingEnabled {
					continue
				}
				enabled++
				if policy.Health != "" && !strings.EqualFold(policy.Health, "ok") && !strings.EqualFold(policy.Health, "healthy") {
					failing++
				}
			}
			switch {
			case enabled == 0:
				historian.State = HealthUnknown
				historian.ReasonCode = "no_logged_points"
			case failing > 0:
				historian.State = HealthDegraded
				historian.ReasonCode = "policy_unhealthy"
				historian.DetailCount = overviewIntPtr(failing)
			default:
				historian.State = HealthGood
				historian.ReasonCode = "ok"
				historian.DetailCount = overviewIntPtr(enabled)
			}
		}
	}
	health = append(health, historian)

	return health
}

func plural(count int, noun string) string {
	return itoaInt(count) + " " + noun
}

func itoaInt(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var buf [20]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

var attentionSeverityRank = map[string]int{"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}

const maxAttentionItems = 24

// buildAttention xếp mọi thứ cần người xử lý vào MỘT danh sách đã sắp theo mức
// độ. Thứ tự bên trong cùng mức giữ nguyên thứ tự nguồn (alarm trước, rồi hạ
// tầng, rồi chất lượng điểm) để hai lần tải liên tiếp không nhảy dòng.
func buildAttention(alarms []AlarmDTO, points []PointDTO, modbus modbusHealthInput) []OverviewAttentionItem {
	items := make([]OverviewAttentionItem, 0, 16)
	for _, alarm := range alarms {
		if strings.EqualFold(alarm.Status, "cleared") || strings.EqualFold(alarm.Status, "shelved") {
			continue
		}
		severity := strings.ToLower(alarm.Severity)
		if _, ok := attentionSeverityRank[severity]; !ok {
			severity = "info"
		}
		if severity == "low" || severity == "info" {
			continue
		}
		// `ISS-PGUI-02` — thông điệp alarm do authority thượng nguồn (Core) dựng.
		// Không có `titleCode`/`detailCode`: mã hoá lại một câu mà tầng này không
		// kiểm soát là bịa ra một phân loại không có thật.
		items = append(items, OverviewAttentionItem{
			ID:         "alarm:" + alarm.ID,
			Severity:   severity,
			Category:   "alarm",
			Title:      alarm.Message,
			Detail:     strings.TrimSpace(strings.Join(nonEmpty(alarm.Source, alarm.Detail), " · ")),
			TargetType: "alarm",
			TargetID:   alarm.ID,
			ObservedAt: alarm.Time,
		})
	}

	for _, slave := range modbus.slaves {
		if slave.Online {
			continue
		}
		// Drill-down đi theo deviceID đã cấu hình — đó là khoá mà trang
		// Modbus/Devices tra được. Slave nào chưa có trong cấu hình thì KHÔNG
		// bịa ra một ID: dòng vẫn hiện, chỉ là không bấm sang được.
		deviceID := modbus.deviceIDFor[overviewSlaveKey(slave.BusID, slave.Addr)]
		title := "Thiết bị Modbus mất liên lạc"
		if name := modbus.nameFor[deviceID]; name != "" {
			title = name + " — mất liên lạc"
		}
		targetType := "modbus_device"
		if deviceID == "" {
			targetType = "bus"
		}
		targetID := deviceID
		if targetID == "" {
			targetID = itoaInt(int(slave.BusID))
		}
		items = append(items, OverviewAttentionItem{
			ID:       "modbus:" + overviewSlaveKey(slave.BusID, slave.Addr),
			Severity: "high",
			Category: "communication",
			Title:    title,
			Detail:   "Bus " + itoaInt(int(slave.BusID)) + " · Slave " + itoaInt(int(slave.Addr)),
			// `subject` rỗng khi thiết bị chưa có tên trong cấu hình: client dựng
			// câu chung ("A Modbus device lost contact") thay vì chèn một khoảng
			// trắng vào giữa câu.
			TitleCode:  "modbus_device_offline",
			Subject:    modbus.nameFor[deviceID],
			DetailCode: "modbus_bus_slave",
			DetailParams: &AttentionDetailParams{
				BusID:     overviewIntPtr(int(slave.BusID)),
				SlaveAddr: overviewIntPtr(int(slave.Addr)),
			},
			TargetType: targetType,
			TargetID:   targetID,
		})
	}

	for _, point := range points {
		quality := strings.ToLower(point.Quality)
		switch quality {
		case "bad":
			items = append(items, OverviewAttentionItem{
				ID: "point:" + point.ID, Severity: "high", Category: "quality",
				Title:     point.Name + " — chất lượng BAD",
				Detail:    attentionPointDetail(point),
				TitleCode: "point_quality_bad", Subject: point.Name,
				DetailCode: "", DetailParams: attentionPointDetailParams(point),
				TargetType: "point", TargetID: point.ID, ObservedAt: point.UpdatedAt,
			})
		case "offline":
			items = append(items, OverviewAttentionItem{
				ID: "point:" + point.ID, Severity: "high", Category: "communication",
				Title:     point.Name + " — OFFLINE",
				Detail:    attentionPointDetail(point),
				TitleCode: "point_offline", Subject: point.Name,
				DetailParams: attentionPointDetailParams(point),
				TargetType:   "point", TargetID: point.ID, ObservedAt: point.UpdatedAt,
			})
		case "stale":
			items = append(items, OverviewAttentionItem{
				ID: "point:" + point.ID, Severity: "medium", Category: "quality",
				Title:     point.Name + " — STALE",
				Detail:    attentionPointDetail(point),
				TitleCode: "point_stale", Subject: point.Name,
				DetailParams: attentionPointDetailParams(point),
				TargetType:   "point", TargetID: point.ID, ObservedAt: point.UpdatedAt,
			})
		}
		if point.Forced {
			items = append(items, OverviewAttentionItem{
				ID: "forced:" + point.ID, Severity: "medium", Category: "forced",
				Title:      point.Name + " — đang ép tay",
				Detail:     forcedDetail(point),
				TitleCode:  "point_forced",
				Subject:    point.Name,
				DetailCode: forcedDetailCode(point),
				DetailParams: &AttentionDetailParams{
					ExpiresInS: forcedExpiresInS(point),
				},
				TargetType: "point", TargetID: point.ID, ObservedAt: point.UpdatedAt,
			})
		}
	}

	sort.SliceStable(items, func(i, j int) bool {
		return attentionSeverityRank[items[i].Severity] < attentionSeverityRank[items[j].Severity]
	})
	if len(items) > maxAttentionItems {
		items = items[:maxAttentionItems]
	}
	return items
}

func attentionPointDetail(point PointDTO) string {
	parts := []string{}
	if point.QualityReason != "" {
		parts = append(parts, point.QualityReason)
	}
	if point.Kind == "modbus_rtu" && point.BusID > 0 {
		parts = append(parts, "Bus "+itoaInt(int(point.BusID))+" · Slave "+itoaInt(int(point.SlaveAddr)))
	}
	if len(parts) == 0 {
		parts = append(parts, point.ID)
	}
	return strings.Join(parts, " · ")
}

// attentionPointDetailParams — điểm chất lượng xấu chỉ có tham số Modbus khi nó
// thật sự là điểm Modbus. Phần còn lại của `attentionPointDetail` (lý do chất
// lượng do Core trả, hoặc `pointID`) là văn bản ĐỤC, đi qua `detail` nguyên văn.
func attentionPointDetailParams(point PointDTO) *AttentionDetailParams {
	if point.Kind != "modbus_rtu" || point.BusID <= 0 {
		return nil
	}
	return &AttentionDetailParams{
		BusID:     overviewIntPtr(int(point.BusID)),
		SlaveAddr: overviewIntPtr(int(point.SlaveAddr)),
	}
}

// forcedDetailCode phân biệt "còn N giây" với "không có thời hạn tự nhả". Hai
// câu này nói hai điều rất khác nhau về rủi ro vận hành, nên chúng là hai mã.
func forcedDetailCode(point PointDTO) string {
	if point.OverrideExpiresInS != nil && *point.OverrideExpiresInS > 0 {
		return "forced_expires_in"
	}
	return "forced_no_expiry"
}

func forcedExpiresInS(point PointDTO) *int {
	if point.OverrideExpiresInS == nil || *point.OverrideExpiresInS <= 0 {
		return nil
	}
	return overviewIntPtr(int(*point.OverrideExpiresInS))
}

func forcedDetail(point PointDTO) string {
	if point.OverrideExpiresInS != nil && *point.OverrideExpiresInS > 0 {
		return point.ID + " · còn " + itoaInt(int(*point.OverrideExpiresInS)) + "s"
	}
	return point.ID + " · không có thời hạn tự nhả"
}

func nonEmpty(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, strings.TrimSpace(value))
		}
	}
	return out
}

// overallFromParts áp đúng thứ tự ưu tiên của §5.1:
// mất authority → alarm critical/high → bad/stale đáng kể → degraded → healthy.
func overallFromParts(overview OverviewResponse) (string, string) {
	if !overview.Connected {
		return HealthOffline, "core_unreachable"
	}
	if overview.Alarms.Critical > 0 {
		return HealthFault, "critical_alarm_active"
	}
	if overview.Alarms.High > 0 {
		return HealthDegraded, "high_alarm_active"
	}
	worst := HealthGood
	reason := "ok"
	for _, domain := range overview.Health {
		switch domain.State {
		case HealthFault:
			return HealthFault, domain.Domain + "_" + domain.ReasonCode
		case HealthOffline:
			return HealthOffline, domain.Domain + "_" + domain.ReasonCode
		case HealthDegraded:
			if worst != HealthDegraded {
				worst = HealthDegraded
				reason = domain.Domain + "_" + domain.ReasonCode
			}
		case HealthUnknown:
			if worst == HealthGood {
				worst = HealthUnknown
				reason = domain.Domain + "_" + domain.ReasonCode
			}
		}
	}
	if worst == HealthGood && (overview.Points.Bad > 0 || overview.Points.Offline > 0) {
		return HealthDegraded, "point_quality_degraded"
	}
	return worst, reason
}
