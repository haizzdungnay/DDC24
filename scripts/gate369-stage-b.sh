#!/usr/bin/env bash
# Gate #369 chặng (b) — vector compiler ST. Đếm số test thật theo từng nhóm vector.
# Chạy được từ mọi clone/worktree: không ghim đường dẫn máy của người đo ban đầu.
#
# VÌ SAO SCRIPT NÀY TỰ KIỂM PHỦ VECTOR CHỨ KHÔNG CHỈ ĐẾM TỔNG
# -----------------------------------------------------------
# Thân #369 đòi chặng (b) "phủ đủ" SÁU nhóm. Bản đo nền 2026-08-31 kết luận
# "5/6 nhóm có phủ, thiếu nhóm WARNING" bằng cách một người ĐỌC danh sách tên
# test. Một kết luận đọc bằng mắt thì lần đo sau phải đọc lại bằng mắt, và ngày
# nào đó nhóm WARNING biến mất thì tổng số test vẫn tăng đều — cổng vẫn xanh
# trong khi thứ nó canh đã mất.
#
# Nên phủ vector ở đây là một phép kiểm CÓ THỂ ĐỎ: mỗi nhóm phải có ít nhất một
# test đăng ký trong `ctest`, và tên test dùng làm bằng chứng được in ra để
# người ký đọc được đúng thứ đã chạy.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs

ctest --test-dir build/fw -R "^St" --output-on-failure > logs/gate369-stvector.log 2>&1
status=$?
echo "$status" > logs/gate369-stvector.exit

echo "ST_CTEST_EXIT=$status"
grep -E "tests passed|Total Test time" logs/gate369-stvector.log | tail -2 || true

# Danh sách test ĐÃ ĐĂNG KÝ, đọc từ chính `ctest` chứ không từ mã nguồn: thứ
# quyết định một vector có chạy hay không là nó có trong bộ test hay không.
ctest --test-dir build/fw -N > logs/gate369-stvector-names.log 2>&1
names=$(grep -oE "Test +#[0-9]+: +[A-Za-z0-9_]+\.[A-Za-z0-9_]+" logs/gate369-stvector-names.log | sed 's/.*: //')

# Sáu nhóm mà thân #369 liệt kê. Mẫu bám vào TÊN TEST, nên đổi tên một test là
# đổi bằng chứng — đúng ý: bằng chứng phải đi theo thứ thật sự chạy.
groups=(
  "cú pháp|^StValidateCli\.InvalidSyntax|^StMultiDiagnostic\.IndependentSyntaxErrors|^StGrammarCorpus\."
  "kiểu|^StValidateCli\.TypeMismatch|^StLang\..*Type.*Reject|^StResolveIoBindings\..*WrongType"
  "FB gọi hai lần một chu kỳ|^StLang\.FbCalledTwicePerCycle"
  "ghi vào output của FB|^StLang\.WriteToFbOutput"
  "WARNING|^StWarning\."
  "nhiều diagnostic một lần Kiểm tra|^StMultiDiagnostic\."
)

missing=0
echo "--- phủ vector theo nhóm ---"
for entry in "${groups[@]}"; do
  label="${entry%%|*}"
  pattern="${entry#*|}"
  matched=$(printf '%s\n' "$names" | grep -E "$pattern" || true)
  count=$(printf '%s' "$matched" | grep -c . || true)
  if [ "$count" -eq 0 ]; then
    echo "THIẾU  nhóm '$label' — không có test nào đăng ký"
    missing=$((missing + 1))
  else
    echo "PHỦ    nhóm '$label': $count test (vd: $(printf '%s\n' "$matched" | head -1))"
  fi
done
printf '%s\n' "$names" > logs/gate369-stvector-registered.txt

if [ "$missing" -ne 0 ]; then
  echo "STAGE_B=FAIL — thiếu $missing nhóm vector"
  exit 1
fi
if [ "$status" -ne 0 ]; then
  echo "STAGE_B=FAIL — ctest exit $status"
  exit "$status"
fi
echo "STAGE_B=PASS — đủ 6 nhóm vector"
