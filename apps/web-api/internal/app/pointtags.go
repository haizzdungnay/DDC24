package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"

	webPoints "mkddc-web/internal/points"

	"mkddc-web/internal/capabilities"
)

type pointNamespaceEntry struct {
	PointID  string
	TagPath  string
	Tag      string
	TagKey   string
	NamePath string
	Name     string
	NameKey  string
}

type pointMigrationEntry struct {
	PointID      string `json:"pointId"`
	SourceValue  string `json:"sourceValue"`
	SelectedTag  string `json:"selectedTag"`
	Reason       string `json:"reason"`
	SourceName   string `json:"sourceName"`
	SelectedName string `json:"selectedName"`
	NameReason   string `json:"nameReason"`
}

func normalizePointTag(tag string) (string, string, error) {
	return webPoints.NormalizeTag(tag)
}

func normalizePointName(name string) (string, string, error) {
	return webPoints.NormalizeName(name)
}

func validatePointNamespace(ioCfg ConfigIO, vpCfg ConfigVirtualPoints) []configValidationError {
	entries, errs := pointNamespaceEntries(ioCfg, vpCfg)
	errs = append(errs, validatePointTagEntries(entries)...)
	errs = append(errs, validatePointNameEntries(entries)...)
	return errs
}

type pointNamespaceTransitionOperation uint8

const (
	pointNamespaceOperationLegacyCompatible pointNamespaceTransitionOperation = iota
	pointNamespaceOperationGeneral
	pointNamespaceOperationSingleNamePatch
)

type pointNamespaceTransitionOptions struct {
	Operation pointNamespaceTransitionOperation
	PointID   string
	NameOnly  bool
}

func validatePointNamespaceTransition(beforeIO ConfigIO, beforeVP ConfigVirtualPoints, candidateIO ConfigIO, candidateVP ConfigVirtualPoints) []configValidationError {
	return validatePointNamespaceTransitionWithOptions(beforeIO, beforeVP, candidateIO, candidateVP, pointNamespaceTransitionOptions{Operation: pointNamespaceOperationLegacyCompatible})
}

func validatePointNamespaceTransitionWithOptions(beforeIO ConfigIO, beforeVP ConfigVirtualPoints, candidateIO ConfigIO, candidateVP ConfigVirtualPoints, options pointNamespaceTransitionOptions) []configValidationError {
	beforeEntries, _ := pointNamespaceEntries(beforeIO, beforeVP)
	candidateEntries, candidateStructuralErrs := pointNamespaceEntries(candidateIO, candidateVP)
	errs := append([]configValidationError{}, candidateStructuralErrs...)
	errs = append(errs, validatePointTagEntries(candidateEntries)...)
	candidateNameErrs := validatePointNameEntries(candidateEntries)
	beforePairs := pointNameConflictPairs(beforeEntries)
	if len(beforePairs) == 0 {
		return append(errs, candidateNameErrs...)
	}
	candidatePairs := pointNameConflictPairs(candidateEntries)
	if options.Operation == pointNamespaceOperationLegacyCompatible && strictPointNameConflictSubset(candidatePairs, beforePairs) {
		for _, err := range candidateNameErrs {
			if err.Reason != "point_name_conflict" {
				errs = append(errs, err)
			}
		}
		return errs
	}
	if options.Operation == pointNamespaceOperationSingleNamePatch && options.NameOnly && strictPointNameConflictSubset(candidatePairs, beforePairs) && singleConflictedNameChange(beforeEntries, candidateEntries, beforePairs, options.PointID) {
		for _, err := range candidateNameErrs {
			if err.Reason != "point_name_conflict" {
				errs = append(errs, err)
			}
		}
		return errs
	}
	for _, pair := range sortedPointNameConflictPairs(candidatePairs) {
		entry := pointNamespaceEntry{PointID: pair.left}
		for _, candidate := range candidateEntries {
			if candidate.PointID == pair.left {
				entry = candidate
				break
			}
		}
		conflict := pointNamespaceEntry{PointID: pair.right}
		for _, candidate := range candidateEntries {
			if candidate.PointID == pair.right {
				conflict = candidate
				break
			}
		}
		errs = append(errs, pointNameError(entry, "point_namespace_conflicted", "legacy display-name conflict set must strictly decrease", conflict))
	}
	if !hasValidationReason(errs, "point_namespace_conflicted") {
		errs = append(errs, configValidationError{Path: "point_namespace", Message: "legacy display-name conflict set must strictly decrease", Reason: "point_namespace_conflicted"})
	}
	return errs
}

