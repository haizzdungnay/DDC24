package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"time"
	"unicode/utf8"
)

const (
	archiveHeaderSize  = 56
	archiveTrailerSize = 32
	archiveRowSize     = 42
	archiveBucketMS    = int64(15000)
	archiveDayMS       = int64(24 * 60 * 60 * 1000)
	archiveMaxRows     = 5760
	archiveMaxGaps     = 5760
	archiveMaxBytes    = 320 << 10
	archiveMaxDetail   = 1024
)

const (
	archiveFaultAfterReservation   = "after-reservation"
	archiveFaultAfterTempWrite     = "after-temp-write"
	archiveFaultAfterTempSync      = "after-temp-sync"
	archiveFaultAfterLink          = "after-link"
	archiveFaultAfterVerification  = "after-verification"
	archiveFaultAfterTempUnlink    = "after-temp-unlink"
	archiveFaultAfterDirectorySync = "after-directory-sync"
	archiveFaultAfterVerifiedState = "after-verified-state"
	archiveFaultAfterWatermark     = "after-watermark"
	archiveFaultBeforeCommit       = "before-commit"
	archiveFaultAfterCommit        = "after-commit"
)

var archiveMagic = [8]byte{'M', 'K', 'H', 'A', 'B', 'L', 'K', 0}

type ArchiveRow struct {
	BucketUTCMS int64
	Value       float64
	Min         float64
	Max         float64
	Sum         float64
	Count       uint32
	Quality     uint8
	Source      string
}

type ArchiveBlock struct {
	PointID           string
	Generation        uint64
	StartUTCMS        int64
	StableCutoffUTCMS int64
	Rows              []ArchiveRow
	Gaps              []ArchiveGap
}

type ArchiveGap struct {
	FromUTCMS int64
	ToUTCMS   int64
	Reason    string
	Detail    string
}

