package application

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

type hostileBundleEntry struct {
	name     string
	data     []byte
	method   uint16
	mode     os.FileMode
	flags    uint16
	extra    []byte
	comment  string
	modified time.Time
	nonUTF8  bool
}

type programmingSecurityCounts struct {
	Projects   int64
	Drafts     int64
	Revisions  int64
	Checks     int64
	Artifacts  int64
	Operations int64
	Audits     int64
	Receipts   int64
}

func unpackHostileBundle(t *testing.T, raw []byte) []hostileBundleEntry {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	entries := make([]hostileBundleEntry, 0, len(reader.File))
	for _, file := range reader.File {
		stream, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(stream)
		if closeErr := stream.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			t.Fatal(err)
		}
		entries = append(entries, hostileBundleEntry{name: file.Name, data: data, method: file.Method,
			mode: file.Mode(), flags: file.Flags, comment: file.Comment, modified: file.Modified, nonUTF8: file.NonUTF8})
	}
	return entries
}

func packHostileBundle(t *testing.T, entries []hostileBundleEntry) []byte {
	t.Helper()
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: entry.method, Flags: entry.flags,
			Extra: append([]byte(nil), entry.extra...), Comment: entry.comment, Modified: entry.modified, NonUTF8: entry.nonUTF8}
		header.SetMode(entry.mode)
		file, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func mutateRootManifest(t *testing.T, entries []hostileBundleEntry, mutate func(map[string]any)) []hostileBundleEntry {
	t.Helper()
	for index := range entries {
		if entries[index].name != "manifest.json" {
			continue
		}
		var manifest map[string]any
		if err := json.Unmarshal(entries[index].data, &manifest); err != nil {
			t.Fatal(err)
		}
		mutate(manifest)
		updated, err := json.Marshal(manifest)
		if err != nil {
			t.Fatal(err)
		}
		entries[index].data = updated
		return entries
	}
	t.Fatal("thiếu root manifest trong fixture")
	return nil
}

func securityCounts(t *testing.T, databasePath string) programmingSecurityCounts {
	t.Helper()
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var counts programmingSecurityCounts
	err = database.QueryRow(`SELECT
		(SELECT count(*) FROM projects), (SELECT count(*) FROM drafts),
		(SELECT count(*) FROM revisions), (SELECT count(*) FROM checks),
		(SELECT count(*) FROM artifacts), (SELECT count(*) FROM operations),
		(SELECT count(*) FROM audit_records), (SELECT count(*) FROM mutation_receipts)`).Scan(
		&counts.Projects, &counts.Drafts, &counts.Revisions, &counts.Checks,
		&counts.Artifacts, &counts.Operations, &counts.Audits, &counts.Receipts)
	if err != nil {
		t.Fatal(err)
	}
	return counts
}

