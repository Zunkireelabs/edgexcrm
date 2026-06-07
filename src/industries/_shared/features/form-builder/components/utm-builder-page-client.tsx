"use client";

import { useRef } from "react";
import type { UtmLink } from "@/types/database";
import { UtmLinkBuilder } from "./utm-link-builder";
import { UtmLinkList, type UtmLinkListHandle } from "./utm-link-list";

interface FormOption {
  id: string;
  name: string;
  slug: string;
}

interface UtmBuilderPageClientProps {
  tenantSlug: string;
  forms: FormOption[];
  initialLinks: UtmLink[];
}

export function UtmBuilderPageClient({
  tenantSlug,
  forms,
  initialLinks,
}: UtmBuilderPageClientProps) {
  const listRef = useRef<UtmLinkListHandle>(null);

  return (
    <div className="space-y-6">
      <UtmLinkBuilder
        tenantSlug={tenantSlug}
        forms={forms}
        onSaved={(link) => listRef.current?.addLink(link)}
      />
      <UtmLinkList ref={listRef} initialLinks={initialLinks} />
    </div>
  );
}
