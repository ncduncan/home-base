// Nat's synthetic weekday work block: 8am–5pm, Monday to Friday. The week
// view draws it (web/src/lib/busy-block.ts) and the workload engine counts it
// as Nat's work hours (workload.ts), so both read the same two numbers.

export const NAT_WORK_START_HOUR = 8
export const NAT_WORK_END_HOUR = 17

/** Hours in Nat's block on one weekday. */
export const NAT_WORK_HOURS_PER_WEEKDAY = NAT_WORK_END_HOUR - NAT_WORK_START_HOUR
