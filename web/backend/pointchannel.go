package main

import (
	"strconv"
	"strings"
)

const physicalPointChannelCount = kxNUI + kxNAO + kxNDO

func globalPointChannel(id string) (int, bool) {
	prefix, channel, ok := parsePointID(id)
	if !ok {
		return 0, false
	}
	switch prefix {
	case "UI":
		return channel, channel >= 1 && channel <= kxNUI
	case "AO":
		return kxNUI + channel, channel >= 1 && channel <= kxNAO
	case "DO":
		return kxNUI + kxNAO + channel, channel >= 1 && channel <= kxNDO
	case "VP":
		return physicalPointChannelCount + channel, channel >= 1 && channel <= virtualPointTotalCapacity
	default:
		return 0, false
	}
}

func pointIDFromGlobalChannel(channel int) (string, bool) {
	switch {
	case channel >= 1 && channel <= kxNUI:
		return formatPointID("UI", channel), true
	case channel <= kxNUI+kxNAO:
		return formatPointID("AO", channel-kxNUI), true
	case channel <= physicalPointChannelCount:
		return formatPointID("DO", channel-kxNUI-kxNAO), true
	case channel <= physicalPointChannelCount+virtualPointTotalCapacity:
		return formatVirtualPointID(channel - physicalPointChannelCount), true
	default:
		return "", false
	}
}

func pointIDOrGlobalChannel(value string) string {
	raw := strings.TrimSpace(value)
	channel, err := strconv.Atoi(raw)
	if err != nil {
		return raw
	}
	if id, ok := pointIDFromGlobalChannel(channel); ok {
		return id
	}
	return raw
}

func validateFixedPhysicalPointTags(cfg ConfigIO) []configValidationError {
	var errs []configValidationError
	validate := func(field, prefix string, rows []map[string]any) {
		for i, row := range rows {
			channel, ok, good := intField(row, "ch")
			if !ok || !good {
				continue
			}
			want := formatPointID(prefix, channel)
			tag, ok, good := stringField(row, "tag")
			if !ok || !good || tag != want {
				errs = append(errs, configValidationError{Path: field + "[" + strconv.Itoa(i) + "].tag", Message: "must be fixed to " + want, Reason: "physical_point_tag_fixed", PointID: want, Tag: tag})
			}
		}
	}
	validate("ui", "UI", cfg.UI)
	validate("ao", "AO", cfg.AO)
	validate("do", "DO", cfg.DO)
	return errs
}
