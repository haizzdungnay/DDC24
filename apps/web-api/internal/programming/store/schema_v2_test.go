package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

// migrateToVersion đưa DB tới đúng schema `target` bằng cách chặn migration kế
// tiếp ở `before_apply`. Không có đường "apply tới version X" trong production
// API và test cũng không được tự chế một đường như vậy.
func migrateToVersion(t *testing.T, db *sql.DB, target int) {
	t.Helper()
	if target < 1 || target >= CurrentSchemaVersion {
		t.Fatalf("target=%d phải trong 1..%d", target, CurrentSchemaVersion-1)
	}
	stop := errors.New("dừng trước migration kế tiếp")
	_, err := Migrate(context.Background(), db, MigrationOptions{
		AppliedAtUTCMS: fixedNow.UnixMilli(),
		FaultHook: func(point string, version int) error {
			if point == "before_apply" && version == target+1 {
				return stop
			}
			return nil
		},
	})
	if !errors.Is(err, stop) {
		t.Fatalf("dừng trước v%d: err=%v", target+1, err)
	}
	var userVersion int
	if err := db.QueryRow("PRAGMA user_version").Scan(&userVersion); err != nil {
		t.Fatal(err)
	}
	if userVersion != target {
		t.Fatalf("user_version=%d; want %d", userVersion, target)
	}
}

func migrateToPrevious(t *testing.T, db *sql.DB) {
	t.Helper()
	migrateToVersion(t, db, CurrentSchemaVersion-1)
}

