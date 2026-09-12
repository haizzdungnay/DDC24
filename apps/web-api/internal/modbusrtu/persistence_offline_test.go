package modbusrtu

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApply_OfflineParams_WiredToJSON(t *testing.T) {
	var writtenPath string
	var writtenData []byte

	persister := Persister{
		ConfigDir:  "/tmp/modbus_test",
		ConfigPath: "/tmp/modbus_test/fieldbus.conf",
		WriteFile: func(path string, data []byte, mode os.FileMode) error {
			if path == "/tmp/modbus_test/fieldbus.conf" {
				writtenPath = path
				writtenData = data
			}
			return nil
		},
		Reload: func() (bool, []string) {
			return true, nil
		},
	}

	cfg := Config{
		OfflineProbeMs: 5000,
		Devices: []Device{
			{
				DeviceID:           "MTR-01",
				DisplayName:        "Electric Meter 01",
				Enabled:            true,
				RS485Port:          "/dev/rs485-1",
				Baud:               19200,
				Parity:             "N",
				StopBit:            1,
				SlaveID:            1,
				PollMS:             1000,
				TimeoutMS:          300,
				Retry:              1,
				OfflineAfterErrors: 3,
			},
		},
		Points: []Point{
			{
				PointID:      "m1_v",
				DeviceID:     "MTR-01",
				TagName:      "MB_M1_V",
				DisplayName:  "Voltage",
				RegisterType: "holding_register",
				Address:      100,
				DataType:     "float32",
				ByteOrder:    "big",
				WordOrder:    "high_low",
				Scale:        1.0,
				Offset:       0,
				ReadWrite:    "read",
				Enabled:      true,
			},
		},
	}

	res, err := persister.Apply(cfg, Config{})
	if err != nil {
		t.Fatalf("Persister.Apply failed: %v", err)
	}

	if res.Config.OfflineProbeMs != 5000 {
		t.Errorf("expected OfflineProbeMs=5000, got %d", res.Config.OfflineProbeMs)
	}

	if len(writtenData) == 0 {
		t.Fatalf("no data written to %s", writtenPath)
	}

	var parsed struct {
		RS485  map[string]any   `json:"rs485"`
		Slaves []map[string]any `json:"slaves"`
	}
	if err := json.Unmarshal(writtenData, &parsed); err != nil {
		t.Fatalf("failed to unmarshal written fieldbus.conf: %v", err)
	}

	if probe, ok := parsed.RS485["offline_probe_ms"].(float64); !ok || int(probe) != 5000 {
		t.Errorf("expected rs485.offline_probe_ms = 5000, got %v", parsed.RS485["offline_probe_ms"])
	}

	if len(parsed.Slaves) != 1 {
		t.Fatalf("expected 1 slave, got %d", len(parsed.Slaves))
	}

	if afterErr, ok := parsed.Slaves[0]["offline_after_errors"].(float64); !ok || int(afterErr) != 3 {
		t.Errorf("expected slaves[0].offline_after_errors = 3, got %v", parsed.Slaves[0]["offline_after_errors"])
	}
}

func TestValidateConfig_256Points(t *testing.T) {
	cfg := Config{
		Devices: []Device{
			{
				DeviceID:  "DEV1",
				Enabled:   true,
				RS485Port: "/dev/rs485-1",
				Baud:      9600,
				Parity:    "N",
				StopBit:   1,
				SlaveID:   1,
				PollMS:    1000,
				TimeoutMS: 300,
			},
		},
	}

	// Create 256 valid points
	for i := 0; i < 256; i++ {
		cfg.Points = append(cfg.Points, Point{
			PointID:      fmt.Sprintf("pt_%d", i),
			DeviceID:     "DEV1",
			TagName:      fmt.Sprintf("MB_TAG_%d", i),
			DisplayName:  fmt.Sprintf("Point %d", i),
			RegisterType: "holding_register",
			Address:      i,
			DataType:     "uint16",
			ByteOrder:    "big",
			WordOrder:    "high_low",
			Scale:        1.0,
			ReadWrite:    "read",
			Enabled:      true,
		})
	}

	errs := Validate(cfg, nil)
	for _, e := range errs {
		if e.Path == "points" {
			t.Errorf("unexpected validation error for 256 points: %s: %s", e.Path, e.Message)
		}
	}

	// Add 257th point
	cfg.Points = append(cfg.Points, Point{
		PointID:      "pt_256",
		DeviceID:     "DEV1",
		TagName:      "MB_TAG_256",
		DisplayName:  "Point 256",
		RegisterType: "holding_register",
		Address:      256,
		DataType:     "uint16",
		ByteOrder:    "big",
		WordOrder:    "high_low",
		Scale:        1.0,
		ReadWrite:    "read",
		Enabled:      true,
	})

	errs = Validate(cfg, nil)
	foundLimitError := false
	for _, e := range errs {
		if e.Path == "points" && e.Code == CodeCapacityExceeded {
			foundLimitError = true
			break
		}
	}
	if !foundLimitError {
		t.Errorf("expected CAPACITY_EXCEEDED for 257 points, but got: %v", errs)
	}
}

