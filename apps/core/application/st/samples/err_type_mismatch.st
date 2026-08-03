(* Mẫu LỖI — trộn INT và REAL giữa hai biến.
 * Mong đợi: exit 1, code ST-SEM-002.
 * ST_SUBSET_SPEC §3.3: không ép kiểu ngầm giữa BIẾN; ngoại lệ duy nhất là
 * literal số (§3.4). Sửa bằng INT_TO_REAL(count). *)
PROGRAM BadTypes
VAR_INPUT  count : INT; END_VAR
VAR_OUTPUT ratio : REAL; END_VAR
    ratio := count;
END_PROGRAM
