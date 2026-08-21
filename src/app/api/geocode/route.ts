import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { fetchWithRetry } from "@/lib/places/http";

const schema = z.object({
  q: z.string().min(2),
});

/** Nominatim geocoding (OSM) — respectful usage, server-side only. */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const parsed = schema.safeParse({ q: url.searchParams.get("q") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe cidade, endereço ou CEP" }, { status: 400 });
  }

  const endpoint = new URL("https://nominatim.openstreetmap.org/search");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("limit", "5");
  endpoint.searchParams.set("countrycodes", "br");
  endpoint.searchParams.set("q", parsed.data.q);

  const res = await fetchWithRetry(
    endpoint.toString(),
    {
      headers: {
        "User-Agent": "NOX-OS-Prospection/1.0 (privacy contact via app settings)",
        Accept: "application/json",
      },
    },
    { retries: 2, timeoutMs: 15000 },
  );

  if (!res.ok) {
    return NextResponse.json({ error: `Geocoder HTTP ${res.status}` }, { status: 502 });
  }

  const data = (await res.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
  }>;

  return NextResponse.json({
    results: data.map((r) => ({
      label: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
    })),
    attribution: "© OpenStreetMap contributors / Nominatim",
  });
}
