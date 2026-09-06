(*
 * Demo điều khiển 32 DO trên Loop 1:
 *   - CK-508 địa chỉ 04: relay DO1..DO8
 *   - CK-508 địa chỉ 05: relay DO1..DO8
 *   - CK-509 địa chỉ 06: NPN/MOSFET DO1..DO8
 *   - CK-509 địa chỉ 07: NPN/MOSFET DO1..DO8
 *
 * Chu kỳ Program: 1000 ms. Mỗi vòng 56 giây gồm:
 *   0..3   : tất cả OFF (cửa sổ an toàn khi khởi động)
 *   4..11  : đuổi đồng bộ cùng một kênh trên bốn module
 *   12..19 : CK-508 đuổi thuận, CK-509 đuổi ngược
 *   20..51 : đuổi lần lượt từng DO trên toàn bộ 32 kênh
 *   52..55 : tất cả OFF (cửa sổ an toàn để Disable)
 *
 * Mọi chu kỳ đều gán OFF trước rồi mới bật mẫu cần thiết. Vì vậy tối đa chỉ
 * bốn DO cùng ON; Mode=0 luôn là trạng thái fail-safe.
 *)
PROGRAM RelayPattern32
VAR_OUTPUT
    R50804_DO1 : BOOL;
    R50804_DO2 : BOOL;
    R50804_DO3 : BOOL;
    R50804_DO4 : BOOL;
    R50804_DO5 : BOOL;
    R50804_DO6 : BOOL;
    R50804_DO7 : BOOL;
    R50804_DO8 : BOOL;

    R50805_DO1 : BOOL;
    R50805_DO2 : BOOL;
    R50805_DO3 : BOOL;
    R50805_DO4 : BOOL;
    R50805_DO5 : BOOL;
    R50805_DO6 : BOOL;
    R50805_DO7 : BOOL;
    R50805_DO8 : BOOL;

    R50906_DO1 : BOOL;
    R50906_DO2 : BOOL;
    R50906_DO3 : BOOL;
    R50906_DO4 : BOOL;
    R50906_DO5 : BOOL;
    R50906_DO6 : BOOL;
    R50906_DO7 : BOOL;
    R50906_DO8 : BOOL;

    R50907_DO1 : BOOL;
    R50907_DO2 : BOOL;
    R50907_DO3 : BOOL;
    R50907_DO4 : BOOL;
    R50907_DO5 : BOOL;
    R50907_DO6 : BOOL;
    R50907_DO7 : BOOL;
    R50907_DO8 : BOOL;
END_VAR
VAR
    Tick : INT;
    Mode : INT;
    Step : INT;