func singleConflictedNameChange(before, candidate []pointNamespaceEntry, baseline map[pointNameConflictPair]struct{}, pointID string) bool {
	if pointID == "" {
		return false
	}
	inConflict := false
	for pair := range baseline {
		if pair.left == pointID || pair.right == pointID {
			inConflict = true
			break
		}
	}
	if !inConflict {
		return false
	}
	beforeNames := make(map[string]string, len(before))
	candidateNames := make(map[string]string, len(candidate))
	for _, entry := range before {
		_, key, err := normalizePointName(entry.Name)
		if err == nil {
			beforeNames[entry.PointID] = key
		}
	}
	for _, entry := range candidate {
		_, key, err := normalizePointName(entry.Name)
		if err == nil {
			candidateNames[entry.PointID] = key
		}
	}
	changed := 0
	for id, beforeName := range beforeNames {
		if candidateNames[id] != beforeName {
			if id != pointID {
				return false
			}
			changed++
		}
	}
	return changed == 1
}

type pointNameConflictPair struct {
	left  string
	right string
}

func pointNameConflictPairs(entries []pointNamespaceEntry) map[pointNameConflictPair]struct{} {
	groups := map[string][]pointNamespaceEntry{}
	for _, entry := range entries {
		_, key, err := normalizePointName(entry.Name)
		if err == nil {
			groups[key] = append(groups[key], entry)
		}
	}
	pairs := make(map[pointNameConflictPair]struct{})
	for _, group := range groups {
		for i := 0; i < len(group); i++ {
			for j := i + 1; j < len(group); j++ {
				left, right := group[i].PointID, group[j].PointID
				if left > right {
					left, right = right, left
				}
				pairs[pointNameConflictPair{left: left, right: right}] = struct{}{}
			}
		}
	}
	return pairs
}

func strictPointNameConflictSubset(candidate, baseline map[pointNameConflictPair]struct{}) bool {
	if len(candidate) >= len(baseline) {
		return false
	}
	for pair := range candidate {
		if _, ok := baseline[pair]; !ok {
			return false
		}
	}
	return true
}

func sortedPointNameConflictPairs(pairs map[pointNameConflictPair]struct{}) []pointNameConflictPair {
	out := make([]pointNameConflictPair, 0, len(pairs))
	for pair := range pairs {
		out = append(out, pair)
	}
	slices.SortFunc(out, func(a, b pointNameConflictPair) int {
		if a.left != b.left {
			return strings.Compare(a.left, b.left)
		}
		return strings.Compare(a.right, b.right)
	})
	return out
}

func hasValidationReason(errs []configValidationError, reason string) bool {
	for _, err := range errs {
		if err.Reason == reason {
			return true
		}
	}
	return false
}

func validatePointTagNamespace(ioCfg ConfigIO, vpCfg ConfigVirtualPoints) []configValidationError {
	entries, errs := pointNamespaceEntries(ioCfg, vpCfg)
	return append(errs, validatePointTagEntries(entries)...)
}

