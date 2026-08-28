// Package simworker là supervisor phía Web cho `mkddc-programming-sim-worker`.
//
// `ADR-053` §2 chia rõ hai vai: worker chạy chương trình, còn `mkddc-web` giữ
// RBAC, audit, quota, TTL và vòng đời tiến trình. Package này là nửa sau — nó
// KHÔNG diễn giải ngữ nghĩa ST, và cũng không được phép làm thế: hai bộ ngữ
// nghĩa cho một chương trình là hai bộ để trôi khỏi nhau.
//
// Kênh liên lạc là ống thừa kế (stdin/stdout của tiến trình con), không phải
// socket có đường dẫn. Một đường dẫn trên hệ thống tập tin có thể bị đoán, bị
// tạo trước hoặc bị thay; một FD thừa kế thì không. Mỗi phiên còn có token
// ngẫu nhiên truyền qua môi trường và bị worker xoá ngay sau khi đọc.
package simworker

// Mã chi tiết của supervisor. Chúng KHÔNG phải public code: mỗi mã được ánh xạ
// sang đúng một `PRG-SIM-*` trong `contracts/programming/error_catalog_v1.json`,
// và generator sẽ đỏ nếu thêm mã ở đây mà quên ánh xạ.
const (
	// DetailSpawn — không sinh được tiến trình worker (thiếu binary, sai quyền).
	DetailSpawn = "SIM-SUP-SPAWN"
	// DetailHandshake — worker trả lời bắt tay sai token/version/profile.
	DetailHandshake = "SIM-SUP-HANDSHAKE"
	// DetailTimeout — lệnh vượt trần 2.000 ms. Sau mã này phiên KHÔNG được coi
	// là thành công hay thất bại theo phỏng đoán: nó đi thẳng tới reconcile.
	DetailTimeout = "SIM-SUP-TIMEOUT"
	// DetailProtocol — khung trả lời hỏng, sai commandId, hoặc vượt trần dòng.
	DetailProtocol = "SIM-SUP-PROTOCOL"
	// DetailCrash — worker thoát ngoài dự kiến (crash/OOM/bị kill).
	DetailCrash = "SIM-SUP-CRASH"
	// DetailQuota — vượt trần phiên đồng thời hoặc trần tốc độ action.
	DetailQuota = "SIM-SUP-QUOTA"
	// DetailExpired — hết idle TTL hoặc hard TTL.
	DetailExpired = "SIM-SUP-EXPIRED"
	// DetailCapability — capability R3 chưa bật, hoặc worker vắng/sai phiên bản.
	DetailCapability = "SIM-SUP-CAPABILITY"
)

// ProtocolVersion phải khớp chính xác với worker. Không có thương lượng xuống
// phiên bản thấp hơn: một worker cũ hiểu lệnh khác đi sẽ tạo ra kết quả trông
// hợp lệ nhưng nói về một ngữ nghĩa khác.
const ProtocolVersion = 1

// Trần khung do supervisor tự thi hành, độc lập với trần bên trong worker.
// Hai lớp trùng nhau là cố ý: supervisor không được tin rằng tiến trình con
// luôn còn nguyên vẹn và đúng đắn.
const (
	MaxResponseLineBytes = 8 << 20
	MaxArtifactBytes     = 16 << 20
	MaxTraceLimit        = 1024
)
