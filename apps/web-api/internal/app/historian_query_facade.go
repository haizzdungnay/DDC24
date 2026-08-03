package app

import webHistorian "mkddc-web/internal/historian"

const historianQueryDefaultMaxPoints = webHistorian.QueryDefaultMaxPoints
const historianTrendCacheRetentionMS = webHistorian.TrendCacheRetentionMS
const historianRAMRetentionMS = webHistorian.RAMRetentionMS
const historianRAMMaxBytes = webHistorian.RAMMaxBytes
const historianRawRAMBudget = webHistorian.RawRAMBudget
const historianRawSampleBytes = webHistorian.RawSampleBytes

type HistorianRawSample = webHistorian.HistorianRawSample
type HistorianRAMCache = webHistorian.HistorianRAMCache
type HotSample = webHistorian.HotSample
type HistoryGap = webHistorian.HistoryGap
type HistorianClockTracker = webHistorian.ClockTracker

type HistorianTier = webHistorian.HistorianTier
type HistorianQueryRequest = webHistorian.HistorianQueryRequest
type HistorianQueryResult = webHistorian.HistorianQueryResult
type HistorianQuerySeries = webHistorian.HistorianQuerySeries
type HistorianQuerySample = webHistorian.HistorianQuerySample
type HistorianQueryGap = webHistorian.HistorianQueryGap
type HistorianQueryIdentity = webHistorian.HistorianQueryIdentity
type HistorianAggregateRow = webHistorian.HistorianAggregateRow
type HistorianTierRead = webHistorian.HistorianTierRead
type HistorianQueryBackend = webHistorian.HistorianQueryBackend
type HistorianQueryError = webHistorian.HistorianQueryError
type HistorianQueryEngine = webHistorian.HistorianQueryEngine

const (
	HistorianTierRAM     = webHistorian.HistorianTierRAM
	HistorianTierCache   = webHistorian.HistorianTierCache
	HistorianTierHot     = webHistorian.HistorianTierHot
	HistorianTierArchive = webHistorian.HistorianTierArchive
)

func NewHistorianQueryEngine(backend HistorianQueryBackend) *HistorianQueryEngine {
	return webHistorian.NewHistorianQueryEngine(backend)
}

func NewHistorianRAMCache(maxBytes uint64) (*HistorianRAMCache, error) {
	return webHistorian.NewHistorianRAMCache(maxBytes)
}

func foldHistorianHot(rows []HistorianRawSample, policyRevision uint64) (HotSample, error) {
	return webHistorian.FoldHot(rows, policyRevision)
}

func NewHistorianClockTracker() *HistorianClockTracker {
	return webHistorian.NewClockTracker()
}
