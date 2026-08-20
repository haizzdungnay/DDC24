package store

import (
	"crypto/sha256"
	"embed"
	"fmt"
	"sort"
)

const CurrentSchemaVersion = 7

//go:embed migrations/*.sql
var migrationFiles embed.FS

type migration struct {
	Version  int
	Name     string
	SQL      string
	Checksum [sha256.Size]byte
}

func embeddedMigrations() ([]migration, error) {
	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return nil, fmt.Errorf("đọc migration Programming: %w", err)
	}
	migrations := make([]migration, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		var version int
		if _, err := fmt.Sscanf(entry.Name(), "%04d_", &version); err != nil || version <= 0 {
			return nil, fmt.Errorf("tên migration Programming không hợp lệ: %s", entry.Name())
		}
		raw, err := migrationFiles.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return nil, fmt.Errorf("đọc migration %s: %w", entry.Name(), err)
		}
		migrations = append(migrations, migration{
			Version:  version,
			Name:     entry.Name(),
			SQL:      string(raw),
			Checksum: sha256.Sum256(raw),
		})
	}
	sort.Slice(migrations, func(left, right int) bool {
		return migrations[left].Version < migrations[right].Version
	})
	for index, item := range migrations {
		if item.Version != index+1 {
			return nil, fmt.Errorf("chuỗi migration Programming không liên tục tại version %d", item.Version)
		}
	}
	if len(migrations) != CurrentSchemaVersion {
		return nil, fmt.Errorf("schema version=%d nhưng có %d migration", CurrentSchemaVersion, len(migrations))
	}
	return migrations, nil
}

func MigrationChecksum(version int) ([sha256.Size]byte, bool) {
	migrations, err := embeddedMigrations()
	if err != nil || version <= 0 || version > len(migrations) {
		return [sha256.Size]byte{}, false
	}
	return migrations[version-1].Checksum, true
}
