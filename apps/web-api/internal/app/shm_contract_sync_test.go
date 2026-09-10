package app

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// ISS-606 — cổng đồng bộ giữa ba hằng số SHM chép tay trong `core_client.go` và
// nguồn chuẩn `contracts/shm/mkddc_shm.h`.
//
// Vì sao cần: `kxShmMagic`, `defaultIOShm`, `defaultPLCShm` là BẢN SAO RỜI của
// `KX_SHM_MAGIC`, `KX_SHM_IO_PATH`, `KX_SHM_PLC_PATH`. Phía C++ an toàn vì
// `#include "mkddc_shm.h"` trực tiếp (`apps/iobus/domain/io/io_types.hpp`,
// `apps/hmi/data/shm_reader.hpp`); chỉ Go giữ bản sao.
//
// Bộ test hiện có KHÔNG thể bắt được drift, và đây là điểm mấu chốt: 16 chỗ
// dùng `kxShmMagic` trong package này, mọi chỗ trừ một là fixture tự dựng SHM
// giả rồi GHI chính hằng số đó vào header (`core_client_test.go:178`), còn chỗ
// cuối là nơi ĐỌC (`shm_reader.go:166`). Test viết bằng hằng số A rồi khẳng
// định code đọc được hằng số A — luôn đúng với MỌI giá trị của A.
//
// Đường hỏng đã đi qua một lần: `mkddc_shm.h:248-286` ghi lại lần bump magic
// v5 → v6 (`ISS-PIO-11`). Lần bump sau mà Go không đổi theo thì `go test` vẫn
// xanh toàn bộ, còn trên thiết bị thật `shm_reader.go:166` so magic mới với
// hằng số cũ ra `false` ⇒ web-api coi SHM là không hợp lệ, người vận hành thấy
// Overview mất dữ liệu Point trong khi Core và iobus chạy bình thường.
//
// Test này cố tình đọc file contract THẬT thay vì một bản sao trong test: bản
// sao sẽ trôi cùng lúc với thứ nó phải canh gác. Khuôn mẫu lấy từ
// `internal/modbusrtu/contract_sync_test.go` (helper fail-close sau #590).
//
// Phần parse tách làm hai lớp có chủ đích: hàm thuần trả `error`
// (`parseShmDefine*`) và lớp bọc `t.Fatalf` (`shmContract*`). Nhờ vậy nhánh
// fail-close kiểm được trực tiếp — nếu chỉ có lớp `t.Fatalf` thì chính cơ chế
// dừng-khi-hỏng lại là thứ không test nào chạm tới.

// shmContractMaxParents là số cấp thư mục tối đa đi ngược lên để tìm gốc repo.
const shmContractMaxParents = 8

// shmContractRelPath là đường dẫn tương đối tới file hợp đồng, tính từ gốc repo.
var shmContractRelPath = filepath.Join("contracts", "shm", "mkddc_shm.h")

