#include "tests/allocation_probe.hpp"

#include <cstdlib>
#include <new>

namespace allocation_probe {

thread_local bool        enabled = false;
thread_local std::size_t count = 0;

namespace {

void record() noexcept { if (enabled) ++count; }

void* allocate(std::size_t size)
{
    record();
    if (void* memory = std::malloc(size == 0 ? 1 : size)) return memory;
    throw std::bad_alloc{};
}

void* allocate_aligned(std::size_t size, std::size_t alignment)
{
    record();
    void* memory = nullptr;
    if (posix_memalign(&memory, alignment, size == 0 ? alignment : size) == 0) return memory;
    throw std::bad_alloc{};
}

} // namespace
} // namespace allocation_probe

/* Ghi đè TOÀN BỘ họ toán tử. Bỏ sót một biến thể (vd aligned new của C++17)
 * sẽ khiến cấp phát qua đường đó không được đếm và test cho kết quả sai lạc
 * theo hướng "an toàn giả". */
void* operator new(std::size_t size) { return allocation_probe::allocate(size); }
void* operator new[](std::size_t size) { return allocation_probe::allocate(size); }
void* operator new(std::size_t size, const std::nothrow_t&) noexcept
{
    try { return allocation_probe::allocate(size); } catch (...) { return nullptr; }
}
void* operator new[](std::size_t size, const std::nothrow_t&) noexcept
{
    try { return allocation_probe::allocate(size); } catch (...) { return nullptr; }
}
void* operator new(std::size_t size, std::align_val_t alignment)
{
    return allocation_probe::allocate_aligned(size, static_cast<std::size_t>(alignment));
}
void* operator new[](std::size_t size, std::align_val_t alignment)
{
    return allocation_probe::allocate_aligned(size, static_cast<std::size_t>(alignment));
}
void* operator new(std::size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept
{
    try {
        return allocation_probe::allocate_aligned(size, static_cast<std::size_t>(alignment));
    } catch (...) { return nullptr; }
}
void* operator new[](std::size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept
{
    try {
        return allocation_probe::allocate_aligned(size, static_cast<std::size_t>(alignment));
    } catch (...) { return nullptr; }
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete(void* memory, const std::nothrow_t&) noexcept { std::free(memory); }
void operator delete[](void* memory, const std::nothrow_t&) noexcept { std::free(memory); }
void operator delete(void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t, std::align_val_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::size_t, std::align_val_t) noexcept { std::free(memory); }
