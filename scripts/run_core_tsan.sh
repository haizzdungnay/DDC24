#!/usr/bin/env bash
# T59-403 — chạy ThreadSanitizer cho đường lập lịch đa lane của Core.
#
# Vì sao là script riêng chứ không phải một cổng trong verify-project.sh: build
# TSan là một cây build KHÁC (instrumentation đổi cả layout bộ nhớ), mất vài phút
# và không chạy được cùng lúc với cây build thường. Gộp vào cổng mặc định sẽ làm
# mọi task không liên quan tới đồng thời phải trả cái giá đó.
#
# ASLR: kernel mới đặt vm.mmap_rnd_bits đủ cao để TSan báo
# "unexpected memory mapping" rồi thoát. `setarch -R` tắt ASLR cho tiến trình con
# — đây là hạn chế của môi trường chạy, không phải của mã được kiểm.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT}/build/tsan"
FILTER="${1:-StProgramLanes.*:StScheduler.*:StProgramRelease.*:ProgrammingPackageV2Stage.*}"
ARCH="$(uname -m)"

cmake --fresh -S "${ROOT}" -B "${BUILD_DIR}" \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON \
  -DCMAKE_C_FLAGS="-fsanitize=thread -g" \
  -DCMAKE_CXX_FLAGS="-fsanitize=thread -g" \
  -DCMAKE_EXE_LINKER_FLAGS="-fsanitize=thread"

# Cả bước build lẫn bước gtest_discover_tests đều chạy binary, nên `setarch` phải
# bọc CẢ lệnh build — không chỉ lệnh chạy test.
setarch "${ARCH}" -R cmake --build "${BUILD_DIR}" --target core_tests --parallel

setarch "${ARCH}" -R "${BUILD_DIR}/core/core_tests" --gtest_filter="${FILTER}"