// shmContractPath trả về đường dẫn tuyệt đối tới `contracts/shm/mkddc_shm.h`.
//
// Fail-close, cố tình KHÔNG `t.Skip`: file hợp đồng luôn phải có trong repo,
// nên không tìm thấy nghĩa là cây thư mục đã đổi (đổi tên/di chuyển
// `contracts/`, hoặc lồng sâu hơn giới hạn) chứ không phải "môi trường thiếu
// điều kiện". Bỏ qua ở đây làm cổng đồng bộ tự biến mất mà `go test` vẫn báo
// `ok` — đúng lỗi mà #590 vừa vá, không được tái lập.
func shmContractPath(t *testing.T) string {
	t.Helper()
	start, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	dir := start
	for i := 0; i < shmContractMaxParents; i++ {
		candidate := filepath.Join(dir, shmContractRelPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		dir = filepath.Dir(dir)
	}
	t.Fatalf("không tìm thấy %s sau khi đi lên %d cấp từ %q — "+
		"kiểm tra contracts/ có bị đổi tên/di chuyển không, hoặc nâng shmContractMaxParents nếu cây thư mục sâu thêm",
		shmContractRelPath, shmContractMaxParents, start)
	return ""
}

// parseShmDefineLine trả về phần giá trị của dòng `#define <name> ...` đầu tiên.
//
// Trả nguyên phần đuôi (kể cả comment) chứ không chỉ token giá trị, để mọi
// thông điệp lỗi phía sau trích được đúng thứ đã đọc — người sửa cần thấy dòng
// thật, không phải suy đoán từ một chuỗi đã bị cắt.
func parseShmDefineLine(header, name string) (string, error) {
	pattern := regexp.MustCompile(`(?m)^[ \t]*#define[ \t]+` + regexp.QuoteMeta(name) + `[ \t]+(.*)$`)
	match := pattern.FindStringSubmatch(header)
	if match == nil {
		return "", fmt.Errorf("không tìm thấy `#define %s` trong %s — hằng số đã bị đổi tên hoặc xoá khỏi hợp đồng",
			name, shmContractRelPath)
	}
	return strings.TrimSpace(match[1]), nil
}

// parseShmDefineUint đọc giá trị số nguyên của một `#define`, bóc hậu tố kiểu C.
//
// `KX_SHM_MAGIC` viết là `0x4B584406u` — chữ `u` cuối là hậu tố kiểu C hợp lệ
// mà `strconv.ParseUint` không nuốt được. Cắt hậu tố `u`/`U`/`l`/`L` (và tổ hợp
// `ul`, `ull`…) trước khi parse; phần đuôi comment `/* … */` hay `// …` cũng
// phải bỏ.
//
// Parse hỏng trả `error` chứ KHÔNG trả 0: một hợp đồng đổi cách viết (ví dụ
// sang biểu thức `(0x4B58 << 16 | 0x4406)`) mà test lặng lẽ cho qua thì cổng
// này mất tác dụng đúng lúc cần nhất.
func parseShmDefineUint(header, name string) (uint64, error) {
	line, err := parseShmDefineLine(header, name)
	if err != nil {
		return 0, err
	}

	value := line
	if idx := strings.Index(value, "/*"); idx >= 0 {
		value = value[:idx]
	}
	if idx := strings.Index(value, "//"); idx >= 0 {
		value = value[:idx]
	}
	value = strings.TrimSpace(value)
	trimmed := strings.TrimRight(value, "uUlL")
	if trimmed == "" {
		return 0, fmt.Errorf("`#define %s` không có phần số sau khi bóc hậu tố kiểu C — dòng đọc được: %q", name, line)
	}

	parsed, parseErr := strconv.ParseUint(trimmed, 0, 64)
	if parseErr != nil {
		return 0, fmt.Errorf("không parse được giá trị của `#define %s`: %w — dòng đọc được: %q (đã bóc hậu tố thành %q); "+
			"nếu hợp đồng đổi sang biểu thức thì phải mở rộng parseShmDefineUint, không được bỏ qua",
			name, parseErr, line, trimmed)
	}
	return parsed, nil
}

// parseShmDefineString đọc giá trị chuỗi của một `#define`, bóc cặp nháy kép.
func parseShmDefineString(header, name string) (string, error) {
	line, err := parseShmDefineLine(header, name)
	if err != nil {
		return "", err
	}

	match := regexp.MustCompile(`^"([^"]*)"`).FindStringSubmatch(line)
	if match == nil {
		return "", fmt.Errorf("giá trị của `#define %s` không phải chuỗi trong cặp nháy kép — dòng đọc được: %q; "+
			"nếu hợp đồng đổi cách viết thì phải mở rộng parseShmDefineString, không được bỏ qua", name, line)
	}
	return match[1], nil
}

// shmContractUint là lớp bọc dừng-ngay của parseShmDefineUint.
func shmContractUint(t *testing.T, header, name string) uint64 {
	t.Helper()
	value, err := parseShmDefineUint(header, name)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

// shmContractString là lớp bọc dừng-ngay của parseShmDefineString.
func shmContractString(t *testing.T, header, name string) string {
	t.Helper()
	value, err := parseShmDefineString(header, name)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

// TestShmContractConstantsMatchHeader canh ba hằng số chép tay trong
// `core_client.go` khớp nguồn chuẩn `contracts/shm/mkddc_shm.h`.
//
// Khác hẳn 16 chỗ dùng `kxShmMagic` trong fixture: những chỗ đó viết và đọc
// cùng một hằng số nên luôn đúng; test này so hằng số Go với FILE hợp đồng,
// nên nó đỏ đúng lúc hai bên thôi khớp.
func TestShmContractConstantsMatchHeader(t *testing.T) {
	path := shmContractPath(t)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("đọc %s hỏng: %v", path, err)
	}
	header := string(raw)

	t.Run("KX_SHM_MAGIC", func(t *testing.T) {
		want := shmContractUint(t, header, "KX_SHM_MAGIC")
		if uint64(kxShmMagic) != want {
			t.Fatalf("kxShmMagic = %#x nhưng KX_SHM_MAGIC = %#x (%s) — "+
				"magic lệch nghĩa là web-api coi SHM của Core là không hợp lệ và Overview mất dữ liệu Point "+
				"trong khi Core/iobus vẫn chạy; sửa hằng số trong core_client.go cho khớp hợp đồng",
				uint64(kxShmMagic), want, shmContractRelPath)
		}
	})

	t.Run("KX_SHM_IO_PATH", func(t *testing.T) {
		want := shmContractString(t, header, "KX_SHM_IO_PATH")
		if defaultIOShm != want {
			t.Fatalf("defaultIOShm = %q nhưng KX_SHM_IO_PATH = %q (%s) — "+
				"đường dẫn lệch nghĩa là web-api attach nhầm file SHM (hoặc không attach được)",
				defaultIOShm, want, shmContractRelPath)
		}
	})

	t.Run("KX_SHM_PLC_PATH", func(t *testing.T) {
		want := shmContractString(t, header, "KX_SHM_PLC_PATH")
		if defaultPLCShm != want {
			t.Fatalf("defaultPLCShm = %q nhưng KX_SHM_PLC_PATH = %q (%s) — "+
				"đường dẫn lệch nghĩa là web-api attach nhầm file SHM (hoặc không attach được)",
				defaultPLCShm, want, shmContractRelPath)
		}
	})
}

// TestShmContractParserAcceptsCStyleSuffix khoá hành vi bóc hậu tố kiểu C và
// bóc nháy kép — phần dễ hỏng nhất khi ai đó "dọn" regex sau này.
func TestShmContractParserAcceptsCStyleSuffix(t *testing.T) {
	header := strings.Join([]string{
		`#define KX_FAKE_MAGIC      0x4B584406u   /* comment kiểu C */`,
		`#define KX_FAKE_PLAIN      256`,
		`#define KX_FAKE_SUFFIX_UL  0x10ul`,
		`#define KX_FAKE_LINE_NOTE  32           // comment kiểu C++`,
		`#define KX_FAKE_PATH       "/dev/shm/fake_path"`,
	}, "\n")

	for _, tc := range []struct {
		name string
		want uint64
	}{
		{"KX_FAKE_MAGIC", 0x4B584406},
		{"KX_FAKE_PLAIN", 256},
		{"KX_FAKE_SUFFIX_UL", 0x10},
		{"KX_FAKE_LINE_NOTE", 32},
	} {
		if got := shmContractUint(t, header, tc.name); got != tc.want {
			t.Errorf("shmContractUint(%s) = %#x, muốn %#x", tc.name, got, tc.want)
		}
	}

	if got := shmContractString(t, header, "KX_FAKE_PATH"); got != "/dev/shm/fake_path" {
		t.Errorf("shmContractString(KX_FAKE_PATH) = %q, muốn %q", got, "/dev/shm/fake_path")
	}
}

// TestShmContractParserFailsClosed khẳng định mọi đầu vào hỏng đều trả `error`
// chứ không trả zero value.
//
// Đây là phần giữ cho cổng còn là cổng: nếu parse hỏng mà trả 0 và `""`, thì
// một hợp đồng đổi cách viết sẽ làm TestShmContractConstantsMatchHeader so
// `kxShmMagic` với 0 — vẫn đỏ, nhưng đỏ vì lý do sai; còn nếu ai đó "sửa" bằng
// cách bỏ qua giá trị rỗng thì cổng biến mất im lặng.
func TestShmContractParserFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name   string
		header string
		symbol string
		reason string
	}{
		{
			name:   "thiếu define",
			header: `#define KX_SOMETHING_ELSE 1`,
			symbol: "KX_SHM_MAGIC",
			reason: "hằng số bị đổi tên hoặc xoá",
		},
		{
			name:   "giá trị không phải số",
			header: `#define KX_SHM_MAGIC (0x4B58 << 16)`,
			symbol: "KX_SHM_MAGIC",
			reason: "hợp đồng đổi sang biểu thức",
		},
		{
			name:   "chỉ còn hậu tố",
			header: `#define KX_SHM_MAGIC uL`,
			symbol: "KX_SHM_MAGIC",
			reason: "không còn phần số",
		},
	} {
		t.Run("uint/"+tc.name, func(t *testing.T) {
			if got, err := parseShmDefineUint(tc.header, tc.symbol); err == nil {
				t.Fatalf("parseShmDefineUint lẽ ra phải trả lỗi (%s) nhưng trả %#x", tc.reason, got)
			}
		})
	}

	for _, tc := range []struct {
		name   string
		header string
		symbol string
		reason string
	}{
		{
			name:   "thiếu define",
			header: `#define KX_SOMETHING_ELSE "x"`,
			symbol: "KX_SHM_IO_PATH",
			reason: "hằng số bị đổi tên hoặc xoá",
		},
		{
			name:   "không có nháy kép",
			header: `#define KX_SHM_IO_PATH /dev/shm/mkddc_io_shm`,
			symbol: "KX_SHM_IO_PATH",
			reason: "hợp đồng đổi cách viết",
		},
	} {
		t.Run("string/"+tc.name, func(t *testing.T) {
			if got, err := parseShmDefineString(tc.header, tc.symbol); err == nil {
				t.Fatalf("parseShmDefineString lẽ ra phải trả lỗi (%s) nhưng trả %q", tc.reason, got)
			}
		})
	}
}
