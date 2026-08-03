package historian

import (
	"context"
	"fmt"
	"sort"
	"strings"

	webPoints "mkddc-web/internal/points"
)

const (
	QueryDefaultMaxPoints          = 5000
	historianQueryDefaultMaxPoints = QueryDefaultMaxPoints
	TrendCacheRetentionMS          = int64(24 * 60 * 60 * 1000)
	historianTrendCacheRetentionMS = TrendCacheRetentionMS
)

type HistorianTier string

const (
	HistorianTierRAM     HistorianTier = "ram"
	HistorianTierCache   HistorianTier = "cache"
	HistorianTierHot     HistorianTier = "hot"
	HistorianTierArchive HistorianTier = "archive"
)

type HistorianQueryRequest struct {
	PointIDs   []string
	FromUTCMS  int64
	ToUTCMS    int64
	Resolution string
	MaxPoints  int
	Source     string
}

type HistorianQueryResult struct {
	FromUTCMS  int64
	ToUTCMS    int64
	Resolution string
	Complete   bool
	Series     []HistorianQuerySeries
	Gaps       []HistorianQueryGap
	TiersUsed  []HistorianTier
}

type HistorianQuerySeries struct {
	PointID             string
	Generation          uint64
	EffectiveResolution string
	Samples             []HistorianQuerySample
}

type HistorianQuerySample struct {
	TimeUTCMS  int64
	Value      float64
	Min        float64
	Max        float64
	Sum        float64
	Count      int
	Quality    string
	Source     string
	Tier       HistorianTier
	Generation uint64
}

type HistorianQueryGap struct {
	PointID    string
	Generation uint64
	FromUTCMS  int64
	ToUTCMS    int64
	Reason     string
	Detail     string
}

type HistorianQueryIdentity struct {
	PointID    string
	Generation uint64
}

// HistorianAggregateRow is the tier-neutral row consumed by the merge engine.
// RAM adapters may provide raw rows with Count=1 and BucketUTCMS at observation time.
type HistorianAggregateRow struct {
	PointID         string
	Generation      uint64
	BucketUTCMS     int64
	LastSampleUTCMS int64
	Value           float64
	Min             float64
	Max             float64
	Sum             float64
	Count           int
	Quality         int
	Source          string
	Tier            HistorianTier
}

type HistorianTierRead struct {
	Tier              HistorianTier
	Available         bool
	CoverageFromUTCMS int64
	CoverageToUTCMS   int64
	Rows              []HistorianAggregateRow
	Gaps              []HistorianQueryGap
}

type HistorianQueryBackend interface {
	Identities(ctx context.Context, pointIDs []string, fromUTCMS, toUTCMS int64, source string) ([]HistorianQueryIdentity, error)
	ReadTier(ctx context.Context, tier HistorianTier, identities []HistorianQueryIdentity, fromUTCMS, toUTCMS int64) (HistorianTierRead, error)
}

type HistorianQueryError struct {
	Code    string
	Message string
}

func (e *HistorianQueryError) Error() string { return e.Message }

type HistorianQueryEngine struct {
	backend HistorianQueryBackend
}

func NewHistorianQueryEngine(backend HistorianQueryBackend) *HistorianQueryEngine {
	return &HistorianQueryEngine{backend: backend}
}

var historianQueryResolutions = []string{"1s", "3s", "5s", "15s", "30s", "1m", "3m", "5m", "15m", "30m", "60m"}

var historianQueryResolutionMS = map[string]int64{
	"1s": 1000, "3s": 3000, "5s": 5000, "15s": 15000, "30s": 30000,
	"1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000,
	"30m": 1800000, "60m": 3600000,
}

