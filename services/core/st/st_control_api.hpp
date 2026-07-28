/**
 * @file  st_control_api.hpp
 * @brief Interface điều khiển Program Runtime cho BE SOM (ACTION 13).
 *
 *        Tách khỏi `web_ipc` có chủ ý: file này là LOGIC hợp đồng thuần tuý
 *        (chuỗi JSON vào → chuỗi JSON ra), không sở hữu socket, không biết
 *        transport. Nhờ vậy toàn bộ hợp đồng với BE test được mà không cần
 *        dựng socket, và khi đổi transport thì hợp đồng không phải viết lại.
 *
 *        Bất biến: MỌI lỗi đều trả JSON có `errorCode` ổn định và cờ
 *        `keepsRunningPackage`. BE không bao giờ phải đoán xem chương trình
 *        đang chạy có bị ảnh hưởng không.
 */
#ifndef CORE_ST_CONTROL_API_HPP
#define CORE_ST_CONTROL_API_HPP

#include <cstdint>
#include <string>

#include "st/st_scheduler.hpp"

namespace core {

/* Mã lỗi ở tầng interface (khác `IR-E-*` của loader và `ST-*` của compiler).
 * Ba họ mã tách biệt để BE biết lỗi đến từ đâu mà không cần phân tích message. */
namespace st_api_error {
constexpr const char* kBadRequest       = "API-E-001";  /* JSON hỏng hoặc thiếu field */
constexpr const char* kUnknownAction    = "API-E-002";
constexpr const char* kUnknownInstance  = "API-E-003";
constexpr const char* kBadTransition    = "API-E-004";  /* lệnh không hợp lệ ở trạng thái hiện tại */
constexpr const char* kBadArtifact      = "API-E-005";  /* base64 hỏng hoặc quá lớn */
constexpr const char* kActivationFailed = "API-E-006";  /* loader từ chối; kèm mã IR-E-* */
constexpr const char* kInternal         = "API-E-007";
} // namespace st_api_error

constexpr int kStApiVersion = 1;

/* Xử lý một request. `request_json` là một dòng JSON; trả về một dòng JSON.
 * KHÔNG bao giờ ném exception và KHÔNG bao giờ trả chuỗi rỗng — BE luôn parse
 * được, kể cả khi request là rác. */
std::string st_handle_control_request(StScheduler* sched, const std::string& request_json);

/* Giải mã base64 (dùng cho trường `artifact`). Trả false khi ký tự không hợp
 * lệ hoặc kết quả vượt `max_bytes`. */
bool st_base64_decode(const std::string& in, std::vector<uint8_t>* out, std::size_t max_bytes);
std::string st_base64_encode(const uint8_t* data, std::size_t n);

} // namespace core

#endif /* CORE_ST_CONTROL_API_HPP */
