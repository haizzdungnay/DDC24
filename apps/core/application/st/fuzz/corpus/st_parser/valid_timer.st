PROGRAM p
VAR_INPUT enabled : BOOL; END_VAR
VAR_OUTPUT running : BOOL; END_VAR
VAR delay : TON; END_VAR
delay(IN := enabled, PT := T#5s);
running := delay.Q;
END_PROGRAM