// failingRestoreWriter trả về một `FileWriter` ghi thật ở pha ghi xuôi và hỏng ở
// pha quay về.
//
// Mốc chuyển pha là lần ghi `configPath` thành công: đó là lần ghi xuôi CUỐI
// cùng của `Apply`, nên mọi lần ghi sau nó đều thuộc đường quay về (hoặc ghi bản
// LKG). Dựng như vậy để tái hiện đúng tình huống thật đáng sợ nhất — đĩa còn chỗ
// cho bản mới nhưng hết chỗ (hoặc mất quyền) đúng lúc cần quay về — chứ không
// phải một `Persister` hỏng ngay từ lần ghi đầu.
func failingRestoreWriter(configPath string, failure error) FileWriter {
	rollbackPhase := false
	writer := func(path string, data []byte, mode os.FileMode) error {
		if rollbackPhase {
			return failure
		}
		if err := os.WriteFile(path, data, mode); err != nil {
			return err
		}
		if path == configPath {
			rollbackPhase = true
		}
		return nil
	}
	return writer
}

// Rollback hỏng phải đi ra ngoài — cả ở lỗi trả về lẫn ở `Reason` của journal.
//
// Bản trước vứt lỗi của `WriteFile`/`os.Remove` trong `restore()`, nên khi quay
// về thất bại `Apply` vẫn báo đúng một thứ: "cấu hình cũ đã được phục hồi", và
// journal vẫn ghi `ROLLED_BACK`. Cả hai đều sai: `fieldbus.conf` trên đĩa còn là
// bản MỚI, và lần khởi động sau iobus nạp đúng cấu hình nó vừa từ chối.
func TestApplyReportsRollbackFailureWhenRestoreFails(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "fieldbus.conf")
	journalPath := filepath.Join(dir, "journal.json")
	if err := os.WriteFile(configPath, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	writer := failingRestoreWriter(configPath, errors.New("read-only file system"))

	// Không kênh điều khiển và không `Reload` ⇒ Apply đi thẳng vào `failTx`.
	p := Persister{ConfigDir: dir, ConfigPath: configPath, WriteFile: writer,
		Journal: Journal{Path: journalPath, WriteFile: os.WriteFile}}
	_, err := p.Apply(validConfig(), Config{})

	if err == nil {
		t.Fatal("Apply phải trả lỗi khi không có đường nạp lại cấu hình")
	}
	if !errors.Is(err, ErrApply) {
		t.Fatalf("lỗi trả về phải vẫn bọc ErrApply (tầng HTTP phân loại theo nó): %v", err)
	}
	if !strings.Contains(err.Error(), configPath) {
		t.Fatalf("lỗi trả về KHÔNG nêu đường dẫn không quay về được (%s), người vận hành không biết đĩa đang lai: %v",
			configPath, err)
	}

	data, readErr := os.ReadFile(configPath)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(data) == "old\n" {
		t.Fatal("dựng test sai: rollback đã thành công nên không kiểm được nhánh rollback hỏng")
	}

	tx, exists, err := Journal{Path: journalPath}.Read()
	if err != nil || !exists {
		t.Fatalf("journal = %v/%v", exists, err)
	}
	if tx.State != TxRolledBack {
		t.Fatalf("tx.State = %q, muốn %q", tx.State, TxRolledBack)
	}
	if !strings.Contains(tx.Reason, configPath) {
		t.Fatalf("tx.Reason chỉ nêu nguyên nhân gốc, không nêu rollback hỏng: %q", tx.Reason)
	}
	if !strings.Contains(tx.Reason, "không có đường nạp lại cấu hình") {
		t.Fatalf("tx.Reason mất nguyên nhân gốc: %q", tx.Reason)
	}
}