func validatePointTagEntries(entries []pointNamespaceEntry) []configValidationError {
	catalogEntries := make([]webPoints.Entry, 0, len(entries))
	for _, entry := range entries {
		catalogEntries = append(catalogEntries, webPoints.Entry{PointID: entry.PointID, TagPath: entry.TagPath, Tag: entry.Tag})
	}
	catalogErrs := webPoints.ValidateTags(catalogEntries, reservedPointID)
	errs := make([]configValidationError, 0, len(catalogErrs))
	for _, err := range catalogErrs {
		errs = append(errs, pointTagError(
			pointNamespaceEntry{PointID: err.Entry.PointID, TagPath: err.Entry.TagPath, Tag: err.Entry.Tag},
			err.Reason,
			err.Message,
			pointNamespaceEntry{PointID: err.Conflict.PointID, TagPath: err.Conflict.TagPath, Tag: err.Conflict.Tag},
		))
	}
	return errs
}

func validatePointNameEntries(entries []pointNamespaceEntry) []configValidationError {
	var errs []configValidationError
	seen := make(map[string]pointNamespaceEntry, len(entries))
	for _, entry := range entries {
		if entry.NamePath == "" {
			continue
		}
		display, key, err := normalizePointName(entry.Name)
		if err != nil {
			errs = append(errs, pointNameError(entry, "point_name_invalid", err.Error(), pointNamespaceEntry{}))
			continue
		}
		entry.Name, entry.NameKey = display, key
		if previous, ok := seen[key]; ok && previous.PointID != entry.PointID {
			errs = append(errs, pointNameError(entry, "point_name_conflict", "must be unique", previous))
			continue
		}
		seen[key] = entry
	}
	return errs
}

func pointNamespaceEntries(ioCfg ConfigIO, vpCfg ConfigVirtualPoints) ([]pointNamespaceEntry, []configValidationError) {
	entries := make([]pointNamespaceEntry, 0, 24+len(vpCfg.Items))
	var errs []configValidationError
	entries, errs = appendConfigNamespaceEntries(entries, errs, "ui", ioCfg.UI, "UI", capabilities.ABIUniversalInputs)
	entries, errs = appendConfigNamespaceEntries(entries, errs, "ao", ioCfg.AO, "AO", capabilities.ABIAnalogOutputs)
	entries, errs = appendConfigNamespaceEntries(entries, errs, "do", ioCfg.DO, "DO", capabilities.ABIDigitalOutputs)
	for i, item := range vpCfg.Items {
		id := canonicalVirtualPointID(item.ID)
		entries = append(entries, pointNamespaceEntry{
			PointID: id,
			TagPath: fmt.Sprintf("items[%d].tag", i),
			Tag:     fallbackPointTag(item.Tag, id),
		})
	}
	return entries, errs
}

func appendConfigNamespaceEntries(entries []pointNamespaceEntry, errs []configValidationError, field string, items []map[string]any, prefix string, max int) ([]pointNamespaceEntry, []configValidationError) {
	rows := make(map[int]map[string]any, len(items))
	indexes := make(map[int]int, len(items))
	for i, item := range items {
		channel, ok, good := intField(item, "ch")
		if !ok || !good || channel < 1 || channel > max {
			continue
		}
		if _, exists := rows[channel]; exists {
			previousIndex := indexes[channel]
			errs = append(errs, configValidationError{
				Path:            fmt.Sprintf("%s[%d].ch", field, i),
				Message:         "must be unique",
				Reason:          "point_channel_conflict",
				PointID:         formatPointID(prefix, channel),
				ConflictPointID: formatPointID(prefix, channel),
				ConflictPath:    fmt.Sprintf("%s[%d].ch", field, previousIndex),
			})
			continue
		}
		rows[channel], indexes[channel] = item, i
	}
	for channel := 1; channel <= max; channel++ {
		id := formatPointID(prefix, channel)
		item, exists := rows[channel]
		index := channel - 1
		if exists {
			index = indexes[channel]
		}
		tag, _, tagGood := stringField(item, "tag")
		if !tagGood {
			tag = ""
		}
		name, _, nameGood := stringField(item, "name")
		if !nameGood {
			name = ""
		}
		entries = append(entries, pointNamespaceEntry{
			PointID:  id,
			TagPath:  fmt.Sprintf("%s[%d].tag", field, index),
			Tag:      fallbackPointTag(tag, id),
			NamePath: fmt.Sprintf("%s[%d].name", field, index),
			Name:     fallbackPointName(name, id),
		})
	}
	return entries, errs
}

