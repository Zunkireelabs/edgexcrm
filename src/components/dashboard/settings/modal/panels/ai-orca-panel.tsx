"use client";

import { PanelContent, PanelHeader } from "../panel-shell";
import { ComingSoon } from "../coming-soon";

export function AiOrcaPanel() {
  return (
    <PanelContent>
      <PanelHeader title="AI & Orca" description="Configure Orca's knowledge, tools, and AI behaviours" />
      <ComingSoon feature="AI & Orca configuration" />
    </PanelContent>
  );
}
