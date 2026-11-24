// WZ-2156 (template v10): la parte dei file veri che serve all'avvio del prototipo (funzioni
// attive su una pagina, limiti, riconoscimento delle foto). È l'unica nel bundle iniziale: il
// resto (Excel, PDF, P7M, documenti) sta in filesLogic.ts e si carica solo con il pannello.
// Copia identica in shared/mockupKinds/filesBasics.ts (verificata da un test).

/** Funzioni dei file attivabili su una pagina ordinaria (`pages[].files`), in quest'ordine. */
export const mockupFileFeatures = ["import", "pdf", "photos", "export"] as const;
export type MockupFileFeature = (typeof mockupFileFeatures)[number];
export const mockupFileFeatureLabels: Record<MockupFileFeature, string> = {
  import: "caricamento di file Excel o CSV",
  pdf: "lettura di PDF e P7M",
  photos: "foto allegate",
  export: "download in PDF e Word",
};
/** Funzioni attive su una pagina, lette con prudenza (la specifica è già validata). */
export function fileFeaturesOf(page: object): MockupFileFeature[] {
  const raw = Reflect.get(page, "files");
  if (!Array.isArray(raw)) return [];
  return mockupFileFeatures.filter((f) => raw.includes(f));
}

export const fileLimits = {
  /** PDF e P7M. */
  documentBytes: 15 * 1024 * 1024,
  pdfPages: 40,
  /** Frammenti di testo letti da un PDF, in tutto: oltre, la lettura si ferma con un messaggio. */
  pdfItems: 20_000,
  /** Elementi ASN.1 visitati leggendo un .p7m: oltre, il file si rifiuta. */
  p7mNodes: 50_000,
  textChars: 200_000,
  photoBytes: 12 * 1024 * 1024,
  photosPerRow: 6,
  /** Righe aggiunte alla tabella da un solo file. */
  importRows: 300,
  /** Livelli di firma uno dentro l'altro in un .p7m (file firmati più volte). */
  p7mLayers: 4,
  valueChars: 200,
} as const;

export class FileReadError extends Error {}

/** Frase da mostrare sempre vicino ai controlli dei file. */
export const filesPrivacyNotice =
  "I file restano in questo browser: si leggono solo in memoria, non vengono salvati né inviati a nessun server. Ricaricando la pagina spariscono.";

export const startsWith = (bytes: Uint8Array, text: string) => [...text].every((c, i) => bytes[i] === c.charCodeAt(0));

// --- Foto -------------------------------------------------------------------------

export type PhotoType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
/** Tipo della foto dai primi byte (non dal nome): un file che non è un'immagine si rifiuta. */
export function sniffPhoto(bytes: Uint8Array): PhotoType | "heic" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (startsWith(bytes, "\x89PNG\r\n\x1a\n")) return "image/png";
  if (startsWith(bytes, "GIF87a") || startsWith(bytes, "GIF89a")) return "image/gif";
  if (startsWith(bytes, "RIFF") && [..."WEBP"].every((c, i) => bytes[8 + i] === c.charCodeAt(0))) return "image/webp";
  const brand = new TextDecoder("latin1").decode(bytes.subarray(4, 12));
  if (/^ftyp(heic|heix|hevc|mif1|msf1)/.test(brand)) return "heic";
  return null;
}
export function photoIssue(name: string, bytes: Uint8Array): string | null {
  if (!bytes.byteLength) return `«${name}» è vuoto.`;
  if (bytes.byteLength > fileLimits.photoBytes) return `«${name}» è troppo grande: il massimo è 12 MB per foto.`;
  const type = sniffPhoto(bytes);
  if (type === "heic") return `«${name}» è in formato HEIC (iPhone), che il browser non mostra: sul telefono scegli «Più compatibile» o invia la foto come JPEG.`;
  if (!type) return `«${name}» non è una foto JPEG, PNG, GIF o WebP.`;
  return null;
}