func validateConfigPointMetadata(cfg ConfigIO) []configValidationError {
	var errs []configValidationError
	validateRows := func(field, prefix string, rows []map[string]any, max int) {
		seen := make(map[int]int, len(rows))
		for i, row := range rows {
			base := fmt.Sprintf("%s[%d]", field, i)
			channel, ok, good := intField(row, "ch")
			if ok && good && channel >= 1 && channel <= max {
				if previous, exists := seen[channel]; exists {
					errs = append(errs, configValidationError{
						Path:            base + ".ch",
						Message:         "must be unique",
						Reason:          "point_channel_conflict",
						PointID:         formatPointID(prefix, channel),
						ConflictPointID: formatPointID(prefix, channel),
						ConflictPath:    fmt.Sprintf("%s[%d].ch", field, previous),
					})
				}
				if _, exists := seen[channel]; !exists {
					seen[channel] = i
				}
			}
			tag, ok, good := stringField(row, "tag")
			if !ok || !good {
				errs = append(errs, configValidationError{Path: base + ".tag", Message: "is required and must be string", Reason: "point_tag_invalid"})
			} else if _, _, err := normalizePointTag(tag); err != nil {
				errs = append(errs, configValidationError{Path: base + ".tag", Message: err.Error(), Reason: "point_tag_invalid", Tag: tag})
			}
			name, ok, good := stringField(row, "name")
			if !ok || !good {
				errs = append(errs, configValidationError{Path: base + ".name", Message: "is required and must be string", Reason: "point_name_invalid"})
			} else if _, _, err := normalizePointName(name); err != nil {
				errs = append(errs, configValidationError{Path: base + ".name", Message: err.Error(), Reason: "point_name_invalid", Name: name})
			}
		}
		for channel := 1; channel <= max; channel++ {
			if _, exists := seen[channel]; !exists {
				errs = append(errs, configValidationError{Path: field, Message: fmt.Sprintf("must include channel %d exactly once", channel), Reason: "point_channel_conflict"})
			}
		}
	}
	// `F-PIO-008`: ba con số này TỪNG là literal. Chúng là SỨC CHỨA ABI, khai
	// báo một lần ở `internal/capabilities`. Trần theo NĂNG LỰC BO thì khác —
	// nó nằm ở `configschema.Bounds`, vì siết không gian định danh điểm theo
	// runtime sẽ đổi luôn nghĩa của "must include channel N exactly once" và
	// thuộc về đợt hỗ trợ SKU DI.
	validateRows("ui", "UI", cfg.UI, capabilities.ABIUniversalInputs)
	validateRows("ao", "AO", cfg.AO, capabilities.ABIAnalogOutputs)
	validateRows("do", "DO", cfg.DO, capabilities.ABIDigitalOutputs)
	return errs
}

func validateVirtualPointMetadata(cfg ConfigVirtualPoints) []configValidationError {
	var errs []configValidationError
	for i, item := range cfg.Items {
		base := fmt.Sprintf("items[%d]", i)
		if _, _, err := normalizePointTag(item.Tag); err != nil {
			errs = append(errs, configValidationError{Path: base + ".tag", Message: err.Error(), Reason: "point_tag_invalid", PointID: canonicalVirtualPointID(item.ID), Tag: item.Tag})
		}
	}
	return errs
}

func fallbackPointTag(tag, pointID string) string {
	if strings.TrimSpace(tag) == "" {
		return pointID
	}
	return tag
}

func fallbackPointName(name, pointID string) string {
	if strings.TrimSpace(name) == "" {
		return pointID
	}
	return name
}

