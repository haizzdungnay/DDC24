package points

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Limits struct {
	UI int
	AO int
	DO int
	VP int
}

type Entry struct {
	PointID string
	TagPath string
	Tag     string
}

type TagError struct {
	Entry    Entry
	Conflict Entry
	Reason   string
	Message  string
}

type ReservedResolver func(string) (string, bool)

func NormalizeTag(tag string) (string, string, error) {
	start, end := 0, len(tag)
	for start < end && tag[start] == ' ' {
		start++
	}
	for end > start && tag[end-1] == ' ' {
		end--
	}
	var b strings.Builder
	space := false
	for _, r := range tag[start:end] {
		if r == ' ' {
			space = b.Len() > 0
			continue
		}
		if space {
			b.WriteByte(' ')
			space = false
		}
		if r > 0x7f || !(r >= 'A' && r <= 'Z') && !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9') && r != '_' && r != '.' && r != '-' {
			return "", "", fmt.Errorf("must contain only ASCII letters, digits, spaces, _, ., or -")
		}
		b.WriteRune(r)
	}
	display := b.String()
	if display == "" {
		return "", "", fmt.Errorf("is required")
	}
	if len(display) > 64 {
		return "", "", fmt.Errorf("must be at most 64 bytes")
	}
	if !isASCIILetterOrDigit(display[0]) {
		return "", "", fmt.Errorf("must start with an ASCII letter or digit")
	}
	return display, strings.ToLower(display), nil
}

func NormalizeName(name string) (string, string, error) {
	for _, r := range name {
		if unicode.IsControl(r) {
			return "", "", fmt.Errorf("must not contain control characters")
		}
	}
	display := strings.Join(strings.Fields(name), " ")
	if display == "" {
		return "", "", fmt.Errorf("is required")
	}
	if utf8.RuneCountInString(display) > 64 {
		return "", "", fmt.Errorf("must be at most 64 Unicode code points")
	}
	return display, strings.ToLower(display), nil
}

func ValidateTags(entries []Entry, resolveReserved ReservedResolver) []TagError {
	var errs []TagError
	seen := make(map[string]Entry, len(entries))
	for _, entry := range entries {
		display, key, err := NormalizeTag(entry.Tag)
		if err != nil {
			errs = append(errs, TagError{Entry: entry, Reason: "point_tag_invalid", Message: err.Error()})
			continue
		}
		entry.Tag = display
		if resolveReserved != nil {
			if reserved, ok := resolveReserved(display); ok && (reserved != entry.PointID || display != entry.PointID) {
				errs = append(errs, TagError{Entry: entry, Conflict: Entry{PointID: reserved}, Reason: "point_tag_reserved", Message: "is reserved for point " + reserved})
				continue
			}
		}
		if previous, ok := seen[key]; ok && previous.PointID != entry.PointID {
			errs = append(errs, TagError{Entry: entry, Conflict: previous, Reason: "point_tag_conflict", Message: "must be unique"})
			continue
		}
		seen[key] = entry
	}
	return errs
}

func CanonicalConfigID(rawID string, limits Limits) (string, bool) {
	id := strings.TrimSpace(rawID)
	prefix, channel, ok := ParseID(id)
	if !ok {
		return "", false
	}
	var canonical string
	switch prefix {
	case "UI":
		if channel < 1 || channel > limits.UI {
			return "", false
		}
		canonical = FormatPhysicalID(prefix, channel)
	case "AO":
		if channel < 1 || channel > limits.AO {
			return "", false
		}
		canonical = FormatPhysicalID(prefix, channel)
	case "DO":
		if channel < 1 || channel > limits.DO {
			return "", false
		}
		canonical = FormatPhysicalID(prefix, channel)
	case "VP":
		if channel < 1 || channel > limits.VP {
			return "", false
		}
		canonical = fmt.Sprintf("VP%d", channel)
	default:
		return "", false
	}
	return canonical, id == canonical
}

func ParseID(id string) (string, int, bool) {
	raw := strings.ToUpper(strings.TrimSpace(id))
	i := 0
	for i < len(raw) && raw[i] >= 'A' && raw[i] <= 'Z' {
		i++
	}
	if i == 0 || i >= len(raw) {
		return "", 0, false
	}
	digits := raw[i:]
	if strings.HasPrefix(digits, "-") || strings.HasPrefix(digits, "_") {
		digits = digits[1:]
	}
	channel, err := strconv.Atoi(digits)
	return raw[:i], channel, err == nil && channel > 0
}

func FormatPhysicalID(prefix string, channel int) string {
	return fmt.Sprintf("%s-%02d", prefix, channel)
}

func isASCIILetterOrDigit(ch byte) bool {
	return ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9'
}