func (e *HistorianQueryEngine) Query(ctx context.Context, request HistorianQueryRequest) (HistorianQueryResult, error) {
	request, err := validateHistorianQueryRequest(request)
	if err != nil {
		return HistorianQueryResult{}, err
	}
	if e == nil || e.backend == nil {
		return HistorianQueryResult{}, historianQueryError("historian_unavailable", "historian query backend unavailable")
	}

	identities, err := e.backend.Identities(ctx, request.PointIDs, request.FromUTCMS, request.ToUTCMS, request.Source)
	if err != nil {
		return HistorianQueryResult{}, historianQueryError("historian_unavailable", "historian identities unavailable")
	}
	identities, err = validateHistorianQueryIdentities(identities, request.PointIDs)
	if err != nil {
		return HistorianQueryResult{}, err
	}

	tiers := historianQueryReadTiers(request)
	reads := make(map[HistorianTier]HistorianTierRead, len(tiers))
	readErrors := make(map[HistorianTier]error, len(tiers))
	available := 0
	for _, tier := range tiers {
		read, readErr := e.backend.ReadTier(ctx, tier, identities, request.FromUTCMS, request.ToUTCMS)
		if read.Tier == "" {
			read.Tier = tier
		}
		if read.Tier != tier {
			readErr = fmt.Errorf("tier mismatch: got %s", read.Tier)
			read.Available = false
		}
		reads[tier] = read
		if readErr != nil {
			readErrors[tier] = readErr
		}
		if read.Available {
			available++
		}
	}
	if request.Source == "" && request.Resolution != "auto" && historianQueryResolutionMS[request.Resolution] < 15000 {
		if readErrors[HistorianTierRAM] == nil && !historianRAMCovers(reads[HistorianTierRAM], request.FromUTCMS, request.ToUTCMS) {
			return HistorianQueryResult{}, historianQueryError("resolution_unavailable", "requested fine resolution is outside the RAM tail")
		}
	}
	if available == 0 {
		return HistorianQueryResult{}, historianQueryError("historian_unavailable", "all historian tiers unavailable")
	}

	candidates := []string{request.Resolution}
	if request.Resolution == "auto" {
		candidates = historianQueryResolutions
		if request.Source != "" {
			candidates = historianQueryResolutions[3:]
		}
	}
	var unavailableFine bool
	for _, resolution := range candidates {
		resolutionMS := historianQueryResolutionMS[resolution]
		if request.Source == "" && resolutionMS < 15000 && !historianRAMCovers(reads[HistorianTierRAM], request.FromUTCMS, request.ToUTCMS) {
			unavailableFine = true
			continue
		}
		result := buildHistorianQueryResult(request, resolution, identities, reads, readErrors)
		if historianSeriesWithinBudget(result.Series, request.MaxPoints) {
			return result, nil
		}
	}
	if request.Resolution != "auto" && unavailableFine {
		return HistorianQueryResult{}, historianQueryError("resolution_unavailable", "requested fine resolution is outside the RAM tail")
	}
	return HistorianQueryResult{}, historianQueryError("output_budget_exceeded", "history result exceeds maxPoints for at least one series")
}

func historianQueryReadTiers(request HistorianQueryRequest) []HistorianTier {
	switch request.Source {
	case "cache":
		return []HistorianTier{HistorianTierCache}
	case "database":
		return []HistorianTier{HistorianTierArchive, HistorianTierHot}
	}
	if request.Resolution != "auto" && historianQueryResolutionMS[request.Resolution] < 15000 {
		return []HistorianTier{HistorianTierRAM}
	}
	return []HistorianTier{HistorianTierArchive, HistorianTierHot, HistorianTierRAM}
}

func validateHistorianQueryRequest(request HistorianQueryRequest) (HistorianQueryRequest, error) {
	if len(request.PointIDs) < 1 || len(request.PointIDs) > 8 {
		return request, historianQueryError("invalid_request", "point must contain 1..8 canonical IDs")
	}
	seen := make(map[string]struct{}, len(request.PointIDs))
	for _, pointID := range request.PointIDs {
		if pointID == "" || strings.TrimSpace(pointID) != pointID || canonicalHistoryPointID(pointID) != pointID {
			return request, historianQueryError("invalid_request", "point IDs must be canonical")
		}
		prefix, _, ok := webPoints.ParseID(pointID)
		if !ok || (prefix != "UI" && prefix != "AO" && prefix != "DO" && prefix != "VP") {
			return request, historianQueryError("invalid_request", "unsupported historian point ID")
		}
		if _, duplicate := seen[pointID]; duplicate {
			return request, historianQueryError("invalid_request", "point IDs must be unique")
		}
		seen[pointID] = struct{}{}
	}
	if request.FromUTCMS < 0 || request.ToUTCMS <= request.FromUTCMS {
		return request, historianQueryError("invalid_request", "from and to must define a non-empty [from,to) UTC range")
	}
	if request.Resolution == "" {
		request.Resolution = "auto"
	}
	if request.Resolution != "auto" {
		if _, ok := historianQueryResolutionMS[request.Resolution]; !ok {
			return request, historianQueryError("invalid_request", "invalid history resolution")
		}
	}
	if request.Source != "" && request.Source != "cache" && request.Source != "database" {
		return request, historianQueryError("invalid_request", "source must be cache or database")
	}
	if request.Source == "cache" && request.ToUTCMS-request.FromUTCMS > historianTrendCacheRetentionMS {
		return request, historianQueryError("invalid_request", "cache source supports at most 24 hours")
	}
	if request.Source != "" && request.Resolution != "auto" && historianQueryResolutionMS[request.Resolution] < 15000 {
		return request, historianQueryError("invalid_request", "cache/database sources support 15s or coarser resolution")
	}
	if request.MaxPoints == 0 {
		request.MaxPoints = historianQueryDefaultMaxPoints
	}
	if request.MaxPoints < 1 || request.MaxPoints > historianQueryDefaultMaxPoints {
		return request, historianQueryError("invalid_request", "maxPoints must be in 1..5000")
	}
	return request, nil
}