func reservedPointID(value string) (string, bool) {
	prefix, channel, ok := parsePointID(value)
	if !ok {
		return "", false
	}
	switch prefix {
	case "UI", "AI":
		return formatPointID("UI", channel), true
	case "DI", "BI":
		return formatPointID("UI", kxNUI+channel), true
	case "AO":
		return formatPointID("AO", channel), true
	case "DO", "BO":
		return formatPointID("DO", channel), true
	case "VP", "AV":
		return formatVirtualPointID(channel), true
	case "BV", "MSV":
		return fmt.Sprintf("%s%d", prefix, channel), true
	default:
		return "", false
	}
}

func pointTagError(entry pointNamespaceEntry, reason, message string, conflict pointNamespaceEntry) configValidationError {
	return configValidationError{
		Path:            entry.TagPath,
		Message:         message,
		Reason:          reason,
		PointID:         entry.PointID,
		ConflictPointID: conflict.PointID,
		ConflictPath:    conflict.TagPath,
		Tag:             entry.Tag,
	}
}

func pointNameError(entry pointNamespaceEntry, reason, message string, conflict pointNamespaceEntry) configValidationError {
	return configValidationError{
		Path:            entry.NamePath,
		Message:         message,
		Reason:          reason,
		PointID:         entry.PointID,
		ConflictPointID: conflict.PointID,
		ConflictPath:    conflict.NamePath,
		Name:            entry.Name,
	}
}

func migratePointTags(ioCfg ConfigIO, vpCfg ConfigVirtualPoints) (ConfigIO, ConfigVirtualPoints) {
	migratedIO, migratedVPs, _ := migratePointMetadata(ioCfg, vpCfg)
	return migratedIO, migratedVPs
}

func migratePointMetadata(ioCfg ConfigIO, vpCfg ConfigVirtualPoints) (ConfigIO, ConfigVirtualPoints, []pointMigrationEntry) {
	type candidate struct {
		pointID      string
		source       string
		value        string
		key          string
		setTag       func(string)
		sourceName   string
		selectedName string
		nameKey      string
		nameReason   string
		setName      func(string)
	}
	migratedIO := ConfigIO{}
	migratedVPs := ConfigVirtualPoints{Items: append([]VirtualPoint(nil), vpCfg.Items...)}
	var candidates []candidate
	var report []pointMigrationEntry
	addRows := func(items []map[string]any, prefix string, max int) []map[string]any {
		byChannel := make(map[int]map[string]any, len(items))
		for _, item := range items {
			channel, _, good := intField(item, "ch")
			if good && channel >= 1 && channel <= max {
				byChannel[channel] = item
			}
		}
		out := make([]map[string]any, 0, max)
		for channel := 1; channel <= max; channel++ {
			item := byChannel[channel]
			next := make(map[string]any, len(item)+4)
			maps.Copy(next, item)
			next["ch"] = channel
			if prefix == "UI" {
				if _, ok := next["type"]; !ok {
					next["type"] = "none"
				}
			}
			if prefix == "AO" {
				if _, ok := next["mode"]; !ok {
					next["mode"] = "0-10V"
				}
			}
			out = append(out, next)
			pointID := formatPointID(prefix, channel)
			source, value := "canonical_physical_tag", pointID
			_, key, _ := normalizePointTag(value)
			row := next
			sourceName := stringMapField(item, "name")
			selectedName, nameReason := migrationNameDecision(sourceName, pointID)
			row["name"] = selectedName
			candidates = append(candidates, candidate{
				pointID: pointID, source: source, value: value, key: key,
				setTag:     func(tag string) { row["tag"] = tag },
				sourceName: sourceName, selectedName: selectedName,
				nameKey: migrationNameKey(selectedName), nameReason: nameReason,
				setName: func(name string) { row["name"] = name },
			})
		}
		return out
	}
	migratedIO.UI = addRows(ioCfg.UI, "UI", capabilities.ABIUniversalInputs)
	migratedIO.AO = addRows(ioCfg.AO, "AO", capabilities.ABIAnalogOutputs)
	migratedIO.DO = addRows(ioCfg.DO, "DO", capabilities.ABIDigitalOutputs)
	for i := range migratedVPs.Items {
		item := &migratedVPs.Items[i]
		item.ID = canonicalVirtualPointID(item.ID)
		source, value := migrationTagValue(item.Tag, item.Label, item.ID)
		_, key, _ := normalizePointTag(value)
		sourceName := item.Label
		item.Label = ""
		candidates = append(candidates, candidate{
			pointID: item.ID, source: source, value: value, key: key,
			setTag:     func(tag string) { item.Tag = tag },
			sourceName: sourceName, nameReason: "removed",
			setName: func(string) {},
		})
	}
	counts := make(map[string]int, len(candidates))
	nameCounts := make(map[string]int, len(candidates))
	for _, item := range candidates {
		counts[item.key]++
		if item.nameKey != "" {
			nameCounts[item.nameKey]++
		}
	}
	for _, item := range candidates {
		selected, reason := item.value, item.source
		if counts[item.key] > 1 {
			selected, reason = item.pointID, "duplicate_fallback"
		}
		item.setTag(selected)
		nameReason := item.nameReason
		if nameCounts[item.nameKey] > 1 && item.sourceName != "" && item.nameReason != "canonical_fallback" {
			nameReason = "duplicate_preserved"
		}
		report = append(report, pointMigrationEntry{
			PointID: item.pointID, SourceValue: item.value, SelectedTag: selected, Reason: reason,
			SourceName: item.sourceName, SelectedName: item.selectedName, NameReason: nameReason,
		})
	}
	return migratedIO, migratedVPs, report
}

