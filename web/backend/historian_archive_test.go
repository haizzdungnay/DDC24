package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestHistorianArchiveCodecDeterministicRoundTrip(t *testing.T) {
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	block := ArchiveBlock{PointID: "UI-01", Generation: 1, StartUTCMS: start, Rows: []ArchiveRow{
		{BucketUTCMS: start + 15_000, Value: 12, Min: 12, Max: 12, Sum: 12, Count: 1, Quality: 1, Source: "physical"},
		{BucketUTCMS: start, Value: 10, Min: 9, Max: 11, Sum: 30, Count: 3, Quality: 0, Source: "mixed"},
	}}
	encoded, digest, err := EncodeArchiveBlock(block)
	if err != nil {
		t.Fatal(err)
	}
	reversed := block
	reversed.Rows = []ArchiveRow{block.Rows[1], block.Rows[0]}
	encodedAgain, digestAgain, err := EncodeArchiveBlock(reversed)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(encoded, encodedAgain) || digest != digestAgain {
		t.Fatal("encoding is not deterministic")
	}
	if got := hex.EncodeToString(digest[:]); got != "94a67f422e00c27f91ef4c766ee94e15b5aa9e216cb6ca83f7becb43ef1ccca0" {
		t.Fatalf("golden SHA-256=%s", got)
	}
	if string(encoded[:8]) != "MKHABLK\x00" || binary.LittleEndian.Uint16(encoded[8:]) != 1 || binary.LittleEndian.Uint32(encoded[32:]) != 15_000 {
		t.Fatalf("invalid fixed header: %x", encoded[:archiveHeaderSize])
	}
	decoded, err := DecodeArchiveBlock(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.PointID != block.PointID || decoded.Generation != 1 || len(decoded.Rows) != 2 || decoded.Rows[0].BucketUTCMS != start || decoded.Rows[1].Source != "physical" {
		t.Fatalf("decoded=%+v", decoded)
	}
}

func TestHistorianArchiveCodecRejectsNonCanonicalPayload(t *testing.T) {
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	valid, _, err := EncodeArchiveBlock(ArchiveBlock{PointID: "UI-01", Generation: 1, StartUTCMS: start, Rows: []ArchiveRow{{BucketUTCMS: start, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "io"}}})
	if err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func([]byte){
		"flags": func(data []byte) { binary.LittleEndian.PutUint32(data[12:], 1) },
		"negative zero": func(data []byte) {
			pointLen := int(binary.LittleEndian.Uint16(data[36:]))
			sourceLen := int(data[archiveHeaderSize+pointLen])
			rowOffset := archiveHeaderSize + pointLen + 1 + sourceLen
			binary.LittleEndian.PutUint64(data[rowOffset+4:], math.Float64bits(math.Copysign(0, -1)))
			binary.LittleEndian.PutUint64(data[rowOffset+12:], math.Float64bits(math.Copysign(0, -1)))
		},
		"invalid point UTF-8": func(data []byte) { data[archiveHeaderSize] = 0xff },
		"invalid source UTF-8": func(data []byte) {
			pointLen := int(binary.LittleEndian.Uint16(data[36:]))
			data[archiveHeaderSize+pointLen+1] = 0xff
		},
	} {
		t.Run(name, func(t *testing.T) {
			data := append([]byte(nil), valid...)
			mutate(data)
			rechecksumArchiveTestData(data)
			if _, err := DecodeArchiveBlock(data); err == nil {
				t.Fatal("expected canonical decode rejection")
			}
		})
	}
	if _, _, err := EncodeArchiveBlock(ArchiveBlock{PointID: string([]byte{0xff}), Generation: 1, StartUTCMS: start}); err == nil {
		t.Fatal("expected invalid point UTF-8 rejection")
	}
	if _, _, err := EncodeArchiveBlock(ArchiveBlock{PointID: "UI-01", Generation: 1, StartUTCMS: start, Rows: []ArchiveRow{{BucketUTCMS: start, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: string([]byte{0xff})}}}); err == nil {
		t.Fatal("expected invalid source UTF-8 rejection")
	}
}

func TestHistorianArchiveCodecBounds(t *testing.T) {
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	rows := make([]ArchiveRow, archiveMaxRows)
	for i := range rows {
		rows[i] = ArchiveRow{BucketUTCMS: start + int64(i)*archiveBucketMS, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "io"}
	}
	encoded, _, err := EncodeArchiveBlock(ArchiveBlock{PointID: strings.Repeat("p", 64), Generation: 1, StartUTCMS: start, Rows: rows})
	if err != nil {
		t.Fatalf("maximum block: %v", err)
	}
	if len(encoded) > archiveMaxBytes {
		t.Fatalf("maximum block bytes=%d", len(encoded))
	}
	if _, err := DecodeArchiveBlock(encoded); err != nil {
		t.Fatalf("decode maximum block: %v", err)
	}
	if _, _, err := EncodeArchiveBlock(ArchiveBlock{PointID: "UI-01", Generation: 1, StartUTCMS: start, Rows: append(rows, rows[0])}); err == nil {
		t.Fatal("expected row limit rejection")
	}
	for _, data := range [][]byte{encoded[:len(encoded)-1], append(append([]byte(nil), encoded...), 0)} {
		if _, err := DecodeArchiveBlock(data); err == nil {
			t.Fatal("expected truncation/trailing rejection")
		}
	}
}

func TestHistorianArchiveCodecValidatesRowsAndNormalizesZero(t *testing.T) {
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	base := ArchiveRow{BucketUTCMS: start, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "io"}
	for name, rows := range map[string][]ArchiveRow{
		"duplicate slot": {base, base},
		"zero count":     {func() ArchiveRow { row := base; row.Count = 0; return row }()},
		"bad quality":    {func() ArchiveRow { row := base; row.Quality = 3; return row }()},
		"NaN":            {func() ArchiveRow { row := base; row.Value = math.NaN(); return row }()},
		"infinity":       {func() ArchiveRow { row := base; row.Sum = math.Inf(1); return row }()},
		"invalid range":  {func() ArchiveRow { row := base; row.Min = 2; return row }()},
		"outside day":    {func() ArchiveRow { row := base; row.BucketUTCMS += archiveDayMS; return row }()},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := EncodeArchiveBlock(ArchiveBlock{PointID: "UI-01", Generation: 1, StartUTCMS: start, Rows: rows}); err == nil {
				t.Fatal("expected invalid row rejection")
			}
		})
	}
	positive := ArchiveBlock{PointID: "UI-01", Generation: 1, StartUTCMS: start, Rows: []ArchiveRow{{BucketUTCMS: start, Source: "io", Count: 1}}}
	negative := positive
	negative.Rows = []ArchiveRow{{BucketUTCMS: start, Value: math.Copysign(0, -1), Min: math.Copysign(0, -1), Max: math.Copysign(0, -1), Sum: math.Copysign(0, -1), Source: "io", Count: 1}}
	positiveBytes, _, err := EncodeArchiveBlock(positive)
	if err != nil {
		t.Fatal(err)
	}
	negativeBytes, _, err := EncodeArchiveBlock(negative)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(positiveBytes, negativeBytes) {
		t.Fatal("negative zero was not normalized")
	}
}

