package modbusrtu

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

/* `ISS-PIO-22`/`F-PIO-021` — nhóm poll theo điểm (đề bài §22). */

func TestNormalizePollGroupFallsBackToNormal(t *testing.T) {
	for value, want := range map[string]string{
		"fast": PollGroupFast, "FAST": PollGroupFast, " slow ": PollGroupSlow,
		"normal": PollGroupNormal, "": PollGroupNormal, "cuc-nhanh": PollGroupNormal,
	} {
		if got := NormalizePollGroup(value); got != want {
			t.Fatalf("NormalizePollGroup(%q) = %q; muốn %q", value, got, want)
		}
	}
}

/* Rỗng là HỢP LỆ (mặc định), chuỗi lạ thì KHÔNG.
 *
 * Im lặng hạ một chuỗi lạ về `normal` ở cửa ghi sẽ để người vận hành tin rằng
 * đã đặt được `slow` cho một điểm cấu hình và đã tiết kiệm được băng thông. */
func TestValidPollGroupRejectsUnknownButAcceptsEmpty(t *testing.T) {
	for _, value := range []string{"", "fast", "normal", "slow", "SLOW"} {
		if !ValidPollGroup(value) {
			t.Fatalf("%q bị từ chối", value)
		}
	}
	for _, value := range []string{"cuc-nhanh", "fastest", "0"} {
		if ValidPollGroup(value) {
			t.Fatalf("%q được chấp nhận", value)
		}
	}
}

/* Cổng chống trôi: ba tên nhóm của Go phải TRÙNG `poll_group_from_string` của
 * firmware. Thêm một nhóm ở một bên mà quên bên kia thì web-api nhận một giá
 * trị mà firmware âm thầm hạ về `normal`. */
func TestPollGroupNamesMatchFirmware(t *testing.T) {
	source, err := os.ReadFile("../../../../apps/iobus/adapters/modbus_rtu/poll_group.cpp")
	if err != nil {
		t.Fatalf("không đọc được poll_group.cpp: %v", err)
	}
	text := string(source)
	for _, group := range PollGroups {
		if !strings.Contains(text, `"`+group+`"`) {
			t.Fatalf("nhóm %q có trong Go nhưng firmware không nhận", group)
		}
	}
	for _, match := range regexp.MustCompile(`return "([a-z]+)";`).FindAllStringSubmatch(text, -1) {
		found := false
		for _, group := range PollGroups {
			if group == match[1] {
				found = true
			}
		}
		if !found {
			t.Fatalf("firmware phát nhóm %q nhưng Go không khai", match[1])
		}
	}
}

/* `BuildProfile` chỉ ghi khoá khi KHÁC mặc định: `fieldbus.conf` của tủ chưa
 * dùng tính năng này phải giữ nguyên hình dạng cũ. */
func TestBuildProfileOmitsDefaultPollGroup(t *testing.T) {
	device := Device{DeviceID: "d1"}
	point := Point{PointID: "p1", DeviceID: "d1", RegisterType: "holding_register",
		Address: 10, DataType: "uint16", Enabled: FlexBool(true)}

	raw, err := BuildProfile(device, []Point{point})
	if err != nil {
		t.Fatalf("BuildProfile lỗi: %v", err)
	}
	if strings.Contains(string(raw), "poll_group") {
		t.Fatalf("mặc định vẫn ghi poll_group xuống cấu hình: %s", raw)
	}
	if strings.Contains(string(raw), "stale_after_ms") {
		t.Fatalf("mặc định vẫn ghi stale_after_ms: %s", raw)
	}
}

func TestBuildProfileEmitsNonDefaultPollGroupAndStale(t *testing.T) {
	device := Device{DeviceID: "d1"}
	point := Point{PointID: "p1", DeviceID: "d1", RegisterType: "holding_register",
		Address: 10, DataType: "uint16", Enabled: FlexBool(true),
		PollGroup: "slow", StaleAfterMS: 45000}

	raw, err := BuildProfile(device, []Point{point})
	if err != nil {
		t.Fatalf("BuildProfile lỗi: %v", err)
	}
	text := string(raw)
	if !strings.Contains(text, `"poll_group"`) || !strings.Contains(text, `"slow"`) {
		t.Fatalf("không ghi poll_group=slow: %s", text)
	}
	if !strings.Contains(text, "45000") {
		t.Fatalf("không ghi stale_after_ms: %s", text)
	}
}

func pollGroupMessages(t *testing.T, mutate func(*Point)) map[string]string {
	t.Helper()
	cfg := validConfig()
	mutate(&cfg.Points[0])
	out := map[string]string{}
	for _, err := range Validate(cfg, map[string]string{}) {
		out[err.Path] = err.Message
	}
	return out
}

