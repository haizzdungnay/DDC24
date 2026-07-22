package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type HistorianMaintenanceRequest struct {
	Manifest     MigrationManifest
	ManifestPath string
	PolicyConfig []byte
	BackupPath   string
	StableUTCMS  int64
	PruneEnabled bool
}

type HistorianMaintenanceResult struct {
	Manifest        MigrationManifest
	Quiesce         LegacyQuiesceProof
	Backup          SQLiteBackupEvidence
	Evidence        HistorianCutoverEvidence
	MaintenanceGaps int
	Activated       bool
}

// RunHistorianMaintenanceCutover is an operator/maintenance-only sequence.
// It is intentionally not called by startup or an HTTP handler.
func (a *App) RunHistorianMaintenanceCutover(ctx context.Context, request HistorianMaintenanceRequest) (HistorianMaintenanceResult, error) {
	var result HistorianMaintenanceResult
	if a == nil || a.trends == nil || a.historianV2 == nil || a.historianActivation == nil {
		return result, fmt.Errorf("historian maintenance dependencies unavailable")
	}
	if request.Manifest.MigrationID == "" || request.BackupPath == "" || request.StableUTCMS <= 0 {
		return result, fmt.Errorf("invalid historian maintenance request")
	}
	if len(request.PolicyConfig) == 0 {
		request.PolicyConfig, _ = a.historian.committedMirrorSnapshot()
	}
	if len(request.PolicyConfig) == 0 {
		return result, fmt.Errorf("historian policy config is required")
	}
	a.maintenanceMu.Lock()
	defer a.maintenanceMu.Unlock()

	proof, err := a.QuiesceLegacyHistorianWriters(ctx)
	if err != nil {
		return result, err
	}
	result.Quiesce = proof
	activated := false
	defer func() {
		if activated {
			return
		}
		authority, authorityErr := a.historianActivation.Authority(context.Background())
		if authorityErr == nil && (authority.WriterV2 || authority.State == "prepared") {
			return
		}
		resumeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = a.ResumeLegacyHistorianWriters(resumeCtx, proof)
		cancel()
	}()

	backup, err := a.finalLegacyBackup(ctx, request.BackupPath)
	if err != nil {
		return result, err
	}
	result.Backup = backup
	rows, _, err := readLegacyBackupRows(ctx, backup.Path)
	if err != nil {
		return result, err
	}
	manifest := request.Manifest
	manifest.SourceIdentity = backup.SourceIdentity
	manifest.SourceSHA256 = backup.SHA256
	manifest.SourceRowCount = uint64(len(rows))
	if err := validateMigrationManifest(manifest); err != nil {
		return result, err
	}
	if request.ManifestPath != "" {
		if err := WriteMigrationManifest(request.ManifestPath, manifest); err != nil {
			return result, err
		}
	}
	if err := a.historianV2.ApplyLegacyMigrationChunk(ctx, manifest, rows, 1, true); err != nil {
		return result, fmt.Errorf("final historian migration: %w", err)
	}
	evidenceErr := a.historianV2.RecordHistorianCutoverEvidenceWithQuiesce(ctx, manifest.MigrationID, backup, proof, time.Now().UTC().UnixMilli())
	if evidenceErr != nil {
		return result, evidenceErr
	}
	result.Evidence, err = a.historianV2.HistorianCutoverEvidence(ctx)
	if err != nil {
		return result, err
	}
	if err := a.recordMaintenanceGaps(ctx, request.PolicyConfig, manifest.PolicyRevision, manifest.MigrationID, proof.StoppedAtUTCMS, request.StableUTCMS, &result.MaintenanceGaps); err != nil {
		return result, err
	}
	if err := a.historianActivation.Prepare(ctx, HistorianActivationPlan{PolicyRevision: manifest.PolicyRevision, Config: request.PolicyConfig, StableUTCMS: request.StableUTCMS, LegacyQuiesced: true, MigrationVerified: true, PruneEnabled: request.PruneEnabled}); err != nil {
		return result, err
	}
	if err := a.historianActivation.Commit(ctx); err != nil {
		return result, err
	}
	authority, err := a.historianActivation.Authority(ctx)
	if err != nil {
		return result, err
	}
	if !authority.WriterV2 || !authority.QueryV2 {
		return result, fmt.Errorf("historian v2 authority did not activate")
	}
	a.historianAuthority = authority
	result.Manifest = manifest
	result.Activated = true
	activated = true
	return result, nil
}

func (a *App) finalLegacyBackup(ctx context.Context, destination string) (SQLiteBackupEvidence, error) {
	absDestination, err := filepath.Abs(destination)
	if err != nil {
		return SQLiteBackupEvidence{}, err
	}
	if _, err := os.Stat(absDestination); err == nil {
		verified, verifyErr := verifySQLiteBackup(ctx, absDestination)
		if verifyErr != nil {
			return SQLiteBackupEvidence{}, verifyErr
		}
		sourceIdentity, identityErr := filepath.Abs(a.trends.path)
		if identityErr != nil {
			return SQLiteBackupEvidence{}, identityErr
		}
		verified.Path, verified.SourceIdentity = absDestination, sourceIdentity
		return verified, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return SQLiteBackupEvidence{}, err
	}
	evidence, err := CreateNativeSQLiteBackup(ctx, a.trends.db, absDestination, 128)
	if err != nil {
		return SQLiteBackupEvidence{}, err
	}
	evidence.Path = absDestination
	return evidence, nil
}

func (a *App) recordMaintenanceGaps(ctx context.Context, config []byte, policyRevision uint64, migrationID string, quiescedAt, anchor int64, count *int) error {
	var policy historianPolicyFile
	if err := json.Unmarshal(config, &policy); err != nil {
		return fmt.Errorf("parse maintenance policy: %w", err)
	}
	if anchor <= quiescedAt {
		anchor = quiescedAt + 1
	}
	revision := policyRevision
	for _, point := range policy.Points {
		if !point.DBLoggingEnabled || point.Generation == 0 {
			continue
		}
		interval, ok := historianIntervalMilliseconds(point.DBInterval)
		start, parseErr := time.Parse(time.RFC3339, point.StartAtUTC)
		if !ok || parseErr != nil {
			return fmt.Errorf("invalid maintenance policy point %s", point.PointID)
		}
		first := start.UnixMilli()
		if first < quiescedAt {
			delta := quiescedAt - first
			first += ((delta + interval - 1) / interval) * interval
		}
		if first >= anchor {
			continue
		}
		gap := HistoryGap{PointID: point.PointID, Generation: point.Generation, FromUTCMS: first, ToUTCMS: anchor, Reason: "restart", Detail: "maintenance-cutover:" + migrationID, PolicyRevision: &revision, CreatedAtUTCMS: anchor}
		if err := a.historianV2.InsertGap(ctx, gap); err != nil {
			return err
		}
		(*count)++
	}
	return nil
}