func TestHistorianArchiveCodecAllows255Sources(t *testing.T) {
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	rows := make([]ArchiveRow, 255)
	for i := range rows {
		rows[i] = ArchiveRow{BucketUTCMS: start + int64(i)*archiveBucketMS, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: string(rune(i + 1))}
	}
	data, _, err := EncodeArchiveBlock(ArchiveBlock{PointID: "UI-01", Generation: 1, StartUTCMS: start, Rows: rows})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeArchiveBlock(data); err != nil {
		t.Fatal(err)
	}
}

func rechecksumArchiveTestData(data []byte) {
	digest := sha256.Sum256(data[:len(data)-archiveTrailerSize])
	copy(data[len(data)-archiveTrailerSize:], digest[:])
}

func TestHistorianArchiveCommitAdvancesOnlyContiguousWatermark(t *testing.T) {
	store := openHistorianStoreTest(t)
	archiveDir := t.TempDir()
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	later := coveredArchiveBlock("UI-01", 1, start+archiveDayMS, 2)
	if _, err := store.CommitArchiveBlock(context.Background(), archiveDir, later, start); err != nil {
		t.Fatal(err)
	}
	if watermark := historianWatermark(t, store, "UI-01", 1); watermark != start {
		t.Fatalf("watermark=%d, crossed hole", watermark)
	}
	first := coveredArchiveBlock("UI-01", 1, start, 1)
	if _, err := store.CommitArchiveBlock(context.Background(), archiveDir, first, start); err != nil {
		t.Fatal(err)
	}
	if watermark := historianWatermark(t, store, "UI-01", 1); watermark != start+2*archiveDayMS {
		t.Fatalf("watermark=%d, want contiguous two days", watermark)
	}
}

