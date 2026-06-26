import { ConsentSignForm } from "./consent-sign-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

interface ConsentData {
  valid: boolean;
  reason?: string;
  tenant?: { name: string; logo_url: string | null };
  tenant_id?: string;
  title?: string;
  body_snapshot?: string;
  require_drawn_signature?: boolean;
}

async function fetchConsentData(token: string): Promise<ConsentData> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    const res = await fetch(`${baseUrl}/api/public/consent/${token}`, {
      cache: "no-store",
    });
    if (!res.ok) return { valid: false, reason: "Failed to load consent document." };
    const json = await res.json();
    return json.data as ConsentData;
  } catch {
    return { valid: false, reason: "Failed to load consent document." };
  }
}

export default async function ConsentTokenPage({ params }: PageProps) {
  const { token } = await params;
  const data = await fetchConsentData(token);

  if (!data.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center mx-auto">
            <span className="text-orange-600 text-xl">!</span>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Link Unavailable</h1>
          <p className="text-sm text-gray-600">{data.reason ?? "This consent link is not available."}</p>
        </div>
      </div>
    );
  }

  return (
    <ConsentSignForm
      token={token}
      tenant={data.tenant!}
      tenantId={data.tenant_id!}
      title={data.title!}
      bodySnapshot={data.body_snapshot!}
      requireDrawnSignature={data.require_drawn_signature ?? false}
    />
  );
}