func validateHistorianQueryIdentities(identities []HistorianQueryIdentity, requested []string) ([]HistorianQueryIdentity, error) {
	allowed := make(map[string]struct{}, len(requested))
	for _, pointID := range requested {
		allowed[pointID] = struct{}{}
	}
	seen := make(map[string]struct{}, len(identities))
	out := make([]HistorianQueryIdentity, 0, len(identities))
	for _, identity := range identities {
		if _, ok := allowed[identity.PointID]; !ok || identity.Generation == 0 {
			return nil, historianQueryError("historian_unavailable", "historian backend returned an invalid identity")
		}
		key := historianIdentityKey(identity.PointID, identity.Generation)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, identity)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].PointID != out[j].PointID {
			return out[i].PointID < out[j].PointID
		}
		return out[i].Generation < out[j].Generation
	})
	return out, nil
}

func buildHistorianQueryResult(request HistorianQueryRequest, resolution string, identities []HistorianQueryIdentity, reads map[HistorianTier]HistorianTierRead, readErrors map[HistorianTier]error) HistorianQueryResult {
	result := HistorianQueryResult{FromUTCMS: request.FromUTCMS, ToUTCMS: request.ToUTCMS, Resolution: resolution, Complete: true}
	resolutionMS := historianQueryResolutionMS[resolution]
	requestedIdentities := make(map[string]HistorianQueryIdentity, len(identities))
	for _, identity := range identities {
		requestedIdentities[historianIdentityKey(identity.PointID, identity.Generation)] = identity
	}

	var rows []HistorianAggregateRow
	if resolutionMS < 15000 {
		read := reads[HistorianTierRAM]
		rows = normalizedFineRows(read.Rows, requestedIdentities, request.FromUTCMS, request.ToUTCMS)
		result.Gaps = append(result.Gaps, clippedHistorianGaps(read.Gaps, requestedIdentities, request.FromUTCMS, request.ToUTCMS)...)
		if readErrors[HistorianTierRAM] != nil {
			result.Complete = false
			result.Gaps = append(result.Gaps, unavailableHistorianGaps(identities, request.FromUTCMS, request.ToUTCMS, HistorianTierRAM, readErrors[HistorianTierRAM])...)
		} else if !read.Available {
			result.Complete = false
			result.Gaps = append(result.Gaps, unavailableHistorianGaps(identities, request.FromUTCMS, request.ToUTCMS, HistorianTierRAM, nil)...)
		}
	} else {
		baseRows := make(map[string]HistorianAggregateRow)
		for _, tier := range historianQueryReadTiers(request) {
			read := reads[tier]
			tierRows := foldHistorianTierBaseRows(read.Rows, tier, requestedIdentities, request.FromUTCMS, request.ToUTCMS)
			for _, row := range tierRows {
				baseRows[historianBucketKey(row.PointID, row.Generation, row.BucketUTCMS)] = row
			}
			result.Gaps = append(result.Gaps, clippedHistorianGaps(read.Gaps, requestedIdentities, request.FromUTCMS, request.ToUTCMS)...)
			if err := readErrors[tier]; err != nil {
				result.Complete = false
				result.Gaps = append(result.Gaps, unavailableHistorianGaps(identities, request.FromUTCMS, request.ToUTCMS, tier, err)...)
			} else if !read.Available {
				result.Complete = false
				result.Gaps = append(result.Gaps, unavailableHistorianGaps(identities, request.FromUTCMS, request.ToUTCMS, tier, nil)...)
			}
		}
		rows = make([]HistorianAggregateRow, 0, len(baseRows))
		for _, row := range baseRows {
			rows = append(rows, row)
		}
	}

	seriesRows := make(map[string]map[int64]HistorianAggregateRow)
	tierSet := map[HistorianTier]struct{}{}
	for _, row := range rows {
		tierSet[row.Tier] = struct{}{}
		bucket := floorHistorianBoundary(row.BucketUTCMS, resolutionMS)
		key := historianIdentityKey(row.PointID, row.Generation)
		if seriesRows[key] == nil {
			seriesRows[key] = make(map[int64]HistorianAggregateRow)
		}
		current, ok := seriesRows[key][bucket]
		if !ok {
			row.BucketUTCMS = bucket
			seriesRows[key][bucket] = row
			continue
		}
		seriesRows[key][bucket] = combineHistorianRows(current, row, bucket)
	}

	for _, identity := range identities {
		key := historianIdentityKey(identity.PointID, identity.Generation)
		buckets := seriesRows[key]
		times := make([]int64, 0, len(buckets))
		for bucket := range buckets {
			times = append(times, bucket)
		}
		sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
		series := HistorianQuerySeries{PointID: identity.PointID, Generation: identity.Generation, EffectiveResolution: resolution, Samples: make([]HistorianQuerySample, 0, len(times))}
		for _, bucket := range times {
			row := buckets[bucket]
			series.Samples = append(series.Samples, HistorianQuerySample{TimeUTCMS: bucket, Value: row.Value, Min: row.Min, Max: row.Max, Sum: row.Sum, Count: row.Count, Quality: historianQueryQuality(row.Quality), Source: row.Source, Tier: row.Tier, Generation: row.Generation})
		}
		result.Series = append(result.Series, series)
	}
	result.Gaps = dedupeHistorianGaps(result.Gaps)
	if len(result.Gaps) > 0 {
		result.Complete = false
	}
	for _, tier := range []HistorianTier{HistorianTierCache, HistorianTierRAM, HistorianTierHot, HistorianTierArchive} {
		if _, ok := tierSet[tier]; ok {
			result.TiersUsed = append(result.TiersUsed, tier)
		}
	}
	return result
}

