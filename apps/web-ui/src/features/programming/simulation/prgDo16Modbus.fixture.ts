/**
 * Fixture chuẩn POU PRG_DO16_MODBUS (293 dòng ST)
 * Nguồn: docs/06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md (L515-807)
 */
export const PRG_DO16_MODBUS_SOURCE = `PROGRAM PRG_DO16_MODBUS
VAR_INPUT
    CmdMode       : UINT;   (* VP multistate, 0..7 hoặc 10 = AUTO *)
    CmdManualMask : REAL;   (* VP integer 0..65535 (slot AV nên là REAL) *)
    CmdLockMask   : REAL;   (* VP integer 0..65535, bit = 1 là khoá kênh *)
    CmdStepSec    : REAL;   (* VP float, giây *)
    CmdDemandPct  : REAL;   (* VP float hoặc UI analog, 0..100 % *)
    CmdTestStart  : BOOL;   (* VP boolean, bấm TRUE rồi trả FALSE *)
    CmdReverse    : BOOL;   (* VP boolean *)
    InPermit      : BOOL;   (* UI tiếp điểm khô hoặc VP boolean: TRUE = cho phép chạy *)
END_VAR
VAR_OUTPUT
    DO01 : BOOL;
    DO02 : BOOL;
    DO03 : BOOL;
    DO04 : BOOL;
    DO05 : BOOL;
    DO06 : BOOL;
    DO07 : BOOL;
    DO08 : BOOL;
    DO09 : BOOL;
    DO10 : BOOL;
    DO11 : BOOL;
    DO12 : BOOL;
    DO13 : BOOL;
    DO14 : BOOL;
    DO15 : BOOL;
    DO16 : BOOL;
    StsMode    : UINT;   (* 0..7 = chế độ đang chạy, 8 = đang chờ chuyển, 9 = khoá liên động *)
    StsOnCount : REAL;   (* số kênh đang đóng *)
    StsTrips   : REAL;   (* số lần mất InPermit, giữ qua mất điện *)
END_VAR
VAR
    Ch01 : FB_DO_CHANNEL;
    Ch02 : FB_DO_CHANNEL;
    Ch03 : FB_DO_CHANNEL;
    Ch04 : FB_DO_CHANNEL;
    Ch05 : FB_DO_CHANNEL;
    Ch06 : FB_DO_CHANNEL;
    Ch07 : FB_DO_CHANNEL;
    Ch08 : FB_DO_CHANNEL;
    Ch09 : FB_DO_CHANNEL;
    Ch10 : FB_DO_CHANNEL;
    Ch11 : FB_DO_CHANNEL;
    Ch12 : FB_DO_CHANNEL;
    Ch13 : FB_DO_CHANNEL;
    Ch14 : FB_DO_CHANNEL;
    Ch15 : FB_DO_CHANNEL;
    Ch16 : FB_DO_CHANNEL;
    Req        : FB_MASK_SPLIT;
    LockBits   : FB_MASK_SPLIT;
    StepClk    : FB_STEP_TIMER;
    Blinker    : FB_BLINK;
    Stager     : FB_STAGER;
    DemandOn   : HYSTERESIS;
    ModeDwell  : TON;
    PulseAll   : TP;
    TestTrig   : R_TRIG;
    PermitLost : F_TRIG;
    TestStep   : CTU;
    Mode       : UINT;
    PrevMode   : UINT;
    Changed    : BOOL;
    Settled    : BOOL;
    LoadMode   : BOOL;
    TestRunning : BOOL;
    Step       : INT;
    Mask       : UINT;
    StepTime   : TIME;
    BlinkTime  : TIME;
    PulseTime  : TIME;
    TMinOn     : TIME;
    TMinOff    : TIME;
    DemandUsed : REAL;
    OnCount    : INT;
    AnyWaiting : BOOL;   (* chu kỳ trước còn kênh chờ hết MinOn/MinOff *)
    AutoTmr    : TON;    (* thời lượng bước AUTO hiện tại *)
    AutoOn     : BOOL;
    AutoNext   : BOOL;
    AutoIdx    : INT;    (* bước AUTO 0..8 *)
    AutoDur    : TIME;
    SegMode    : UINT;   (* chế độ của bước AUTO hiện tại *)
END_VAR
VAR RETAIN
    TripCount   : DINT;
    TotalCycles : DINT;
END_VAR
VAR CONSTANT
    MASK_ODD          : UINT := 21845;              (* 0x5555: DO01, DO03, ..., DO15 *)
    MASK_EVEN         : UINT := NOT MASK_ODD;       (* 0xAAAA: DO02, DO04, ..., DO16 *)
    MASK_LOW_NIBBLES  : UINT := 3855;               (* 0x0F0F *)
    MASK_HIGH_NIBBLES : UINT := NOT MASK_LOW_NIBBLES; (* 0xF0F0 *)
END_VAR

    (* ===== 1. Chuẩn hoá đầu vào ===== *)
    Mode := CmdMode;
    AutoOn := Mode = 10;
    IF Mode > 7 THEN
        Mode := 0;                                   (* giá trị lạ => OFF *)
    END_IF;

    (* ===== 1b. AUTO: tự chạy lần lượt mọi chế độ =====
       AutoTmr dùng AutoDur của bước hiện tại (tính ở chu kỳ trước). Mất
       InPermit hoặc rời AUTO thì về bước 0 (OFF nghỉ 12 s), để relay luôn nghỉ
       đủ trước khi vào chế độ tải. Chu kỳ đầu sau khi Program khởi động có
       AutoDur = T#0s: phải chặn, nếu không bước OFF bị bỏ qua. *)
    AutoTmr(IN := AutoOn AND InPermit AND NOT AutoNext AND (AutoDur > T#0s), PT := AutoDur);
    AutoNext := AutoTmr.Q;
    IF NOT AutoOn OR NOT InPermit THEN
        AutoIdx := 0;
    ELSIF AutoNext THEN
        AutoIdx := FN_NEXT_STEP(AutoIdx + 1, 9, FALSE) - 1;   (* 0..8 quay vòng *)
    END_IF;
    CASE AutoIdx OF
        1:  SegMode := 2; AutoDur := T#22s;
        2:  SegMode := 3; AutoDur := T#12s;
        3:  SegMode := 4; AutoDur := T#10s;
        4:  SegMode := 1; AutoDur := T#8s;
        5:  SegMode := 6; AutoDur := T#12s;
        6:  SegMode := 7; AutoDur := T#8s;
        7:  SegMode := 0; AutoDur := T#12s;
        8:  SegMode := 5; AutoDur := T#40s;
    ELSE
        SegMode := 0; AutoDur := T#12s;
    END_CASE;

    IF AutoOn THEN
        Mode := SegMode;
        StepTime  := SEL((Mode = 3) OR (Mode = 6), T#1s, T#500ms);
        BlinkTime := T#1s;
        PulseTime := T#3s;
        (* STAGING tự chạy: 55 % trong 20 s đầu rồi 20 %, cho thấy cả tăng lẫn giảm bậc. *)
        DemandUsed := SEL(Mode = 5, 0.0, SEL(AutoTmr.ET < T#20s, 20.0, 55.0));
    ELSE
        StepTime  := FN_SEC_TO_TIME(CmdStepSec, 0.5, 60.0);
        BlinkTime := FN_SEC_TO_TIME(CmdStepSec, 1.0, 60.0);
        PulseTime := FN_SEC_TO_TIME(CmdStepSec, 1.0, 600.0);
        (* Giữ giá trị cũ khi nhu cầu dao động dưới 2 %. *)
        DemandUsed := DEADBAND(LIMIT(0.0, CmdDemandPct, 100.0), 2.0, DemandUsed);
    END_IF;

    (* ===== 2. Khoá liên động và khoảng nghỉ khi chuyển chế độ ===== *)
    PermitLost(CLK := InPermit);
    IF PermitLost.Q AND (TripCount < 2147483647) THEN
        TripCount := TripCount + 1;
    END_IF;
    Changed := Mode <> PrevMode;
    PrevMode := Mode;
    (* Đổi chế độ hoặc mất InPermit: tắt hết, chờ 2 s ổn định rồi mới chạy. *)
    ModeDwell(IN := InPermit AND NOT Changed, PT := T#2s);
    Settled := ModeDwell.Q;
    IF NOT Settled THEN
        Step := 0;
        TestRunning := FALSE;
    END_IF;

    (* ===== 3. Gọi MỌI instance FB đúng một lần mỗi chu kỳ ===== *)
    StepClk(Run := Settled AND (((Mode = 2) AND (Step < 16) AND NOT AnyWaiting) OR (Mode = 3) OR ((Mode = 6) AND TestRunning)),
            StepTime := StepTime);
    Blinker(Run := Settled AND (Mode = 4), TimeOn := BlinkTime, TimeOff := BlinkTime);
    DemandOn(IN := DemandUsed, HIGH := 10.0, LOW := 5.0);
    Stager(Run := Settled AND (Mode = 5) AND DemandOn.Q, DemandPct := DemandUsed,
           MaxStages := 16, StageDelay := StepTime, Hold := AnyWaiting);
    (* AUTO tự "bấm nút" khi bước TEST/PULSE vừa ổn định. *)
    TestTrig(CLK := SEL(AutoOn, CmdTestStart, Settled AND ((Mode = 6) OR (Mode = 7))));
    TestStep(CU := StepClk.Pulse AND TestRunning, RESET := TestTrig.Q OR NOT Settled, PV := 16);
    (* Kích bằng SƯỜN của nút (TestTrig.Q), không bằng mức: nút để quên ở TRUE
       rồi chuyển sang chế độ 7 thì không được tự đóng 16 relay. *)
    PulseAll(IN := Settled AND (Mode = 7) AND TestTrig.Q, PT := PulseTime);

    (* ===== 4. Tạo mặt nạ yêu cầu theo chế độ ===== *)
    Mask := 0;
    LoadMode := FALSE;
    CASE Mode OF
        1:  IF AutoOn THEN
                Mask := SEL(AutoTmr.ET < T#4s, MASK_HIGH_NIBBLES, MASK_LOW_NIBBLES);   (* 0x0F0F rồi 0xF0F0 *)
            ELSE
                Mask := FN_MASK_FROM_REAL(CmdManualMask);
            END_IF;
        2:  LoadMode := TRUE;
            IF Step = 0 THEN
                Step := 1;
            ELSIF StepClk.Pulse AND (Step < 16) AND NOT AnyWaiting THEN
                Step := Step + 1;
            END_IF;
            Mask := FN_FIRST_N(Step);
        3:  IF Step = 0 THEN
                Step := SEL(CmdReverse, 1, 16);
            ELSIF StepClk.Pulse THEN
                Step := FN_NEXT_STEP(Step, 16, CmdReverse);
                IF (Step = SEL(CmdReverse, 1, 16)) AND (TotalCycles < 2147483647) THEN
                    TotalCycles := TotalCycles + 1;
                END_IF;
            END_IF;
            Mask := FN_ONE_HOT(Step);
        4:  Mask := SEL(Blinker.Q, MASK_EVEN, MASK_ODD);
        5:  LoadMode := TRUE;
            Mask := FN_FIRST_N(Stager.Stages);
        6:  IF TestTrig.Q AND Settled THEN
                TestRunning := TRUE;
            END_IF;
            IF TestStep.Q THEN
                TestRunning := FALSE;
            END_IF;
            IF TestRunning THEN
                Mask := FN_ONE_HOT(TestStep.CV + 1);
            END_IF;
        7:  IF PulseAll.Q THEN
                Mask := 65535;
            END_IF;
    ELSE
        Mask := 0;
    END_CASE;
    IF NOT Settled THEN
        Mask := 0;
    END_IF;

    (* Tải thật (chế độ 2, 5) có thời gian đóng/nghỉ tối thiểu 10 s.
       Thời gian đóng tối thiểu chỉ áp khi chế độ tải đã ổn định: trong 2 s nghỉ
       đổi chế độ, relay còn đóng từ chế độ cũ phải nhả ngay, không bị giữ thêm
       10 s theo luật của chế độ mới. Thời gian nghỉ tối thiểu vẫn luôn áp. *)
    TMinOn  := SEL(LoadMode AND Settled, T#0s, T#10s);
    TMinOff := SEL(LoadMode, T#0s, T#10s);

    (* ===== 5. 16 kênh ra qua khối bảo vệ relay ===== *)
    Req(Mask := Mask);
    LockBits(Mask := FN_MASK_FROM_REAL(CmdLockMask));
    Ch01(Cmd := Req.B01, Enable := InPermit AND NOT LockBits.B01, MinOn := TMinOn, MinOff := TMinOff);
    Ch02(Cmd := Req.B02, Enable := InPermit AND NOT LockBits.B02, MinOn := TMinOn, MinOff := TMinOff);
    Ch03(Cmd := Req.B03, Enable := InPermit AND NOT LockBits.B03, MinOn := TMinOn, MinOff := TMinOff);
    Ch04(Cmd := Req.B04, Enable := InPermit AND NOT LockBits.B04, MinOn := TMinOn, MinOff := TMinOff);
    Ch05(Cmd := Req.B05, Enable := InPermit AND NOT LockBits.B05, MinOn := TMinOn, MinOff := TMinOff);
    Ch06(Cmd := Req.B06, Enable := InPermit AND NOT LockBits.B06, MinOn := TMinOn, MinOff := TMinOff);
    Ch07(Cmd := Req.B07, Enable := InPermit AND NOT LockBits.B07, MinOn := TMinOn, MinOff := TMinOff);
    Ch08(Cmd := Req.B08, Enable := InPermit AND NOT LockBits.B08, MinOn := TMinOn, MinOff := TMinOff);
    Ch09(Cmd := Req.B09, Enable := InPermit AND NOT LockBits.B09, MinOn := TMinOn, MinOff := TMinOff);
    Ch10(Cmd := Req.B10, Enable := InPermit AND NOT LockBits.B10, MinOn := TMinOn, MinOff := TMinOff);
    Ch11(Cmd := Req.B11, Enable := InPermit AND NOT LockBits.B11, MinOn := TMinOn, MinOff := TMinOff);
    Ch12(Cmd := Req.B12, Enable := InPermit AND NOT LockBits.B12, MinOn := TMinOn, MinOff := TMinOff);
    Ch13(Cmd := Req.B13, Enable := InPermit AND NOT LockBits.B13, MinOn := TMinOn, MinOff := TMinOff);
    Ch14(Cmd := Req.B14, Enable := InPermit AND NOT LockBits.B14, MinOn := TMinOn, MinOff := TMinOff);
    Ch15(Cmd := Req.B15, Enable := InPermit AND NOT LockBits.B15, MinOn := TMinOn, MinOff := TMinOff);
    Ch16(Cmd := Req.B16, Enable := InPermit AND NOT LockBits.B16, MinOn := TMinOn, MinOff := TMinOff);
    DO01 := Ch01.Q;
    DO02 := Ch02.Q;
    DO03 := Ch03.Q;
    DO04 := Ch04.Q;
    DO05 := Ch05.Q;
    DO06 := Ch06.Q;
    DO07 := Ch07.Q;
    DO08 := Ch08.Q;
    DO09 := Ch09.Q;
    DO10 := Ch10.Q;
    DO11 := Ch11.Q;
    DO12 := Ch12.Q;
    DO13 := Ch13.Q;
    DO14 := Ch14.Q;
    DO15 := Ch15.Q;
    DO16 := Ch16.Q;

    AnyWaiting := Ch01.Waiting OR Ch02.Waiting OR Ch03.Waiting OR Ch04.Waiting
                  OR Ch05.Waiting OR Ch06.Waiting OR Ch07.Waiting OR Ch08.Waiting
                  OR Ch09.Waiting OR Ch10.Waiting OR Ch11.Waiting OR Ch12.Waiting
                  OR Ch13.Waiting OR Ch14.Waiting OR Ch15.Waiting OR Ch16.Waiting;

    (* ===== 6. Trạng thái cho HMI ===== *)
    OnCount := 0;
    IF DO01 THEN OnCount := OnCount + 1; END_IF;
    IF DO02 THEN OnCount := OnCount + 1; END_IF;
    IF DO03 THEN OnCount := OnCount + 1; END_IF;
    IF DO04 THEN OnCount := OnCount + 1; END_IF;
    IF DO05 THEN OnCount := OnCount + 1; END_IF;
    IF DO06 THEN OnCount := OnCount + 1; END_IF;
    IF DO07 THEN OnCount := OnCount + 1; END_IF;
    IF DO08 THEN OnCount := OnCount + 1; END_IF;
    IF DO09 THEN OnCount := OnCount + 1; END_IF;
    IF DO10 THEN OnCount := OnCount + 1; END_IF;
    IF DO11 THEN OnCount := OnCount + 1; END_IF;
    IF DO12 THEN OnCount := OnCount + 1; END_IF;
    IF DO13 THEN OnCount := OnCount + 1; END_IF;
    IF DO14 THEN OnCount := OnCount + 1; END_IF;
    IF DO15 THEN OnCount := OnCount + 1; END_IF;
    IF DO16 THEN OnCount := OnCount + 1; END_IF;
    StsOnCount := INT_TO_REAL(OnCount);
    StsTrips := DINT_TO_REAL(TripCount);
    IF NOT InPermit THEN
        StsMode := 9;
    ELSIF NOT Settled THEN
        StsMode := 8;
    ELSE
        StsMode := Mode;
    END_IF;
END_PROGRAM`
