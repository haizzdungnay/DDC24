(* Mẫu LỖI — gọi cùng một instance FB hai lần trong một chu kỳ.
 * Mong đợi: exit 1, code ST-SEM-010.
 * Một lần gọi = một lần cập nhật trạng thái; gọi hai lần làm ngữ nghĩa timer
 * mất ý nghĩa (SPEC §5.3). Sửa bằng cách khai báo hai instance riêng. *)
PROGRAM BadFb
VAR_INPUT  c : BOOL; END_VAR
VAR_OUTPUT q : BOOL; END_VAR
VAR dly : TON; END_VAR
    dly(IN := c, PT := T#1s);
    dly(IN := c, PT := T#2s);
    q := dly.Q;
END_PROGRAM