func normalizedFineRows(rows []HistorianAggregateRow, identities map[string]HistorianQueryIdentity, fromUTCMS, toUTCMS int64) []HistorianAggregateRow {
	out := make([]HistorianAggregateRow, 0, len(rows))
	for _, row := range rows {
		row.Tier = HistorianTierRAM
		if validHistorianQueryRow(row, identities, fromUTCMS, toUTCMS) {
			out = append(out, row)
		}
	}
	return out
}

func foldHistorianTierBaseRows(rows []HistorianAggregateRow, tier HistorianTier, identities map[string]HistorianQueryIdentity, fromUTCMS, toUTCMS int64) []HistorianAggregateRow {
	base := make(map[string]HistorianAggregateRow)
	for _, row := range rows {
		row.Tier = tier
		if !validHistorianQueryRow(row, identities, fromUTCMS, toUTCMS) {
			continue
		}
		bucket := floorHistorianBoundary(row.BucketUTCMS, 15000)
		key := historianBucketKey(row.PointID, row.Generation, bucket)
		if current, ok := base[key]; ok {
			base[key] = combineHistorianRows(current, row, bucket)
		} else {
			row.BucketUTCMS = bucket
			base[key] = row
		}
	}
	out := make([]HistorianAggregateRow, 0, len(base))
	for _, row := range base {
		out = append(out, row)
	}
	return out
}

func validHistorianQueryRow(row HistorianAggregateRow, identities map[string]HistorianQueryIdentity, fromUTCMS, toUTCMS int64) bool {
	if _, ok := identities[historianIdentityKey(row.PointID, row.Generation)]; !ok {
		return false
	}
	if row.BucketUTCMS < fromUTCMS || row.BucketUTCMS >= toUTCMS || row.Count <= 0 || row.Quality < 0 || row.Quality > 2 || row.Source == "" {
		return false
	}
	if row.LastSampleUTCMS == 0 {
		row.LastSampleUTCMS = row.BucketUTCMS
	}
	return finite(row.Value) && finite(row.Min) && finite(row.Max) && finite(row.Sum) && row.Min <= row.Value && row.Value <= row.Max
}

