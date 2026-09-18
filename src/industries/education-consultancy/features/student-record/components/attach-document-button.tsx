"use client";

import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocumentType } from "@/lib/documents/constants";
import {
  DocumentUploadDialog,
  type QualificationLevel,
} from "@/industries/education-consultancy/features/applicant-documents/document-upload-dialog";

/**
 * A small "Attach Document" trigger for Passport & Citizenship / a specific
 * Qualification card — reuses DocumentUploadDialog (the same presign -> R2
 * PUT -> verified-complete flow the sidebar Documents card uses), just
 * pre-locked to the context it was opened from so the upload lands tagged
 * correctly without the user re-picking a type/qualification they already
 * told us by clicking this specific button.
 */
export function AttachDocumentButton({
  leadId,
  defaultDocumentType,
  fixedQualificationLevel,
  label = "Attach Document",
}: {
  leadId: string;
  defaultDocumentType: DocumentType;
  fixedQualificationLevel?: QualificationLevel;
  label?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,.docx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFile(f);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-muted-foreground hover:text-foreground"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="h-3.5 w-3.5 mr-1" />
        {label}
      </Button>
      <DocumentUploadDialog
        leadId={leadId}
        file={file}
        onOpenChange={(open) => !open && setFile(null)}
        defaultDocumentType={defaultDocumentType}
        fixedQualificationLevel={fixedQualificationLevel}
      />
    </>
  );
}
