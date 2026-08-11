package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
	sqlite3 "modernc.org/sqlite"
)

type sqliteBackuper interface {
	NewBackup(string) (*sqlite3.Backup, error)
}

type BackupEvidence struct {
	SchemaVersion   int    `json:"schemaVersion"`
	Path            string `json:"path"`
	ManifestPath    string `json:"manifestPath"`
	SourceIdentity  string `json:"sourceIdentity"`
	SHA256          string `json:"sha256"`
	SchemaSHA256    string `json:"schemaSha256"`
	QuickCheck      string `json:"quickCheck"`
	ByteSize        int64  `json:"byteSize"`
	CreatedAtUTCMS  int64  `json:"createdAtUtcMs"`
	DatabaseVersion int    `json:"databaseVersion"`
}

func (s *Store) Backup(ctx context.Context, destination string) (BackupEvidence, error) {
	if s == nil || s.db == nil {
		return BackupEvidence{}, fmt.Errorf("Programming store chưa mở")
	}
	if destination == "" {
		destination = filepath.Join(s.backupDir, fmt.Sprintf("programming-v1-%d.sqlite", s.now().UTC().UnixMilli()))
	}
	return Backup(ctx, s.db, s.path, destination, s.now().UTC().UnixMilli())
}

func Backup(ctx context.Context, source *sql.DB, sourcePath, destination string, createdAtUTCMS int64) (evidence BackupEvidence, err error) {
	if source == nil || sourcePath == "" || destination == "" || createdAtUTCMS < 0 {
		return BackupEvidence{}, fmt.Errorf("source, sourcePath, destination và thời gian là bắt buộc")
	}
	absSource, err := filepath.Abs(sourcePath)
	if err != nil {
		return BackupEvidence{}, err
	}
	absDestination, err := filepath.Abs(destination)
	if err != nil {
		return BackupEvidence{}, err
	}
	if absSource == absDestination {
		return BackupEvidence{}, fmt.Errorf("backup destination trùng Programming DB")
	}
	manifestPath := absDestination + ".manifest.json"
	for _, candidate := range []string{absDestination, manifestPath} {
		if _, err := os.Lstat(candidate); err == nil || !os.IsNotExist(err) {
			return BackupEvidence{}, fmt.Errorf("backup artifact đã tồn tại hoặc không kiểm tra được: %s", candidate)
		}
	}
	dir := filepath.Dir(absDestination)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return BackupEvidence{}, fmt.Errorf("tạo thư mục backup: %w", err)
	}
	if err := ensureBackupSpace(absSource, dir); err != nil {
		return BackupEvidence{}, err
	}
	partial, err := os.CreateTemp(dir, filepath.Base(absDestination)+".partial-*")
	if err != nil {
		return BackupEvidence{}, fmt.Errorf("tạo backup tạm: %w", err)
	}
	partialPath := partial.Name()
	destinationPublished := false
	manifestPublished := false
	defer func() {
		if err != nil {
			_ = os.Remove(partialPath)
			if destinationPublished {
				_ = os.Remove(absDestination)
			}
			if manifestPublished {
				_ = os.Remove(manifestPath)
			}
		}
	}()
	if err := partial.Chmod(0o600); err != nil {
		_ = partial.Close()
		return BackupEvidence{}, err
	}
	if err := partial.Close(); err != nil {
		return BackupEvidence{}, err
	}
	connection, err := source.Conn(ctx)
	if err != nil {
		return BackupEvidence{}, fmt.Errorf("lấy SQLite connection cho backup: %w", err)
	}
	defer connection.Close()
	var sourceIdentity string
	if err := connection.QueryRowContext(ctx,
		`SELECT file FROM pragma_database_list WHERE name='main'`).Scan(&sourceIdentity); err != nil {
		return BackupEvidence{}, fmt.Errorf("đọc source identity: %w", err)
	}
	resolvedSourceIdentity, err := filepath.Abs(sourceIdentity)
	if err != nil || resolvedSourceIdentity != absSource {
		return BackupEvidence{}, fmt.Errorf("source identity lệch path: db=%s expected=%s", sourceIdentity, absSource)
	}
	if err := connection.Raw(func(driverConnection any) error {
		backuper, ok := driverConnection.(sqliteBackuper)
		if !ok {
			return fmt.Errorf("SQLite driver không hỗ trợ online backup")
		}
		backup, err := backuper.NewBackup(partialPath)
		if err != nil {
			return err
		}
		var stepErr error
		busyRetries := 0
		for more := true; more; {
			if err := ctx.Err(); err != nil {
				stepErr = err
				break
			}
			more, stepErr = backup.Step(128)
			if stepErr != nil {
				if sqliteBackupBusy(stepErr) && busyRetries < 8 {
					busyRetries++
					stepErr = nil
					continue
				}
				break
			}
			busyRetries = 0
		}
		finishErr := backup.Finish()
		if stepErr != nil {
			return stepErr
		}
		return finishErr
	}); err != nil {
		return BackupEvidence{}, fmt.Errorf("SQLite online backup: %w", err)
	}
	if err := syncFile(partialPath); err != nil {
		return BackupEvidence{}, err
	}
	evidence, err = VerifyBackup(ctx, partialPath)
	if err != nil {
		return BackupEvidence{}, err
	}
	evidence.Path = absDestination
	evidence.ManifestPath = manifestPath
	evidence.SourceIdentity = sourceIdentity
	evidence.CreatedAtUTCMS = createdAtUTCMS
	if err := os.Link(partialPath, absDestination); err != nil {
		return BackupEvidence{}, fmt.Errorf("publish backup không ghi đè: %w", err)
	}
	destinationPublished = true
	if err := os.Chmod(absDestination, 0o600); err != nil {
		return BackupEvidence{}, err
	}
	if err := syncDirectory(dir); err != nil {
		return BackupEvidence{}, err
	}
	if err := os.Remove(partialPath); err != nil {
		return BackupEvidence{}, err
	}
	if err := writeBackupManifest(evidence); err != nil {
		return BackupEvidence{}, err
	}
	manifestPublished = true
	published, err := VerifyBackup(ctx, absDestination)
	if err != nil {
		return BackupEvidence{}, err
	}
	if published.SHA256 != evidence.SHA256 || published.SchemaSHA256 != evidence.SchemaSHA256 ||
		published.ByteSize != evidence.ByteSize || published.DatabaseVersion != evidence.DatabaseVersion {
		return BackupEvidence{}, fmt.Errorf("backup published lệch evidence")
	}
	return evidence, nil
}

