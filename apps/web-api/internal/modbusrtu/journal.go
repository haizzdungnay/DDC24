package modbusrtu

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Trạng thái một transaction apply (MBR-B204).
const (
	TxStaged      = "STAGED"      // file mới đã ghi, iobus CHƯA được báo
	TxSent        = "SENT"        // đã gửi ApplyConfig, chưa nhận ACK
	TxCommitted   = "COMMITTED"   // iobus ACK, cấu hình mới đang chạy
	TxRolledBack  = "ROLLED_BACK" // đã khôi phục cấu hình cũ
	TxUnreachable = "UNREACHABLE" // iobus không trả lời — cần reconcile
)

// Transaction là một bản ghi journal.
//
// Vì sao cần journal: apply chạm ba thứ ở ba thời điểm khác nhau — file profile,
// file fieldbus.conf, và tiến trình iobus. Mất điện giữa chừng để lại hệ thống ở
// trạng thái nửa vời mà KHÔNG AI biết là nửa vời: file mới trên đĩa nhưng iobus
// vẫn chạy cấu hình cũ, và lần khởi động sau iobus đọc file mới nên hai bên khớp
// lại một cách tình cờ — hoặc không. Journal biến "nửa vời" thành trạng thái
// đọc được và sửa được.
type Transaction struct {
	OperationID    string    `json:"operation_id"`
	TargetRevision uint64    `json:"target_revision"`
	BaseRevision   uint64    `json:"base_revision"`
	Checksum       string    `json:"checksum"`
	State          string    `json:"state"`
	Reason         string    `json:"reason,omitempty"`
	Actor          string    `json:"actor,omitempty"`
	StartedAt      time.Time `json:"started_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (t Transaction) Terminal() bool {
	return t.State == TxCommitted || t.State == TxRolledBack
}

type Journal struct {
	Path      string
	WriteFile FileWriter
}

func (j Journal) Read() (Transaction, bool, error) {
	raw, err := os.ReadFile(j.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return Transaction{}, false, nil
		}
		return Transaction{}, false, err
	}
	var tx Transaction
	if err := json.Unmarshal(raw, &tx); err != nil {
		return Transaction{}, false, fmt.Errorf("journal hỏng: %w", err)
	}
	return tx, true, nil
}

func (j Journal) Write(tx Transaction) error {
	if j.WriteFile == nil {
		return errors.New("journal thiếu WriteFile")
	}
	tx.UpdatedAt = time.Now().UTC()
	data, err := json.MarshalIndent(tx, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(j.Path), 0o755); err != nil {
		return err
	}
	return j.WriteFile(j.Path, append(data, '\n'), 0o644)
}

// ReconcileResult mô tả việc đã làm để đưa hệ thống về trạng thái nhất quán.
type ReconcileResult struct {
	Performed bool   `json:"performed"`
	Action    string `json:"action"`
	Detail    string `json:"detail,omitempty"`
}

// Reconcile so khớp journal ↔ cấu hình trên đĩa ↔ iobus đang chạy.
//
// Gọi lúc web-api khởi động. Ba tình huống thật:
//
//  1. Journal ở STAGED: mất điện SAU khi ghi file, TRƯỚC khi báo iobus.
//     File đã đúng, chỉ cần gửi lại ApplyConfig.
//  2. Journal ở SENT/UNREACHABLE: đã gửi nhưng không rõ iobus có nhận không.
//     Hỏi `status`; nếu iobus đã ở đúng revision thì chỉ cần đóng journal, nếu
//     chưa thì gửi lại. ApplyConfig là idempotent theo revision nên gửi lại an
//     toàn.
//  3. Journal terminal: không làm gì.
func Reconcile(j Journal, control ControlClient, configPath string) (ReconcileResult, error) {
	tx, exists, err := j.Read()
	if err != nil || !exists {
		return ReconcileResult{}, err
	}
	if tx.Terminal() {
		return ReconcileResult{}, nil
	}

	status, statusErr := control.Status()
	if statusErr == nil && status.ConfigRevision == tx.TargetRevision {
		tx.State = TxCommitted
		tx.Reason = "reconcile: iobus đã chạy đúng revision"
		return ReconcileResult{Performed: true, Action: "closed_journal",
			Detail: fmt.Sprintf("iobus đã ở revision %d", tx.TargetRevision)}, j.Write(tx)
	}

	ack, applyErr := control.ApplyConfig(tx.TargetRevision, tx.Checksum, configPath)
	if applyErr != nil {
		tx.State = TxUnreachable
		tx.Reason = applyErr.Error()
		_ = j.Write(tx)
		return ReconcileResult{Performed: false, Action: "iobus_unreachable",
			Detail: applyErr.Error()}, applyErr
	}
	if ack.Result != "ack" {
		tx.State = TxRolledBack
		tx.Reason = ack.Reason
		_ = j.Write(tx)
		return ReconcileResult{Performed: true, Action: "rejected_by_iobus",
			Detail: ack.Reason}, fmt.Errorf("iobus từ chối cấu hình: %s", ack.Reason)
	}
	tx.State = TxCommitted
	tx.Reason = "reconcile: đã gửi lại ApplyConfig"
	return ReconcileResult{Performed: true, Action: "reapplied",
			Detail: fmt.Sprintf("revision %d, generation %d", ack.AppliedRevision, ack.Generation)},
		j.Write(tx)
}