// schemaFingerprint là toàn bộ DDL của DB, sắp ổn định. Dùng nó thay vì liệt kê
// tay từng bảng/cột/trigger mới: danh sách viết tay phải sửa theo mỗi migration
// và sẽ âm thầm trở thành no-op ngay khi ai đó quên cập nhật — đúng lớp lỗi mà
// `TestMigrationFaultChecksumPartialAndCorruptFailClosed` từng mắc phải.
func schemaFingerprint(t *testing.T, db *sql.DB) string {
	t.Helper()
	rows, err := db.Query(`SELECT type,name,coalesce(sql,'') FROM sqlite_master
		WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var kind, name, ddl string
		if err := rows.Scan(&kind, &name, &ddl); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, kind+"|"+name+"|"+strings.Join(strings.Fields(ddl), " "))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(lines, "\n")
}

func verifiedBackup() func(context.Context, int, int) (BackupEvidence, error) {
	return func(_ context.Context, from, to int) (BackupEvidence, error) {
		return BackupEvidence{
			SchemaVersion: from, DatabaseVersion: from, Path: "backup.sqlite",
			ManifestPath: "backup.json", SourceIdentity: "test",
			SHA256: strings.Repeat("a", 64), SchemaSHA256: strings.Repeat("b", 64),
			QuickCheck: "ok", ByteSize: 1, CreatedAtUTCMS: fixedNow.UnixMilli(),
		}, nil
	}
}

func tableNames(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	return names
}

func rowCount(t *testing.T, db *sql.DB, table string) int {
	t.Helper()
	var count int
	if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// Migration v(N-1)->vN phải nguyên tử ở MỌI điểm lỗi: DB giữ đúng schema cũ
// **từng byte DDL**, và chạy lại vẫn lên được head.
func TestSchemaV2MigrationIsAtomicAtEveryFaultPoint(t *testing.T) {
	for _, point := range []string{"before_apply", "after_sql", "before_commit"} {
		t.Run(point, func(t *testing.T) {
			db := openRawSQLite(t, filepath.Join(t.TempDir(), "atomic.sqlite"))
			defer db.Close()
			migrateToPrevious(t, db)
			before := schemaFingerprint(t, db)

			injected := errors.New("mô phỏng mất điện")
			_, err := Migrate(context.Background(), db, MigrationOptions{
				AppliedAtUTCMS: fixedNow.UnixMilli(),
				Backup:         verifiedBackup(),
				FaultHook: func(candidate string, version int) error {
					if candidate == point && version == CurrentSchemaVersion {
						return injected
					}
					return nil
				},
			})
			if !errors.Is(err, injected) {
				t.Fatalf("point=%s err=%v", point, err)
			}

			var userVersion int
			if err := db.QueryRow("PRAGMA user_version").Scan(&userVersion); err != nil {
				t.Fatal(err)
			}
			if userVersion != CurrentSchemaVersion-1 {
				t.Fatalf("point=%s user_version=%d; want %d", point, userVersion, CurrentSchemaVersion-1)
			}
			if after := schemaFingerprint(t, db); after != before {
				t.Fatalf("point=%s để lại DDL dở dang:\n--- trước ---\n%s\n--- sau ---\n%s", point, before, after)
			}

			// Sau lỗi, chạy lại phải lên được head — không kẹt vĩnh viễn.
			report, err := Migrate(context.Background(), db, MigrationOptions{
				AppliedAtUTCMS: fixedNow.UnixMilli(), Backup: verifiedBackup(),
			})
			if err != nil || report.ToVersion != CurrentSchemaVersion {
				t.Fatalf("recovery err=%v report=%+v", err, report)
			}
		})
	}
}

// Mọi migration trong chuỗi — không chỉ head — phải nguyên tử. Một migration cũ
// hỏng nửa chừng trên board đang chạy cũng nguy hiểm y hệt head.
func TestEveryMigrationInChainIsAtomic(t *testing.T) {
	for target := 1; target < CurrentSchemaVersion; target++ {
		t.Run(fmt.Sprintf("v%d-to-v%d", target, target+1), func(t *testing.T) {
			db := openRawSQLite(t, filepath.Join(t.TempDir(), "chain.sqlite"))
			defer db.Close()
			migrateToVersion(t, db, target)
			before := schemaFingerprint(t, db)

			injected := errors.New("mô phỏng mất điện")
			_, err := Migrate(context.Background(), db, MigrationOptions{
				AppliedAtUTCMS: fixedNow.UnixMilli(), Backup: verifiedBackup(),
				FaultHook: func(candidate string, version int) error {
					if candidate == "after_sql" && version == target+1 {
						return injected
					}
					return nil
				},
			})
			if !errors.Is(err, injected) {
				t.Fatalf("v%d err=%v", target+1, err)
			}
			var userVersion int
			if err := db.QueryRow("PRAGMA user_version").Scan(&userVersion); err != nil {
				t.Fatal(err)
			}
			if userVersion != target {
				t.Fatalf("v%d user_version=%d; want %d", target+1, userVersion, target)
			}
			if after := schemaFingerprint(t, db); after != before {
				t.Fatalf("v%d để lại DDL dở dang", target+1)
			}
		})
	}
}

// Chạy lại Migrate trên DB đã ở head là no-op, kể cả nhiều lần (idempotent qua
// restart tiến trình).
func TestSchemaV2MigrationIsIdempotentAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "idempotent.sqlite")
	db := openRawSQLite(t, path)
	report, err := Migrate(context.Background(), db, MigrationOptions{AppliedAtUTCMS: fixedNow.UnixMilli()})
	if err != nil || report.ToVersion != CurrentSchemaVersion {
		t.Fatalf("lần đầu err=%v report=%+v", err, report)
	}
	first := tableNames(t, db)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	for round := 0; round < 3; round++ {
		reopened := openRawSQLite(t, path)
		again, err := Migrate(context.Background(), reopened, MigrationOptions{AppliedAtUTCMS: fixedNow.UnixMilli()})
		if err != nil {
			t.Fatalf("vòng %d err=%v", round, err)
		}
		if len(again.Applied) != 0 {
			t.Fatalf("vòng %d áp dụng lại migration: %v", round, again.Applied)
		}
		if fmt.Sprint(tableNames(t, reopened)) != fmt.Sprint(first) {
			t.Fatalf("vòng %d schema đổi sau khi chạy lại", round)
		}
		if err := reopened.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

// Migration KHÔNG được tự Commission hay bật Program nào.
func TestSchemaV2MigrationDoesNotCommissionOrEnable(t *testing.T) {
	db := openRawSQLite(t, filepath.Join(t.TempDir(), "no-commission.sqlite"))
	defer db.Close()
	if _, err := Migrate(context.Background(), db, MigrationOptions{AppliedAtUTCMS: fixedNow.UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"operations", "commission_records", "program_runtime_intents",
		"pou_objects", "library_revisions", "library_entries", "published_signal_defs"} {
		if count := rowCount(t, db, table); count != 0 {
			t.Fatalf("%s có %d hàng sau migration; phải rỗng", table, count)
		}
	}
}

// Rollback binary: dữ liệu v1 phải nguyên vẹn và cột mới có DEFAULT tương thích,
// nên binary cũ đọc lại Revision không thấy khác biệt ngữ nghĩa.
func TestSchemaV2KeepsExistingDataAndDefaults(t *testing.T) {
	store := openTestStore(t)
	draft := createProjectFixture(t, store)
	if draft.ETag < 1 {
		t.Fatal("fixture draft không hợp lệ")
	}

	var projects, drafts int
	if err := store.db.QueryRow("SELECT count(*) FROM projects").Scan(&projects); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow("SELECT count(*) FROM drafts").Scan(&drafts); err != nil {
		t.Fatal(err)
	}
	if projects != 1 || drafts != 1 {
		t.Fatalf("dữ liệu v1 bị mất: projects=%d drafts=%d", projects, drafts)
	}

	// Cột mới trên `revisions` phải có DEFAULT giữ nguyên nghĩa cũ.
	var defaultDocumentVersion, defaultProgramCount int
	row := store.db.QueryRow(`SELECT
		(SELECT "dflt_value" FROM pragma_table_info('revisions') WHERE name='document_schema_version'),
		(SELECT "dflt_value" FROM pragma_table_info('revisions') WHERE name='program_count')`)
	if err := row.Scan(&defaultDocumentVersion, &defaultProgramCount); err != nil {
		t.Fatal(err)
	}
	if defaultDocumentVersion != 1 || defaultProgramCount != 1 {
		t.Fatalf("default cột mới = %d/%d; want 1/1", defaultDocumentVersion, defaultProgramCount)
	}
}

func TestSchemaV2TableInvariants(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	createProjectFixture(t, store)

	t.Run("signal fallback bắt buộc đúng chính sách", func(t *testing.T) {
		insert := `INSERT INTO published_signal_defs(revision_id,signal_id,name,name_folded,
			data_type,unit,producer_program_id,freshness_ms,on_invalid,fallback_json)
			VALUES('r','s','S','s','REAL',NULL,'p',5000,?,?)`
		// USE_FALLBACK mà thiếu giá trị dự phòng: phải bị chặn, không im lặng hoá 0.
		if _, err := store.db.ExecContext(ctx, insert, "USE_FALLBACK", nil); err == nil {
			t.Fatal("USE_FALLBACK thiếu fallback vẫn được ghi")
		}
		// BLOCK_PROGRAM mà lại kèm fallback: mâu thuẫn chính sách.
		if _, err := store.db.ExecContext(ctx, insert, "BLOCK_PROGRAM", []byte(`{"v":0}`)); err == nil {
			t.Fatal("BLOCK_PROGRAM kèm fallback vẫn được ghi")
		}
	})

	t.Run("freshness ngoài khoảng bị chặn", func(t *testing.T) {
		insert := `INSERT INTO published_signal_defs(revision_id,signal_id,name,name_folded,
			data_type,unit,producer_program_id,freshness_ms,on_invalid,fallback_json)
			VALUES('r','s2','S2','s2','REAL',NULL,'p',?,'HOLD_PRIVATE',NULL)`
		for _, value := range []int{999, 90001} {
			if _, err := store.db.ExecContext(ctx, insert, value); err == nil {
				t.Fatalf("freshness %d được chấp nhận", value)
			}
		}
	})

	t.Run("library scope ràng buộc project_id", func(t *testing.T) {
		insert := `INSERT INTO library_revisions(library_revision_id,project_id,scope,version,
			state,manifest_json,manifest_sha256,created_by,created_at_utc_ms)
			VALUES(?,?,?,'1.0','DRAFT',x'7B7D',zeroblob(32),'tester',0)`
		if _, err := store.db.ExecContext(ctx, insert, "l1", projectID, "SYSTEM"); err == nil {
			t.Fatal("SYSTEM library gắn project_id vẫn được ghi")
		}
		if _, err := store.db.ExecContext(ctx, insert, "l2", nil, "PROJECT"); err == nil {
			t.Fatal("PROJECT library thiếu project_id vẫn được ghi")
		}
	})

	t.Run("intent generation chỉ tăng và mặc định Disabled", func(t *testing.T) {
		if _, err := store.db.ExecContext(ctx,
			`INSERT INTO program_runtime_intents(project_id,program_id,updated_by,updated_at_utc_ms)
			 VALUES(?,'prog-1','tester',0)`, projectID); err != nil {
			t.Fatal(err)
		}
		var desired, generation int
		if err := store.db.QueryRowContext(ctx,
			`SELECT desired_enabled, generation FROM program_runtime_intents WHERE program_id='prog-1'`).
			Scan(&desired, &generation); err != nil {
			t.Fatal(err)
		}
		// DDD §0: Program mới sau Commission mặc định Disabled.
		if desired != 0 || generation != 1 {
			t.Fatalf("mặc định intent = %d/%d; want 0/1", desired, generation)
		}
		if _, err := store.db.ExecContext(ctx,
			`UPDATE program_runtime_intents SET desired_enabled=1, generation=1 WHERE program_id='prog-1'`); err == nil {
			t.Fatal("generation không tăng vẫn được ghi")
		}
		if _, err := store.db.ExecContext(ctx,
			`UPDATE program_runtime_intents SET desired_enabled=1, generation=2 WHERE program_id='prog-1'`); err != nil {
			t.Fatalf("generation tăng hợp lệ bị chặn: %v", err)
		}
	})

	t.Run("program_count bị chặn ngoài 1..32", func(t *testing.T) {
		// Phải INSERT thật: `UPDATE` trên bảng rỗng trả về nil và biến test thành
		// no-op — đúng loại test tự đánh lừa mà gate không bắt được.
		insert := `INSERT INTO revisions(revision_id,project_id,parent_revision_id,sequence,
			schema_version,target_profile,manifest_json,manifest_sha256,created_by,
			created_at_utc_ms,document_schema_version,program_count)
			VALUES(?,?,NULL,?,1,'MKDDC24_REVA',x'7B7D',zeroblob(32),'tester',0,?,?)`
		if _, err := store.db.ExecContext(ctx, insert, "rev-ok", projectID, 1, 2, 32); err != nil {
			t.Fatalf("program_count=32 hợp lệ bị chặn: %v", err)
		}
		if _, err := store.db.ExecContext(ctx, insert, "rev-over", projectID, 2, 2, 33); err == nil {
			t.Fatal("program_count=33 được chấp nhận")
		}
		if _, err := store.db.ExecContext(ctx, insert, "rev-zero", projectID, 3, 2, 0); err == nil {
			t.Fatal("program_count=0 được chấp nhận")
		}
		if _, err := store.db.ExecContext(ctx, insert, "rev-doc3", projectID, 4, 3, 1); err == nil {
			t.Fatal("document_schema_version=3 được chấp nhận")
		}
	})
}
