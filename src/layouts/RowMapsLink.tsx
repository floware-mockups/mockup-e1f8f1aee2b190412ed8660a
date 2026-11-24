// WZ-2157 (template v12): «Apri in Google Maps» nel Dettaglio di una riga con coordinate. Si
// carica a parte (fuori dal bundle iniziale) con la lettura delle coordinate; il collegamento
// apre una nuova scheda solo con un clic e solo verso i domini ammessi (Google Maps).
// Copia identica in shared/mockupLayoutViews/RowMapsLink.tsx (anteprima di FlowareHub).
import { externalLinkAllowed, googleMapsUrl, rowCoordinates, type LayoutRow } from "./layoutLogic";

/** WZ-2157: API dei componenti su misura (`MapsLink` di ../floware): coordinate come numeri, mai un indirizzo. */
export function MapsLink({ lat, lon, label = "Apri in Google Maps" }: { lat: number; lon: number; label?: string }) {
  const valid = typeof lat === "number" && typeof lon === "number" && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const url = valid ? googleMapsUrl(lat, lon) : "";
  if (!url || !externalLinkAllowed(url)) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-(--mk-primary) underline">
      {String(label).slice(0, 60)}
    </a>
  );
}

export default function RowMapsLink({ page, row, className = "mt-4 inline-block font-medium text-(--mk-primary) underline" }: { page: { columns: string[] }; row: LayoutRow; className?: string }) {
  const at = rowCoordinates(page, row);
  const url = at && googleMapsUrl(at[0], at[1]);
  if (!url || !externalLinkAllowed(url)) return null;
  return (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer" aria-label="Apri in Google Maps (nuova scheda)">
      Apri in Google Maps
    </a>
  );
}
