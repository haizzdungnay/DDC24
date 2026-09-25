package app

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"syscall"
)

// journalLevelWriter — EV-PROG-FBD-ST-MB-20260925 F08.
//
// Web in mọi dòng ra stdout/stderr với mức ở dạng CHỮ ("WARN", "ERROR"), còn
// journald chỉ hiểu tiền tố `<N>` đứng đầu dòng. Thiếu tiền tố thì mọi dòng
// là priority info, và `journalctl -p warning` trả "No entries" ngay lúc web
// đang in `WARN health degraded` — đúng cách baseline audit ngày 2026-09-25
// báo "0 cảnh báo" sai. Writer này chỉ gắn tiền tố khi chạy dưới systemd
// (`JOURNAL_STREAM` có mặt), nên chạy tay ở terminal vẫn giữ nguyên dòng log.
type journalLevelWriter struct{ out io.Writer }

func (w journalLevelWriter) Write(p []byte) (int, error) {
	level := journalLevelOf(p)
	if level < 0 {
		return w.out.Write(p)
	}
	line := make([]byte, 0, len(p)+3)
	line = append(line, '<', byte('0'+level), '>')
	line = append(line, p...)
	if _, err := w.out.Write(line); err != nil {
		return 0, err
	}
	return len(p), nil
}

// journalLevelOf lấy mức từ token mức XUẤT HIỆN SỚM NHẤT ở phần đầu dòng (sau
// tiền tố logger và mốc giờ). Lấy theo vị trí chứ không theo thứ tự ưu tiên:
// dòng "INFO ... ERROR ..." là một dòng INFO có nhắc tới chữ ERROR.
func journalLevelOf(p []byte) int {
	head := p
	if len(head) > 64 {
		head = head[:64]
	}
	tokens := []struct {
		text  string
		level int
	}{
		{" ERROR ", 3}, {" FATAL ", 3}, {" ALARM ", 3}, {" WARN ", 4},
		{" INFO ", 6}, {" AUDIT ", 6}, {" DEBUG ", 7},
	}
	level, first := -1, len(head)+1
	for _, token := range tokens {
		if index := bytes.Index(head, []byte(token.text)); index >= 0 && index < first {
			level, first = token.level, index
		}
	}
	return level
}

// journalAwareOutput trả writer có tiền tố mức khi `file` THẬT SỰ là stream
// journald mà systemd nối vào (so `dev:inode` trong `JOURNAL_STREAM` với
// `fstat` của chính file). Tiến trình con thừa hưởng biến môi trường nhưng đã
// bị chuyển stdout/stderr sang pipe hoặc file thì giữ nguyên dòng log.
func journalAwareOutput(file *os.File) io.Writer {
	if !isJournalStream(file, os.Getenv("JOURNAL_STREAM")) {
		return file
	}
	return journalLevelWriter{out: file}
}

func isJournalStream(file *os.File, stream string) bool {
	var dev, ino uint64
	if stream == "" {
		return false
	}
	if _, err := fmt.Sscanf(stream, "%d:%d", &dev, &ino); err != nil {
		return false
	}
	info, err := file.Stat()
	if err != nil {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && uint64(stat.Dev) == dev && uint64(stat.Ino) == ino
}
