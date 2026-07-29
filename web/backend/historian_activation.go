package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	historianActivationSchemaVersion     = 1
	activationFaultAfterPrepare          = "activation_after_prepare"
	activationFaultAfterFilesystemCommit = "activation_after_filesystem_commit"
	activationFaultAfterSQLiteActive     = "activation_after_sqlite_active"
)

var ErrHistorianActivationPending = errors.New("historian activation is prepared but not committed")

type HistorianActivationPlan struct {
	PolicyRevision    uint64
	Config            []byte
	StableUTCMS       int64
	LegacyQuiesced    bool
	MigrationVerified bool
	PruneEnabled      bool
}

type HistorianRuntimeAuthority struct {
	State               string
	PolicyRevision      uint64
	WriterV2            bool
	QueryV2             bool
	PruneEnabled        bool
	LegacyWriterAllowed bool
	ConfigSHA256        []byte
	StableUTCMS         int64
}

type historianActivationEnvelope struct {
	SchemaVersion     int    `json:"schemaVersion"`
	State             string `json:"state"`
	PolicyRevision    uint64 `json:"policyRevision"`
	ConfigSHA256      string `json:"configSha256"`
	StableUTCMS       int64  `json:"stableUtcMs"`
	LegacyQuiesced    bool   `json:"legacyQuiesced"`
	MigrationVerified bool   `json:"migrationVerified"`
	PruneEnabled      bool   `json:"pruneEnabled"`
	PreparedAtUTCMS   int64  `json:"preparedAtUtcMs"`
}

type HistorianActivationCoordinator struct {
	policyPath      string
	preparedPath    string
	metadataPath    string
	store           *HistorianStore
	now             func() time.Time
	activationFault func(string) error
}

func NewHistorianActivationCoordinator(policyPath string, store *HistorianStore) *HistorianActivationCoordinator {
	return &HistorianActivationCoordinator{
		policyPath: policyPath, preparedPath: policyPath + ".prepared", metadataPath: policyPath + ".prepared.meta",
		store: store, now: time.Now,
	}
}

func (c *HistorianActivationCoordinator) Prepare(ctx context.Context, plan HistorianActivationPlan) error {
	if c == nil || c.store == nil || c.policyPath == "" || plan.PolicyRevision == 0 || !json.Valid(plan.Config) || plan.StableUTCMS <= 0 || !plan.LegacyQuiesced {
		return fmt.Errorf("invalid historian activation plan")
	}
	digest := sha256.Sum256(plan.Config)
	envelope := historianActivationEnvelope{
		SchemaVersion: historianActivationSchemaVersion, State: "prepared", PolicyRevision: plan.PolicyRevision,
		ConfigSHA256: hex.EncodeToString(digest[:]), StableUTCMS: plan.StableUTCMS,
		LegacyQuiesced: plan.LegacyQuiesced, MigrationVerified: true, PruneEnabled: plan.PruneEnabled,
		PreparedAtUTCMS: c.now().UTC().UnixMilli(),
	}
	if envelope.PreparedAtUTCMS <= 0 {
		envelope.PreparedAtUTCMS = plan.StableUTCMS
	}
	if err := c.store.prepareHistorianActivation(ctx, envelope, digest[:]); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(c.policyPath), 0o700); err != nil {
		return fmt.Errorf("prepare historian activation directory: %w", err)
	}
	if err := writeConfigFileAtomicStrict(c.preparedPath, plan.Config, 0o600); err != nil {
		return fmt.Errorf("write prepared historian policy: %w", err)
	}
	metadata, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal historian activation metadata: %w", err)
	}
	metadata = append(metadata, '\n')
	if err := writeConfigFileAtomicStrict(c.metadataPath, metadata, 0o600); err != nil {
		return fmt.Errorf("write historian activation metadata: %w", err)
	}
	return runActivationFault(c.activationFault, activationFaultAfterPrepare)
}

