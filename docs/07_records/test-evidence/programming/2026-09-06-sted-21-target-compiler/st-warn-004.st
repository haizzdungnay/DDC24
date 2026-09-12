PROGRAM t
VAR_OUTPUT running : BOOL; END_VAR
VAR timer : TON; go : BOOL; END_VAR
  running := timer.Q;
  timer(IN := go, PT := T#1s);
END_PROGRAM
