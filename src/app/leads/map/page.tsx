"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import Link from "next/link";

const MapView = dynamic(() => import("@/components/leads/leads-map"), {
  ssr: false,
  loading: () => <p className="text-nox-muted">Carregando mapa…</p>,
});

type MapLead = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  opportunityScore: number;
  city: string | null;
};

export default function MapPage() {
  const [leads, setLeads] = useState<MapLead[]>([]);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const [leadsRes, settingsRes] = await Promise.all([
        fetch("/api/leads?page=1&pageSize=100&sort=score_desc"),
        fetch("/api/settings"),
      ]);
      const leadsJson = await leadsRes.json();
      const settingsJson = await settingsRes.json();
      setLeads(leadsJson.items ?? []);
      if (settingsJson.settings?.originLat != null) {
        setOrigin({
          lat: settingsJson.settings.originLat,
          lng: settingsJson.settings.originLng,
        });
      } else {
        const withCoords = (leadsJson.items as MapLead[]).find(
          (l) => l.latitude != null && l.longitude != null,
        );
        if (withCoords?.latitude != null && withCoords.longitude != null) {
          setOrigin({ lat: withCoords.latitude, lng: withCoords.longitude });
        }
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Mapa</h1>
        <p className="text-sm text-nox-muted">
          Marcadores da página atual (máx. 100). © OpenStreetMap contributors.
        </p>
      </div>
      <div className="h-[70vh] overflow-hidden rounded-xl border border-nox-border">
        {origin ? (
          <MapView origin={origin} leads={leads} />
        ) : (
          <p className="p-4 text-nox-muted">
            Sem coordenadas. Importe leads ou defina origem em{" "}
            <Link href="/leads/import" className="text-nox-cyan">
              Importação
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
