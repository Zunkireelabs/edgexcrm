export type DayStatus =
  | "on_leave"
  | "holiday"
  | "weekend"
  | "present"
  | "remote"
  | "half_day"
  | "absent"
  | "not_marked";

export interface AttendanceDay {
  date: string;
  status: DayStatus;
  clock_in_at: string | null;
  clock_out_at: string | null;
  note: string | null;
  source: "self_clock" | "manual" | null;
}

export interface MemberAttendance {
  tenant_user_id: string;
  user_id: string;
  name: string | null;
  email: string;
  days: AttendanceDay[];
}

export interface TodayBoardMember {
  tenant_user_id: string;
  user_id: string;
  name: string | null;
  email: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  status: string;
}

export const STATUS_LABEL: Record<string, string> = {
  on_leave: "On leave",
  holiday: "Holiday",
  weekend: "Weekend",
  present: "Present",
  remote: "Remote",
  half_day: "Half day",
  absent: "Absent",
  not_marked: "Not marked",
};

export const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  on_leave: "secondary",
  holiday: "outline",
  weekend: "outline",
  present: "default",
  remote: "default",
  half_day: "secondary",
  absent: "destructive",
  not_marked: "outline",
};