func TestSourceBundleHostileCorpusRejectsWithoutMutation(t *testing.T) {
	service, store := openBundleService(t)
	_, revisionOne, revisionTwo := createBundleRevisionPair(t, service)
	actor := Actor{ID: testActorID, Role: "admin"}
	exported, err := service.ExportBundle(context.Background(), actor, BundleExportCommand{SchemaVersion: "1.0",
		RevisionIDs: []string{revisionOne, revisionTwo}, IdempotencyKey: "70000000-0000-4000-8000-000000000001",
		CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	base := unpackHostileBundle(t, exported.Bundle)
	baselineCounts := securityCounts(t, store.Path())

	firstNonRoot := func(entries []hostileBundleEntry) int {
		for index := range entries {
			if entries[index].name != "manifest.json" {
				return index
			}
		}
		return -1
	}
	clone := func() []hostileBundleEntry {
		result := make([]hostileBundleEntry, len(base))
		copy(result, base)
		for index := range result {
			result[index].data = append([]byte(nil), base[index].data...)
		}
		return result
	}

	cases := []struct {
		name       string
		mutate     func([]hostileBundleEntry) []hostileBundleEntry
		wantDetail string
	}{
		{name: "path traversal", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			return append(entries, hostileBundleEntry{name: "../escape.json", data: []byte("{}"), method: zip.Store, mode: 0o640, modified: entries[0].modified})
		}},
		{name: "absolute path", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].name = "/etc/shadow"
			return entries
		}},
		{name: "backslash path", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].name = `revisions\\escape.json`
			return entries
		}},
		{name: "control character path", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].name = "revisions/bad\nname.json"
			return entries
		}},
		{name: "non NFC path", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].name = "revisions/e\u0301.json"
			return entries
		}},
		{name: "invalid UTF-8 path", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].name = "revisions/\xff.json"
			entries[firstNonRoot(entries)].nonUTF8 = true
			return entries
		}},
		{name: "symlink", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].mode = os.ModeSymlink | 0o777
			return entries
		}},
		{name: "executable", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].mode = 0o755
			return entries
		}},
		{name: "compressed zip bomb", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].method = zip.Deflate
			entries[firstNonRoot(entries)].data = bytes.Repeat([]byte("A"), maxBundleFileBytes)
			return entries
		}},
		{name: "encrypted flag", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].flags |= 1
			return entries
		}},
		{name: "hardlink extra metadata", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			index := firstNonRoot(entries)
			entries[index].modified = time.Time{}
			entries[index].extra = []byte{0x0d, 0x00, 0x00, 0x00}
			return entries
		}},
		{name: "file comment metadata", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].comment = "hidden metadata"
			return entries
		}},
		{name: "non deterministic timestamp", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].modified = entries[firstNonRoot(entries)].modified.Add(time.Second)
			return entries
		}},
		{name: "duplicate archive path", wantDetail: "trùng path", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			return append(entries, entries[firstNonRoot(entries)])
		}},
		{name: "artifact native smuggling", wantDetail: "file set", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			return append(entries, hostileBundleEntry{name: "artifact/native.bin", data: []byte("ELF!"), method: zip.Store, mode: 0o640, modified: entries[0].modified})
		}},
		{name: "duplicate root JSON key", wantDetail: "manifest root", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			for index := range entries {
				if entries[index].name == "manifest.json" {
					entries[index].data = bytes.Replace(entries[index].data, []byte(`{"schemaVersion":"1.0"`),
						[]byte(`{"schemaVersion":"1.0","schemaVersion":"1.0"`), 1)
				}
			}
			return entries
		}},
		{name: "unknown root field", wantDetail: "manifest root", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			return mutateRootManifest(t, entries, func(manifest map[string]any) { manifest["artifact"] = "smuggled" })
		}},
		{name: "wrong target profile", wantDetail: "manifest root", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			return mutateRootManifest(t, entries, func(manifest map[string]any) { manifest["targetProfile"] = "attacker" })
		}},
		{name: "selected revision outside set", wantDetail: "manifest root", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			return mutateRootManifest(t, entries, func(manifest map[string]any) { manifest["selectedRevisionId"] = "79999999-9999-4999-8999-999999999999" })
		}},
		{name: "duplicate revision ID", wantDetail: "manifest root", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			return mutateRootManifest(t, entries, func(manifest map[string]any) {
				revisions := manifest["revisionIds"].([]any)
				manifest["revisionIds"] = append(revisions, revisions[0])
			})
		}},
		{name: "unsupported descriptor kind", wantDetail: "descriptor", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			return mutateRootManifest(t, entries, func(manifest map[string]any) {
				files := manifest["files"].([]any)
				files[0].(map[string]any)["kind"] = "ARTIFACT"
			})
		}},
		{name: "object hash mismatch", wantDetail: "hash", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			return mutateRootManifest(t, entries, func(manifest map[string]any) {
				files := manifest["files"].([]any)
				files[0].(map[string]any)["sha256"] = strings.Repeat("0", sha256.Size*2)
			})
		}},
		{name: "duplicate revision manifest key", wantDetail: "revision manifest", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			for index := range entries {
				if entries[index].name != "manifest.json" && strings.HasSuffix(entries[index].name, "/manifest.json") {
					entries[index].data = bytes.Replace(entries[index].data, []byte(`"schemaVersion":1`),
						[]byte(`"schemaVersion":1,"schemaVersion":1`), 1)
					break
				}
			}
			return mutateRootManifest(t, entries, func(manifest map[string]any) {
				files := manifest["files"].([]any)
				for _, raw := range files {
					descriptor := raw.(map[string]any)
					if descriptor["kind"] == "REVISION_MANIFEST" {
						for _, entry := range entries {
							if entry.name == descriptor["path"] {
								digest := sha256.Sum256(entry.data)
								descriptor["sha256"] = hex.EncodeToString(digest[:])
								descriptor["byteSize"] = len(entry.data)
								return
							}
						}
					}
				}
			})
		}},
		{name: "file size one over", wantDetail: "file ZIP", mutate: func(entries []hostileBundleEntry) []hostileBundleEntry {
			entries[firstNonRoot(entries)].data = bytes.Repeat([]byte("x"), maxBundleFileBytes+1)
			return entries
		}},
		{name: "file count one over", wantDetail: "số file", mutate: func(_ []hostileBundleEntry) []hostileBundleEntry {
			entries := make([]hostileBundleEntry, 0, maxBundleFiles+2)
			for index := 0; index < maxBundleFiles+2; index++ {
				entries = append(entries, hostileBundleEntry{name: fmt.Sprintf("padding/%04d.json", index), data: []byte("{}"),
					method: zip.Store, mode: 0o640, modified: time.Unix(fixedBundleUnixTime, 0).UTC()})
			}
			return entries
		}},
	}

	for index, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			hostile := packHostileBundle(t, testCase.mutate(clone()))
			digest := sha256.Sum256(hostile)
			_, err := service.ImportBundle(context.Background(), actor, BundleImportCommand{SchemaVersion: "1.0",
				Name: "Không được tạo", Description: "hostile corpus", Bundle: hostile,
				ExpectedSHA256: hex.EncodeToString(digest[:]),
				IdempotencyKey: fmt.Sprintf("70000000-0000-4000-8000-%012d", index+2), CorrelationID: testCorrelationID})
			if !errors.Is(err, ErrInvalidBundle) && !errors.Is(err, ErrBundleTooLarge) {
				t.Fatalf("hostile bundle accepted/returned wrong error: %v", err)
			}
			if testCase.wantDetail != "" && !strings.Contains(err.Error(), testCase.wantDetail) {
				t.Fatalf("error=%q; want detail %q", err, testCase.wantDetail)
			}
			if strings.Contains(strings.ToLower(err.Error()), "var_output fan") {
				t.Fatalf("error leaked source: %v", err)
			}
			if current := securityCounts(t, store.Path()); !reflect.DeepEqual(current, baselineCounts) {
				t.Fatalf("reject để lại mutation: before=%+v after=%+v", baselineCounts, current)
			}
		})
	}
}

func TestInspectSourceBundleRejectsArchiveByteLimitOneOver(t *testing.T) {
	raw := bytes.Repeat([]byte("x"), maxBundleBytes+1)
	_, _, err := inspectSourceBundle(raw, "71111111-1111-4111-8111-111111111111", "bounded")
	if !errors.Is(err, ErrBundleTooLarge) {
		t.Fatalf("archive one-over err=%v", err)
	}
}

func FuzzInspectSourceBundleBounded(f *testing.F) {
	f.Add([]byte("not-a-zip"))
	f.Add([]byte("PK\x03\x04"))
	f.Add(bytes.Repeat([]byte{0}, 1024))
	f.Fuzz(func(t *testing.T, raw []byte) {
		if len(raw) > maxBundleBytes+1 {
			raw = raw[:maxBundleBytes+1]
		}
		_, _, _ = inspectSourceBundle(raw, "72222222-2222-4222-8222-222222222222", "fuzz")
	})
}
