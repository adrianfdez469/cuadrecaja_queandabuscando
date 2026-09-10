"use client";

import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import { GeoJSON, MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import type { Layer, LeafletMouseEvent, StyleFunction } from "leaflet";

/**
 * F-042 (architecture.md § AD5) — el ÚNICO módulo que importa `leaflet`,
 * `react-leaflet` y la hoja de estilos que Leaflet publica en su propio
 * paquete. Nada de esto existe en la carga inicial del checkout (R14, E7):
 * `ZoneMapPanel.tsx` lo carga con `next/dynamic({ ssr: false })`.
 *
 * NO hay punto-en-polígono escrito por nosotros, ni en servidor ni en
 * cliente: Leaflet dispara el `click` de la capa del polígono tocado y, si
 * no hay ninguno, el del mapa (ADR 0011 sigue cerrada sin discusión).
 */

export type ZoneMapFeature = {
  type: "Feature";
  properties: { code: string };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
};
export type ZoneMapFeatureCollection = {
  type: "FeatureCollection";
  geometryVersion?: string;
  features: ZoneMapFeature[];
};

function OutsideClickHandler({ onOutsideClick }: { onOutsideClick: () => void }) {
  useMapEvents({ click: () => onOutsideClick() });
  return null;
}

export function ZoneMap({
  data,
  tileUrlTemplate,
  tileAttribution,
  boundariesAttribution,
  selectedCode,
  touchedCode,
  onZoneClick,
  onOutsideClick,
}: {
  data: ZoneMapFeatureCollection;
  tileUrlTemplate: string;
  tileAttribution: string;
  boundariesAttribution: string;
  selectedCode: string | null;
  touchedCode: string | null;
  onZoneClick: (code: string) => void;
  onOutsideClick: () => void;
}) {
  const bounds = useMemo(() => computeBounds(data), [data]);

  const styleFn: StyleFunction = (feature) => {
    const code = feature?.properties?.code as string | undefined;
    if (code === touchedCode) {
      return { className: "fill-brand/35 stroke-brand", weight: 3 };
    }
    if (code === selectedCode) {
      return { className: "fill-brand/35 stroke-brand-contrast", weight: 1 };
    }
    return { className: "fill-brand/15 stroke-brand", weight: 1.5 };
  };

  function onEachFeature(feature: ZoneMapFeature, layer: Layer) {
    layer.on("click", (event: LeafletMouseEvent) => {
      // Sin esto el click también dispara el del mapa (OutsideClickHandler)
      // y "tocar dentro de una zona" se leería, además, como "tocar fuera".
      event.originalEvent?.stopPropagation();
      onZoneClick(feature.properties.code);
    });
  }

  return (
    <MapContainer
      bounds={bounds}
      className="h-full w-full"
      attributionControl={false}
      aria-hidden="true"
    >
      <TileLayer url={tileUrlTemplate} attribution={tileAttribution} />
      <GeoJSON
        key={data.geometryVersion ?? "geometry"}
        data={data as unknown as GeoJSON.FeatureCollection}
        style={styleFn}
        onEachFeature={(feature, layer) => onEachFeature(feature as ZoneMapFeature, layer)}
      />
      <OutsideClickHandler onOutsideClick={onOutsideClick} />
      {/* D2/R18/AP1: dos piezas SIEMPRE — el crédito del proveedor de
          teselas y, además, la línea fija de límites municipales. Nunca
          detrás de un toggle. */}
      <div className="bg-surface/90 text-fg-muted absolute right-1 bottom-1 z-[1000] max-w-[90%] rounded px-2 py-1 text-xs">
        {tileAttribution} · {boundariesAttribution}
      </div>
    </MapContainer>
  );
}

function computeBounds(
  fc: ZoneMapFeatureCollection,
): [[number, number], [number, number]] | undefined {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const feature of fc.features) {
    for (const polygon of feature.geometry.coordinates) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        }
      }
    }
  }
  if (!Number.isFinite(minLat)) return undefined;
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}
