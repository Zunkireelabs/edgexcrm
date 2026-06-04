import type { Position } from "@/types/database";

export interface OrgMember {
  user_id: string;
  email: string;
  role: string;
}

export interface OrgLayerWithPositions {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  positions: (Position & { member_count: number; members: OrgMember[] })[];
}
