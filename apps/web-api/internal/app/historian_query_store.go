package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	historianQueryStoreDefaultMaxRows   = 100_000
	historianQueryStoreDefaultMaxBlocks = 1024
	historianQueryStoreMaxIdentities    = 1024
)

var ErrHistorianQueryReadLimit = errors.New("historian query tier read limit exceeded")

type HistorianStorageFrontier struct {
	PointID                  string
	Generation               uint64
	ArchiveOriginUTCMS       int64
	ArchiveCoveredUntilUTCMS int64
	HotCoveredUntilUTCMS     int64
	HasArchive               bool
	HasHot                   bool
}

type HistorianArchiveIssue struct {
	BlockID   string
	FromUTCMS int64
	ToUTCMS   int64
	Err       error
}

type HistorianArchiveReadError struct {
	Issues []HistorianArchiveIssue
}

func (e *HistorianArchiveReadError) Error() string {
	if e == nil || len(e.Issues) == 0 {
		return "historian archive read failed"
	}
	return fmt.Sprintf("historian archive read failed for %d block(s): %v", len(e.Issues), e.Issues[0].Err)
}

func (e *HistorianArchiveReadError) Unwrap() error {
	if e == nil || len(e.Issues) == 0 {
		return nil
	}
	return e.Issues[0].Err
}

type HistorianQueryStoreBackend struct {
	store      *HistorianStore
	ram        *HistorianRAMCache
	trendCache *HistorianTrendCache
	archiveDir string
	maxRows    int
	maxBlocks  int
}

func NewHistorianQueryStoreBackend(store *HistorianStore, ram *HistorianRAMCache, archiveDir string) (*HistorianQueryStoreBackend, error) {
	if store == nil || store.db == nil {
		return nil, fmt.Errorf("historian query store is required")
	}
	absArchiveDir := ""
	if archiveDir != "" {
		var err error
		absArchiveDir, err = filepath.Abs(archiveDir)
		if err != nil {
			return nil, fmt.Errorf("resolve historian archive directory: %w", err)
		}
	}
	return &HistorianQueryStoreBackend{
		store:      store,
		ram:        ram,
		archiveDir: absArchiveDir,
		maxRows:    historianQueryStoreDefaultMaxRows,
		maxBlocks:  historianQueryStoreDefaultMaxBlocks,
	}, nil
}

func (b *HistorianQueryStoreBackend) Frontiers(ctx context.Context, identities []HistorianQueryIdentity) ([]HistorianStorageFrontier, error) {
	if b == nil || b.store == nil || b.store.db == nil {
		return nil, fmt.Errorf("historian query store unavailable")
	}
	if len(identities) > historianQueryStoreMaxIdentities {
		return nil, fmt.Errorf("historian frontiers: %w", ErrHistorianQueryReadLimit)
	}
	result := make([]HistorianStorageFrontier, 0, len(identities))
	for _, identity := range identities {
		if err := validateHistorianQueryIdentity(identity); err != nil {
			return nil, err
		}
		frontier := HistorianStorageFrontier{PointID: identity.PointID, Generation: identity.Generation}
		err := b.store.db.QueryRowContext(ctx, `SELECT w.origin_utc_ms,w.covered_until_utc_ms
			FROM archive_watermarks w
			JOIN archive_blocks block ON block.block_id=w.block_id
				AND block.point_id=w.point_id AND block.generation=w.generation
				AND block.to_utc_ms=w.covered_until_utc_ms AND block.state='committed'
			WHERE w.point_id=? AND w.generation=?`, identity.PointID, identity.Generation).Scan(&frontier.ArchiveOriginUTCMS, &frontier.ArchiveCoveredUntilUTCMS)
		if err == nil {
			frontier.HasArchive = true
		} else if err != sql.ErrNoRows {
			return nil, fmt.Errorf("read historian archive frontier for %s generation %d: %w", identity.PointID, identity.Generation, err)
		}
		// Scan into a local nullable value because MAX over an empty set is NULL.
		var hot sql.NullInt64
		err = b.store.db.QueryRowContext(ctx, `SELECT MAX(covered_until_utc_ms) FROM (
			SELECT bucket_utc_ms + 15000 AS covered_until_utc_ms FROM hot_samples WHERE point_id=? AND generation=?
			UNION ALL
			SELECT to_utc_ms AS covered_until_utc_ms FROM history_gaps WHERE point_id=? AND generation=?
		)`, identity.PointID, identity.Generation, identity.PointID, identity.Generation).Scan(&hot)
		if err != nil {
			return nil, fmt.Errorf("read historian hot frontier for %s generation %d: %w", identity.PointID, identity.Generation, err)
		}
		if hot.Valid {
			frontier.HotCoveredUntilUTCMS = hot.Int64
			frontier.HasHot = true
		}
		result = append(result, frontier)
	}
	return result, nil
}

