import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ linkId: string }> }
) {
  const { linkId } = await params;
  const supabase = await createServiceClient();

  const { data: link } = await supabase
    .from("utm_links")
    .select("destination_url, utm_source, utm_medium, utm_campaign")
    .eq("id", linkId)
    .single();

  if (!link) {
    return new NextResponse("Not found", { status: 404 });
  }

  await supabase.rpc("increment_utm_link_clicks", { p_link_id: linkId });

  const url = new URL(link.destination_url);
  if (link.utm_source) url.searchParams.set("utm_source", link.utm_source);
  if (link.utm_medium) url.searchParams.set("utm_medium", link.utm_medium);
  if (link.utm_campaign) url.searchParams.set("utm_campaign", link.utm_campaign);

  return NextResponse.redirect(url.toString(), 302);
}