// Đường dự phòng (restart service) có mã quay về riêng, không đi qua `failTx`.
// Nó phải nói cùng một thứ về cùng một sự cố, nếu không hai đường quay về cho
// hai lời khai khác nhau về trạng thái đĩa.
func TestApplyReportsRollbackFailureOnReloadFallback(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "fieldbus.conf")
	journalPath := filepath.Join(dir, "journal.json")
	if err := os.WriteFile(configPath, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	writer := failingRestoreWriter(configPath, errors.New("no space left on device"))
	reloads := 0

	p := Persister{ConfigDir: dir, ConfigPath: configPath, WriteFile: writer,
		Reload:  func() (bool, []string) { reloads++; return false, []string{"restart failed"} },
		Journal: Journal{Path: journalPath, WriteFile: os.WriteFile}}
	_, err := p.Apply(validConfig(), Config{})

	if err == nil {
		t.Fatal("Apply phải trả lỗi khi Reload không áp được cấu hình")
	}
	if !errors.Is(err, ErrApply) {
		t.Fatalf("lỗi trả về phải vẫn bọc ErrApply: %v", err)
	}
	if !strings.Contains(err.Error(), configPath) {
		t.Fatalf("lỗi trả về KHÔNG nêu đường dẫn không quay về được (%s): %v", configPath, err)
	}
	if reloads != 2 {
		t.Fatalf("reloads = %d, muốn 2 (một lần áp bản mới, một lần chạy lại bằng bản cũ)", reloads)
	}

	tx, exists, readErr := Journal{Path: journalPath}.Read()
	if readErr != nil || !exists {
		t.Fatalf("journal = %v/%v", exists, readErr)
	}
	if !strings.Contains(tx.Reason, configPath) {
		t.Fatalf("tx.Reason chỉ nêu nguyên nhân gốc, không nêu rollback hỏng: %q", tx.Reason)
	}
	if !strings.Contains(tx.Reason, "restart failed") {
		t.Fatalf("tx.Reason mất nguyên nhân gốc: %q", tx.Reason)
	}
}

// Bản last-known-good vắng mặt là thứ phải biết TRƯỚC khi cần tới nó. Ghi hỏng
// không làm apply thất bại (cấu hình mới vẫn áp được), nhưng im lặng thì lần sau
// người vận hành đi tìm `fieldbus.lkg.json` để quay về và không thấy gì.
func TestApplyWarnsWhenLastKnownGoodWriteFails(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "fieldbus.conf")
	lkgPath := filepath.Join(dir, "fieldbus.lkg.json")

	p := Persister{ConfigDir: dir, ConfigPath: configPath,
		WriteFile: func(path string, data []byte, mode os.FileMode) error {
			if path == lkgPath {
				return errors.New("read-only file system")
			}
			return os.WriteFile(path, data, mode)
		},
		Reload: func() (bool, []string) { return true, nil }}

	res, err := p.Apply(validConfig(), Config{Revision: 3})
	if err != nil {
		t.Fatalf("ghi LKG hỏng KHÔNG được làm apply thất bại: %v", err)
	}
	found := false
	for _, w := range res.Warnings {
		if strings.Contains(w, lkgPath) {
			found = true
		}
	}
	if !found {
		t.Fatalf("không có warning nào nêu %s; warnings = %q", lkgPath, res.Warnings)
	}
	if _, statErr := os.Stat(lkgPath); !os.IsNotExist(statErr) {
		t.Fatalf("dựng test sai: %s vẫn được ghi nên không kiểm được nhánh ghi hỏng (%v)", lkgPath, statErr)
	}
}