func (c *HistorianActivationCoordinator) Commit(ctx context.Context) error {
	envelope, config, err := c.readPrepared()
	if err != nil {
		return err
	}
	if err := writeConfigFileAtomicStrict(c.policyPath, config, 0o600); err != nil {
		return fmt.Errorf("commit historian policy activation: %w", err)
	}
	if err := runActivationFault(c.activationFault, activationFaultAfterFilesystemCommit); err != nil {
		return err
	}
	if err := c.activatePrepared(ctx, envelope); err != nil {
		return err
	}
	if err := runActivationFault(c.activationFault, activationFaultAfterSQLiteActive); err != nil {
		return err
	}
	return c.cleanupPrepared()
}

func (c *HistorianActivationCoordinator) Reconcile(ctx context.Context) error {
	envelope, err := c.readEnvelope()
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	active, err := os.ReadFile(c.policyPath)
	if errors.Is(err, os.ErrNotExist) {
		return ErrHistorianActivationPending
	}
	if err != nil {
		return fmt.Errorf("read active historian policy during reconciliation: %w", err)
	}
	digest := sha256.Sum256(active)
	if hex.EncodeToString(digest[:]) != envelope.ConfigSHA256 {
		return ErrHistorianActivationPending
	}
	var payload struct {
		Revision uint64 `json:"revision"`
	}
	if err := json.Unmarshal(active, &payload); err != nil || payload.Revision != envelope.PolicyRevision {
		return fmt.Errorf("active historian policy does not match prepared revision")
	}
	if err := c.activatePrepared(ctx, envelope); err != nil {
		return err
	}
	return c.cleanupPrepared()
}

func (c *HistorianActivationCoordinator) Authority(ctx context.Context) (HistorianRuntimeAuthority, error) {
	if c == nil || c.store == nil {
		return HistorianRuntimeAuthority{State: "legacy", LegacyWriterAllowed: true}, nil
	}
	authority, err := c.store.historianRuntimeAuthority(ctx)
	if err != nil || !authority.WriterV2 {
		return authority, err
	}
	active, readErr := os.ReadFile(c.policyPath)
	digest := sha256.Sum256(active)
	var payload struct {
		Revision uint64 `json:"revision"`
	}
	policyValid := false
	if readErr == nil && json.Unmarshal(active, &payload) == nil {
		switch {
		case payload.Revision == authority.PolicyRevision:
			policyValid = equalBytes(digest[:], authority.ConfigSHA256)
		case payload.Revision > authority.PolicyRevision:
			policyValid = c.store.latestHistorianPolicyMirrorVerified(ctx, payload.Revision, digest[:])
		}
	}
	if !policyValid {
		authority.State = "degraded"
		authority.WriterV2 = false
		authority.QueryV2 = false
		authority.PruneEnabled = false
		authority.LegacyWriterAllowed = false
	}
	return authority, nil
}

func (s *HistorianStore) latestHistorianPolicyMirrorVerified(ctx context.Context, revision uint64, digest []byte) bool {
	if s == nil || s.db == nil || revision == 0 || len(digest) != sha256.Size {
		return false
	}
	var stored []byte
	var status string
	var latest uint64
	err := s.db.QueryRowContext(ctx, `SELECT config_sha256,mirror_status,(SELECT max(revision) FROM policy_revisions WHERE mirror_status='verified') FROM policy_revisions WHERE revision=?`, revision).Scan(&stored, &status, &latest)
	return err == nil && status == "verified" && latest == revision && equalBytes(stored, digest)
}

// AdvanceStableUTC persists an externally reconciled UTC horizon. It is
// monotonic by design; clock-jump handling must happen before this call.
func (c *HistorianActivationCoordinator) AdvanceStableUTC(ctx context.Context, stableUTCMS int64) error {
	if c == nil || c.store == nil || stableUTCMS <= 0 {
		return fmt.Errorf("invalid historian stable UTC horizon")
	}
	return c.store.AdvanceHistorianStableUTC(ctx, stableUTCMS)
}