func EncodeArchiveBlock(block ArchiveBlock) ([]byte, [32]byte, error) {
	var zero [32]byte
	if len(block.PointID) == 0 || len(block.PointID) > 64 || !utf8.ValidString(block.PointID) || block.Generation == 0 || block.StartUTCMS <= 0 || block.StartUTCMS%archiveDayMS != 0 || len(block.Rows) > archiveMaxRows || len(block.Gaps) > archiveMaxGaps {
		return nil, zero, fmt.Errorf("invalid archive block")
	}
	rows := append([]ArchiveRow(nil), block.Rows...)
	sort.Slice(rows, func(i, j int) bool { return rows[i].BucketUTCMS < rows[j].BucketUTCMS })
	sourceSet := map[string]bool{}
	previous := int64(-1)
	for i := range rows {
		row := &rows[i]
		if row.BucketUTCMS < block.StartUTCMS || row.BucketUTCMS >= block.StartUTCMS+archiveDayMS || (row.BucketUTCMS-block.StartUTCMS)%archiveBucketMS != 0 || row.BucketUTCMS == previous || row.Count == 0 || row.Quality > 2 || row.Source == "" || len(row.Source) > 255 || !utf8.ValidString(row.Source) || !finite(row.Value) || !finite(row.Min) || !finite(row.Max) || !finite(row.Sum) || row.Min > row.Value || row.Value > row.Max {
			return nil, zero, fmt.Errorf("invalid archive row")
		}
		row.Value, row.Min, row.Max, row.Sum = positiveZero(row.Value), positiveZero(row.Min), positiveZero(row.Max), positiveZero(row.Sum)
		previous = row.BucketUTCMS
		sourceSet[row.Source] = true
	}
	if len(sourceSet) > 255 {
		return nil, zero, fmt.Errorf("too many archive sources")
	}
	sources := make([]string, 0, len(sourceSet))
	for source := range sourceSet {
		sources = append(sources, source)
	}
	sort.Strings(sources)
	sourceIndex := make(map[string]uint8, len(sources))
	for i, source := range sources {
		sourceIndex[source] = uint8(i)
	}
	gaps := append([]ArchiveGap(nil), block.Gaps...)
	sort.Slice(gaps, func(i, j int) bool {
		if gaps[i].FromUTCMS != gaps[j].FromUTCMS {
			return gaps[i].FromUTCMS < gaps[j].FromUTCMS
		}
		if gaps[i].ToUTCMS != gaps[j].ToUTCMS {
			return gaps[i].ToUTCMS < gaps[j].ToUTCMS
		}
		if gaps[i].Reason != gaps[j].Reason {
			return gaps[i].Reason < gaps[j].Reason
		}
		return gaps[i].Detail < gaps[j].Detail
	})
	bodySize := len(block.PointID) + len(rows)*archiveRowSize
	for _, source := range sources {
		bodySize += 1 + len(source)
	}
	var previousGapEnd int64
	for _, gap := range gaps {
		if gap.FromUTCMS < block.StartUTCMS || gap.ToUTCMS <= gap.FromUTCMS || gap.ToUTCMS > block.StartUTCMS+archiveDayMS || (gap.FromUTCMS-block.StartUTCMS)%archiveBucketMS != 0 || (gap.ToUTCMS-block.StartUTCMS)%archiveBucketMS != 0 || gap.Reason == "" || len(gap.Reason) > 255 || len(gap.Detail) > archiveMaxDetail || !utf8.ValidString(gap.Reason) || !utf8.ValidString(gap.Detail) {
			return nil, zero, fmt.Errorf("invalid archive gap")
		}
		if gap.FromUTCMS < previousGapEnd {
			return nil, zero, fmt.Errorf("overlapping archive gaps")
		}
		previousGapEnd = gap.ToUTCMS
		bodySize += 11 + len(gap.Reason) + len(gap.Detail)
	}
	total := archiveHeaderSize + bodySize + archiveTrailerSize
	if total > archiveMaxBytes {
		return nil, zero, fmt.Errorf("archive block too large")
	}
	data := make([]byte, archiveHeaderSize, total)
	copy(data[:8], archiveMagic[:])
	binary.LittleEndian.PutUint16(data[8:], 1)
	binary.LittleEndian.PutUint16(data[10:], archiveHeaderSize)
	binary.LittleEndian.PutUint16(data[14:], uint16(len(gaps)))
	binary.LittleEndian.PutUint32(data[16:], uint32(bodySize))
	binary.LittleEndian.PutUint32(data[20:], uint32(len(rows)))
	binary.LittleEndian.PutUint64(data[24:], block.Generation)
	binary.LittleEndian.PutUint32(data[32:], uint32(archiveBucketMS))
	binary.LittleEndian.PutUint16(data[36:], uint16(len(block.PointID)))
	binary.LittleEndian.PutUint16(data[38:], uint16(len(sources)))
	binary.LittleEndian.PutUint64(data[40:], uint64(block.StartUTCMS))
	binary.LittleEndian.PutUint64(data[48:], uint64(block.StartUTCMS+archiveDayMS))
	data = append(data, block.PointID...)
	for _, source := range sources {
		data = append(data, byte(len(source)))
		data = append(data, source...)
	}
	for _, gap := range gaps {
		item := make([]byte, 11)
		binary.LittleEndian.PutUint32(item[0:], uint32((gap.FromUTCMS-block.StartUTCMS)/archiveBucketMS))
		binary.LittleEndian.PutUint32(item[4:], uint32((gap.ToUTCMS-block.StartUTCMS)/archiveBucketMS))
		item[8] = byte(len(gap.Reason))
		binary.LittleEndian.PutUint16(item[9:], uint16(len(gap.Detail)))
		data = append(data, item...)
		data = append(data, gap.Reason...)
		data = append(data, gap.Detail...)
	}
	for _, row := range rows {
		item := make([]byte, archiveRowSize)
		binary.LittleEndian.PutUint32(item[0:], uint32((row.BucketUTCMS-block.StartUTCMS)/archiveBucketMS))
		binary.LittleEndian.PutUint64(item[4:], math.Float64bits(row.Value))
		binary.LittleEndian.PutUint64(item[12:], math.Float64bits(row.Min))
		binary.LittleEndian.PutUint64(item[20:], math.Float64bits(row.Max))
		binary.LittleEndian.PutUint64(item[28:], math.Float64bits(row.Sum))
		binary.LittleEndian.PutUint32(item[36:], row.Count)
		item[40], item[41] = row.Quality, sourceIndex[row.Source]
		data = append(data, item...)
	}
	digest := sha256.Sum256(data)
	data = append(data, digest[:]...)
	return data, digest, nil
}

