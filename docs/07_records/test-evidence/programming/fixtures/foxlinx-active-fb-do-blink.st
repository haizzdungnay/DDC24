FUNCTION_BLOCK FB_DO_BLINK_100MS_V1
VAR_INPUT
    DUMMY : BOOL;
END_VAR

VAR_OUTPUT
    Q : BOOL;
END_VAR

VAR
    TickCount : INT;
END_VAR

(* Program cycle = 50 ms. Toggle every 2 scans = 100 ms per state change. *)
TickCount := TickCount + 1;

IF TickCount >= 2 THEN
    TickCount := 0;
    Q := NOT Q;
END_IF;

END_FUNCTION_BLOCK
