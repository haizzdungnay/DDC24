(* Mẫu HỢP LỆ — điều khiển quạt AHU.
 * Đây là chương trình tham chiếu normative của ST_SUBSET_SPEC §13:
 * mọi thay đổi compiler/runtime phải giữ nó biên dịch được và cho kết quả
 * đúng bảng hành vi ghi trong SPEC.
 *
 * Compile:  mkddc-st-compile --source ahu_fan_control.st --out ahu.mkir
 *)
PROGRAM AHU_FanControl
VAR_INPUT
    SupplyTemp  : REAL;     (* °C, bind UI-01 *)
    Setpoint    : REAL;     (* °C, bind AV *)
    Occupied    : BOOL;     (* từ schedule *)
END_VAR
VAR_OUTPUT
    FanEnable   : BOOL;     (* bind DO-01 *)
    FanSpeed    : REAL;     (* %, bind AO-01 *)
    AlarmHigh   : BOOL;
END_VAR
VAR
    StartDelay  : TON;
    HighTrig    : R_TRIG;
    Deviation   : REAL;
END_VAR
VAR RETAIN
    StartCount  : INT;      (* giữ qua restart *)
END_VAR

    Deviation := SupplyTemp - Setpoint;

    (* Quạt chỉ chạy khi có người VÀ lệch quá 1°C liên tục 30 giây —
       chống bật/tắt liên tục quanh setpoint *)
    StartDelay(IN := Occupied AND (Deviation > 1.0), PT := T#30s);
    FanEnable := StartDelay.Q;

    // Tốc độ tỉ lệ độ lệch, kẹp trong 0..100
    FanSpeed := LIMIT(0.0, Deviation * 20.0, 100.0);

    AlarmHigh := Deviation > 5.0;

    (* Đếm số lần khởi động, giữ qua restart *)
    HighTrig(CLK := FanEnable);
    IF HighTrig.Q THEN
        StartCount := StartCount + 1;
    END_IF;
END_PROGRAM