func TestHistorianArchiveCommitRejectsCoverageHole(t *testing.T) {
	store := openHistorianStoreTest(t)
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	block := coveredArchiveBlock("UI-01", 1, start, 1)
	block.Gaps[0].FromUTCMS += archiveBucketMS
	if _, err := store.CommitArchiveBlock(context.Background(), t.TempDir(), block, start); err == nil {
		t.Fatal("expected coverage hole rejection")
	}
	var count int
	if err := store.db.QueryRow(`SELECT count(*) FROM archive_blocks`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("count=%d err=%v", count, err)
	}
}

func TestHistorianArchiveCommitLifecycleStopsAtVerified(t *testing.T) {
	store := openHistorianStoreTest(t)
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	store.archiveFault = func(stage string) error {
		if stage == archiveFaultAfterVerifiedState {
			return errors.New("power cut")
		}
		return nil
	}
	if _, err := store.CommitArchiveBlock(context.Background(), t.TempDir(), coveredArchiveBlock("UI-01", 1, start, 1), start); err == nil {
		t.Fatal("expected injected failure")
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM archive_blocks`).Scan(&state); err != nil || state != "verified" {
		t.Fatalf("state=%q err=%v", state, err)
	}
	var watermarks int
	if err := store.db.QueryRow(`SELECT count(*) FROM archive_watermarks`).Scan(&watermarks); err != nil || watermarks != 0 {
		t.Fatalf("watermarks=%d err=%v", watermarks, err)
	}
}

func TestHistorianArchiveCommitKeepsGenerationWatermarksSeparate(t *testing.T) {
	store := openHistorianStoreTest(t)
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	for generation := uint64(1); generation <= 2; generation++ {
		if _, err := store.CommitArchiveBlock(context.Background(), t.TempDir(), coveredArchiveBlock("VP1", generation, start, float64(generation)), start); err != nil {
			t.Fatal(err)
		}
	}
	for generation := uint64(1); generation <= 2; generation++ {
		if got := historianWatermark(t, store, "VP1", generation); got != start+archiveDayMS {
			t.Fatalf("generation=%d watermark=%d", generation, got)
		}
	}
}

func TestHistorianArchiveCommitExactRetryIsIdempotent(t *testing.T) {
	store := openHistorianStoreTest(t)
	dir := t.TempDir()
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	block := coveredArchiveBlock("UI-01", 1, start, 1)
	first, err := store.CommitArchiveBlock(context.Background(), dir, block, start)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.CommitArchiveBlock(context.Background(), dir, block, start)
	if err != nil {
		t.Fatal(err)
	}
	if first != second || historianWatermark(t, store, "UI-01", 1) != start+archiveDayMS {
		t.Fatalf("first=%q second=%q", first, second)
	}
}

func TestHistorianArchiveCommitRollbackLeavesVerifiedWithoutWatermark(t *testing.T) {
	store := openHistorianStoreTest(t)
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	store.archiveFault = func(stage string) error {
		if stage == archiveFaultBeforeCommit {
			return errors.New("power cut")
		}
		return nil
	}
	if _, err := store.CommitArchiveBlock(context.Background(), t.TempDir(), coveredArchiveBlock("UI-01", 1, start, 1), start); err == nil {
		t.Fatal("expected injected failure")
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM archive_blocks`).Scan(&state); err != nil || state != "verified" {
		t.Fatalf("state=%q err=%v", state, err)
	}
	var count int
	if err := store.db.QueryRow(`SELECT count(*) FROM archive_watermarks`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("watermarks=%d err=%v", count, err)
	}
}

func TestHistorianArchiveCommitExplicitEmptyDay(t *testing.T) {
	store := openHistorianStoreTest(t)
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	block := ArchiveBlock{PointID: "UI-01", Generation: 1, StartUTCMS: start, StableCutoffUTCMS: start + archiveDayMS, Gaps: []ArchiveGap{{FromUTCMS: start, ToUTCMS: start + archiveDayMS, Reason: "snapshot", Detail: "verified empty"}}}
	if _, err := store.CommitArchiveBlock(context.Background(), t.TempDir(), block, start); err != nil {
		t.Fatal(err)
	}
	if got := historianWatermark(t, store, "UI-01", 1); got != start+archiveDayMS {
		t.Fatalf("watermark=%d", got)
	}
}

