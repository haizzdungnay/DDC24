PROGRAM ModbusDoProbeST
VAR_OUTPUT
    DO_CMD : BOOL;
END_VAR
VAR
    Pulse : TON;
END_VAR

Pulse(IN := NOT Pulse.Q, PT := T#1s);
DO_CMD := Pulse.Q;
END_PROGRAM
