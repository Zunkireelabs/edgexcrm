"use client";

import { useState, useEffect } from "react";
import { PanelContent, PanelHeader, PanelSection } from "../panel-shell";
import { ApiKeysManager } from "@/components/dashboard/api-keys-manager";
import { ComingSoon } from "../coming-soon";
import { useSettingsModal } from "@/contexts/settings-modal-context";

interface ApiKeyRow {
  id: string;
  name: string;
  permissions: string[];
  permissions_detail?: Record<string, unknown>;
  form_id?: string | null;
  allowed_origins?: string[] | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  status: "active" | "revoked";
}

export function IntegrationsPanel() {
  const { tenant } = useSettingsModal();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/settings/api-keys")
      .then((r) => r.json())
      .then((json) => {
        const raw = (json.data ?? []) as ApiKeyRow[];
        setKeys(
          raw
            .filter((k) => {
              const detail = k.permissions_detail as { category?: string } | undefined;
              return !detail || detail.category === "integration" || detail.category === undefined;
            })
            .map((k) => ({
              ...k,
              status: (k.revoked_at ? "revoked" : "active") as "active" | "revoked",
            })),
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <PanelContent>
      <PanelHeader title="Integrations" description="API keys and webhook configuration" />
      <PanelSection>
        {loading ? (
          <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <ApiKeysManager
            tenantId={tenant.id}
            initialKeys={keys}
            category="integration"
          />
        )}
      </PanelSection>
      <PanelSection>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Webhooks</h3>
        <ComingSoon feature="Webhooks" />
      </PanelSection>
    </PanelContent>
  );
}
