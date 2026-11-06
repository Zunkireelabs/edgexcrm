import { notFound } from "next/navigation";
import { Showcase } from "@/components/design-system/showcase";

// Dev-only Design System v2 showcase (EDGEX-85). No sidebar entry, no data fetching, no DB.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Showcase />;
}
