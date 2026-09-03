package app

import (
	"encoding/binary"
	"testing"
	"time"
)

/* `ISS-PIO-08`/`F-PIO-007` — mốc thời gian điểm LOCAL đến từ PRODUCER.
 *
 * Chỗ này từng là `time.Now()`, tức "lúc web đọc SHM". Hệ quả đúng bằng
 * `PA3-F04`: một điểm mà Core đã ngừng cập nhật từ lâu vẫn hiện "vừa xong" trên
 * mọi màn hình, và `isFreshIso()` coi nó là dữ liệu tươi — một cảm biến chết
 * cứng trông y hệt một cảm biến đang chạy. */

func plcBufferWithTs(sampleMonoNS uint64) []byte {
	data := make([]byte, kxPlcShmMinLen)
	binary.LittleEndian.PutUint64(data[offPLCTsNS:offPLCTsNS+8], sampleMonoNS)
	return data
}

// Snapshot đóng dấu 5 giây trước ⇒ `updatedAt` phải LÙI 5 giây so với hiện tại,
// không phải "bây giờ".
func TestPlcSnapshotUpdatedAtReflectsProducerAge(t *testing.T) {
	nowMono, ok := monotonicNowNS()
	if !ok {
		t.Skip("nền tảng này không đọc được CLOCK_MONOTONIC")
	}
	const ageS = 5
	wallNow := time.Date(2026, 9, 3, 22, 0, 0, 0, time.UTC)
	raw := plcSnapshotUpdatedAt(plcBufferWithTs(nowMono-ageS*1_000_000_000), wallNow)
	if raw == "" {
		t.Fatal("không dựng được mốc dù ts_ns hợp lệ")
	}
	got, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		t.Fatalf("mốc không phải RFC3339: %q (%v)", raw, err)
	}
	age := wallNow.Sub(got)
	// Nới ±1 s cho thời gian trôi giữa hai lời gọi `clock_gettime`.
	if age < (ageS-1)*time.Second || age > (ageS+1)*time.Second {
		t.Fatalf("tuổi mẫu = %v; chờ khoảng %ds — mốc phải là của producer, không phải lúc web đọc", age, ageS)
	}
}

/* Ba ca "không biết", và cả ba phải ra CHUỖI RỖNG.
 *
 * Chuỗi rỗng đi tới FE thành `updatedAt: undefined` và giao diện hiện `—`. Điền
 * `time.Now()` vào bất kỳ ca nào trong đây chính là con bug: nó biến "không ai
 * biết điểm này cập nhật lúc nào" thành "vừa xong". */
func TestPlcSnapshotUpdatedAtSaysUnknownInsteadOfGuessing(t *testing.T) {
	wallNow := time.Now()
	cases := map[string][]byte{
		"producer chưa từng đóng dấu (ts_ns = 0)": plcBufferWithTs(0),
		"segment ngắn hơn cả header":              make([]byte, 4),
	}
	for name, data := range cases {
		if got := plcSnapshotUpdatedAt(data, wallNow); got != "" {
			t.Fatalf("%s ⇒ %q; chờ chuỗi rỗng (KHÔNG BIẾT)", name, got)
		}
	}
}

/* Mốc ở TƯƠNG LAI so với đồng hồ tiến trình này là bằng chứng giả thiết
 * "cùng trục monotonic" đã sai — ví dụ SHM còn sót từ lần boot trước. Nói
 * "không biết" thay vì trả một mốc bịa. */
func TestPlcSnapshotUpdatedAtRejectsATimestampFromTheFuture(t *testing.T) {
	nowMono, ok := monotonicNowNS()
	if !ok {
		t.Skip("nền tảng này không đọc được CLOCK_MONOTONIC")
	}
	if got := plcSnapshotUpdatedAt(plcBufferWithTs(nowMono+60*1_000_000_000), time.Now()); got != "" {
		t.Fatalf("mốc từ tương lai ⇒ %q; chờ chuỗi rỗng", got)
	}
}

// Mọi điểm trong CÙNG một snapshot chia sẻ đúng một mốc — `plc_shm` chỉ có
// `ts_ns` ở header, nên phát ra nhiều mốc khác nhau sẽ là bịa độ phân giải mà
// hợp đồng không có.
func TestDecodePointsShareOneSnapshotTimestamp(t *testing.T) {
	nowMono, ok := monotonicNowNS()
	if !ok {
		t.Skip("nền tảng này không đọc được CLOCK_MONOTONIC")
	}
	points := decodePoints(plcBufferWithTs(nowMono-1_000_000_000), nil)
	if len(points) == 0 {
		t.Fatal("không giải mã được điểm nào")
	}
	first := points[0].UpdatedAt
	if first == "" {
		t.Fatal("điểm đầu không có mốc dù ts_ns hợp lệ")
	}
	for _, point := range points {
		if point.UpdatedAt != first {
			t.Fatalf("điểm %s có mốc %q khác điểm đầu %q — hợp đồng chỉ có MỘT ts_ns cho cả bảng",
				point.ID, point.UpdatedAt, first)
		}
	}
}

// Và khi producer chưa đóng dấu, MỌI điểm phải nói "không biết" — không điểm
// nào được tự điền giờ đọc.
func TestDecodePointsReportUnknownTimestampWhenProducerNeverStamped(t *testing.T) {
	for _, point := range decodePoints(plcBufferWithTs(0), nil) {
		if point.UpdatedAt != "" {
			t.Fatalf("điểm %s có mốc %q dù producer chưa từng đóng dấu", point.ID, point.UpdatedAt)
		}
	}
}