func validateHistorianQueryIdentity(identity HistorianQueryIdentity) error {
	if identity.PointID == "" || identity.Generation == 0 {
		return fmt.Errorf("invalid historian query identity")
	}
	return nil
}

func validateHistorianQueryReadRange(fromUTCMS, toUTCMS int64) error {
	if fromUTCMS < 0 || toUTCMS <= fromUTCMS {
		return fmt.Errorf("invalid historian query range")
	}
	return nil
}

func historianQueryPlaceholders(count int) string {
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

type historianArchiveMetadata struct {
	blockID       string
	pointID       string
	generation    uint64
	fromUTCMS     int64
	toUTCMS       int64
	codec         string
	fileName      string
	byteSize      int64
	sampleCount   int
	gapCount      int
	payloadSHA256 []byte
}

func (b *HistorianQueryStoreBackend) readArchiveFile(metadata historianArchiveMetadata) (ArchiveBlock, error) {
	if b.archiveDir == "" {
		return ArchiveBlock{}, fmt.Errorf("historian archive directory unavailable")
	}
	if metadata.codec != "mkhab-v1" || metadata.byteSize < archiveHeaderSize+archiveTrailerSize || metadata.byteSize > archiveMaxBytes || metadata.sampleCount < 0 || metadata.sampleCount > archiveMaxRows || metadata.gapCount < 0 || metadata.gapCount > archiveMaxGaps || len(metadata.payloadSHA256) != sha256.Size {
		return ArchiveBlock{}, fmt.Errorf("invalid committed archive metadata")
	}
	if !filepath.IsLocal(metadata.fileName) || filepath.Base(metadata.fileName) != metadata.fileName || metadata.fileName != metadata.blockID+".mkhab" {
		return ArchiveBlock{}, fmt.Errorf("unsafe committed archive file name")
	}
	path := filepath.Join(b.archiveDir, metadata.fileName)
	info, err := os.Lstat(path)
	if err != nil {
		return ArchiveBlock{}, fmt.Errorf("stat committed archive file: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() != metadata.byteSize {
		return ArchiveBlock{}, fmt.Errorf("committed archive file metadata mismatch")
	}
	file, err := os.Open(path)
	if err != nil {
		return ArchiveBlock{}, fmt.Errorf("open committed archive file: %w", err)
	}
	openedInfo, statErr := file.Stat()
	if statErr != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) || openedInfo.Size() != metadata.byteSize {
		file.Close()
		return ArchiveBlock{}, fmt.Errorf("committed archive file changed while opening")
	}
	data, readErr := io.ReadAll(io.LimitReader(file, archiveMaxBytes+1))
	closeErr := file.Close()
	if readErr != nil {
		return ArchiveBlock{}, fmt.Errorf("read committed archive file: %w", readErr)
	}
	if closeErr != nil {
		return ArchiveBlock{}, fmt.Errorf("close committed archive file: %w", closeErr)
	}
	if len(data) != int(metadata.byteSize) || len(data) > archiveMaxBytes || len(data) < archiveTrailerSize {
		return ArchiveBlock{}, fmt.Errorf("committed archive file size changed")
	}
	digest := sha256.Sum256(data[:len(data)-archiveTrailerSize])
	if !equalBytes(digest[:], metadata.payloadSHA256) || hex.EncodeToString(digest[:]) != metadata.blockID {
		return ArchiveBlock{}, fmt.Errorf("committed archive metadata checksum mismatch")
	}
	block, err := DecodeArchiveBlock(data)
	if err != nil {
		return ArchiveBlock{}, err
	}
	if block.PointID != metadata.pointID || block.Generation != metadata.generation || block.StartUTCMS != metadata.fromUTCMS || block.StartUTCMS+archiveDayMS != metadata.toUTCMS || len(block.Rows) != metadata.sampleCount || len(block.Gaps) != metadata.gapCount {
		return ArchiveBlock{}, fmt.Errorf("committed archive decoded metadata mismatch")
	}
	return block, nil
}

func clampHistorianQueryGap(gap HistorianQueryGap, fromUTCMS, toUTCMS int64) (HistorianQueryGap, bool) {
	if gap.FromUTCMS < fromUTCMS {
		gap.FromUTCMS = fromUTCMS
	}
	if gap.ToUTCMS > toUTCMS {
		gap.ToUTCMS = toUTCMS
	}
	return gap, gap.FromUTCMS < gap.ToUTCMS
}

func sortHistorianQueryIdentities(identities []HistorianQueryIdentity) {
	sort.Slice(identities, func(i, j int) bool {
		if identities[i].PointID != identities[j].PointID {
			return identities[i].PointID < identities[j].PointID
		}
		return identities[i].Generation < identities[j].Generation
	})
}

func (b *HistorianQueryStoreBackend) Identities(ctx context.Context, pointIDs []string, fromUTCMS, toUTCMS int64, source string) ([]HistorianQueryIdentity, error) {
	if b == nil || b.store == nil || b.store.db == nil {
		return nil, fmt.Errorf("historian query store unavailable")
	}
	if err := validateHistorianQueryReadRange(fromUTCMS, toUTCMS); err != nil {
		return nil, err
	}
	if len(pointIDs) > 8 {
		return nil, fmt.Errorf("historian query supports at most 8 point ids")
	}
	ids := make(map[HistorianQueryIdentity]struct{})
	for _, pointID := range pointIDs {
		if pointID == "" {
			return nil, fmt.Errorf("invalid historian query point id")
		}
	}
	if source == "cache" && b.trendCache != nil {
		for _, identity := range b.trendCache.Identities(pointIDs, fromUTCMS, toUTCMS) {
			ids[identity] = struct{}{}
		}
		if len(ids) > historianQueryStoreMaxIdentities {
			return nil, fmt.Errorf("historian identities: %w", ErrHistorianQueryReadLimit)
		}
	}
	if b.ram != nil {
		ramIDs, err := b.ram.Identities(ctx, pointIDs, fromUTCMS, toUTCMS, historianQueryStoreMaxIdentities-len(ids))
		if err != nil {
			return nil, fmt.Errorf("historian identities: %w", ErrHistorianQueryReadLimit)
		}
		for _, identity := range ramIDs {
			ids[identity] = struct{}{}
		}
	}
	selectedArgs := make([]any, 0, len(pointIDs))
	filter := ""
	if len(pointIDs) > 0 {
		filter = " AND point_id IN (" + historianQueryPlaceholders(len(pointIDs)) + ")"
		for _, pointID := range pointIDs {
			selectedArgs = append(selectedArgs, pointID)
		}
	}
	type identityQuery struct {
		statement string
		args      []any
	}
	rangeArgs := append([]any{toUTCMS, fromUTCMS}, selectedArgs...)
	policyArgs := append([]any{toUTCMS}, selectedArgs...)
	queries := []identityQuery{
		{"SELECT DISTINCT point_id,generation FROM hot_samples WHERE bucket_utc_ms < ? AND bucket_utc_ms + 15000 > ?" + filter, rangeArgs},
		{"SELECT DISTINCT point_id,generation FROM history_gaps WHERE from_utc_ms < ? AND to_utc_ms > ?" + filter, rangeArgs},
		{"SELECT DISTINCT point_id,generation FROM archive_blocks WHERE state='committed' AND from_utc_ms < ? AND to_utc_ms > ?" + filter, rangeArgs},
		{"SELECT DISTINCT point_id,generation FROM point_policies WHERE enabled=1 AND start_utc_ms < ?" + filter, policyArgs},
	}
	var discoveryErrors []error
	for _, query := range queries {
		rows, err := b.store.db.QueryContext(ctx, query.statement, query.args...)
		if err != nil {
			discoveryErrors = append(discoveryErrors, fmt.Errorf("discover historian identities: %w", err))
			continue
		}
		failed := false
		for rows.Next() {
			var id HistorianQueryIdentity
			if err := rows.Scan(&id.PointID, &id.Generation); err != nil {
				discoveryErrors = append(discoveryErrors, fmt.Errorf("scan historian identity: %w", err))
				failed = true
				break
			}
			ids[id] = struct{}{}
			if len(ids) > historianQueryStoreMaxIdentities {
				rows.Close()
				return nil, fmt.Errorf("historian identities: %w", ErrHistorianQueryReadLimit)
			}
		}
		if !failed {
			if err := rows.Err(); err != nil {
				discoveryErrors = append(discoveryErrors, fmt.Errorf("read historian identities: %w", err))
			}
		}
		rows.Close()
	}
	if len(ids) == 0 && len(discoveryErrors) > 0 {
		return nil, errors.Join(discoveryErrors...)
	}
	result := make([]HistorianQueryIdentity, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	sortHistorianQueryIdentities(result)
	return result, nil
}

func historianQueryPointSelected(pointIDs []string, pointID string) bool {
	for _, selected := range pointIDs {
		if selected == pointID {
			return true
		}
	}
	return false
}

func (b *HistorianQueryStoreBackend) readRAMIdentity(ctx context.Context, identity HistorianQueryIdentity, fromUTCMS, toUTCMS int64) ([]HistorianRawSample, error) {
	if b.ram == nil {
		return nil, fmt.Errorf("historian RAM tier unavailable")
	}
	result, limited, err := b.ram.RawHalfOpen(ctx, identity.PointID, identity.Generation, fromUTCMS, toUTCMS, b.maxRows)
	if err != nil {
		return result, err
	}
	if limited {
		return result, fmt.Errorf("RAM: %w", ErrHistorianQueryReadLimit)
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].ObservedUTCMS < result[j].ObservedUTCMS })
	return result, nil
}

