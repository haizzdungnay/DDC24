package store

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
)

var (
	ErrSchemaChecksum = errors.New("checksum migration Programming không khớp")
	ErrSchemaFuture   = errors.New("schema Programming mới hơn binary")
	ErrPartialSchema  = errors.New("schema Programming dở dang hoặc không được quản lý")
)

type MigrationFaultHook func(point string, version int) error

type MigrationOptions struct {
	AppliedAtUTCMS int64
	FaultHook      MigrationFaultHook
	Backup         func(context.Context, int, int) (BackupEvidence, error)
}

type MigrationReport struct {
	FromVersion int
	ToVersion   int
	Applied     []int
	Backup      *BackupEvidence
}

func Migrate(ctx context.Context, db *sql.DB, options MigrationOptions) (MigrationReport, error) {
	if db == nil {
		return MigrationReport{}, fmt.Errorf("database Programming là bắt buộc")
	}
	if options.AppliedAtUTCMS < 0 {
		return MigrationReport{}, fmt.Errorf("appliedAtUtcMs không hợp lệ")
	}
	if err := quickCheck(ctx, db); err != nil {
		return MigrationReport{}, err
	}
	migrations, err := embeddedMigrations()
	if err != nil {
		return MigrationReport{}, err
	}
	hasMigrationTable, err := tableExists(ctx, db, "schema_migrations")
	if err != nil {
		return MigrationReport{}, err
	}
	if !hasMigrationTable {
		count, err := managedTableCount(ctx, db)
		if err != nil {
			return MigrationReport{}, err
		}
		if count != 0 {
			return MigrationReport{}, ErrPartialSchema
		}
	}
	current := 0
	if hasMigrationTable {
		rows, err := db.QueryContext(ctx, `SELECT version, checksum FROM schema_migrations ORDER BY version`)
		if err != nil {
			return MigrationReport{}, fmt.Errorf("đọc schema_migrations: %w", err)
		}
		for rows.Next() {
			var version int
			var checksum []byte
			if err := rows.Scan(&version, &checksum); err != nil {
				rows.Close()
				return MigrationReport{}, fmt.Errorf("đọc migration record: %w", err)
			}
			if version <= 0 || version > len(migrations) {
				rows.Close()
				return MigrationReport{}, fmt.Errorf("%w: version %d", ErrSchemaFuture, version)
			}
			if version != current+1 || !bytes.Equal(checksum, migrations[version-1].Checksum[:]) {
				rows.Close()
				return MigrationReport{}, fmt.Errorf("%w: version %d", ErrSchemaChecksum, version)
			}
			current = version
		}
		if err := rows.Close(); err != nil {
			return MigrationReport{}, fmt.Errorf("đóng migration rows: %w", err)
		}
	}
	var userVersion int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&userVersion); err != nil {
		return MigrationReport{}, fmt.Errorf("đọc Programming user_version: %w", err)
	}
	if userVersion > CurrentSchemaVersion {
		return MigrationReport{}, fmt.Errorf("%w: user_version=%d", ErrSchemaFuture, userVersion)
	}
	if userVersion != current {
		return MigrationReport{}, fmt.Errorf("%w: user_version=%d migration=%d", ErrPartialSchema, userVersion, current)
	}
	report := MigrationReport{FromVersion: current, ToVersion: current}
	if current > 0 && current < len(migrations) {
		if options.Backup == nil {
			return report, fmt.Errorf("migration %d→%d thiếu backup verified", current, len(migrations))
		}
		backup, err := options.Backup(ctx, current, len(migrations))
		if err != nil {
			return report, fmt.Errorf("backup trước migration: %w", err)
		}
		if backup.QuickCheck != "ok" || backup.SHA256 == "" || backup.SchemaSHA256 == "" {
			return report, fmt.Errorf("backup trước migration thiếu evidence")
		}
		report.Backup = &backup
	}
	for _, item := range migrations[current:] {
		if options.FaultHook != nil {
			if err := options.FaultHook("before_apply", item.Version); err != nil {
				return report, err
			}
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return report, fmt.Errorf("bắt đầu migration %d: %w", item.Version, err)
		}
		if _, err := tx.ExecContext(ctx, item.SQL); err != nil {
			_ = tx.Rollback()
			return report, fmt.Errorf("áp dụng migration %d: %w", item.Version, err)
		}
		if options.FaultHook != nil {
			if err := options.FaultHook("after_sql", item.Version); err != nil {
				_ = tx.Rollback()
				return report, err
			}
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schema_migrations(version,name,checksum,applied_at_utc_ms) VALUES(?,?,?,?)`,
			item.Version, item.Name, item.Checksum[:], options.AppliedAtUTCMS); err != nil {
			_ = tx.Rollback()
			return report, fmt.Errorf("ghi migration %d: %w", item.Version, err)
		}
		if options.FaultHook != nil {
			if err := options.FaultHook("before_commit", item.Version); err != nil {
				_ = tx.Rollback()
				return report, err
			}
		}
		if err := tx.Commit(); err != nil {
			return report, fmt.Errorf("commit migration %d: %w", item.Version, err)
		}
		report.Applied = append(report.Applied, item.Version)
		report.ToVersion = item.Version
	}
	if report.ToVersion != CurrentSchemaVersion {
		return report, fmt.Errorf("%w: current=%d supported=%d", ErrSchemaFuture, report.ToVersion, CurrentSchemaVersion)
	}
	if err := quickCheck(ctx, db); err != nil {
		return report, err
	}
	return report, nil
}

func quickCheck(ctx context.Context, db *sql.DB) error {
	var result string
	if err := db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&result); err != nil {
		return fmt.Errorf("SQLite quick_check Programming: %w", err)
	}
	if result != "ok" {
		return fmt.Errorf("SQLite quick_check Programming: %s", result)
	}
	return nil
}

func tableExists(ctx context.Context, db *sql.DB, name string) (bool, error) {
	var count int
	if err := db.QueryRowContext(ctx,
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&count); err != nil {
		return false, fmt.Errorf("kiểm tra bảng %s: %w", name, err)
	}
	return count == 1, nil
}

func managedTableCount(ctx context.Context, db *sql.DB) (int, error) {
	var count int
	if err := db.QueryRowContext(ctx,
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).Scan(&count); err != nil {
		return 0, fmt.Errorf("đếm bảng Programming: %w", err)
	}
	return count, nil
}