func migrationNameDecision(name, pointID string) (string, string) {
	canonical, _, err := normalizePointName(name)
	if err != nil {
		return pointID, "canonical_fallback"
	}
	return canonical, "existing_name"
}

func migrationNameKey(name string) string {
	_, key, err := normalizePointName(name)
	if err != nil {
		return ""
	}
	return key
}

func migrationPointTag(item map[string]any, pointID string) (string, string) {
	return migrationTagValue(stringMapField(item, "tag"), stringMapField(item, "name"), pointID)
}

func migrationTagValue(tag, display, pointID string) (string, string) {
	for _, candidate := range []struct{ source, value string }{{"existing_tag", tag}, {"display_name", display}} {
		canonical, _, err := normalizePointTag(candidate.value)
		if err != nil {
			continue
		}
		if reserved, ok := reservedPointID(canonical); ok {
			if reserved != pointID || canonical != pointID {
				continue
			}
		}
		return candidate.source, canonical
	}
	return "canonical_fallback", pointID
}

func migrationNameValue(name, pointID string) string {
	canonical, _, err := normalizePointName(name)
	if err != nil {
		return pointID
	}
	return canonical
}

func stringMapField(item map[string]any, field string) string {
	value, _, good := stringField(item, field)
	if !good {
		return ""
	}
	return value
}

func clonePointIOConfig(cfg ConfigIO) ConfigIO {
	cloneRows := func(rows []map[string]any) []map[string]any {
		out := make([]map[string]any, len(rows))
		for i, row := range rows {
			out[i] = make(map[string]any, len(row))
			maps.Copy(out[i], row)
		}
		return out
	}
	return ConfigIO{Revision: cfg.Revision, Checksum: cfg.Checksum,
		UI: cloneRows(cfg.UI), AO: cloneRows(cfg.AO), DO: cloneRows(cfg.DO)}
}

func clonePointVirtualConfig(cfg ConfigVirtualPoints) ConfigVirtualPoints {
	return ConfigVirtualPoints{Items: append([]VirtualPoint(nil), cfg.Items...)}
}

