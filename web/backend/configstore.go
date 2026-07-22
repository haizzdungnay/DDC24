package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

var ErrConfigMissing = errors.New("config missing")

func resolveConfigDir() string {
	return getenv("CONFIG_DIR", "/data/config")
}

func writeConfigFileAtomic(path string, data []byte, perm os.FileMode) error {
	return writeConfigFileAtomicWithDirectorySync(path, data, perm, false)
}

func writeConfigFileAtomicStrict(path string, data []byte, perm os.FileMode) error {
	return writeConfigFileAtomicWithDirectorySync(path, data, perm, true)
}

func writeConfigFileAtomicWithDirectorySync(path string, data []byte, perm os.FileMode, strict bool) error {
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
		if err := syncDirectory(dir); err != nil {
			return fmt.Errorf("fsync config directory %s: %w", dir, err)
		}
	} else if dirFile, err := os.Open(dir); err == nil {
		_ = dirFile.Sync()
		_ = dirFile.Close()
	}
	return nil
}

func readConfigJSON(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrConfigMissing
		}
		return fmt.Errorf("read config %s: %w", path, err)
	}
	if err := json.Unmarshal(data, v); err != nil {
		return fmt.Errorf("parse config %s: %w", path, err)
	}
	return nil
}
