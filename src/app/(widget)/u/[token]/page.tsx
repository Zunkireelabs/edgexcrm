import { OptOutForm } from "./optout-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

interface OptOutData {
  valid: boolean;
  reason?: string;
  tenantName?: string;
  maskedPhone?: string;
}

async function fetchOptOutData(token: string): Promise<OptOutData> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    const res = await fetch(`${baseUrl}/api/public/sms/opt-out/${token}`, {
      cache: "no-store",
    });
    if (!res.ok) return { valid: false, reason: "This link is no longer valid." };
    const json = await res.json();
    return json.data as OptOutData;
  } catch {
    return { valid: false, reason: "This link is no longer valid." };
  }
}

export default async function SmsOptOutPage({ params }: PageProps) {
  const { token } = await params;
  const data = await fetchOptOutData(token);

  if (!data.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
            <span className="text-gray-500 text-xl">i</span>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Link Unavailable</h1>
          <p className="text-sm text-gray-600">{data.reason ?? "This link is not available."}</p>
        </div>
      </div>
    );
  }

  return <OptOutForm token={token} tenantName={data.tenantName!} maskedPhone={data.maskedPhone!} />;
}
