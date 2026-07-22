package main

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

type historianRecoveryAction string

const (
	historianRecoveryMissing  historianRecoveryAction = "missing"
	historianRecoveryClean    historianRecoveryAction = "clean"
	historianRecoveryDisabled historianRecoveryAction = "disabled"
)

type HistorianRecoveryResult struct {
	Action      historianRecoveryAction
	EvidenceDir string
}

func HistorianRecoveryPreflight(path string) (HistorianRecoveryResult, error) {
	if path == "" {
		return HistorianRecoveryResult{}, fmt.Errorf("historian recovery path is required")
	}
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		return HistorianRecoveryResult{Action: historianRecoveryMissing}, nil
	} else if err != nil {
		return HistorianRecoveryResult{Action: historianRecoveryDisabled}, err
	}
	check, openErr := checkHistorianFamily(path)
	if openErr == nil && check == "ok" {
		return HistorianRecoveryResult{Action: historianRecoveryClean}, nil
	}
	evidenceDir, evidenceErr := preserveHistorianFamily(path)
	result := HistorianRecoveryResult{Action: historianRecoveryDisabled, EvidenceDir: evidenceDir}
	if evidenceErr != nil {
		return result, fmt.Errorf("historian integrity failed (%v), preserve evidence: %w", openErr, evidenceErr)
	}
	candidate := path + ".recovery-candidate"
	if _, candidateErr := verifySQLiteBackup(context.Background(), candidate); candidateErr == nil {
		if publishErr := publishRecoveryCandidate(path, candidate, evidenceDir); publishErr != nil {
			return result, fmt.Errorf("historian integrity failed (%v), recovery publication: %w", openErr, publishErr)
		}
		return HistorianRecoveryResult{Action: historianRecoveryClean, EvidenceDir: evidenceDir}, nil
	}
	return result, fmt.Errorf("historian integrity failed: quick_check=%q: %w", check, openErr)
}

func checkHistorianFamily(path string) (string, error) {
	scratchDir, err := os.MkdirTemp(filepath.Dir(path), ".historian-preflight-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(scratchDir)
	scratchPath := filepath.Join(scratchDir, filepath.Base(path))
	for _, source := range []string{path, path + "-wal", path + "-shm"} {
		if _, err := os.Lstat(source); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return "", err
		}
		destination := scratchPath + source[len(path):]
		if err := copyEvidenceFile(source, destination); err != nil {
			return "", err
		}
	}
	db, err := sql.Open("sqlite", scratchPath)
	if err != nil {
		return "", err
	}
	var check string
	checkErr := db.QueryRow(`PRAGMA quick_check`).Scan(&check)
	closeErr := db.Close()
	if checkErr != nil {
		return check, checkErr
	}
	return check, closeErr
}

func publishRecoveryCandidate(path, candidate, evidenceDir string) error {
	parent := filepath.Dir(path)
	quarantine := filepath.Join(evidenceDir, "quarantine")
	if err := os.Mkdir(quarantine, 0o700); err != nil {
		return err
	}
	for _, member := range []string{path, path + "-wal", path + "-shm"} {
		if _, err := os.Lstat(member); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		if err := os.Rename(member, filepath.Join(quarantine, filepath.Base(member))); err != nil {
			return err
		}
	}
	if err := syncDirectory(quarantine); err != nil {
		return err
	}
	if err := syncDirectory(parent); err != nil {
		return err
	}
	if err := os.Link(candidate, path); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := syncDirectory(parent); err != nil {
		return err
	}
	_, err = verifySQLiteBackup(context.Background(), path)
	return err
}

func preserveHistorianFamily(path string) (string, error) {
	parent := filepath.Dir(path)
	base := filepath.Base(path)
	evidenceDir, err := os.MkdirTemp(parent, base+".damaged-"+time.Now().UTC().Format("20060102T150405.000000000Z")+"-")
	if err != nil {
		return "", err
	}
	if err := os.Chmod(evidenceDir, 0o700); err != nil {
		return evidenceDir, err
	}
	for _, source := range []string{path, path + "-wal", path + "-shm"} {
		if _, err := os.Lstat(source); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return evidenceDir, err
		}
		if err := copyEvidenceFile(source, filepath.Join(evidenceDir, filepath.Base(source))); err != nil {
			return evidenceDir, err
		}
	}
	if err := syncDirectory(evidenceDir); err != nil {
		return evidenceDir, err
	}
	if err := syncDirectory(parent); err != nil {
		return evidenceDir, err
	}
	return evidenceDir, nil
}

func copyEvidenceFile(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
