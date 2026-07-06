export interface LeaveTypeOption {
  leave_type_id: string;
  name: string;
  code: string | null;
  color: string | null;
  is_paid: boolean;
  allow_half_day: boolean;
  carry_forward: boolean;
  annual_allotment_days: number;
  adjustments: number;
  approved_days: number;
  balance: number;
  year: number;
}

export interface LeaveRequestRow {
  id: string;
  tenant_user_id: string;
  user_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  start_half: boolean;
  end_half: boolean;
  total_days: number;
  reason: string | null;
  approval_status: "pending" | "approved" | "rejected" | "cancelled";
  approver_tenant_user_id: string | null;
  rejection_reason: string | null;
  created_at: string;
  leave_types: { id: string; name: string; code: string | null; color: string | null; is_paid: boolean } | null;
}
