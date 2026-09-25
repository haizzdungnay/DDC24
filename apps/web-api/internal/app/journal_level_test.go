package app

import (
	"bytes"
	"fmt"
	"log"
	"os"
	"syscall"
	"testing"
)

// F08: dòng WARN/ERROR phải mang tiền tố syslog để `journalctl -p warning` thấy.
func TestJournalLevelWriterPrefixesSyslogPriority(t *testing.T) {
	var sink bytes.Buffer
	logger := log.New(journalLevelWriter{out: &sink}, "mkddc-web ", log.LstdFlags|log.LUTC)
	logger.Printf("WARN health degraded err=shm")
	logger.Printf("ERROR bind failed")
	logger.Printf("INFO http method=GET")
	logger.Printf("plain line without level")
	logger.Printf("INFO message mentions ERROR later but stays info padding padding padding")
	lines := bytes.Split(bytes.TrimRight(sink.Bytes(), "\n"), []byte("\n"))
	want := []string{"<4>", "<3>", "<6>", "", "<6>"}
	if len(lines) != len(want) {
		t.Fatalf("số dòng=%d: %q", len(lines), sink.String())
	}
	for index, prefix := range want {
		line := lines[index]
		if prefix == "" {
			if bytes.HasPrefix(line, []byte("<")) {
				t.Fatalf("dòng %d không có mức nhưng bị gắn tiền tố: %q", index, line)
			}
			continue
		}
		if !bytes.HasPrefix(line, []byte(prefix+"mkddc-web ")) {
			t.Fatalf("dòng %d phải bắt đầu bằng %s: %q", index, prefix, line)
		}
	}
}

func TestJournalAwareOutputRequiresTheRealJournalStream(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "stderr")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	stat := info.Sys().(*syscall.Stat_t)
	if isJournalStream(file, "") {
		t.Fatal("không có JOURNAL_STREAM thì không phải journald")
	}
	// Thừa hưởng biến môi trường nhưng stderr là file KHÁC: giữ nguyên dòng log.
	if isJournalStream(file, fmt.Sprintf("%d:%d", uint64(stat.Dev), uint64(stat.Ino)+1)) {
		t.Fatal("inode khác mà vẫn coi là journald")
	}
	if !isJournalStream(file, fmt.Sprintf("%d:%d", uint64(stat.Dev), uint64(stat.Ino))) {
		t.Fatal("đúng dev:inode phải nhận là journald")
	}
}