func TestHistorianArchiveCommitRetryAfterLinkCrash(t *testing.T) {
	store := openHistorianStoreTest(t)
	dir := t.TempDir()
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	block := coveredArchiveBlock("UI-01", 1, start, 1)
	store.archiveFault = func(stage string) error {
		if stage == archiveFaultAfterLink {
			return errors.New("power cut")
		}
		return nil
	}
	if _, err := store.CommitArchiveBlock(context.Background(), dir, block, start); err == nil {
		t.Fatal("expected injected failure")
	}
	var state, name string
	if err := store.db.QueryRow(`SELECT state,file_name FROM archive_blocks`).Scan(&state, &name); err != nil || state != "building" {
		t.Fatalf("state=%q name=%q err=%v", state, name, err)
	}
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeArchiveBlock(data); err != nil {
		t.Fatal(err)
	}
	store.archiveFault = nil
	if _, err := store.CommitArchiveBlock(context.Background(), dir, block, start); err != nil {
		t.Fatal(err)
	}
}

func TestHistorianArchiveCommitRetryAfterCommitCrash(t *testing.T) {
	store := openHistorianStoreTest(t)
	dir := t.TempDir()
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	block := coveredArchiveBlock("UI-01", 1, start, 1)
	store.archiveFault = func(stage string) error {
		if stage == archiveFaultAfterCommit {
			return errors.New("lost acknowledgement")
		}
		return nil
	}
	if _, err := store.CommitArchiveBlock(context.Background(), dir, block, start); err == nil {
		t.Fatal("expected injected failure")
	}
	if got := historianWatermark(t, store, "UI-01", 1); got != start+archiveDayMS {
		t.Fatalf("watermark=%d", got)
	}
	store.archiveFault = nil
	if _, err := store.CommitArchiveBlock(context.Background(), dir, block, start); err != nil {
		t.Fatal(err)
	}
}

func coveredArchiveBlock(pointID string, generation uint64, start int64, value float64) ArchiveBlock {
	return ArchiveBlock{
		PointID: pointID, Generation: generation, StartUTCMS: start, StableCutoffUTCMS: start + archiveDayMS,
		Rows: []ArchiveRow{{BucketUTCMS: start, Value: value, Min: value, Max: value, Sum: value, Count: 1, Source: "io"}},
		Gaps: []ArchiveGap{{FromUTCMS: start + archiveBucketMS, ToUTCMS: start + archiveDayMS, Reason: "snapshot", Detail: "verified empty"}},
	}
}