func DecodeArchiveBlock(data []byte) (ArchiveBlock, error) {
	if len(data) < archiveHeaderSize+archiveTrailerSize || len(data) > archiveMaxBytes || !bytes.Equal(data[:8], archiveMagic[:]) || binary.LittleEndian.Uint16(data[8:]) != 1 || binary.LittleEndian.Uint16(data[10:]) != archiveHeaderSize || binary.LittleEndian.Uint16(data[12:]) != 0 {
		return ArchiveBlock{}, fmt.Errorf("invalid archive header")
	}
	bodySize := int(binary.LittleEndian.Uint32(data[16:]))
	if len(data) != archiveHeaderSize+bodySize+archiveTrailerSize {
		return ArchiveBlock{}, fmt.Errorf("invalid archive size")
	}
	digest := sha256.Sum256(data[:len(data)-archiveTrailerSize])
	if !bytes.Equal(digest[:], data[len(data)-archiveTrailerSize:]) {
		return ArchiveBlock{}, fmt.Errorf("archive checksum mismatch")
	}
	rowCount := int(binary.LittleEndian.Uint32(data[20:]))
	gapCount := int(binary.LittleEndian.Uint16(data[14:]))
	generation := binary.LittleEndian.Uint64(data[24:])
	pointLen := int(binary.LittleEndian.Uint16(data[36:]))
	sourceCount := int(binary.LittleEndian.Uint16(data[38:]))
	start := int64(binary.LittleEndian.Uint64(data[40:]))
	end := int64(binary.LittleEndian.Uint64(data[48:]))
	if rowCount > archiveMaxRows || gapCount > archiveMaxGaps || generation == 0 || pointLen < 1 || pointLen > 64 || sourceCount > 255 || start <= 0 || start%archiveDayMS != 0 || end != start+archiveDayMS || binary.LittleEndian.Uint32(data[32:]) != uint32(archiveBucketMS) {
		return ArchiveBlock{}, fmt.Errorf("invalid archive metadata")
	}
	offset, bodyEnd := archiveHeaderSize, archiveHeaderSize+bodySize
	if offset+pointLen > bodyEnd {
		return ArchiveBlock{}, fmt.Errorf("truncated point id")
	}
	pointID := string(data[offset : offset+pointLen])
	if !utf8.ValidString(pointID) {
		return ArchiveBlock{}, fmt.Errorf("invalid point id")
	}
	block := ArchiveBlock{PointID: pointID, Generation: generation, StartUTCMS: start}
	offset += pointLen
	sources := make([]string, sourceCount)
	for i := range sources {
		if offset >= bodyEnd {
			return ArchiveBlock{}, fmt.Errorf("truncated source")
		}
		length := int(data[offset])
		offset++
		if length == 0 || offset+length > bodyEnd {
			return ArchiveBlock{}, fmt.Errorf("invalid source")
		}
		sources[i] = string(data[offset : offset+length])
		offset += length
		if !utf8.ValidString(sources[i]) || (i > 0 && sources[i-1] >= sources[i]) {
			return ArchiveBlock{}, fmt.Errorf("unsorted sources")
		}
	}
	for i := 0; i < gapCount; i++ {
		if offset+11 > bodyEnd {
			return ArchiveBlock{}, fmt.Errorf("truncated gap")
		}
		fromSlot := binary.LittleEndian.Uint32(data[offset:])
		toSlot := binary.LittleEndian.Uint32(data[offset+4:])
		reasonLen := int(data[offset+8])
		detailLen := int(binary.LittleEndian.Uint16(data[offset+9:]))
		offset += 11
		if fromSlot >= toSlot || toSlot > archiveMaxRows || reasonLen == 0 || detailLen > archiveMaxDetail || offset+reasonLen+detailLen > bodyEnd {
			return ArchiveBlock{}, fmt.Errorf("invalid archive gap")
		}
		gap := ArchiveGap{FromUTCMS: start + int64(fromSlot)*archiveBucketMS, ToUTCMS: start + int64(toSlot)*archiveBucketMS, Reason: string(data[offset : offset+reasonLen]), Detail: string(data[offset+reasonLen : offset+reasonLen+detailLen])}
		offset += reasonLen + detailLen
		if !utf8.ValidString(gap.Reason) || !utf8.ValidString(gap.Detail) {
			return ArchiveBlock{}, fmt.Errorf("invalid archive gap text")
		}
		if i > 0 {
			previous := block.Gaps[i-1]
			if previous.FromUTCMS > gap.FromUTCMS || previous.ToUTCMS > gap.FromUTCMS {
				return ArchiveBlock{}, fmt.Errorf("unsorted archive gaps")
			}
		}
		block.Gaps = append(block.Gaps, gap)
	}
	if offset+rowCount*archiveRowSize != bodyEnd {
		return ArchiveBlock{}, fmt.Errorf("invalid row body")
	}
	previousSlot := uint32(0)
	for i := 0; i < rowCount; i++ {
		item := data[offset : offset+archiveRowSize]
		offset += archiveRowSize
		slot := binary.LittleEndian.Uint32(item)
		if slot >= archiveMaxRows || (i > 0 && slot <= previousSlot) || int(item[41]) >= len(sources) || item[40] > 2 {
			return ArchiveBlock{}, fmt.Errorf("invalid archive row")
		}
		row := ArchiveRow{BucketUTCMS: start + int64(slot)*archiveBucketMS, Value: math.Float64frombits(binary.LittleEndian.Uint64(item[4:])), Min: math.Float64frombits(binary.LittleEndian.Uint64(item[12:])), Max: math.Float64frombits(binary.LittleEndian.Uint64(item[20:])), Sum: math.Float64frombits(binary.LittleEndian.Uint64(item[28:])), Count: binary.LittleEndian.Uint32(item[36:]), Quality: item[40], Source: sources[item[41]]}
		if row.Count == 0 || !finite(row.Value) || !finite(row.Min) || !finite(row.Max) || !finite(row.Sum) || negativeZero(row.Value) || negativeZero(row.Min) || negativeZero(row.Max) || negativeZero(row.Sum) || row.Min > row.Value || row.Value > row.Max {
			return ArchiveBlock{}, fmt.Errorf("invalid aggregate")
		}
		block.Rows = append(block.Rows, row)
		previousSlot = slot
	}
	return block, nil
}