END_VAR

    (* Fail-safe mặc định: không giữ lại trạng thái của chu kỳ trước. *)
    R50804_DO1 := FALSE;
    R50804_DO2 := FALSE;
    R50804_DO3 := FALSE;
    R50804_DO4 := FALSE;
    R50804_DO5 := FALSE;
    R50804_DO6 := FALSE;
    R50804_DO7 := FALSE;
    R50804_DO8 := FALSE;

    R50805_DO1 := FALSE;
    R50805_DO2 := FALSE;
    R50805_DO3 := FALSE;
    R50805_DO4 := FALSE;
    R50805_DO5 := FALSE;
    R50805_DO6 := FALSE;
    R50805_DO7 := FALSE;
    R50805_DO8 := FALSE;

    R50906_DO1 := FALSE;
    R50906_DO2 := FALSE;
    R50906_DO3 := FALSE;
    R50906_DO4 := FALSE;
    R50906_DO5 := FALSE;
    R50906_DO6 := FALSE;
    R50906_DO7 := FALSE;
    R50906_DO8 := FALSE;

    R50907_DO1 := FALSE;
    R50907_DO2 := FALSE;
    R50907_DO3 := FALSE;
    R50907_DO4 := FALSE;
    R50907_DO5 := FALSE;
    R50907_DO6 := FALSE;
    R50907_DO7 := FALSE;
    R50907_DO8 := FALSE;

    Mode := 0;
    Step := 0;
    IF Tick < 4 THEN
        Mode := 0;
    ELSIF Tick < 12 THEN
        Mode := 1;
        Step := Tick - 4;
    ELSIF Tick < 20 THEN
        Mode := 2;
        Step := Tick - 12;
    ELSIF Tick < 52 THEN
        Mode := 3;
        Step := Tick - 20;
    ELSE
        Mode := 0;
    END_IF;

    (* Mode 1: cùng một số kênh chạy đồng bộ trên cả bốn module. *)
    IF Mode = 1 THEN
        CASE Step OF
            0: R50804_DO1 := TRUE; R50805_DO1 := TRUE; R50906_DO1 := TRUE; R50907_DO1 := TRUE;
            1: R50804_DO2 := TRUE; R50805_DO2 := TRUE; R50906_DO2 := TRUE; R50907_DO2 := TRUE;
            2: R50804_DO3 := TRUE; R50805_DO3 := TRUE; R50906_DO3 := TRUE; R50907_DO3 := TRUE;
            3: R50804_DO4 := TRUE; R50805_DO4 := TRUE; R50906_DO4 := TRUE; R50907_DO4 := TRUE;
            4: R50804_DO5 := TRUE; R50805_DO5 := TRUE; R50906_DO5 := TRUE; R50907_DO5 := TRUE;
            5: R50804_DO6 := TRUE; R50805_DO6 := TRUE; R50906_DO6 := TRUE; R50907_DO6 := TRUE;
            6: R50804_DO7 := TRUE; R50805_DO7 := TRUE; R50906_DO7 := TRUE; R50907_DO7 := TRUE;
            7: R50804_DO8 := TRUE; R50805_DO8 := TRUE; R50906_DO8 := TRUE; R50907_DO8 := TRUE;
        END_CASE;
    END_IF;

    (* Mode 2: hai CK-508 chạy thuận, hai CK-509 chạy ngược. *)
    IF Mode = 2 THEN
        CASE Step OF
            0: R50804_DO1 := TRUE; R50805_DO1 := TRUE; R50906_DO8 := TRUE; R50907_DO8 := TRUE;
            1: R50804_DO2 := TRUE; R50805_DO2 := TRUE; R50906_DO7 := TRUE; R50907_DO7 := TRUE;
            2: R50804_DO3 := TRUE; R50805_DO3 := TRUE; R50906_DO6 := TRUE; R50907_DO6 := TRUE;
            3: R50804_DO4 := TRUE; R50805_DO4 := TRUE; R50906_DO5 := TRUE; R50907_DO5 := TRUE;
            4: R50804_DO5 := TRUE; R50805_DO5 := TRUE; R50906_DO4 := TRUE; R50907_DO4 := TRUE;
            5: R50804_DO6 := TRUE; R50805_DO6 := TRUE; R50906_DO3 := TRUE; R50907_DO3 := TRUE;
            6: R50804_DO7 := TRUE; R50805_DO7 := TRUE; R50906_DO2 := TRUE; R50907_DO2 := TRUE;
            7: R50804_DO8 := TRUE; R50805_DO8 := TRUE; R50906_DO1 := TRUE; R50907_DO1 := TRUE;
        END_CASE;
    END_IF;

    (* Mode 3: chỉ một DO ON tại một thời điểm, đi hết 32 kênh. *)
    IF Mode = 3 THEN
        CASE Step OF
            0: R50804_DO1 := TRUE;
            1: R50804_DO2 := TRUE;
            2: R50804_DO3 := TRUE;
            3: R50804_DO4 := TRUE;
            4: R50804_DO5 := TRUE;
            5: R50804_DO6 := TRUE;
            6: R50804_DO7 := TRUE;
            7: R50804_DO8 := TRUE;
            8: R50805_DO1 := TRUE;
            9: R50805_DO2 := TRUE;
            10: R50805_DO3 := TRUE;
            11: R50805_DO4 := TRUE;
            12: R50805_DO5 := TRUE;
            13: R50805_DO6 := TRUE;
            14: R50805_DO7 := TRUE;
            15: R50805_DO8 := TRUE;
            16: R50906_DO1 := TRUE;
            17: R50906_DO2 := TRUE;
            18: R50906_DO3 := TRUE;
            19: R50906_DO4 := TRUE;
            20: R50906_DO5 := TRUE;
            21: R50906_DO6 := TRUE;
            22: R50906_DO7 := TRUE;
            23: R50906_DO8 := TRUE;
            24: R50907_DO1 := TRUE;
            25: R50907_DO2 := TRUE;
            26: R50907_DO3 := TRUE;
            27: R50907_DO4 := TRUE;
            28: R50907_DO5 := TRUE;
            29: R50907_DO6 := TRUE;
            30: R50907_DO7 := TRUE;
            31: R50907_DO8 := TRUE;
        END_CASE;
    END_IF;

    Tick := Tick + 1;
    IF Tick >= 56 THEN
        Tick := 0;
    END_IF;
END_PROGRAM
