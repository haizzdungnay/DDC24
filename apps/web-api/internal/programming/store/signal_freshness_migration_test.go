package store

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

// ADR-061 mục 4.5 — migration `0016` nới CHECK `freshness_ms` thành 10..150000.
//
// Ba điều phải đúng cùng lúc: hàng cũ (dải 1000..90000) còn nguyên sau rebuild;
// dải mới nhận đúng hai đầu và chặn đúng hai ngoài; và hai trigger bất biến
// được dựng lại — bỏ sót chúng là biến bảng append-only thành bảng sửa được.
func TestSignalFreshnessMigrationWidensRangeAndKeepsImmutability(t *testing.T) {
	ctx := context.Background()
	db := openRawSQLite(t, filepath.Join(t.TempDir(), "freshness.sqlite"))
	defer db.Close()
	migrateToVersion(t, db, 15)
	// Bảng con có FK sang `revisions`; test chỉ kiểm CHECK/trigger nên tắt FK
	// trên kết nối thô này thay vì dựng cả chuỗi Project/Revision.
	if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
		t.Fatal(err)
	}
	insert := func(signalID string, freshness int) error {
		_, err := db.ExecContext(ctx, `INSERT INTO published_signal_defs(revision_id,signal_id,name,name_folded,
			data_type,unit,producer_program_id,freshness_ms,on_invalid,fallback_json)
			VALUES('rev-legacy',?,?,?,'REAL',NULL,'program-a',?,'HOLD_PRIVATE',NULL)`,
			signalID, "S_"+signalID, "S_"+strings.ToUpper(signalID), freshness)
		return err
	}
	if err := insert("legacy", 5000); err != nil {
		t.Fatalf("hàng v15 hợp lệ: %v", err)
	}
	if err := insert("too-fast-v15", 10); err == nil {
		t.Fatal("v15 phải còn chặn 10 ms — nếu không, test không đo được migration")
	}

	report, err := Migrate(ctx, db, MigrationOptions{AppliedAtUTCMS: fixedNow.UnixMilli(), Backup: verifiedBackup()})
	if err != nil || report.ToVersion != 16 {
		t.Fatalf("migrate v15 -> v16: report=%+v err=%v", report, err)
	}
	var freshness int
	if err := db.QueryRowContext(ctx, `SELECT freshness_ms FROM published_signal_defs WHERE signal_id='legacy'`).
		Scan(&freshness); err != nil || freshness != 5000 {
		t.Fatalf("hàng cũ mất sau rebuild: freshness=%d err=%v", freshness, err)
	}
	for _, accepted := range []int{10, 150000} {
		if err := insert(fmt.Sprintf("ok-%d", accepted), accepted); err != nil {
			t.Fatalf("freshness %d ms hợp lệ bị chặn: %v", accepted, err)
		}
	}
	for _, rejected := range []int{9, 150001} {
		if err := insert(fmt.Sprintf("bad-%d", rejected), rejected); err == nil {
			t.Fatalf("freshness %d ms lọt qua CHECK", rejected)
		}
	}
	if _, err := db.ExecContext(ctx, `UPDATE published_signal_defs SET freshness_ms=20 WHERE signal_id='legacy'`); err == nil ||
		!strings.Contains(err.Error(), "immutable published_signal_defs") {
		t.Fatalf("trigger no_update mất sau rebuild: %v", err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM published_signal_defs WHERE signal_id='legacy'`); err == nil ||
		!strings.Contains(err.Error(), "immutable published_signal_defs") {
		t.Fatalf("trigger no_delete mất sau rebuild: %v", err)
	}
	var indexes int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='index'
		AND name IN ('published_signal_defs_name_idx','published_signal_defs_producer_idx')`).Scan(&indexes); err != nil || indexes != 2 {
		t.Fatalf("index của published_signal_defs mất sau rebuild: %d err=%v", indexes, err)
	}
}
