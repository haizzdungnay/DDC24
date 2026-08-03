package points

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type NamespaceAuthority struct {
	Revision    uint64            `json:"revision"`
	Generations map[string]uint64 `json:"generations"`
}

type FileWriter func(string, []byte, os.FileMode) error

type NamespaceStore struct {
	Path   string
	Writer FileWriter
}

func (s NamespaceStore) Read() (NamespaceAuthority, error) {
	authority := NamespaceAuthority{Generations: map[string]uint64{}}
	data, err := os.ReadFile(s.Path)
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

func (s NamespaceStore) Write(authority NamespaceAuthority) error {
	if s.Writer == nil {
		return fmt.Errorf("point namespace writer is required")
	}
	data, err := json.MarshalIndent(authority, "", "  ")
	if err != nil {
		return fmt.Errorf("encode point namespace: %w", err)
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o755); err != nil {
		return fmt.Errorf("prepare point namespace dir: %w", err)
	}
	return s.Writer(s.Path, data, 0o644)
}