func normalizePointTags(ioCfg ConfigIO, vpCfg ConfigVirtualPoints) (ConfigIO, ConfigVirtualPoints) {
	normalizeRows := func(items []map[string]any) []map[string]any {
		out := make([]map[string]any, len(items))
		for i, item := range items {
			next := make(map[string]any, len(item))
			maps.Copy(next, item)
			if display, _, err := normalizePointTag(stringMapField(item, "tag")); err == nil {
				next["tag"] = display
			}
			if display, _, err := normalizePointName(stringMapField(item, "name")); err == nil {
				next["name"] = display
			}
			out[i] = next
		}
		return out
	}
	ioCfg.UI = normalizeRows(ioCfg.UI)
	ioCfg.AO = normalizeRows(ioCfg.AO)
	ioCfg.DO = normalizeRows(ioCfg.DO)
	items := make([]VirtualPoint, len(vpCfg.Items))
	for i, item := range vpCfg.Items {
		if display, _, err := normalizePointTag(item.Tag); err == nil {
			item.Tag = display
		}
		item.Label = ""
		items[i] = item
	}
	vpCfg.Items = items
	return ioCfg, vpCfg
}

type pointMigrationSnapshot struct {
	path    string
	present bool
	data    []byte
	mode    os.FileMode
}

type pointMigrationWrite struct {
	snapshot pointMigrationSnapshot
	data     []byte
}

func (a *App) migrateLegacyPointConfig() error {
	ioPath := a.configPath(configGroupIO.file)
	vpPath := a.configPath(configGroupVirtualPoints.file)
	_, ioErr := os.Stat(ioPath)
	_, vpErr := os.Stat(vpPath)
	if os.IsNotExist(ioErr) && os.IsNotExist(vpErr) {
		return nil
	}
	ioCfg, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		return fmt.Errorf("read point-tag migration IO config: %w", err)
	}
	vpCfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return fmt.Errorf("read point-tag migration VP config: %w", err)
	}
	if errs := validateLegacyPhysicalTopology(ioCfg); len(errs) > 0 {
		return fmt.Errorf("point-tag migration source topology invalid: %s", configValidationSummary(errs))
	}
	migratedIO, migratedVPs, report := migratePointMetadata(ioCfg, vpCfg)
	var migrationErrs []configValidationError
	migrationErrs = append(migrationErrs, validateConfigIO(migratedIO)...)
	migrationErrs = append(migrationErrs, validateConfigPointMetadata(migratedIO)...)
	migrationErrs = append(migrationErrs, validateConfigVirtualPoints(migratedVPs)...)
	migrationErrs = append(migrationErrs, validateVirtualPointMetadata(migratedVPs)...)
	migrationErrs = append(migrationErrs, validatePointTagNamespace(migratedIO, migratedVPs)...)
	if len(migrationErrs) > 0 {
		return fmt.Errorf("point-tag migration validation failed: %s", configValidationSummary(migrationErrs))
	}

	writes := make([]pointMigrationWrite, 0, 3)
	addWrite := func(path string, value any) error {
		data, err := encodePointMigrationFile(value)
		if err != nil {
			return err
		}
		snapshot, err := capturePointMigrationSnapshot(path)
		if err != nil {
			return err
		}
		writes = append(writes, pointMigrationWrite{snapshot: snapshot, data: data})
		return nil
	}
	if ioErr == nil && !reflect.DeepEqual(ioCfg, migratedIO) {
		if err := addWrite(ioPath, migratedIO); err != nil {
			return fmt.Errorf("prepare point-tag migration IO: %w", err)
		}
	}
	if vpErr == nil && !reflect.DeepEqual(vpCfg, migratedVPs) {
		if err := addWrite(vpPath, migratedVPs); err != nil {
			return fmt.Errorf("prepare point-tag migration VP: %w", err)
		}
	}
	if len(report) > 0 {
		reportPath := filepath.Join(filepath.Dir(ioPath), "point_tag_migration_report.json")
		if _, err := os.Stat(reportPath); os.IsNotExist(err) {
			if err := addWrite(reportPath, report); err != nil {
				return fmt.Errorf("prepare point-tag migration report: %w", err)
			}
		} else if err != nil {
			return fmt.Errorf("inspect point-tag migration report: %w", err)
		}
	}
	attempted := make([]pointMigrationWrite, 0, len(writes))
	for _, write := range writes {
		attempted = append(attempted, write)
		if err := a.writePreparedPointMigrationFile(write.snapshot.path, write.data, 0o644); err != nil {
			rollbackErr := rollbackPointMigrationFiles(attempted)
			if rollbackErr != nil {
				return fmt.Errorf("point-tag migration write %s failed; rollback failed: %w", write.snapshot.path, errors.Join(err, rollbackErr))
			}
			return fmt.Errorf("point-tag migration write %s failed: %w", write.snapshot.path, err)
		}
	}
	return nil
}