func combineHistorianRows(left, right HistorianAggregateRow, bucket int64) HistorianAggregateRow {
	combined := left
	combined.BucketUTCMS = bucket
	if right.Min < combined.Min {
		combined.Min = right.Min
	}
	if right.Max > combined.Max {
		combined.Max = right.Max
	}
	combined.Sum += right.Sum
	combined.Count += right.Count
	if right.Quality > combined.Quality {
		combined.Quality = right.Quality
	}
	if combined.Source != right.Source {
		combined.Source = "mixed"
	}
	leftLast, rightLast := left.LastSampleUTCMS, right.LastSampleUTCMS
	if leftLast == 0 {
		leftLast = left.BucketUTCMS
	}
	if rightLast == 0 {
		rightLast = right.BucketUTCMS
	}
	if rightLast > leftLast || (rightLast == leftLast && historianTierPriority(right.Tier) > historianTierPriority(left.Tier)) {
		combined.Value = right.Value
		combined.LastSampleUTCMS = rightLast
		combined.Tier = right.Tier
	} else {
		combined.LastSampleUTCMS = leftLast
	}
	return combined
}

func clippedHistorianGaps(gaps []HistorianQueryGap, identities map[string]HistorianQueryIdentity, fromUTCMS, toUTCMS int64) []HistorianQueryGap {
	out := make([]HistorianQueryGap, 0, len(gaps))
	for _, gap := range gaps {
		if _, ok := identities[historianIdentityKey(gap.PointID, gap.Generation)]; !ok || gap.Reason == "" || gap.ToUTCMS <= gap.FromUTCMS || gap.ToUTCMS <= fromUTCMS || gap.FromUTCMS >= toUTCMS {
			continue
		}
		if gap.FromUTCMS < fromUTCMS {
			gap.FromUTCMS = fromUTCMS
		}
		if gap.ToUTCMS > toUTCMS {
			gap.ToUTCMS = toUTCMS
		}
		out = append(out, gap)
	}
	return out
}

func unavailableHistorianGaps(identities []HistorianQueryIdentity, fromUTCMS, toUTCMS int64, tier HistorianTier, err error) []HistorianQueryGap {
	reason := "runtime"
	if tier == HistorianTierHot {
		reason = "sqlite"
	} else if tier == HistorianTierArchive {
		reason = "disk"
	}
	detail := tier.String() + " tier unavailable"
	if err != nil {
		detail += ": " + err.Error()
	}
	out := make([]HistorianQueryGap, 0, len(identities))
	for _, identity := range identities {
		out = append(out, HistorianQueryGap{PointID: identity.PointID, Generation: identity.Generation, FromUTCMS: fromUTCMS, ToUTCMS: toUTCMS, Reason: reason, Detail: detail})
	}
	return out
}

func dedupeHistorianGaps(gaps []HistorianQueryGap) []HistorianQueryGap {
	seen := make(map[string]struct{}, len(gaps))
	out := make([]HistorianQueryGap, 0, len(gaps))
	for _, gap := range gaps {
		key := fmt.Sprintf("%s\x00%d\x00%d\x00%d\x00%s\x00%s", gap.PointID, gap.Generation, gap.FromUTCMS, gap.ToUTCMS, gap.Reason, gap.Detail)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, gap)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].PointID != out[j].PointID {
			return out[i].PointID < out[j].PointID
		}
		if out[i].Generation != out[j].Generation {
			return out[i].Generation < out[j].Generation
		}
		if out[i].FromUTCMS != out[j].FromUTCMS {
			return out[i].FromUTCMS < out[j].FromUTCMS
		}
		return out[i].ToUTCMS < out[j].ToUTCMS
	})
	return out
}

func historianRAMCovers(read HistorianTierRead, fromUTCMS, toUTCMS int64) bool {
	return read.Available && read.CoverageFromUTCMS <= fromUTCMS && read.CoverageToUTCMS >= toUTCMS
}

func historianSeriesWithinBudget(series []HistorianQuerySeries, maxPoints int) bool {
	for _, item := range series {
		if len(item.Samples) > maxPoints {
			return false
		}
	}
	return true
}

func historianBucketKey(pointID string, generation uint64, bucketUTCMS int64) string {
	return fmt.Sprintf("%s\x00%d\x00%d", pointID, generation, bucketUTCMS)
}

func historianTierPriority(tier HistorianTier) int {
	switch tier {
	case HistorianTierCache:
		return 4
	case HistorianTierRAM:
		return 3
	case HistorianTierHot:
		return 2
	case HistorianTierArchive:
		return 1
	default:
		return 0
	}
}

func historianQueryQuality(quality int) string {
	switch quality {
	case 0:
		return "GOOD"
	case 1:
		return "UNCERTAIN"
	default:
		return "BAD"
	}
}

func historianQueryError(code, message string) error {
	return &HistorianQueryError{Code: code, Message: message}
}

func (tier HistorianTier) String() string { return string(tier) }
