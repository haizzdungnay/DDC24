package store

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sync"
	"testing"
)

// T59-603 — audit và đồng thời (concurrency), phần mà happy-path không kiểm được.
//
// `VerifyAuditChain` đã được gọi ở nhiều test, nhưng luôn trên chuỗi LÀNH. Một
// hàm verify luôn trả nil cũng qua được mọi phép kiểm đó. Giá trị của chuỗi hash
// nằm TRỌN ở việc nó phát hiện được sửa đổi — nên phải có test sửa thật vào DB.

func commitAuditFixture(t *testing.T, store *Store, index int, action string) {
	t.Helper()
	_, err := store.CommitAudit(context.Background(), AuditInput{
		AuditID:         fmt.Sprintf("90000000-0000-4000-8000-%012d", index),
		ActorID:         actorID,
		Role:            role,
		Action:          action,
		TargetType:      "PROJECT",
		TargetID:        projectID,
		OccurredAtUTCMS: fixedNow.UnixMilli(),
		ResultCode:      "ACCEPTED",
		CorrelationID:   correlationID,
		DetailsJSON:     []byte(`{"note":"fixture"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestAuditRecordsAreImmutableAtTheDatabaseLayer(t *testing.T) {
	// Lớp phòng thủ THỨ NHẤT: schema có trigger chặn UPDATE/DELETE. Nó mạnh hơn
	// chuỗi hash ở chỗ nó CHẶN thay vì chỉ phát hiện — nhưng chỉ có hiệu lực với
	// ai đi qua chính kết nối này.
	store := openTestStore(t)
	for index := 1; index <= 3; index++ {
		commitAuditFixture(t, store, index, "COMMISSION")
	}
	if err := store.VerifyAuditChain(context.Background()); err != nil {
		t.Fatalf("chuỗi lành phải verify được: %v", err)
	}

	if _, err := store.db.Exec(
		`UPDATE audit_records SET actor_id = 'nguoi-khac' WHERE sequence = 2`); err == nil {
		t.Fatal("UPDATE audit_records phải bị trigger chặn")
	}
	if _, err := store.db.Exec(`DELETE FROM audit_records WHERE sequence = 2`); err == nil {
		t.Fatal("DELETE audit_records phải bị trigger chặn")
	}
	if err := store.VerifyAuditChain(context.Background()); err != nil {
		t.Fatalf("chuỗi phải còn nguyên sau khi hai phép sửa bị chặn: %v", err)
	}
}

func TestAuditChainDetectsTamperingWhenTriggersAreBypassed(t *testing.T) {
	// Lớp phòng thủ THỨ HAI, và là lý do chuỗi hash tồn tại: kẻ có file DB trong
	// tay gỡ trigger rồi sửa. Trigger không còn ý nghĩa ở kịch bản này — chỉ
	// chuỗi hash phát hiện được.
	//
	// Không có test kiểu này thì `VerifyAuditChain` chỉ từng được gọi trên chuỗi
	// LÀNH: một hàm luôn trả nil cũng qua được mọi phép kiểm hiện có.
	store := openTestStore(t)
	for index := 31; index <= 34; index++ {
		commitAuditFixture(t, store, index, "ENABLE_INTENT")
	}
	if _, err := store.db.Exec(`DROP TRIGGER audit_records_no_update`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(
		`UPDATE audit_records SET actor_id = 'nguoi-khac' WHERE sequence = 2`); err != nil {
		t.Fatal(err)
	}
	if err := store.VerifyAuditChain(context.Background()); err == nil {
		t.Fatal("sửa actor giữa chuỗi mà VerifyAuditChain vẫn PASS")
	}
}

func TestAuditChainDetectsDeletionWhenTriggersAreBypassed(t *testing.T) {
	store := openTestStore(t)
	for index := 41; index <= 44; index++ {
		commitAuditFixture(t, store, index, "RESTORE")
	}
	if _, err := store.db.Exec(`DROP TRIGGER audit_records_no_delete`); err != nil {
		t.Fatal(err)
	}
	// Xoá là cách che dấu vết rẻ nhất; chuỗi phải gãy vì bản ghi sau không còn
	// nối được với bản ghi trước nó.
	if _, err := store.db.Exec(`DELETE FROM audit_records WHERE sequence = 3`); err != nil {
		t.Fatal(err)
	}
	if err := store.VerifyAuditChain(context.Background()); err == nil {
		t.Fatal("xoá một bản ghi giữa chuỗi mà VerifyAuditChain vẫn PASS")
	}
}

func TestConcurrentIdenticalMutationsProduceExactlyOneProject(t *testing.T) {
	// Cùng một idempotency key gửi song song là kịch bản THẬT: người vận hành
	// bấm hai lần, hoặc client retry sau timeout trong khi request đầu vẫn đang
	// chạy. Nếu store xử lý bằng "kiểm tra rồi ghi" không nguyên tử, hai
	// goroutine cùng vượt qua bước kiểm và tạo hai Project.
	store := openTestStore(t)
	key := sha256.Sum256([]byte("key:concurrent-create"))
	request := sha256.Sum256([]byte("request:concurrent-create"))

	const workers = 8
	var wait sync.WaitGroup
	errs := make([]error, workers)
	for index := 0; index < workers; index++ {
		wait.Add(1)
		go func(slot int) {
			defer wait.Done()
			_, _, err := store.CreateProject(context.Background(), CreateProjectParams{
				ProjectID: projectID, DraftID: draftID, Name: "AHU song song",
				ContentJSON: []byte(`{"schemaVersion":1,"programs":[]}`),
				ActorID:     actorID, Role: role,
				AuditID:       "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1",
				CorrelationID: correlationID, At: fixedNow,
				IdempotencyKeySHA256: key, RequestSHA256: request,
			})
			errs[slot] = err
		}(index)
	}
	wait.Wait()

	var projects int
	if err := store.db.QueryRow(`SELECT count(*) FROM projects`).Scan(&projects); err != nil {
		t.Fatal(err)
	}
	if projects != 1 {
		t.Fatalf("số Project = %d; want 1 (idempotency key trùng nhau)", projects)
	}
	// Audit cũng không được nhân bản: một thao tác thật = một dòng nhật ký.
	var audits int
	if err := store.db.QueryRow(
		`SELECT count(*) FROM audit_records WHERE action LIKE '%PROJECT%'`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits > 1 {
		t.Fatalf("audit ghi %d dòng cho một thao tác idempotent", audits)
	}
	if err := store.VerifyAuditChain(context.Background()); err != nil {
		t.Fatalf("chuỗi audit gãy sau khi chạy song song: %v", err)
	}
}
