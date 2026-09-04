package store

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type Options struct {
	Path                  string
	BackupDir             string
	Now                   func() time.Time
	SystemLibraryProvider SystemLibraryProvider
}

type Store struct {
	db        *sql.DB
	path      string
	backupDir string
	now       func() time.Time
	system    *SystemLibrarySnapshot
}

func OpenProgrammingStore(ctx context.Context, options Options) (*Store, error) {
	if options.Path == "" {
		return nil, fmt.Errorf("đường dẫn Programming DB là bắt buộc")
	}
	absPath, err := filepath.Abs(options.Path)
	if err != nil {
		return nil, fmt.Errorf("chuẩn hóa đường dẫn Programming DB: %w", err)
	}
	dir := filepath.Dir(absPath)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("tạo thư mục Programming DB: %w", err)
	}
	if err := os.Chmod(dir, 0o750); err != nil {
		return nil, fmt.Errorf("đặt quyền thư mục Programming DB: %w", err)
	}
	if info, err := os.Lstat(absPath); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return nil, fmt.Errorf("Programming DB phải là regular file, không qua symlink")
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("kiểm tra Programming DB: %w", err)
	} else {
		file, err := os.OpenFile(absPath, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
		if err != nil {
			return nil, fmt.Errorf("tạo Programming DB: %w", err)
		}
		if err := file.Close(); err != nil {
			return nil, fmt.Errorf("đóng Programming DB mới: %w", err)
		}
	}
	if err := os.Chmod(absPath, 0o600); err != nil {
		return nil, fmt.Errorf("đặt quyền Programming DB: %w", err)
	}
	dsn := (&url.URL{Scheme: "file", Opaque: filepath.ToSlash(absPath), RawQuery: url.Values{
		"_pragma": []string{
			"busy_timeout(5000)", "foreign_keys(1)", "journal_mode(WAL)",
			"synchronous(FULL)", "trusted_schema(0)", "wal_autocheckpoint(1000)",
		},
		"_txlock": []string{"immediate"},
	}.Encode()}).String()
	if err := registerUnicodeUpper(); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("mở Programming DB: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping Programming DB: %w", err)
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	backupDir := options.BackupDir
	if backupDir == "" {
		backupDir = filepath.Join(dir, "programming-backups")
	}
	backupDir, err = filepath.Abs(backupDir)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("chuẩn hóa thư mục backup: %w", err)
	}
	migrationTime := now().UTC().UnixMilli()
	if _, err := Migrate(ctx, db, MigrationOptions{
		AppliedAtUTCMS: migrationTime,
		Backup: func(backupContext context.Context, fromVersion, toVersion int) (BackupEvidence, error) {
			destination := filepath.Join(backupDir,
				fmt.Sprintf("programming-v%d-before-v%d-%d.sqlite", fromVersion, toVersion, migrationTime))
			return Backup(backupContext, db, absPath, destination, migrationTime)
		},
	}); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := verifyConnectionPolicy(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	store := &Store{db: db, path: absPath, backupDir: backupDir, now: now}
	provider := options.SystemLibraryProvider
	if provider == nil {
		provider = generatedSystemLibraryProvider{}
	}
	if provider != nil {
		snapshot, err := provider.LoadSystemLibrary(ctx)
		if err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("nạp SYSTEM Control Library: %w", err)
		}
		if err := validateSystemLibrarySnapshot(snapshot); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("SYSTEM Control Library không hợp lệ: %w", err)
		}
		store.system = cloneSystemLibrarySnapshot(&snapshot)
	}
	return store, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) Path() string {
	if s == nil {
		return ""
	}
	return s.path
}

func (s *Store) QuickCheck(ctx context.Context) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("Programming store chưa mở")
	}
	return quickCheck(ctx, s.db)
}

func verifyConnectionPolicy(ctx context.Context, db *sql.DB) error {
	checks := []struct {
		pragma string
		want   string
	}{
		{"foreign_keys", "1"},
		{"journal_mode", "wal"},
		{"synchronous", "2"},
		{"busy_timeout", "5000"},
	}
	for _, check := range checks {
		var got string
		if err := db.QueryRowContext(ctx, "PRAGMA "+check.pragma).Scan(&got); err != nil {
			return fmt.Errorf("đọc PRAGMA %s: %w", check.pragma, err)
		}
		if got != check.want {
			return fmt.Errorf("PRAGMA %s=%s, cần %s", check.pragma, got, check.want)
		}
	}
	return nil
}