func (c *HistorianActivationCoordinator) readPrepared() (historianActivationEnvelope, []byte, error) {
	envelope, err := c.readEnvelope()
	if err != nil {
		return historianActivationEnvelope{}, nil, err
	}
	config, err := os.ReadFile(c.preparedPath)
	if err != nil {
		return historianActivationEnvelope{}, nil, fmt.Errorf("read prepared historian policy: %w", err)
	}
	digest := sha256.Sum256(config)
	if hex.EncodeToString(digest[:]) != envelope.ConfigSHA256 {
		return historianActivationEnvelope{}, nil, fmt.Errorf("prepared historian policy checksum mismatch")
	}
	return envelope, config, nil
}

func (c *HistorianActivationCoordinator) readEnvelope() (historianActivationEnvelope, error) {
	var envelope historianActivationEnvelope
	data, err := os.ReadFile(c.metadataPath)
	if err != nil {
		return envelope, err
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return envelope, fmt.Errorf("parse historian activation metadata: %w", err)
	}
	if envelope.SchemaVersion != historianActivationSchemaVersion || envelope.State != "prepared" || envelope.PolicyRevision == 0 || envelope.StableUTCMS <= 0 || !envelope.LegacyQuiesced || !envelope.MigrationVerified {
		return envelope, fmt.Errorf("invalid historian activation metadata")
	}
	if digest, err := hex.DecodeString(envelope.ConfigSHA256); err != nil || len(digest) != sha256.Size {
		return envelope, fmt.Errorf("invalid historian activation checksum")
	}
	return envelope, nil
}

func (c *HistorianActivationCoordinator) activatePrepared(ctx context.Context, envelope historianActivationEnvelope) error {
	digest, _ := hex.DecodeString(envelope.ConfigSHA256)
	proof := HistorianActivationProof{
		PolicyRevision: envelope.PolicyRevision, ConfigSHA256: digest, StableUTCMS: envelope.StableUTCMS,
		WriterAuthority: "v2", LegacyQuiesced: envelope.LegacyQuiesced, MigrationVerified: envelope.MigrationVerified,
		PruneEnabled: envelope.PruneEnabled, ReconciledAtUTCMS: c.now().UTC().UnixMilli(),
	}
	if proof.ReconciledAtUTCMS < proof.StableUTCMS {
		proof.ReconciledAtUTCMS = proof.StableUTCMS
	}
	return c.store.activatePreparedHistorian(ctx, proof)
}

func (c *HistorianActivationCoordinator) cleanupPrepared() error {
	for _, path := range []string{c.preparedPath, c.metadataPath} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove historian activation evidence %s: %w", path, err)
		}
	}
	if err := syncDirectory(filepath.Dir(c.policyPath)); err != nil {
		return fmt.Errorf("sync historian activation directory: %w", err)
	}
	return nil
}

