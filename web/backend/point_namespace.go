package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const pointNamespaceFile = "point_namespace.conf"

type pointNamespaceAuthority struct {
	Revision    uint64            `json:"revision"`
	Generations map[string]uint64 `json:"generations"`
}

func (a *App) readPointNamespaceAuthority() (pointNamespaceAuthority, error) {
	authority := pointNamespaceAuthority{Generations: map[string]uint64{}}
	data, err := os.ReadFile(a.configPath(pointNamespaceFile))
	if os.IsNotExist(err) {
		return authority, nil
	}
	if err != nil {
		return authority, fmt.Errorf("read point namespace: %w", err)
	}
	if err := json.Unmarshal(data, &authority); err != nil {
		return authority, fmt.Errorf("parse point namespace: %w", err)
	}
	if authority.Generations == nil {
		authority.Generations = map[string]uint64{}
	}
	return authority, nil
}

func (a *App) writePointNamespaceAuthority(authority pointNamespaceAuthority) error {
	data, err := json.MarshalIndent(authority, "", "  ")
	if err != nil {
		return fmt.Errorf("encode point namespace: %w", err)
	}
	data = append(data, '\n')
	path := a.configPath(pointNamespaceFile)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("prepare point namespace dir: %w", err)
	}
	writer := a.pointNamespaceWriter
	if writer == nil {
		writer = writeConfigFileAtomic
	}
	return writer(path, data, 0o644)
}