func positiveZero(value float64) float64 {
	if value == 0 {
		return 0
	}
	return value
}

func negativeZero(value float64) bool { return value == 0 && math.Signbit(value) }

func publishArchiveFile(dir, finalPath string, data []byte) error {
	return publishArchiveFileWithFault(dir, finalPath, data, nil)
}

func publishArchiveFileWithFault(dir, finalPath string, data []byte, fault func(string) error) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if info, err := os.Lstat(finalPath); err == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("archive destination is not a regular file")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	temp, err := os.CreateTemp(dir, ".archive-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := runArchiveFault(fault, archiveFaultAfterTempWrite); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := runArchiveFault(fault, archiveFaultAfterTempSync); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Link(tempPath, finalPath); err != nil {
		existing, readErr := os.ReadFile(finalPath)
		if readErr == nil && bytes.Equal(existing, data) {
			return nil
		}
		return fmt.Errorf("publish archive block: %w", err)
	}
	if err := runArchiveFault(fault, archiveFaultAfterLink); err != nil {
		return err
	}
	if err := os.Remove(tempPath); err != nil {
		return err
	}
	if err := runArchiveFault(fault, archiveFaultAfterTempUnlink); err != nil {
		return err
	}
	if err := syncDirectory(dir); err != nil {
		return err
	}
	return runArchiveFault(fault, archiveFaultAfterDirectorySync)
}

