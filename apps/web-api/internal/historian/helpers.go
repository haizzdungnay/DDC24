package historian

import (
	"fmt"
	"math"
	"strings"

	"mkddc-web/internal/points"
)

func historianIdentityKey(pointID string, generation uint64) string {
	return fmt.Sprintf("%s\x00%d", pointID, generation)
}

func floorHistorianBoundary(utcMS, intervalMS int64) int64 {
	if intervalMS <= 0 {
		return utcMS
	}
	return utcMS - utcMS%intervalMS
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func canonicalHistoryPointID(id string) string {
	prefix, channel, ok := points.ParseID(id)
	if !ok {
		return strings.TrimSpace(id)
	}
	switch prefix {
	case "UI", "AI":
		return points.FormatPhysicalID("UI", channel)
	case "AO", "DO":
		return points.FormatPhysicalID(prefix, channel)
	case "VP", "AV":
		return fmt.Sprintf("VP%d", channel)
	default:
		return strings.TrimSpace(id)
	}
}
