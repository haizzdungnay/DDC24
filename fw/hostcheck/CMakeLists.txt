# Test HOST cho lớp giao thức của firmware MCU.
#
# Firmware thật build bằng `fw/Makefile` với arm-none-eabi. Nhưng `fw/src/iop/`
# là C thuần không chạm HAL, nên nó biên dịch được cho host và kiểm được bằng
# chính `ctest` của dự án — cùng một bộ gate với SOM, chứ không phải một quy
# trình riêng mà rồi sẽ có người quên chạy.
#
# Đây là phần firmware kiểm chứng được NGAY khi chưa có bo mạch: endian, độ dài
# payload, CRC, quy tắc SEQ, luật NACK. Phần chạm thanh ghi phải chờ phần cứng.
add_executable(fw_iop_tests
    ${CMAKE_CURRENT_SOURCE_DIR}/../tests/test_iop_link.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/iop/iop_link.c)
target_include_directories(fw_iop_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/iop
    ${CMAKE_CURRENT_SOURCE_DIR}/../../shared)
# Cùng cách dò như `services/iobus/CMakeLists.txt`: GTest tìm được ở hệ thống thì
# dùng target có namespace, còn khi FetchContent kéo về thì chỉ có `gtest_main`.
if(TARGET GTest::gtest_main)
    target_link_libraries(fw_iop_tests PRIVATE GTest::gtest_main)
else()
    # `libgtest_main.a` của hệ thống không kéo theo `libgtest.a`, phải liệt kê cả hai.
    target_link_libraries(fw_iop_tests PRIVATE gtest_main gtest)
endif()
add_test(NAME fw_iop_tests COMMAND fw_iop_tests)