func (s *HistorianStore) CommitArchiveBlock(ctx context.Context, dir string, block ArchiveBlock, originUTCMS int64) (string, error) {
	s.archiveMu.Lock()
	defer s.archiveMu.Unlock()
	if originUTCMS < 0 || originUTCMS%archiveBucketMS != 0 || block.StableCutoffUTCMS < block.StartUTCMS+archiveDayMS {
		return "", fmt.Errorf("archive coverage proof required")
	}
	if err := verifyArchiveCoverage(block); err != nil {
		return "", err
	}
	data, digest, err := EncodeArchiveBlock(block)
	if err != nil {
		return "", err
	}
	name := hex.EncodeToString(digest[:]) + ".mkhab"
	finalPath := filepath.Join(dir, name)
	blockID := hex.EncodeToString(digest[:])
	if _, err := s.db.ExecContext(ctx, `INSERT INTO archive_blocks(block_id,point_id,generation,from_utc_ms,to_utc_ms,codec,file_name,byte_size,sample_count,gap_count,payload_sha256,state,created_at_utc_ms) VALUES(?,?,?,?,?,'mkhab-v1',?,?,?,?,?,'building',?) ON CONFLICT(block_id) DO NOTHING`, blockID, block.PointID, block.Generation, block.StartUTCMS, block.StartUTCMS+archiveDayMS, name, len(data), len(block.Rows), len(block.Gaps), digest[:], time.Now().UTC().UnixMilli()); err != nil {
		return "", err
	}
	if err := runArchiveFault(s.archiveFault, archiveFaultAfterReservation); err != nil {
		return "", err
	}
	if err := publishArchiveFileWithFault(dir, finalPath, data, s.archiveFault); err != nil {
		return "", err
	}
	verified, err := os.ReadFile(finalPath)
	if err != nil {
		return "", err
	}
	decoded, err := DecodeArchiveBlock(verified)
	if err != nil {
		return "", err
	}
	if decoded.PointID != block.PointID || decoded.Generation != block.Generation || decoded.StartUTCMS != block.StartUTCMS || len(decoded.Rows) != len(block.Rows) || len(decoded.Gaps) != len(block.Gaps) {
		return "", fmt.Errorf("archive metadata mismatch")
	}
	if err := runArchiveFault(s.archiveFault, archiveFaultAfterVerification); err != nil {
		return "", err
	}
	var durableState string
	if err := s.db.QueryRowContext(ctx, `SELECT state FROM archive_blocks WHERE block_id=? AND point_id=? AND generation=? AND from_utc_ms=? AND to_utc_ms=? AND file_name=? AND byte_size=? AND sample_count=? AND gap_count=? AND payload_sha256=?`, blockID, block.PointID, block.Generation, block.StartUTCMS, block.StartUTCMS+archiveDayMS, name, len(data), len(block.Rows), len(block.Gaps), digest[:]).Scan(&durableState); err != nil {
		return "", fmt.Errorf("verify archive metadata: %w", err)
	}
	if durableState == "committed" {
		return finalPath, nil
	}
	now := time.Now().UTC().UnixMilli()
	result, err := s.db.ExecContext(ctx, `UPDATE archive_blocks SET state='verified',verified_at_utc_ms=? WHERE block_id=? AND state IN ('building','verified')`, now, blockID)
	if err != nil {
		return "", err
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		return "", fmt.Errorf("verify archive metadata transition: changed=%d err=%v", changed, err)
	}
	if err := runArchiveFault(s.archiveFault, archiveFaultAfterVerifiedState); err != nil {
		return "", err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE archive_blocks SET state='committed',committed_at_utc_ms=? WHERE block_id=? AND state='verified'`, now, blockID); err != nil {
		return "", err
	}
	var current int64
	err = tx.QueryRowContext(ctx, `SELECT covered_until_utc_ms FROM archive_watermarks WHERE point_id=? AND generation=?`, block.PointID, block.Generation).Scan(&current)
	if err == sql.ErrNoRows {
		current = originUTCMS
	} else if err != nil {
		return "", err
	}
	for {
		var nextEnd int64
		var nextID string
		err := tx.QueryRowContext(ctx, `SELECT to_utc_ms,block_id FROM archive_blocks WHERE point_id=? AND generation=? AND state='committed' AND from_utc_ms=?`, block.PointID, block.Generation, current).Scan(&nextEnd, &nextID)
		if err == sql.ErrNoRows {
			break
		}
		if err != nil {
			return "", err
		}
		current, blockID = nextEnd, nextID
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO archive_watermarks(point_id,generation,origin_utc_ms,covered_until_utc_ms,block_id,updated_at_utc_ms) VALUES(?,?,?,?,?,?) ON CONFLICT(point_id,generation) DO UPDATE SET covered_until_utc_ms=excluded.covered_until_utc_ms,block_id=excluded.block_id,updated_at_utc_ms=excluded.updated_at_utc_ms`, block.PointID, block.Generation, originUTCMS, current, blockID, now); err != nil {
		return "", err
	}
	if err := runArchiveFault(s.archiveFault, archiveFaultAfterWatermark); err != nil {
		return "", err
	}
	if err := runArchiveFault(s.archiveFault, archiveFaultBeforeCommit); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	if err := runArchiveFault(s.archiveFault, archiveFaultAfterCommit); err != nil {
		return "", err
	}
	return finalPath, nil
}

