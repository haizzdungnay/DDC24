/**
 * `ISS-STED-17` / `ADR-054` điểm 3 — KHỐI NÀY CÓ THUỘC IEC 61131-3 KHÔNG.
 *
 * VÌ SAO CẦN NHÃN
 * ---------------
 * `PID`, `HYSTERESIS`, `SCALE`, `DEADBAND` **không** thuộc thư viện chuẩn IEC
 * 61131-3. Chúng được giữ vì là khối cốt lõi của DDC, và IEC cho phép mở rộng
 * nhà sản xuất — **miễn là công bố rõ**.
 *
 * "Công bố rõ" không có nghĩa là ghi vào một mục cuối tài liệu. Người dùng
 * quyết định dùng khối nào ở màn hình **chọn khối**, không phải khi đọc tài
 * liệu; nhãn nằm ở chỗ khác là nhãn không ai đọc đúng lúc. Hệ quả thật của
 * việc thiếu nhãn: kỹ sư viết một chương trình quanh `PID`, rồi phát hiện nó
 * không chuyển được sang PLC hãng khác — muộn hơn nhiều so với lúc chọn.
 *
 * NGUỒN
 * -----
 * `PROGRAMMING_LIBRARY_ENTRIES.iecClassification`, sinh tự động từ danh sách
 * `vendorExtensions` của hồ sơ ngôn ngữ. Không có danh sách thứ hai ở đây: một
 * bản chép sẽ trôi khỏi hồ sơ đúng vào ngày ai đó thêm khối mở rộng thứ năm.
 */

import {
  PROGRAMMING_LIBRARY_ENTRIES,
  type LibraryIecClassification,
} from '../../api/generated/library_registry'

const BY_NAME = new Map<string, LibraryIecClassification>(
  PROGRAMMING_LIBRARY_ENTRIES.map((entry) => [entry.id.toUpperCase(), entry.iecClassification]),
)

/**
 * Phân loại một khối theo TÊN.
 *
 * `null` khi registry không biết tên đó — POU do người dùng định nghĩa
 * (`scope: 'PROJECT'`) không thuộc IEC lẫn thư viện Mekong, nên gắn cho nó một
 * trong hai nhãn là nói sai. Không biết thì không dán nhãn.
 */
export function iecClassificationOf(name: string): LibraryIecClassification | null {
  return BY_NAME.get(name.toUpperCase()) ?? null
}

/** Khối là mở rộng của nhà sản xuất — cần nhãn ở nơi người dùng chọn. */
export function isManufacturerExtension(name: string): boolean {
  return iecClassificationOf(name) === 'MANUFACTURER_EXTENSION'
}
