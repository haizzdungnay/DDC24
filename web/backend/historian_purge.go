package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type historianQuarantinedArchive struct {
	original string
	staged   string
}

func (s *HistorianStore) PurgePoint(ctx context.Context, pointID, archiveDir string) error {
	if s == nil || s.db == nil {
		return nil
	}
	pointID = canonicalHistoryPointID(pointID)
	if pointID == "" {
		return fmt.Errorf("point id is required")
	}
	s.archiveMu.Lock()
	defer s.archiveMu.Unlock()

	ids := storagePointIDs([]string{pointID})
	placeholders, args := historianPurgeSQLArgs(ids)
	rows, err := s.db.QueryContext(ctx, `SELECT file_name FROM archive_blocks WHERE point_id IN (`+placeholders+`)`, args...)
	if err != nil {
		return fmt.Errorf("list point archives: %w", err)
	}
	var fileNames []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return fmt.Errorf("scan point archive: %w", err)
		}
		fileNames = append(fileNames, name)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("read point archives: %w", err)
	}
	rows.Close()

	quarantined, err := quarantineHistorianArchives(archiveDir, fileNames)
	if err != nil {
		return err
	}
	restore := func() {
		for i := len(quarantined) - 1; i >= 0; i-- {
			_ = os.Rename(quarantined[i].staged, quarantined[i].original)
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		restore()
		return fmt.Errorf("begin historian point purge: %w", err)
	}
	defer tx.Rollback()
	for _, table := range []string{"archive_watermarks", "retention_prune_queue", "archive_blocks", "hot_samples", "history_gaps", "point_policies"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE point_id IN (`+placeholders+`)`, args...); err != nil {
			restore()
			return fmt.Errorf("purge historian %s: %w", table, err)
		}
	}
	if err := tx.Commit(); err != nil {
		restore()
		return fmt.Errorf("commit historian point purge: %w", err)
	}
	for _, file := range quarantined {
		if err := os.Remove(file.staged); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove quarantined historian archive: %w", err)
		}
	}
	if len(quarantined) > 0 {
		_ = syncDirectory(filepath.Dir(quarantined[0].staged))
	}
	return nil
}

func historianPurgeSQLArgs(ids []string) (string, []any) {
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i], args[i] = "?", id
	}
	return strings.Join(placeholders, ","), args
}

func quarantineHistorianArchives(archiveDir string, names []string) ([]historianQuarantinedArchive, error) {
	if len(names) == 0 {
		return nil, nil
	}
	if strings.TrimSpace(archiveDir) == "" {
		return nil, fmt.Errorf("historian archive directory unavailable")
	}
	absDir, err := filepath.Abs(archiveDir)
	if err != nil {
		return nil, fmt.Errorf("resolve historian archive directory: %w", err)
	}
	quarantined := make([]historianQuarantinedArchive, 0, len(names))
	restore := func() {
		for i := len(quarantined) - 1; i >= 0; i-- {
			_ = os.Rename(quarantined[i].staged, quarantined[i].original)
		}
	}
	for _, name := range names {
		if !filepath.IsLocal(name) || filepath.Base(name) != name || filepath.Ext(name) != ".mkhab" {
			restore()
			return nil, fmt.Errorf("unsafe historian archive file name %q", name)
		}
		path := filepath.Join(absDir, name)
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			restore()
			return nil, fmt.Errorf("inspect historian archive %q: %w", name, err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			restore()
			return nil, fmt.Errorf("historian archive %q is not a regular file", name)
		}
		temp, err := os.CreateTemp(absDir, ".vp-purge-*")
		if err != nil {
			restore()
			return nil, fmt.Errorf("reserve historian archive quarantine: %w", err)
		}
		staged := temp.Name()
		if closeErr := temp.Close(); closeErr != nil {
			_ = os.Remove(staged)
			restore()
			return nil, closeErr
		}
		if err := os.Remove(staged); err != nil {
			restore()
			return nil, err
		}
		if err := os.Rename(path, staged); err != nil {
			restore()
			return nil, fmt.Errorf("quarantine historian archive %q: %w", name, err)
		}
		quarantined = append(quarantined, historianQuarantinedArchive{original: path, staged: staged})
	}
	return quarantined, nil
}