func verifyArchiveCoverage(block ArchiveBlock) error {
	covered := make([]bool, archiveMaxRows)
	for _, row := range block.Rows {
		if row.BucketUTCMS < block.StartUTCMS || row.BucketUTCMS >= block.StartUTCMS+archiveDayMS || (row.BucketUTCMS-block.StartUTCMS)%archiveBucketMS != 0 {
			return fmt.Errorf("archive row outside coverage")
		}
		slot := int((row.BucketUTCMS - block.StartUTCMS) / archiveBucketMS)
		if covered[slot] {
			return fmt.Errorf("archive coverage overlap")
		}
		covered[slot] = true
	}
	for _, gap := range block.Gaps {
		if gap.FromUTCMS < block.StartUTCMS || gap.ToUTCMS > block.StartUTCMS+archiveDayMS || gap.ToUTCMS <= gap.FromUTCMS || (gap.FromUTCMS-block.StartUTCMS)%archiveBucketMS != 0 || (gap.ToUTCMS-block.StartUTCMS)%archiveBucketMS != 0 {
			return fmt.Errorf("invalid archive gap coverage")
		}
		from := int((gap.FromUTCMS - block.StartUTCMS) / archiveBucketMS)
		to := int((gap.ToUTCMS - block.StartUTCMS) / archiveBucketMS)
		for slot := from; slot < to; slot++ {
			if covered[slot] {
				return fmt.Errorf("archive coverage overlap")
			}
			covered[slot] = true
		}
	}
	for _, present := range covered {
		if !present {
			return fmt.Errorf("archive coverage hole")
		}
	}
	return nil
}

func runArchiveFault(fault func(string) error, stage string) error {
	if fault == nil {
		return nil
	}
	return fault(stage)
}

func (s *HistorianStore) PruneHot(ctx context.Context, nowUTCMS int64) (int64, error) {
	cutoff := (nowUTCMS - 48*60*60*1000) / archiveBucketMS * archiveBucketMS
	result, err := s.db.ExecContext(ctx, `DELETE FROM hot_samples WHERE bucket_utc_ms < ? AND EXISTS (
		SELECT 1 FROM archive_watermarks w
		JOIN archive_blocks b ON b.block_id=w.block_id AND b.point_id=w.point_id AND b.generation=w.generation AND b.to_utc_ms=w.covered_until_utc_ms AND b.state='committed'
		WHERE w.point_id=hot_samples.point_id AND w.generation=hot_samples.generation AND hot_samples.bucket_utc_ms < w.covered_until_utc_ms
	)`, cutoff)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