func (b *HistorianQueryStoreBackend) readHotIdentity(ctx context.Context, identity HistorianQueryIdentity, fromUTCMS, toUTCMS int64) ([]HotSample, error) {
	rows, err := b.store.db.QueryContext(ctx, `SELECT point_id,generation,bucket_utc_ms,last_sample_utc_ms,value,min_value,max_value,sum_value,sample_count,worst_quality,source,policy_revision
		FROM hot_samples WHERE point_id=? AND generation=? AND bucket_utc_ms < ? AND bucket_utc_ms + 15000 > ? ORDER BY bucket_utc_ms`, identity.PointID, identity.Generation, toUTCMS, fromUTCMS)
	if err != nil {
		return nil, fmt.Errorf("read historian hot samples: %w", err)
	}
	defer rows.Close()
	result := make([]HotSample, 0)
	for rows.Next() {
		var row HotSample
		if err := rows.Scan(&row.PointID, &row.Generation, &row.BucketUTCMS, &row.LastSampleUTCMS, &row.Value, &row.Min, &row.Max, &row.Sum, &row.Count, &row.WorstQuality, &row.Source, &row.PolicyRevision); err != nil {
			return result, fmt.Errorf("scan historian hot sample: %w", err)
		}
		if row.BucketUTCMS >= fromUTCMS && row.BucketUTCMS < toUTCMS {
			result = append(result, row)
			if len(result) > b.maxRows {
				return result[:b.maxRows], fmt.Errorf("hot: %w", ErrHistorianQueryReadLimit)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return result, fmt.Errorf("read historian hot samples: %w", err)
	}
	return result, nil
}

func (b *HistorianQueryStoreBackend) readGapsIdentity(ctx context.Context, identity HistorianQueryIdentity, fromUTCMS, toUTCMS int64) ([]HistorianQueryGap, error) {
	rows, err := b.store.db.QueryContext(ctx, `SELECT point_id,generation,from_utc_ms,to_utc_ms,reason,detail
		FROM history_gaps WHERE point_id=? AND generation=? AND from_utc_ms < ? AND to_utc_ms > ? ORDER BY from_utc_ms,to_utc_ms,gap_id`, identity.PointID, identity.Generation, toUTCMS, fromUTCMS)
	if err != nil {
		return nil, fmt.Errorf("read historian gaps: %w", err)
	}
	defer rows.Close()
	result := make([]HistorianQueryGap, 0)
	for rows.Next() {
		var gap HistorianQueryGap
		if err := rows.Scan(&gap.PointID, &gap.Generation, &gap.FromUTCMS, &gap.ToUTCMS, &gap.Reason, &gap.Detail); err != nil {
			return result, fmt.Errorf("scan historian gap: %w", err)
		}
		gap.Reason = historianQueryGapReason(gap.Reason)
		if gap, ok := clampHistorianQueryGap(gap, fromUTCMS, toUTCMS); ok {
			result = append(result, gap)
			if len(result) > b.maxRows {
				return result[:b.maxRows], fmt.Errorf("gaps: %w", ErrHistorianQueryReadLimit)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return result, fmt.Errorf("read historian gaps: %w", err)
	}
	return result, nil
}

func (b *HistorianQueryStoreBackend) readArchiveIdentity(ctx context.Context, identity HistorianQueryIdentity, fromUTCMS, toUTCMS int64) ([]ArchiveRow, []HistorianQueryGap, bool, error) {
	b.store.archiveMu.RLock()
	defer b.store.archiveMu.RUnlock()
	rows, err := b.store.db.QueryContext(ctx, `SELECT block_id,point_id,generation,from_utc_ms,to_utc_ms,codec,file_name,byte_size,sample_count,gap_count,payload_sha256
		FROM archive_blocks block
		WHERE block.point_id=? AND block.generation=? AND block.state='committed'
			AND block.from_utc_ms < ? AND block.to_utc_ms > ?
			AND EXISTS (SELECT 1 FROM archive_watermarks watermark
				WHERE watermark.point_id=block.point_id AND watermark.generation=block.generation
					AND block.from_utc_ms >= watermark.origin_utc_ms AND block.to_utc_ms <= watermark.covered_until_utc_ms)
		ORDER BY block.from_utc_ms LIMIT ?`, identity.PointID, identity.Generation, toUTCMS, fromUTCMS, b.maxBlocks+1)
	if err != nil {
		return nil, nil, false, fmt.Errorf("read committed archive metadata: %w", err)
	}
	metadata := make([]historianArchiveMetadata, 0)
	for rows.Next() {
		var item historianArchiveMetadata
		if err := rows.Scan(&item.blockID, &item.pointID, &item.generation, &item.fromUTCMS, &item.toUTCMS, &item.codec, &item.fileName, &item.byteSize, &item.sampleCount, &item.gapCount, &item.payloadSHA256); err != nil {
			rows.Close()
			return nil, nil, false, fmt.Errorf("scan committed archive metadata: %w", err)
		}
		metadata = append(metadata, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, nil, false, fmt.Errorf("read committed archive metadata: %w", err)
	}
	rows.Close()
	if len(metadata) > b.maxBlocks {
		return nil, nil, false, fmt.Errorf("archive blocks: %w", ErrHistorianQueryReadLimit)
	}
	resultRows := make([]ArchiveRow, 0)
	resultGaps := make([]HistorianQueryGap, 0)
	issues := make([]HistorianArchiveIssue, 0)
	trusted := len(metadata) == 0
	for _, item := range metadata {
		if err := ctx.Err(); err != nil {
			return resultRows, resultGaps, trusted, err
		}
		block, err := b.readArchiveFile(item)
		if err != nil {
			issues = append(issues, HistorianArchiveIssue{BlockID: item.blockID, FromUTCMS: item.fromUTCMS, ToUTCMS: item.toUTCMS, Err: err})
			continue
		}
		trusted = true
		for _, row := range block.Rows {
			if row.BucketUTCMS >= fromUTCMS && row.BucketUTCMS < toUTCMS {
				resultRows = append(resultRows, row)
				if len(resultRows)+len(resultGaps) > b.maxRows {
					return resultRows[:max(0, b.maxRows-len(resultGaps))], resultGaps, trusted, fmt.Errorf("archive: %w", ErrHistorianQueryReadLimit)
				}
			}
		}
		for _, archived := range block.Gaps {
			gap := HistorianQueryGap{PointID: identity.PointID, Generation: identity.Generation, FromUTCMS: archived.FromUTCMS, ToUTCMS: archived.ToUTCMS, Reason: historianQueryGapReason(archived.Reason), Detail: archived.Detail}
			if gap, ok := clampHistorianQueryGap(gap, fromUTCMS, toUTCMS); ok {
				resultGaps = append(resultGaps, gap)
				if len(resultRows)+len(resultGaps) > b.maxRows {
					return resultRows, resultGaps[:max(0, b.maxRows-len(resultRows))], trusted, fmt.Errorf("archive: %w", ErrHistorianQueryReadLimit)
				}
			}
		}
	}
	if len(issues) > 0 {
		return resultRows, resultGaps, trusted, &HistorianArchiveReadError{Issues: issues}
	}
	return resultRows, resultGaps, trusted, nil
}

func historianQueryGapReason(reason string) string {
	switch reason {
	case "snapshot":
		return "runtime"
	case "storage":
		return "sqlite"
	case "corruption":
		return "disk"
	default:
		return reason
	}
}

func (b *HistorianQueryStoreBackend) ReadTier(ctx context.Context, tier HistorianTier, identities []HistorianQueryIdentity, fromUTCMS, toUTCMS int64) (HistorianTierRead, error) {
	read := HistorianTierRead{Tier: tier}
	if b == nil || b.store == nil || b.store.db == nil {
		return read, fmt.Errorf("historian query store unavailable")
	}
	if err := validateHistorianQueryReadRange(fromUTCMS, toUTCMS); err != nil {
		return read, err
	}
	if len(identities) > historianQueryStoreMaxIdentities {
		return read, fmt.Errorf("historian tier identities: %w", ErrHistorianQueryReadLimit)
	}
	for _, identity := range identities {
		if err := validateHistorianQueryIdentity(identity); err != nil {
			return read, err
		}
	}
	read.CoverageFromUTCMS, read.CoverageToUTCMS = fromUTCMS, toUTCMS
	var readErrors []error
	switch tier {
	case HistorianTierCache:
		if b.trendCache == nil {
			return read, fmt.Errorf("historian trend cache unavailable")
		}
		read = b.trendCache.Read(identities, fromUTCMS, toUTCMS)
		if err := b.enforceReadBudget(&read); err != nil {
			readErrors = append(readErrors, err)
		}
	case HistorianTierRAM:
		if b.ram == nil {
			return read, fmt.Errorf("historian RAM tier unavailable")
		}
		read.Available = true
		read.CoverageFromUTCMS, read.CoverageToUTCMS = b.ramCoverage(identities)
		for _, identity := range identities {
			rows, err := b.readRAMIdentity(ctx, identity, fromUTCMS, toUTCMS)
			for _, row := range rows {
				read.Rows = append(read.Rows, HistorianAggregateRow{
					PointID: identity.PointID, Generation: identity.Generation,
					BucketUTCMS: row.ObservedUTCMS, LastSampleUTCMS: row.ObservedUTCMS,
					Value: row.Value, Min: row.Value, Max: row.Value, Sum: row.Value,
					Count: 1, Quality: row.Quality, Source: row.Source, Tier: HistorianTierRAM,
				})
			}
			if err != nil {
				readErrors = append(readErrors, err)
			}
			if err := b.enforceReadBudget(&read); err != nil {
				readErrors = append(readErrors, err)
				break
			}
		}
	case HistorianTierHot:
		trustedAny := len(identities) == 0
		for _, identity := range identities {
			rows, err := b.readHotIdentity(ctx, identity, fromUTCMS, toUTCMS)
			trustedAny = trustedAny || err == nil
			for _, row := range rows {
				read.Rows = append(read.Rows, HistorianAggregateRow{
					PointID: row.PointID, Generation: row.Generation,
					BucketUTCMS: row.BucketUTCMS, LastSampleUTCMS: row.LastSampleUTCMS,
					Value: row.Value, Min: row.Min, Max: row.Max, Sum: row.Sum,
					Count: row.Count, Quality: row.WorstQuality, Source: row.Source, Tier: HistorianTierHot,
				})
			}
			if err != nil {
				readErrors = append(readErrors, err)
			}
			gaps, gapErr := b.readGapsIdentity(ctx, identity, fromUTCMS, toUTCMS)
			trustedAny = trustedAny || gapErr == nil
			read.Gaps = append(read.Gaps, gaps...)
			if gapErr != nil {
				readErrors = append(readErrors, gapErr)
			}
			if err := b.enforceReadBudget(&read); err != nil {
				readErrors = append(readErrors, err)
				break
			}
		}
		read.Available = trustedAny
	case HistorianTierArchive:
		if b.archiveDir == "" {
			return read, fmt.Errorf("historian archive tier unavailable")
		}
		read.Available = true
		trustedAny := len(identities) == 0
		for _, identity := range identities {
			rows, gaps, trusted, err := b.readArchiveIdentity(ctx, identity, fromUTCMS, toUTCMS)
			trustedAny = trustedAny || trusted
			for _, row := range rows {
				read.Rows = append(read.Rows, HistorianAggregateRow{
					PointID: identity.PointID, Generation: identity.Generation,
					BucketUTCMS: row.BucketUTCMS, LastSampleUTCMS: row.BucketUTCMS,
					Value: row.Value, Min: row.Min, Max: row.Max, Sum: row.Sum,
					Count: int(row.Count), Quality: int(row.Quality), Source: row.Source, Tier: HistorianTierArchive,
				})
			}
			read.Gaps = append(read.Gaps, gaps...)
			if err != nil {
				readErrors = append(readErrors, err)
			}
			if err := b.enforceReadBudget(&read); err != nil {
				readErrors = append(readErrors, err)
				break
			}
		}
		read.Available = trustedAny
		if frontiers, err := b.Frontiers(ctx, identities); err != nil {
			readErrors = append(readErrors, err)
		} else {
			read.CoverageFromUTCMS, read.CoverageToUTCMS = historianArchiveCoverage(frontiers)
		}
	default:
		return read, fmt.Errorf("invalid historian query tier %q", tier)
	}
	sort.SliceStable(read.Rows, func(i, j int) bool {
		if read.Rows[i].PointID != read.Rows[j].PointID {
			return read.Rows[i].PointID < read.Rows[j].PointID
		}
		if read.Rows[i].Generation != read.Rows[j].Generation {
			return read.Rows[i].Generation < read.Rows[j].Generation
		}
		return read.Rows[i].BucketUTCMS < read.Rows[j].BucketUTCMS
	})
	sort.SliceStable(read.Gaps, func(i, j int) bool {
		if read.Gaps[i].PointID != read.Gaps[j].PointID {
			return read.Gaps[i].PointID < read.Gaps[j].PointID
		}
		if read.Gaps[i].Generation != read.Gaps[j].Generation {
			return read.Gaps[i].Generation < read.Gaps[j].Generation
		}
		if read.Gaps[i].FromUTCMS != read.Gaps[j].FromUTCMS {
			return read.Gaps[i].FromUTCMS < read.Gaps[j].FromUTCMS
		}
		return read.Gaps[i].ToUTCMS < read.Gaps[j].ToUTCMS
	})
	return read, errors.Join(readErrors...)
}

func (b *HistorianQueryStoreBackend) enforceReadBudget(read *HistorianTierRead) error {
	if len(read.Rows)+len(read.Gaps) <= b.maxRows {
		return nil
	}
	remainingRows := b.maxRows - min(len(read.Gaps), b.maxRows)
	if len(read.Rows) > remainingRows {
		read.Rows = read.Rows[:remainingRows]
	}
	remainingGaps := b.maxRows - len(read.Rows)
	if len(read.Gaps) > remainingGaps {
		read.Gaps = read.Gaps[:remainingGaps]
	}
	return fmt.Errorf("%s: %w", read.Tier, ErrHistorianQueryReadLimit)
}

func (b *HistorianQueryStoreBackend) ramCoverage(identities []HistorianQueryIdentity) (int64, int64) {
	if b.ram == nil {
		return 0, 0
	}
	return b.ram.Coverage(identities)
}

func historianArchiveCoverage(frontiers []HistorianStorageFrontier) (int64, int64) {
	if len(frontiers) == 0 {
		return 0, 0
	}
	var from, to int64
	for index, frontier := range frontiers {
		if !frontier.HasArchive {
			return 0, 0
		}
		if index == 0 || frontier.ArchiveOriginUTCMS > from {
			from = frontier.ArchiveOriginUTCMS
		}
		if index == 0 || frontier.ArchiveCoveredUntilUTCMS < to {
			to = frontier.ArchiveCoveredUntilUTCMS
		}
	}
	if to < from {
		return 0, 0
	}
	return from, to
}
