"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

interface ConsentSignFormProps {
  token: string;
  tenant: { name: string; logo_url: string | null };
  tenantId: string;
  title: string;
  bodySnapshot: string;
  requireDrawnSignature: boolean;
}

export function ConsentSignForm({
  token,
  tenant,
  tenantId,
  title,
  bodySnapshot,
  requireDrawnSignature,
}: ConsentSignFormProps) {
  const [signerName, setSignerName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Canvas for drawn signature
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);

  // ── Canvas drawing helpers ────────────────────────────────────────
  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
    setHasDrawn(true);
  }, []);

  const onPointerUp = useCallback(() => {
    drawing.current = false;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }, []);

  async function uploadSignatureBlob(): Promise<string | null> {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        if (!blob) { resolve(null); return; }

        setUploadingSignature(true);
        try {
          // Step 1: get signed upload URL from the existing upload API
          const urlRes = await fetch("/api/v1/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenant_id: tenantId,
              file_name: `signature.png`,
              file_size: blob.size,
              mime_type: "image/png",
              field_name: "consent_signature",
              session_id: "consent",
            }),
          });
          if (!urlRes.ok) { resolve(null); return; }
          const urlJson = await urlRes.json();
          const { path, token, public_url } = urlJson.data as { path: string; token: string; public_url: string };

          // Step 2: upload using Supabase storage client (mirrors public-form.tsx:326-333)
          const supabase = createClient();
          const { error: uploadError } = await supabase.storage
            .from("lead-documents")
            .uploadToSignedUrl(path, token, blob, { contentType: "image/png" });

          if (uploadError) { resolve(null); return; }

          resolve(public_url);
        } catch {
          resolve(null);
        } finally {
          setUploadingSignature(false);
        }
      }, "image/png");
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!signerName.trim()) { setError("Please enter your full name."); return; }
    if (!agreed) { setError("Please confirm that you have read and agree to the document."); return; }
    if (requireDrawnSignature && !hasDrawn) { setError("Please draw your signature."); return; }

    setSubmitting(true);

    try {
      let signatureImageUrl: string | null = null;
      if (requireDrawnSignature) {
        signatureImageUrl = await uploadSignatureBlob();
        if (!signatureImageUrl) {
          setError("Failed to upload signature. Please try again.");
          setSubmitting(false);
          return;
        }
      }

      const body: Record<string, unknown> = {
        signer_name: signerName.trim(),
        signature_type: requireDrawnSignature ? "drawn" : "typed",
        signature_value: signerName.trim(),
        agreed: true,
      };
      if (signatureImageUrl) body.signature_image_url = signatureImageUrl;

      const res = await fetch(`/api/public/consent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error?.message ?? "Failed to submit. Please try again.");
        return;
      }

      setDone(true);
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <span className="text-green-600 text-2xl">✓</span>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Consent Signed</h1>
          <p className="text-sm text-gray-600">
            Thank you, <strong>{signerName}</strong>. Your consent has been recorded successfully. You may close this window.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border p-6 flex items-center gap-4">
          {tenant.logo_url ? (
            <Image src={tenant.logo_url} alt={tenant.name} width={40} height={40} className="rounded-lg object-contain" />
          ) : (
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              {tenant.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Consent Request from</p>
            <p className="font-semibold text-gray-900">{tenant.name}</p>
          </div>
        </div>

        {/* Document */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-6 border-b">
            <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          </div>
          <div className="p-6 max-h-96 overflow-y-auto">
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
              {bodySnapshot}
            </pre>
          </div>
        </div>

        {/* Signature form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Sign Consent</h2>

          {/* Full name */}
          <div className="space-y-1.5">
            <label htmlFor="signer-name" className="text-sm font-medium text-gray-700">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              id="signer-name"
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Enter your full legal name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* Drawn signature (conditional) */}
          {requireDrawnSignature && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">
                  Drawn Signature <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Clear
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={600}
                height={120}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                className="w-full border border-gray-300 rounded-lg cursor-crosshair touch-none bg-white"
                style={{ height: "120px" }}
              />
              <p className="text-xs text-gray-500">Draw your signature above using a mouse or touch.</p>
            </div>
          )}

          {/* Agreement checkbox */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">
              I have read and understand the consent document above, and I agree to its terms.
            </span>
          </label>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || uploadingSignature}
            className="w-full py-2.5 px-4 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting || uploadingSignature ? "Submitting…" : "Submit Consent"}
          </button>
        </form>
      </div>
    </div>
  );
}