func TestHistorianPruneRequiresAgeAndWatermark(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	cutoff := time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli()
	old := cutoff - 48*60*60*1000 - 15_000
	boundary := cutoff - 48*60*60*1000
	for _, bucket := range []int64{old, boundary} {
		sample := HotSample{PointID: "UI-01", Generation: 1, BucketUTCMS: bucket, LastSampleUTCMS: bucket, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "io", PolicyRevision: 1}
		if err := store.InsertHotBatch(context.Background(), []HotSample{sample}); err != nil {
			t.Fatal(err)
		}
	}
	if deleted, err := store.PruneHot(context.Background(), cutoff); err != nil || deleted != 0 {
		t.Fatalf("without watermark deleted=%d err=%v", deleted, err)
	}
	_, err := store.db.Exec(`INSERT INTO archive_blocks(block_id,point_id,generation,from_utc_ms,to_utc_ms,codec,file_name,byte_size,sample_count,gap_count,payload_sha256,state,created_at_utc_ms,committed_at_utc_ms) VALUES('b','UI-01',1,?,?, 'mkhab-v1','b.mkhab',0,0,0,?, 'committed',1,1)`, old-15_000, boundary, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.Exec(`INSERT INTO archive_watermarks(point_id,generation,origin_utc_ms,covered_until_utc_ms,block_id,updated_at_utc_ms) VALUES('UI-01',1,?,?, 'b',1)`, old-15_000, boundary)
	if err != nil {
		t.Fatal(err)
	}
	if deleted, err := store.PruneHot(context.Background(), cutoff); err != nil || deleted != 1 {
		t.Fatalf("deleted=%d err=%v", deleted, err)
	}
	var remaining int
	_ = store.db.QueryRow(`SELECT count(*) FROM hot_samples`).Scan(&remaining)
	if remaining != 1 {
		t.Fatalf("remaining=%d", remaining)
	}
}

func TestHistorianPruneRequiresMatchingCommittedBlock(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	now := time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli()
	bucket := now - 48*60*60*1000 - archiveBucketMS
	sample := HotSample{PointID: "UI-01", Generation: 1, BucketUTCMS: bucket, LastSampleUTCMS: bucket, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "io", PolicyRevision: 1}
	if err := store.InsertHotBatch(context.Background(), []HotSample{sample}); err != nil {
		t.Fatal(err)
	}
	from := bucket - archiveBucketMS
	if _, err := store.db.Exec(`INSERT INTO archive_blocks(block_id,point_id,generation,from_utc_ms,to_utc_ms,codec,file_name,byte_size,sample_count,gap_count,payload_sha256,state,created_at_utc_ms,verified_at_utc_ms) VALUES('verified','AO-01',1,?,?, 'mkhab-v1','verified.mkhab',0,0,0,?, 'verified',1,1)`, from, bucket+archiveBucketMS, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`INSERT INTO archive_watermarks(point_id,generation,origin_utc_ms,covered_until_utc_ms,block_id,updated_at_utc_ms) VALUES('UI-01',1,?,?, 'verified',1)`, from, bucket+archiveBucketMS); err != nil {
		t.Fatal(err)
	}
	if deleted, err := store.PruneHot(context.Background(), now); err != nil || deleted != 0 {
		t.Fatalf("deleted=%d err=%v", deleted, err)
	}
}

func TestHistorianRetentionPruneIsDeferredWithoutCutoverAuthority(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	bucket := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	sample := HotSample{PointID: "UI-01", Generation: 1, BucketUTCMS: bucket, LastSampleUTCMS: bucket, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "io", PolicyRevision: 1}
	if err := store.InsertHotBatch(context.Background(), []HotSample{sample}); err != nil {
		t.Fatal(err)
	}
	result, err := store.PruneRetention(context.Background(), HistorianRetentionPruneRequest{ArchiveDir: t.TempDir(), MaxBlocks: 8, MaxRows: 32})
	if result != (HistorianRetentionPruneResult{}) || !errors.Is(err, ErrHistorianRetentionDeferred) {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	var remaining int
	if err := store.db.QueryRow(`SELECT count(*) FROM hot_samples`).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("remaining=%d err=%v", remaining, err)
	}
}

func TestHistorianRetentionPruneExpiresAllTiersAndRebasesFrontier(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	archiveDir := t.TempDir()
	stableUTCMS := time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli()
	cutoff := stableUTCMS - 180*archiveDayMS
	start := cutoff - 2*archiveDayMS
	paths := make([]string, 0, 3)
	for day := 0; day < 3; day++ {
		path, err := store.CommitArchiveBlock(context.Background(), archiveDir, coveredArchiveBlock("UI-01", 1, start+int64(day)*archiveDayMS, float64(day+1)), start)
		if err != nil {
			t.Fatal(err)
		}
		paths = append(paths, path)
	}
	otherGeneration, err := store.CommitArchiveBlock(context.Background(), archiveDir, coveredArchiveBlock("UI-01", 2, start, 9), start)
	if err != nil {
		t.Fatal(err)
	}
	for _, bucket := range []int64{cutoff - archiveBucketMS, cutoff} {
		sample := HotSample{PointID: "UI-01", Generation: 1, BucketUTCMS: bucket, LastSampleUTCMS: bucket, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "io", PolicyRevision: 1}
		if err := store.InsertHotBatch(context.Background(), []HotSample{sample}); err != nil {
			t.Fatal(err)
		}
	}
	for _, gap := range []HistoryGap{
		{PointID: "UI-01", Generation: 1, FromUTCMS: cutoff - 2*archiveBucketMS, ToUTCMS: cutoff, Reason: "storage", CreatedAtUTCMS: stableUTCMS},
		{PointID: "UI-01", Generation: 1, FromUTCMS: cutoff - archiveBucketMS, ToUTCMS: cutoff + archiveBucketMS, Reason: "storage", CreatedAtUTCMS: stableUTCMS},
	} {
		if err := store.InsertGap(context.Background(), gap); err != nil {
			t.Fatal(err)
		}
	}
	reconcileHistorianActivationTest(t, store, stableUTCMS)
	result, err := store.PruneRetention(context.Background(), HistorianRetentionPruneRequest{ArchiveDir: archiveDir, MaxBlocks: 8, MaxRows: 32})
	if err != nil {
		t.Fatal(err)
	}
	if result.ArchiveBlocks != 2 || result.HotSamples != 1 || result.Gaps != 1 {
		t.Fatalf("result=%+v", result)
	}
	for index, path := range paths {
		_, statErr := os.Stat(path)
		if index < 2 && !errors.Is(statErr, os.ErrNotExist) {
			t.Fatalf("expired path %d still present: %v", index, statErr)
		}
		if index == 2 && statErr != nil {
			t.Fatalf("boundary path removed: %v", statErr)
		}
	}
	if _, err := os.Stat(otherGeneration); err != nil {
		t.Fatalf("generation without retention lease changed: %v", err)
	}
	var origin, covered int64
	if err := store.db.QueryRow(`SELECT origin_utc_ms,covered_until_utc_ms FROM archive_watermarks WHERE point_id='UI-01' AND generation=1`).Scan(&origin, &covered); err != nil {
		t.Fatal(err)
	}
	if origin != cutoff || covered != cutoff+archiveDayMS {
		t.Fatalf("origin=%d covered=%d cutoff=%d", origin, covered, cutoff)
	}
	var hotRows, gaps int
	if err := store.db.QueryRow(`SELECT count(*) FROM hot_samples WHERE point_id='UI-01' AND generation=1`).Scan(&hotRows); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT count(*) FROM history_gaps WHERE point_id='UI-01' AND generation=1`).Scan(&gaps); err != nil {
		t.Fatal(err)
	}
	if hotRows != 1 || gaps != 1 {
		t.Fatalf("hot=%d gaps=%d", hotRows, gaps)
	}
}

func TestHistorianRetentionPruneIsBoundedAndRetryableAfterMetadataCommit(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	archiveDir := t.TempDir()
	stableUTCMS := time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli()
	cutoff := stableUTCMS - 180*archiveDayMS
	start := cutoff - 3*archiveDayMS
	for day := 0; day < 4; day++ {
		if _, err := store.CommitArchiveBlock(context.Background(), archiveDir, coveredArchiveBlock("UI-01", 1, start+int64(day)*archiveDayMS, float64(day+1)), start); err != nil {
			t.Fatal(err)
		}
	}
	reconcileHistorianActivationTest(t, store, stableUTCMS)
	store.retentionFault = func(stage string) error {
		if stage == retentionFaultAfterMetadataCommit {
			return errors.New("power cut")
		}
		return nil
	}
	result, err := store.PruneRetention(context.Background(), HistorianRetentionPruneRequest{ArchiveDir: archiveDir, MaxBlocks: 1, MaxRows: 8})
	if result.ArchiveBlocks != 1 || err == nil {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	store.retentionFault = nil
	result, err = store.PruneRetention(context.Background(), HistorianRetentionPruneRequest{ArchiveDir: archiveDir, MaxBlocks: 3, MaxRows: 8})
	if err != nil || result.ArchiveFiles != 3 || result.ArchiveBlocks != 2 {
		t.Fatalf("retry result=%+v err=%v", result, err)
	}
	var committed, queued int
	if err := store.db.QueryRow(`SELECT count(*) FROM archive_blocks WHERE point_id='UI-01' AND generation=1 AND state='committed'`).Scan(&committed); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT count(*) FROM retention_prune_queue`).Scan(&queued); err != nil {
		t.Fatal(err)
	}
	if committed != 1 || queued != 0 {
		t.Fatalf("committed=%d queued=%d", committed, queued)
	}
}