func (s *HistorianStore) prepareHistorianActivation(ctx context.Context, envelope historianActivationEnvelope, digest []byte) error {
	var stored []byte
	var status string
	if err := s.db.QueryRowContext(ctx, `SELECT config_sha256,mirror_status FROM policy_revisions WHERE revision=?`, envelope.PolicyRevision).Scan(&stored, &status); err != nil {
		return fmt.Errorf("read prepared policy revision: %w", err)
	}
	if status != "verified" || !equalBytes(stored, digest) {
		return fmt.Errorf("prepared historian policy revision is not verified")
	}
	if err := s.historianCutoverEvidenceValid(ctx, envelope.PolicyRevision, digest); err != nil {
		return fmt.Errorf("prepared historian policy has no durable cutover evidence: %w", err)
	}
	var activeRevision uint64
	err := s.db.QueryRowContext(ctx, `SELECT policy_revision FROM historian_activation WHERE singleton=1 AND state='active'`).Scan(&activeRevision)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("read active historian revision: %w", err)
	}
	if err == nil && envelope.PolicyRevision <= activeRevision {
		return fmt.Errorf("historian activation revision must advance")
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO historian_activation(singleton,policy_revision,config_sha256,state,writer_authority,legacy_quiesced,migration_verified,prune_enabled,stable_utc_ms,reconciled_at_utc_ms) VALUES(1,?,?,'prepared','legacy',0,?,0,?,?) ON CONFLICT(singleton) DO UPDATE SET policy_revision=excluded.policy_revision,config_sha256=excluded.config_sha256,state='prepared',writer_authority='legacy',legacy_quiesced=0,migration_verified=excluded.migration_verified,prune_enabled=0,stable_utc_ms=excluded.stable_utc_ms,reconciled_at_utc_ms=excluded.reconciled_at_utc_ms`, envelope.PolicyRevision, digest, boolToInt(envelope.MigrationVerified), envelope.StableUTCMS, envelope.PreparedAtUTCMS)
	if err != nil {
		return fmt.Errorf("persist prepared historian activation: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `PRAGMA wal_checkpoint(FULL)`); err != nil {
		return fmt.Errorf("checkpoint prepared historian activation: %w", err)
	}
	return nil
}

func (s *HistorianStore) activatePreparedHistorian(ctx context.Context, proof HistorianActivationProof) error {
	var revision uint64
	var digest []byte
	var state string
	if err := s.db.QueryRowContext(ctx, `SELECT policy_revision,config_sha256,state FROM historian_activation WHERE singleton=1`).Scan(&revision, &digest, &state); err != nil {
		return fmt.Errorf("read prepared historian activation: %w", err)
	}
	if revision != proof.PolicyRevision || !equalBytes(digest, proof.ConfigSHA256) || (state != "prepared" && state != "active") {
		return fmt.Errorf("prepared historian activation mismatch")
	}
	if state == "active" {
		return nil
	}
	return s.RecordReconciledHistorianActivation(ctx, proof)
}

func (s *HistorianStore) historianRuntimeAuthority(ctx context.Context) (HistorianRuntimeAuthority, error) {
	var authority HistorianRuntimeAuthority
	var state, writer string
	var legacyQuiesced, migrationVerified, pruneEnabled int
	err := s.db.QueryRowContext(ctx, `SELECT state,policy_revision,config_sha256,writer_authority,legacy_quiesced,migration_verified,prune_enabled,stable_utc_ms FROM historian_activation WHERE singleton=1`).Scan(&state, &authority.PolicyRevision, &authority.ConfigSHA256, &writer, &legacyQuiesced, &migrationVerified, &pruneEnabled, &authority.StableUTCMS)
	if err == sql.ErrNoRows {
		return HistorianRuntimeAuthority{State: "legacy", LegacyWriterAllowed: true}, nil
	}
	if err != nil {
		return authority, fmt.Errorf("read historian runtime authority: %w", err)
	}
	authority.State = state
	authority.LegacyWriterAllowed = state == "prepared"
	authority.WriterV2 = state == "active" && writer == "v2" && legacyQuiesced == 1 && migrationVerified == 1
	if authority.WriterV2 {
		if err := s.historianCutoverEvidenceValid(ctx, authority.PolicyRevision, authority.ConfigSHA256); err != nil {
			authority.WriterV2 = false
		}
	}
	authority.QueryV2 = authority.WriterV2
	authority.PruneEnabled = authority.WriterV2 && pruneEnabled == 1
	return authority, nil
}

func (s *HistorianStore) AdvanceHistorianStableUTC(ctx context.Context, stableUTCMS int64) error {
	if stableUTCMS <= 0 {
		return fmt.Errorf("stable UTC horizon must be positive")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE historian_activation SET stable_utc_ms=?,reconciled_at_utc_ms=? WHERE singleton=1 AND state='active' AND stable_utc_ms<=?`, stableUTCMS, stableUTCMS, stableUTCMS)
	if err != nil {
		return fmt.Errorf("advance historian stable UTC: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read historian stable UTC update: %w", err)
	}
	if changed == 0 {
		var current int64
		err := s.db.QueryRowContext(ctx, `SELECT stable_utc_ms FROM historian_activation WHERE singleton=1 AND state='active'`).Scan(&current)
		if err == sql.ErrNoRows {
			return ErrHistorianRetentionDeferred
		}
		if err != nil {
			return fmt.Errorf("read historian stable UTC: %w", err)
		}
		if stableUTCMS < current {
			return fmt.Errorf("historian stable UTC moved backwards")
		}
	}
	return nil
}

func runActivationFault(fault func(string) error, stage string) error {
	if fault == nil {
		return nil
	}
	return fault(stage)
}
