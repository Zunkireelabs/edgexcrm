import { redirect } from "next/navigation";

export default function LegacyTimeTrackingApprovalsRoute() {
  redirect("/approvals/time-entries");
}
