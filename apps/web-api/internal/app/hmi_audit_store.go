package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const hmiAuditMaxBytes = 16 * 1024 * 1024

type hmiAuditRecord struct {
	Time       string   `json:"time"`
	Phase      string   `json:"phase"`
	RequestID  string   `json:"requestId"`
	Actor      string   `json:"actor"`
	Role       Role     `json:"role"`
	Action     string   `json:"action"`
	Target     string   `json:"target,omitempty"`
	Value      *float64 `json:"value,omitempty"`
	Effective  any      `json:"effectiveValue,omitempty"`
	Source     string   `json:"effectiveSource,omitempty"`
	Mode       string   `json:"mode,omitempty"`
	Reason     string   `json:"reason,omitempty"`
	TTLS       uint32   `json:"ttlS,omitempty"`
	Result     string   `json:"result"`
	ReasonCode string   `json:"reasonCode"`
}

type hmiAuditStore struct {
	path string
	mu   sync.Mutex
}

func (s *hmiAuditStore) append(record hmiAuditRecord) error {
	if s == nil || s.path == "" {
		return errors.New("hmi audit path unavailable")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o750); err != nil {
		return err
	}
	file, err := os.OpenFile(s.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	if info, err := file.Stat(); err != nil || info.Size() >= hmiAuditMaxBytes {
		if err != nil {
			return err
		}
		return fmt.Errorf("hmi audit file reached %d bytes", hmiAuditMaxBytes)
	}
	record.Time = time.Now().UTC().Format(time.RFC3339Nano)
	line, err := json.Marshal(record)
	if err != nil {
		return err
	}
	line = append(line, '\n')
	if _, err := file.Write(line); err != nil {
		return err
	}
	return file.Sync()
}
