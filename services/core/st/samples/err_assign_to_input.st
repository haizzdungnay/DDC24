(* Mẫu LỖI — gán vào VAR_INPUT.
 * Mong đợi: exit 1, code ST-SEM-003. VAR_INPUT là chỉ đọc (SPEC §2). *)
PROGRAM BadWrite
VAR_INPUT  temp : REAL; END_VAR
VAR_OUTPUT o : REAL; END_VAR
    temp := 1.0;
    o := temp;
END_PROGRAM