func encodePointMigrationFile(value any) ([]byte, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode point-tag migration file: %w", err)
	}
	return append(data, byte(10)), nil
}

func capturePointMigrationSnapshot(path string) (pointMigrationSnapshot, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return pointMigrationSnapshot{path: path}, nil
		}
		return pointMigrationSnapshot{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return pointMigrationSnapshot{}, err
	}
	return pointMigrationSnapshot{path: path, present: true, data: data, mode: info.Mode().Perm()}, nil
}

func (a *App) writePreparedPointMigrationFile(path string, data []byte, perm os.FileMode) error {
	writer := a.pointMigrationWriter
	if writer == nil {
		writer = writeConfigFileAtomic
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("prepare point-tag migration dir: %w", err)
	}
	if err := writer(path, data, perm); err != nil {
		return fmt.Errorf("write point-tag migration file: %w", err)
	}
	return nil
}

func rollbackPointMigrationFiles(files []pointMigrationWrite) error {
	var rollbackErr error
	for i := len(files) - 1; i >= 0; i-- {
		snapshot := files[i].snapshot
		if snapshot.present {
			if err := os.WriteFile(snapshot.path, snapshot.data, snapshot.mode); err != nil {
				rollbackErr = errors.Join(rollbackErr, fmt.Errorf("restore %s: %w", snapshot.path, err))
				continue
			}
			if err := os.Chmod(snapshot.path, snapshot.mode); err != nil {
				rollbackErr = errors.Join(rollbackErr, fmt.Errorf("restore mode %s: %w", snapshot.path, err))
			}
			continue
		}
		if err := os.Remove(snapshot.path); err != nil && !os.IsNotExist(err) {
			rollbackErr = errors.Join(rollbackErr, fmt.Errorf("remove %s: %w", snapshot.path, err))
		}
	}
	return rollbackErr
}

func validateLegacyPhysicalTopology(cfg ConfigIO) []configValidationError {
	var errs []configValidationError
	validateRows := func(field string, rows []map[string]any, max int) {
		seen := make(map[int]int, len(rows))
		for i, row := range rows {
			path := fmt.Sprintf("%s[%d].ch", field, i)
			channel, ok, good := intField(row, "ch")
			if !ok || !good {
				errs = append(errs, configValidationError{Path: path, Message: "must be integer", Reason: "point_channel_invalid"})
				continue
			}
			if channel < 1 || channel > max {
				errs = append(errs, configValidationError{Path: path, Message: fmt.Sprintf("must be integer in range 1..%d", max), Reason: "point_channel_invalid"})
				continue
			}
			if previous, exists := seen[channel]; exists {
				errs = append(errs, configValidationError{Path: path, Message: fmt.Sprintf("duplicates %s[%d].ch", field, previous), Reason: "point_channel_conflict"})
				continue
			}
			seen[channel] = i
		}
	}
	validateRows("ui", cfg.UI, capabilities.ABIUniversalInputs)
	validateRows("ao", cfg.AO, capabilities.ABIAnalogOutputs)
	validateRows("do", cfg.DO, capabilities.ABIDigitalOutputs)
	return errs
}

func writePointMigrationFile(path string, value any) error {
	data, err := encodePointMigrationFile(value)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("prepare point-tag migration dir: %w", err)
	}
	if err := writeConfigFileAtomic(path, data, 0o644); err != nil {
		return fmt.Errorf("write point-tag migration file: %w", err)
	}
	return nil
}
