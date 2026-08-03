package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

var ErrMissing = errors.New("config missing")

func ResolveDir() string {
	if value := os.Getenv("CONFIG_DIR"); value != "" {
		return value
	}
	return "/data/config"
}

func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	return writeFileAtomic(path, data, perm, false)
}

func WriteFileAtomicStrict(path string, data []byte, perm os.FileMode) error {
	return writeFileAtomic(path, data, perm, true)
}

func writeFileAtomic(path string, data []byte, perm os.FileMode, strict bool) error {
	dir := filepath.Dir(path)
	file, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("create temp config %s: %w", path, err)
	}
	tmpPath := file.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if err := file.Chmod(perm); err != nil {
		_ = file.Close()
		return fmt.Errorf("chmod temp config %s: %w", path, err)
	}
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return fmt.Errorf("write temp config %s: %w", path, err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return fmt.Errorf("fsync temp config %s: %w", path, err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close temp config %s: %w", path, err)
	}
	if err := preserveExistingFileOwnership(path, tmpPath); err != nil {
		return fmt.Errorf("preserve config ownership %s: %w", path, err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("rename config %s: %w", path, err)
	}
	cleanup = false
	if strict {
		if err := SyncDirectory(dir); err != nil {
			return fmt.Errorf("fsync config directory %s: %w", dir, err)
		}
	} else if dirFile, err := os.Open(dir); err == nil {
		_ = dirFile.Sync()
		_ = dirFile.Close()
	}
	return nil
}

func ReadJSON(path string, value any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrMissing
		}
		return fmt.Errorf("read config %s: %w", path, err)
	}
	if err := json.Unmarshal(data, value); err != nil {
		return fmt.Errorf("parse config %s: %w", path, err)
	}
	return nil
}
