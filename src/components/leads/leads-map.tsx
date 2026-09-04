"use client";

import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from "react-leaflet";
import L from "leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";

const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

type Props = {
  origin: { lat: number; lng: number };
  leads: Array<{
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    opportunityScore: number;
    city: string | null;
  }>;
};

export default function LeadsMap({ origin, leads }: Props) {
  const points = leads.filter((l) => l.latitude != null && l.longitude != null);

  return (
    <MapContainer
      center={[origin.lat, origin.lng]}
      zoom={12}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <CircleMarker
        center={[origin.lat, origin.lng]}
        radius={10}
        pathOptions={{ color: "#22d3ee", fillColor: "#22d3ee", fillOpacity: 0.6 }}
      >
        <Popup>Origem da busca</Popup>
      </CircleMarker>
      {points.map((l) => (
        <Marker key={l.id} position={[l.latitude!, l.longitude!]} icon={icon}>
          <Popup>
            <strong>{l.name}</strong>
            <br />
            Score {l.opportunityScore}
            <br />
            <Link href={`/leads/${l.id}`}>Abrir ficha</Link>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