/* Nhóm poll lạ bị TỪ CHỐI ở cửa ghi, không im lặng hạ về `normal`: hạ im lặng
 * sẽ để người vận hành tin rằng đã đặt được `slow` cho một điểm cấu hình và đã
 * tiết kiệm được băng thông RS-485. */
func TestValidateRejectsUnknownPollGroup(t *testing.T) {
	messages := pollGroupMessages(t, func(p *Point) { p.PollGroup = "cuc-nhanh" })
	if messages["points[0].poll_group"] == "" {
		t.Fatalf("nhóm poll lạ đi lọt: %#v", messages)
	}

	// Ba nhóm hợp lệ và chuỗi rỗng (mặc định) phải đi qua.
	for _, group := range []string{"", "fast", "normal", "slow"} {
		if messages := pollGroupMessages(t, func(p *Point) { p.PollGroup = group }); len(messages) != 0 {
			t.Fatalf("nhóm %q bị từ chối: %#v", group, messages)
		}
	}
}

func TestValidateBoundsStaleAfterMS(t *testing.T) {
	if messages := pollGroupMessages(t, func(p *Point) { p.StaleAfterMS = -1 }); messages["points[0].stale_after_ms"] == "" {
		t.Fatalf("ngưỡng stale âm đi lọt: %#v", messages)
	}
	if messages := pollGroupMessages(t, func(p *Point) { p.StaleAfterMS = StaleAfterMaxMS + 1 }); messages["points[0].stale_after_ms"] == "" {
		t.Fatalf("ngưỡng stale quá trần đi lọt: %#v", messages)
	}
	// `0` là hợp lệ và mang nghĩa "suy từ chu kỳ poll", không phải "chưa đặt".
	if messages := pollGroupMessages(t, func(p *Point) { p.StaleAfterMS = 0 }); len(messages) != 0 {
		t.Fatalf("ngưỡng stale 0 bị từ chối: %#v", messages)
	}
}

/* `ISS-PIO-23` — xác nhận sau khi ghi. */

func TestValidateVerifyAfterWriteRequiresWritablePoint(t *testing.T) {
	// Bật cho điểm CHỈ ĐỌC là hiểu nhầm phải nói ra: nó sẽ không bao giờ chạy,
	// và im lặng nhận sẽ để người dùng tin rằng đã bật được kiểm chứng.
	messages := pollGroupMessages(t, func(p *Point) {
		p.ReadWrite = "read"
		p.VerifyAfterWrite = true
	})
	if messages["points[0].verify_after_write"] == "" {
		t.Fatalf("bật verify cho điểm chỉ đọc đi lọt: %#v", messages)
	}

	if messages := pollGroupMessages(t, func(p *Point) {
		p.ReadWrite = "read_write"
		p.VerifyAfterWrite = true
	}); len(messages) != 0 {
		t.Fatalf("điểm read_write bật verify bị từ chối: %#v", messages)
	}
}

func TestValidateRejectsNegativeReadbackTolerance(t *testing.T) {
	messages := pollGroupMessages(t, func(p *Point) { p.ReadbackTolerance = -1 })
	if messages["points[0].readback_tolerance"] == "" {
		t.Fatalf("dung sai âm đi lọt: %#v", messages)
	}
}

func TestBuildProfileEmitsVerifyAfterWriteOnlyWhenEnabled(t *testing.T) {
	device := Device{DeviceID: "d1"}
	base := Point{PointID: "p1", DeviceID: "d1", RegisterType: "holding_register",
		Address: 10, DataType: "uint16", Enabled: FlexBool(true), ReadWrite: "read_write"}

	raw, err := BuildProfile(device, []Point{base})
	if err != nil {
		t.Fatalf("BuildProfile lỗi: %v", err)
	}
	if strings.Contains(string(raw), "verify_after_write") {
		t.Fatalf("mặc định vẫn ghi verify_after_write: %s", raw)
	}

	enabled := base
	enabled.VerifyAfterWrite = true
	enabled.ReadbackTolerance = 0.5
	raw, err = BuildProfile(device, []Point{enabled})
	if err != nil {
		t.Fatalf("BuildProfile lỗi: %v", err)
	}
	text := string(raw)
	if !strings.Contains(text, "verify_after_write") {
		t.Fatalf("không ghi verify_after_write: %s", text)
	}
	if !strings.Contains(text, "readback_tolerance") {
		t.Fatalf("không ghi readback_tolerance: %s", text)
	}
}