func VerifyBackup(ctx context.Context, path string) (BackupEvidence, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return BackupEvidence{}, err
	}
	info, err := os.Lstat(absPath)
	if err != nil {
		return BackupEvidence{}, fmt.Errorf("stat backup: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return BackupEvidence{}, fmt.Errorf("backup không phải regular file")
	}
	dsn := (&url.URL{Scheme: "file", Opaque: filepath.ToSlash(absPath), RawQuery: url.Values{
		"mode": {"ro"}, "_pragma": {"trusted_schema(0)"},
	}.Encode()}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return BackupEvidence{}, fmt.Errorf("mở backup read-only: %w", err)
	}
	defer db.Close()
	if err := quickCheck(ctx, db); err != nil {
		return BackupEvidence{}, err
	}
	var databaseVersion int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&databaseVersion); err != nil {
		return BackupEvidence{}, fmt.Errorf("đọc backup user_version: %w", err)
	}
	if err := verifyMigrationRecords(ctx, db, databaseVersion); err != nil {
		return BackupEvidence{}, err
	}
	rows, err := db.QueryContext(ctx,
		`SELECT type,name,tbl_name,coalesce(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name,tbl_name,sql`)
	if err != nil {
		return BackupEvidence{}, fmt.Errorf("đọc backup schema: %w", err)
	}
	hashSchema := sha256.New()
	for rows.Next() {
		var kind, name, table, statement string
		if err := rows.Scan(&kind, &name, &table, &statement); err != nil {
			rows.Close()
			return BackupEvidence{}, err
		}
		_, _ = io.WriteString(hashSchema, kind+"\x00"+name+"\x00"+table+"\x00"+statement+"\n")
	}
	if err := rows.Close(); err != nil {
		return BackupEvidence{}, err
	}
	file, err := os.Open(absPath)
	if err != nil {
		return BackupEvidence{}, err
	}
	hashFile := sha256.New()
	if _, err := io.Copy(hashFile, file); err != nil {
		_ = file.Close()
		return BackupEvidence{}, err
	}
	fileInfo, statErr := file.Stat()
	closeErr := file.Close()
	if statErr != nil {
		return BackupEvidence{}, statErr
	}
	if closeErr != nil {
		return BackupEvidence{}, closeErr
	}
	return BackupEvidence{
		SchemaVersion: 1, Path: absPath, SHA256: hex.EncodeToString(hashFile.Sum(nil)),
		SchemaSHA256: hex.EncodeToString(hashSchema.Sum(nil)), QuickCheck: "ok",
		ByteSize: fileInfo.Size(), DatabaseVersion: databaseVersion,
	}, nil
}