func TestHistorianRetentionActivationRejectsBackwardStableUTC(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	stableUTCMS := time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli()
	reconcileHistorianActivationTest(t, store, stableUTCMS)
	proof := historianActivationProofTest(t, store, stableUTCMS-archiveBucketMS)
	if err := store.RecordReconciledHistorianActivation(context.Background(), proof); err == nil {
		t.Fatal("expected backward stable UTC rejection")
	}
}

func TestHistorianRetentionPruneFailsClosedOnCorruptArchive(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	archiveDir := t.TempDir()
	stableUTCMS := time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli()
	start := stableUTCMS - 181*archiveDayMS
	path, err := store.CommitArchiveBlock(context.Background(), archiveDir, coveredArchiveBlock("UI-01", 1, start, 1), start)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("corrupt"), 0o600); err != nil {
		t.Fatal(err)
	}
	reconcileHistorianActivationTest(t, store, stableUTCMS)
	result, err := store.PruneRetention(context.Background(), HistorianRetentionPruneRequest{ArchiveDir: archiveDir, MaxBlocks: 8, MaxRows: 8})
	if err == nil || result != (HistorianRetentionPruneResult{}) {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if _, statErr := os.Stat(path); statErr != nil {
		t.Fatalf("corrupt evidence removed: %v", statErr)
	}
	var blocks int
	if err := store.db.QueryRow(`SELECT count(*) FROM archive_blocks WHERE state='committed'`).Scan(&blocks); err != nil || blocks != 1 {
		t.Fatalf("committed blocks=%d err=%v", blocks, err)
	}
}

