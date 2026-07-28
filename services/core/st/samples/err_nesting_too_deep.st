(* Mẫu LỖI — biểu thức lồng quá sâu.
 * Mong đợi: exit 1, code ST-SYN-002.
 * Đây là "vượt giới hạn tài nguyên", KHÔNG phải sai cú pháp — thông điệp cho
 * user là "đơn giản hoá chương trình", không phải "đi tìm lỗi gõ". *)
PROGRAM TooDeep
VAR_INPUT  a : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := ((((((((((((((((((((((((((((((((((((((((a))))))))))))))))))))))))))))))))))))))));
END_PROGRAM