func RestoreBackup(ctx context.Context, backupPath, destination string) error {
	if _, err := VerifyBackup(ctx, backupPath); err != nil {
		return err
	}
	absDestination, err := filepath.Abs(destination)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(absDestination); err == nil || !os.IsNotExist(err) {
		return fmt.Errorf("restore destination đã tồn tại hoặc không kiểm tra được")
	}
	dir := filepath.Dir(absDestination)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	source, err := os.Open(backupPath)
	if err != nil {
		return err
	}
	defer source.Close()
	partial, err := os.CreateTemp(dir, filepath.Base(absDestination)+".restore-*")
	if err != nil {
		return err
	}
	partialPath := partial.Name()
	defer os.Remove(partialPath)
	if err := partial.Chmod(0o600); err != nil {
		_ = partial.Close()
		return err
	}
	if _, err := io.Copy(partial, source); err != nil {
		_ = partial.Close()
		return err
	}
	if err := partial.Sync(); err != nil {
		_ = partial.Close()
		return err
	}
	if err := partial.Close(); err != nil {
		return err
	}
	if _, err := VerifyBackup(ctx, partialPath); err != nil {
		return err
	}
	if err := os.Link(partialPath, absDestination); err != nil {
		return fmt.Errorf("publish restore không ghi đè: %w", err)
	}
	if err := syncDirectory(dir); err != nil {
		_ = os.Remove(absDestination)
		_ = syncDirectory(dir)
		return err
	}
	return nil
}

func verifyMigrationRecords(ctx context.Context, db *sql.DB, databaseVersion int) error {
	if databaseVersion <= 0 || databaseVersion > CurrentSchemaVersion {
		return fmt.Errorf("%w: backup user_version=%d", ErrSchemaFuture, databaseVersion)
	}
	rows, err := db.QueryContext(ctx, `SELECT version,checksum FROM schema_migrations ORDER BY version`)
	if err != nil {
		return fmt.Errorf("đọc migration backup: %w", err)
	}
	defer rows.Close()
	expectedVersion := 1
	for rows.Next() {
		var version int
		var stored []byte
		if err := rows.Scan(&version, &stored); err != nil {
			return err
		}
		expected, ok := MigrationChecksum(version)
		if !ok || version != expectedVersion || !bytes.Equal(stored, expected[:]) {
			return fmt.Errorf("%w: backup migration=%d", ErrSchemaChecksum, version)
		}
		expectedVersion++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if expectedVersion-1 != databaseVersion {
		return fmt.Errorf("%w: backup user_version=%d migration=%d", ErrPartialSchema, databaseVersion, expectedVersion-1)
	}
	return nil
}

func writeBackupManifest(evidence BackupEvidence) error {
	raw, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	dir := filepath.Dir(evidence.ManifestPath)
	partial, err := os.CreateTemp(dir, filepath.Base(evidence.ManifestPath)+".partial-*")
	if err != nil {
		return err
	}
	partialPath := partial.Name()
	defer os.Remove(partialPath)
	if err := partial.Chmod(0o600); err != nil {
		_ = partial.Close()
		return err
	}
	if _, err := partial.Write(raw); err != nil {
		_ = partial.Close()
		return err
	}
	if err := partial.Sync(); err != nil {
		_ = partial.Close()
		return err
	}
	if err := partial.Close(); err != nil {
		return err
	}
	if _, err := os.Lstat(evidence.ManifestPath); err == nil || !os.IsNotExist(err) {
		return fmt.Errorf("backup manifest đã tồn tại hoặc không kiểm tra được")
	}
	if err := os.Link(partialPath, evidence.ManifestPath); err != nil {
		return err
	}
	if err := syncDirectory(dir); err != nil {
		_ = os.Remove(evidence.ManifestPath)
		_ = syncDirectory(dir)
		return err
	}
	return nil
}

func ensureBackupSpace(sourcePath, destinationDir string) error {
	info, err := os.Stat(sourcePath)
	if err != nil {
		return err
	}
	var stat unix.Statfs_t
	if err := unix.Statfs(destinationDir, &stat); err != nil {
		return fmt.Errorf("đọc dung lượng backup: %w", err)
	}
	available := uint64(stat.Bavail) * uint64(stat.Bsize)
	required := uint64(info.Size())*2 + 8*1024*1024
	if available < required {
		return fmt.Errorf("không đủ dung lượng backup: available=%d required=%d", available, required)
	}
	return nil
}

func syncFile(path string) error {
	file, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return err
	}
	return directory.Close()
}

func sqliteBackupBusy(err error) bool {
	var sqliteError *sqlite3.Error
	if !errors.As(err, &sqliteError) {
		return false
	}
	code := sqliteError.Code() & 0xff
	return code == 5 || code == 6
}
