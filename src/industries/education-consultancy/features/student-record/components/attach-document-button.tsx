"use client";

import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DocumentType } from "@/lib/documents/constants";
import type { QualificationLevel } from "@/industries/education-consultancy/features/applicant-documents/document-upload-dialog";
import { MultiDocumentUploadDialog } from "@/industries/education-consultancy/features/applicant-documents/multi-document-upload-dialog";
import { ACCEPT_ATTR, describeSkipped, pickFiles } from "@/industries/education-consultancy/features/applicant-documents/multi-upload";

// What a document on each kind of card can be. The first entry is that card's usual document.
const QUALIFICATION_TYPES: readonly DocumentType[] = ["marksheet", "transcript", "certificate", "english_test_result", "other"];
const IDENTITY_TYPES: readonly DocumentType[] = ["passport", "identity_document", "other"];

/**
 * An "Attach" trigger for a Qualification card or Passport & Citizenship. Choose several files at once (up to 10),
 * then say what each one is and name it in one dialog. Same safe upload as everywhere else (presign -> storage PUT ->
 * server-verified complete); the dialog starts each file as this card's usual type, so a marksheet card needs no
 * picking for the common case.
 */
export function AttachDocumentButton({
  leadId,
  defaultDocumentType,
  fixedQualificationLevel,
  label = "Attach",
  onUploaded,
}: {
  leadId: string;
  defaultDocumentType: DocumentType;
  fixedQualificationLevel?: QualificationLevel;
  label?: string;
  onUploaded?: () => void;
}) {
  const [files, setFiles] = useState<File[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typeOptions = defaultDocumentType === "passport" ? IDENTITY_TYPES : QUALIFICATION_TYPES;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="hidden"
        data-testid="attach-input"
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (chosen.length === 0) return;
          const result = pickFiles([], chosen);
          const note = describeSkipped(result);
          if (note) toast.error(note);
          if (result.accepted.length > 0) setFiles(result.accepted);
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
      <MultiDocumentUploadDialog
        leadId={leadId}
        files={files}
        onClose={() => setFiles(null)}
        onUploaded={onUploaded}
        typeOptions={typeOptions}
        defaultType={defaultDocumentType}
        fixedQualificationLevel={fixedQualificationLevel}
      />
    </>
  );
}
