"use client";

import { useState } from "react";

interface UnsubscribeFormProps {
  token: string;
  tenantName: string;
  maskedEmail: string;
}

export function UnsubscribeForm({ token, tenantName, maskedEmail }: UnsubscribeFormProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/email/unsubscribe/${token}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.data?.valid) {
        setError("This link is no longer valid.");
        return;
      }
      setConfirmed(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <span className="text-green-600 text-xl">✓</span>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">You&apos;re unsubscribed</h1>
          <p className="text-sm text-gray-600">
            {maskedEmail} will no longer receive emails from {tenantName}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border p-8 text-center space-y-5">
        <h1 className="text-lg font-semibold text-gray-900">Stop receiving emails from {tenantName}?</h1>
        <p className="text-sm text-gray-600">
          This will unsubscribe <span className="font-medium">{maskedEmail}</span> from all future emails from{" "}
          {tenantName}.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {submitting ? "Unsubscribing…" : "Yes, unsubscribe me"}
        </button>
      </div>
    </div>
  );
}