func TestHistorianRetentionPruneHonorsCancellationBeforeMutation(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	stableUTCMS := time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli()
	reconcileHistorianActivationTest(t, store, stableUTCMS)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err := store.PruneRetention(ctx, HistorianRetentionPruneRequest{ArchiveDir: t.TempDir(), MaxBlocks: 1, MaxRows: 1})
	if err == nil || result != (HistorianRetentionPruneResult{}) {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func reconcileHistorianActivationTest(t *testing.T, store *HistorianStore, stableUTCMS int64) {
	t.Helper()
	if err := store.RecordReconciledHistorianActivation(context.Background(), historianActivationProofTest(t, store, stableUTCMS)); err != nil {
		t.Fatal(err)
	}
}

func historianActivationProofTest(t *testing.T, store *HistorianStore, stableUTCMS int64) HistorianActivationProof {
	t.Helper()
	var revision uint64
	var digest []byte
	if err := store.db.QueryRow(`SELECT revision,config_sha256 FROM policy_revisions WHERE mirror_status='verified' ORDER BY revision DESC LIMIT 1`).Scan(&revision, &digest); err != nil {
		t.Fatal(err)
	}
	return HistorianActivationProof{
		PolicyRevision: revision, ConfigSHA256: digest, StableUTCMS: stableUTCMS,
		WriterAuthority: "v2", LegacyQuiesced: true, MigrationVerified: true,
		PruneEnabled: true, ReconciledAtUTCMS: stableUTCMS,
	}
}

func historianWatermark(t *testing.T, store *HistorianStore, pointID string, generation uint64) int64 {
	t.Helper()
	var watermark int64
	if err := store.db.QueryRow(`SELECT covered_until_utc_ms FROM archive_watermarks WHERE point_id=? AND generation=?`, pointID, generation).Scan(&watermark); err != nil {
		t.Fatal(err)
	}
	return watermark
}

func TestHistorianArchivePublishDoesNotOverwrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fixed.mkhab")
	if err := os.WriteFile(path, []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := publishArchiveFile(dir, path, []byte("different")); err == nil {
		t.Fatal("expected existing mismatch")
	}
	data, _ := os.ReadFile(path)
	if string(data) != "existing" {
		t.Fatalf("destination overwritten: %q", data)
	}
}

func TestHistorianArchivePublishExistingExactFileIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fixed.mkhab")
	data := []byte("same")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := publishArchiveFile(dir, path, data); err != nil {
		t.Fatal(err)
	}
}

func TestHistorianArchivePublishRejectsSymlinkDestination(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs Windows developer mode or elevation")
	}
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	path := filepath.Join(dir, "fixed.mkhab")
	if err := os.WriteFile(target, []byte("same"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
	if err := publishArchiveFile(dir, path, []byte("same")); err == nil {
		t.Fatal("expected symlink rejection")
	}
}

func TestHistorianArchiveCodecRejectsCorruption(t *testing.T) {
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	encoded, _, err := EncodeArchiveBlock(ArchiveBlock{PointID: "DO-01", Generation: 1, StartUTCMS: start, Rows: []ArchiveRow{{BucketUTCMS: start, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "io"}}})
	if err != nil {
		t.Fatal(err)
	}
	encoded[len(encoded)/2] ^= 0x01
	if _, err := DecodeArchiveBlock(encoded); err == nil {
		t.Fatal("expected checksum failure")
	}
}
