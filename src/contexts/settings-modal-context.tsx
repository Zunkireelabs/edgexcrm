"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Tenant, Industry } from "@/types/database";
import type { NavCatalogItem, WidgetCatalogItem } from "@/lib/settings/catalogs";

export interface BootstrapData {
  industry: Industry | null;
  navCatalog: NavCatalogItem[];
  widgetCatalog: WidgetCatalogItem[];
  maxBranches: number;
}

interface SettingsModalContextValue {
  isOpen: boolean;
  activeTab: string;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;
  tenant: Tenant;
  role: string;
  industryId: string | null;
  isEducation: boolean;
  bootstrapData: BootstrapData | null;
  bootstrapLoading: boolean;
}

const SettingsModalContext = createContext<SettingsModalContextValue | null>(null);

export function useSettingsModal(): SettingsModalContextValue {
  const ctx = useContext(SettingsModalContext);
  if (!ctx) {
    // Graceful fallback when used outside the provider
    return {
      isOpen: false,
      activeTab: "general",
      openSettings: () => { window.location.href = "/home?settings=general"; },
      closeSettings: () => {},
      tenant: {} as Tenant,
      role: "",
      industryId: null,
      isEducation: false,
      bootstrapData: null,
      bootstrapLoading: false,
    };
  }
  return ctx;
}

const VALID_TABS = [
  "general",
  "ai-orca",
  "organization",
  "team-roles",
  "lead-management",
  "academic-operations",
  "communications",
  "integrations",
  "compliance",
];

function resolveTab(raw: string | null): string {
  if (!raw) return "general";
  return VALID_TABS.includes(raw) ? raw : "general";
}

// Dynamically loaded so it code-splits and doesn't run on the server
const SettingsModalPortal = dynamic(
  () =>
    import("@/components/dashboard/settings/modal/settings-modal").then(
      (m) => m.SettingsModal,
    ),
  { ssr: false },
);

interface SettingsModalProviderProps {
  children: ReactNode;
  tenant: Tenant;
  role: string;
  industryId: string | null;
}

export function SettingsModalProvider({
  children,
  tenant,
  role,
  industryId,
}: SettingsModalProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isEducation = industryId === "education_consultancy";

  const [bootstrapData, setBootstrapData] = useState<BootstrapData | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const bootstrapFetched = useRef(false);

  // Derive open/tab state from URL
  const settingsParam = searchParams.get("settings");
  const isOpen = settingsParam !== null;
  const activeTab = resolveTab(settingsParam);

  // Fetch bootstrap once when the modal first opens
  useEffect(() => {
    if (isOpen && !bootstrapFetched.current) {
      bootstrapFetched.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBootstrapLoading(true);
      fetch("/api/v1/settings/bootstrap")
        .then((r) => r.json())
        .then((json) => setBootstrapData(json.data ?? null))
        .catch(() => {})
        .finally(() => setBootstrapLoading(false));
    }
  }, [isOpen]);

  const buildUrl = useCallback(
    (tab?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("connected");
      params.delete("error");
      params.set("settings", tab ?? "general");
      return `${pathname}?${params.toString()}`;
    },
    [pathname, searchParams],
  );

  const openSettings = useCallback(
    (tab?: string) => {
      router.push(buildUrl(tab ?? "general"));
    },
    [router, buildUrl],
  );

  const closeSettings = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("settings");
    const remaining = params.toString();
    router.push(remaining ? `${pathname}?${remaining}` : pathname);
  }, [router, pathname, searchParams]);

  const handleTabChange = useCallback(
    (tab: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("settings", tab);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <SettingsModalContext.Provider
      value={{
        isOpen,
        activeTab,
        openSettings,
        closeSettings,
        tenant,
        role,
        industryId,
        isEducation,
        bootstrapData,
        bootstrapLoading,
      }}
    >
      {children}
      {/* Modal overlay — Radix portal renders at document.body */}
      <SettingsModalPortal
        isOpen={isOpen}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onClose={closeSettings}
      />
    </SettingsModalContext.Provider>
  );
}
