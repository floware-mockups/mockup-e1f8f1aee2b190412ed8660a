// WZ-2157 (template v12): mappa vera della vista «mappa», caricata a parte solo quando la pagina
// ha righe con coordinate. Leaflet 1.9 (BSD-2-Clause) con le tessere di OpenStreetMap (dati
// © OpenStreetMap contributors, ODbL): l'unica richiesta di rete sono le tessere, consentite
// dalla CSP del template (img-src https://tile.openstreetmap.org). Le righe non escono dal
// browser: i punti sono cerchi disegnati nella pagina (nessuna icona da scaricare) e l'etichetta
// resta un testo locale. Copia identica in shared/mockupLayoutViews/LeafletMap.tsx (anteprima).
import { useEffect, useRef } from "react";
import { circleMarker, latLngBounds, layerGroup, map as leafletMap, tileLayer, type LayerGroup, type Map as LeafletInstance } from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map.css";

export const mapTileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const mapAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
export type MapPoint = { index: number; lat: number; lon: number; label: string; tone: string | null };
const textNode = (text: string) => {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
};

export function LeafletMap({ points, selected, inert, onOpen }: { points: MapPoint[]; selected: number | null; inert?: boolean; onOpen: (index: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletInstance | null>(null);
  const pins = useRef<LayerGroup | null>(null);
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    const m = leafletMap(box.current!, { scrollWheelZoom: false, attributionControl: true });
    // Senza il prefisso di Leaflet: l'unico collegamento sulla mappa è l'attribuzione richiesta da OpenStreetMap.
    m.attributionControl.setPrefix(false);
    tileLayer(mapTileUrl, { maxZoom: 19, attribution: mapAttribution }).addTo(m);
    pins.current = layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      pins.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    const layer = pins.current;
    if (!m || !layer) return;
    layer.clearLayers();
    for (const p of points) {
      const on = selected === p.index;
      circleMarker([p.lat, p.lon], { radius: on ? 11 : 8, weight: 2, className: `mk-pin${p.tone ? ` mk-pin-${p.tone}` : ""}${on ? " mk-pin-on" : ""}`, interactive: !inert })
        // Il testo della riga è un dato: mai HTML (Leaflet scriverebbe una stringa con innerHTML).
        .bindTooltip(textNode(p.label))
        .on("click", () => open.current(p.index))
        .addTo(layer);
    }
    const focus = points.find((p) => p.index === selected);
    if (focus) m.setView([focus.lat, focus.lon], Math.max(m.getZoom() || 0, 14));
    else if (points.length === 1) m.setView([points[0].lat, points[0].lon], 14);
    else if (points.length) m.fitBounds(latLngBounds(points.map((p) => [p.lat, p.lon])), { padding: [24, 24], maxZoom: 15 });
  }, [points, selected, inert]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const handler of [m.dragging, m.touchZoom, m.doubleClickZoom, m.boxZoom, m.keyboard]) {
      if (inert) handler.disable();
      else handler.enable();
    }
  }, [inert]);
  return (
    <div
      ref={box}
      role="region"
      aria-label={`Mappa con ${points.length === 1 ? "1 punto" : `${points.length} punti`}: l'elenco a lato ha gli stessi elementi`}
      className="mk-map aspect-[4/3] w-full overflow-hidden rounded-lg border border-(--mk-divider)"
    />
  );
}
