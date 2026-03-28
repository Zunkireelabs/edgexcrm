"use client";

import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface Entity {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface EntitySelectFieldProps {
  tenantId: string;
  value: string;
  onChange: (entityId: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function EntitySelectField({
  tenantId,
  value,
  onChange,
  placeholder = "Select...",
  className,
  style,
}: EntitySelectFieldProps) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEntities() {
      try {
        const res = await fetch(
          `/api/v1/entities/public?tenant_id=${encodeURIComponent(tenantId)}`
        );
        if (res.ok) {
          const json = await res.json();
          setEntities(json.data || []);
        }
      } catch {
        // Silent fail - entities will be empty
      } finally {
        setLoading(false);
      }
    }

    fetchEntities();
  }, [tenantId]);

  if (loading) {
    return <Skeleton className="h-10 w-full rounded-md" />;
  }

  if (entities.length === 0) {
    return (
      <Select disabled>
        <SelectTrigger className={className} style={style}>
          <SelectValue placeholder="No options available" />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} style={style}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {entities.map((entity) => (
          <SelectItem key={entity.id} value={entity.id}>
            {entity.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
