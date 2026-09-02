/**
 * @file  sanitizer_build.hpp
 * @brief Nhận biết build có sanitizer dùng shadow memory.
 *
 * VÌ SAO CẦN
 * ----------
 * Hai tiến trình bị đóng hộp — `mkddc-programming-sim-worker` và
 * `mkddc-st-compile` — tự áp `setrlimit(RLIMIT_AS, …)` vài trăm MB. ASan/TSan/
 * MSan đặt chỗ hàng chục TB không gian địa chỉ ảo cho shadow memory, nên dưới
 * trần đó mọi `mmap` sau khi áp hàng rào đều hỏng và tiến trình chết với
 * "Failed to mmap". Hệ quả: lane ASan KHÔNG THỂ xanh, và vì nó đỏ triền miên
 * nên toàn bộ đường compile + mô phỏng chưa từng thật sự được ASan soi.
 *
 * Cách nhận biết ở đây dùng macro do CHÍNH compiler đặt khi có `-fsanitize`,
 * không phải một tuỳ chọn build tự khai. Không có cấu hình nào tắt được trần
 * này trong một bản phát hành: muốn tắt phải build bằng sanitizer, mà bản
 * sanitizer thì không phải bản phát hành.
 *
 * UBSan KHÔNG có shadow map lớn nên không nằm trong danh sách này — lane UBSan
 * vẫn chạy với trần đầy đủ.
 */
#ifndef MKDDC_SANITIZER_BUILD_HPP
#define MKDDC_SANITIZER_BUILD_HPP

#if defined(__SANITIZE_ADDRESS__) || defined(__SANITIZE_THREAD__)
#define MKDDC_SHADOW_SANITIZER_BUILD 1
#elif defined(__has_feature)
#if __has_feature(address_sanitizer) || __has_feature(thread_sanitizer) || \
    __has_feature(memory_sanitizer)
#define MKDDC_SHADOW_SANITIZER_BUILD 1
#endif
#endif

namespace core {

/* `true` khi binary được build với sanitizer dùng shadow memory. Dùng để BỎ
 * RIÊNG trần không gian địa chỉ; mọi thành phần khác của hàng rào — seccomp,
 * NO_NEW_PRIVS, cấm fork, trần file/CPU — vẫn phải áp đủ. */
#ifdef MKDDC_SHADOW_SANITIZER_BUILD
constexpr bool kShadowSanitizerBuild = true;
#else
constexpr bool kShadowSanitizerBuild = false;
#endif

}  // namespace core

/* Tắt RIÊNG phần kiểm rò rỉ của LeakSanitizer cho một binary tự đóng hộp.
 *
 * LSan chạy lúc thoát và cần đình chỉ luồng + đọc bộ nhớ tiến trình — đúng
 * những syscall mà seccomp của hàng rào chặn. Kết quả là "LeakSanitizer has
 * encountered a fatal error" và tiến trình thoát khác 0 SAU KHI đã làm đúng mọi
 * việc: test đỏ vì bản thân bộ kiểm rò rỉ, không vì sản phẩm sai.
 *
 * Phần bắt lỗi bộ nhớ của ASan — thứ có giá trị thật ở đây — vẫn bật nguyên.
 * Không nới hàng rào để chiều LSan: hàng rào chính là vật đang được kiểm.
 *
 * Gọi ĐÚNG MỘT LẦN ở phạm vi file trong TU chứa `main()`. */
#ifdef MKDDC_SHADOW_SANITIZER_BUILD
#define MKDDC_SANDBOX_DISABLES_LEAK_CHECK() \
    extern "C" int __lsan_is_turned_off() { return 1; }
#else
#define MKDDC_SANDBOX_DISABLES_LEAK_CHECK()
#endif

#endif  // MKDDC_SANITIZER_BUILD_HPP
