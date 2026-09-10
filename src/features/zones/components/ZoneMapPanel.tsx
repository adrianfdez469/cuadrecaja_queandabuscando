"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatMoney, money } from "@/lib/money";
import { publicEnv } from "@/lib/publicEnv";
import { ZONE_BOUNDARIES_ATTRIBUTION, ZONE_MAP_SLOW_LOAD_MS } from "@/constants/zones";
import { resolveTileLayer } from "../tiles";
import { findZoneInCoverage, type OfferableZone } from "../coverage";
import type { ZoneMapFeatureCollection } from "./ZoneMap";

/**
 * F-042 (architecture.md § AD5, design.md § 3) — la hoja/panel del mapa.
 * `ZoneMap` (el único importador de Leaflet) se carga con `next/dynamic`,
 * `ssr: false`, y SOLO se pide al renderizarse por primera vez — nada de
 * esto existe antes de que el comprador pulse el botón (R14, E7, C5).
 */
const ZoneMap = dynamic(() => import("./ZoneMap").then((mod) => mod.ZoneMap), {
  ssr: false,
  loading: () => (
    <p className="text-fg-muted flex h-full items-center justify-center text-sm">
      Cargando el mapa…
    </p>
  ),
});

type PanelState = "closed" | "loading" | "open" | "error";

export function ZoneMapPanel({
  storeSlug,
  zones,
  currencyCode,
  selectedCode,
  onConfirm,
}: {
  storeSlug: string;
  zones: readonly OfferableZone[];
  currencyCode: string;
  selectedCode: string | null;
  onConfirm: (code: string) => void;
}) {
  const [state, setState] = useState<PanelState>("closed");
  const [data, setData] = useState<ZoneMapFeatureCollection | null>(null);
  const [touchedCode, setTouchedCode] = useState<string | null>(null);
  const [outsideNotice, setOutsideNotice] = useState(false);
  const [slow, setSlow] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (state !== "loading") return undefined;
    const timer = setTimeout(() => setSlow(true), ZONE_MAP_SLOW_LOAD_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [state]);

  async function openPanel() {
    setState("loading");
    setTouchedCode(null);
    setOutsideNotice(false);
    try {
      const response = await fetch(`/api/zones/geometry/${storeSlug}`);
      if (!response.ok) throw new Error(`geometry route responded ${response.status}`);
      const json = (await response.json()) as ZoneMapFeatureCollection;
      setData(json);
      setState("open");
    } catch {
      setState("error");
    }
  }

  function closePanel() {
    setState("closed");
    setTouchedCode(null);
    setOutsideNotice(false);
    openButtonRef.current?.focus();
  }

  const touchedZone = touchedCode ? findZoneInCoverage(zones, touchedCode) : null;
  const tileLayer = resolveTileLayer({
    mapTileUrlTemplate: publicEnv.mapTileUrlTemplate,
    mapTileAttribution: publicEnv.mapTileAttribution,
  });

  return (
    <div>
      <Button
        ref={openButtonRef}
        type="button"
        variant="secondary"
        className="w-full"
        aria-busy={state === "loading"}
        onClick={() => void openPanel()}
      >
        {selectedCode ? "Ver el mapa" : "No sé mi municipio: verlo en el mapa"}
      </Button>
      <p className="text-fg-muted mt-1 text-xs">
        El mapa es una ayuda para ubicarte. También puedes elegir tu municipio en la lista.
      </p>

      {state === "loading" && (
        <div className="bg-surface-muted mt-3 flex h-64 items-center justify-center rounded-md">
          <p className="text-fg-muted text-sm">
            {slow
              ? "Sigue cargando. Mientras tanto puedes elegir tu municipio en la lista."
              : "Cargando el mapa…"}
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="border-danger/30 bg-danger/12 mt-3 rounded-md border p-3 text-sm">
          <p>No pudimos cargar el mapa. Elige tu municipio en la lista de arriba.</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void openPanel()}>
            Reintentar
          </Button>
        </div>
      )}

      {state === "open" && data && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Elige tu municipio en el mapa"
          className="border-border mt-3 flex h-96 flex-col overflow-hidden rounded-md border"
        >
          <div className="border-border flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">Elige tu municipio en el mapa</span>
            <button type="button" onClick={closePanel} className="text-sm underline">
              Cerrar el mapa
            </button>
          </div>
          <div className="relative flex-1">
            <ZoneMap
              data={data}
              tileUrlTemplate={tileLayer.urlTemplate}
              tileAttribution={tileLayer.attribution}
              boundariesAttribution={ZONE_BOUNDARIES_ATTRIBUTION}
              selectedCode={selectedCode}
              touchedCode={touchedCode}
              onZoneClick={(code) => {
                setTouchedCode(code);
                setOutsideNotice(false);
              }}
              onOutsideClick={() => {
                setTouchedCode(null);
                setOutsideNotice(true);
              }}
            />
          </div>
          <div className="border-border border-t p-3">
            {touchedZone ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold">
                  ¿Tu dirección está en {touchedZone.name}?{" "}
                  <span className="text-fg-muted font-normal">
                    {touchedZone.deliveryFee === "0.00"
                      ? "Envío gratis"
                      : `Envío + ${formatMoney(money(touchedZone.deliveryFee, currencyCode))}`}
                  </span>
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      onConfirm(touchedZone.code);
                      closePanel();
                    }}
                  >
                    Sí, es {touchedZone.name}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setTouchedCode(null)}>
                    No, elegir otro
                  </Button>
                </div>
              </div>
            ) : outsideNotice ? (
              <p className="text-sm">
                Esta tienda no llega ahí. Solo entrega en los municipios pintados. Puedes recogerlo
                en la tienda.
              </p>
            ) : (
              <p className="text-fg-muted text-sm">Toca el municipio donde vives.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
