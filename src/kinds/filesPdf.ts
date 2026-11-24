// WZ-2156 (template v10): testo di un PDF letto nel browser, in memoria. La libreria
// (unpdf 2.1.0, MIT, con PDF.js di Mozilla, Apache-2.0) si carica con import() solo al
// primo PDF: il resto del prototipo non la scarica. PDF.js qui gira nella pagina, senza
// worker, senza `eval` e senza scaricare caratteri o mappe: nessuna richiesta di rete.
// Il caricatore si può sostituire, così i test provano l'estrazione in Node.
// Copia identica in shared/mockupKinds/filesPdf.ts (verificata da un test).
import { FileReadError, fileLimits } from "./filesLogic.ts";

type TextItem = { str?: unknown; hasEOL?: unknown; transform?: unknown; width?: unknown };
type PdfPage = {
  getTextContent(): Promise<{ items: unknown[] }>;
  streamTextContent?(): ReadableStream<{ items: unknown[] }>;
  cleanup(): unknown;
};
export const pdfTooManyItems = "Il PDF contiene troppi frammenti di testo per il prototipo: prova con un file più piccolo o con meno pagine.";
/**
 * Parti di testo di una pagina, lette a pezzi: appena il totale supera `budget.left` la
 * lettura si ferma (e il resto della pagina non viene nemmeno raccolto).
 */
async function pageItems(page: PdfPage, budget: { left: number }, deadline: number): Promise<unknown[]> {
  if (typeof page.streamTextContent !== "function") {
    const items = (await within(page.getTextContent(), deadline)).items;
    if ((budget.left -= items.length) < 0) throw new FileReadError(pdfTooManyItems);
    return items;
  }
  const reader = page.streamTextContent().getReader();
  const items: unknown[] = [];
  try {
    for (;;) {
      const { done, value } = await within(reader.read(), deadline);
      if (done) break;
      const chunk = Array.isArray(value?.items) ? value.items : [];
      if ((budget.left -= chunk.length) < 0) throw new FileReadError(pdfTooManyItems);
      for (const item of chunk) items.push(item);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
  return items;
}
type PdfProxy = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy?(): Promise<unknown> };
export type PdfLibrary = { getDocumentProxy(data: Uint8Array, options?: Record<string, unknown>): Promise<PdfProxy> };
const loadUnpdf = async (): Promise<PdfLibrary> => (await import("unpdf")) as unknown as PdfLibrary;

/**
 * Righe di testo di una pagina: le parti sulla stessa linea si uniscono, da sinistra a destra.
 * Le parti si ordinano una volta sola (per y, poi per x) e si raggruppano scorrendole: lavoro
 * quasi lineare anche con molte parti (il loro numero è già limitato da `fileLimits.pdfItems`).
 */
export function pdfItemsText(items: readonly unknown[]): string {
  const parts: { y: number; x: number; text: string }[] = [];
  for (const raw of items) {
    const item = raw as TextItem;
    if (typeof item.str !== "string") continue;
    const t = Array.isArray(item.transform) ? (item.transform as number[]) : [];
    const y = typeof t[5] === "number" && Number.isFinite(t[5]) ? t[5] : 0;
    const x = typeof t[4] === "number" && Number.isFinite(t[4]) ? t[4] : 0;
    parts.push({ y, x, text: item.str });
  }
  parts.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; parts: { x: number; text: string }[] }[] = [];
  for (const p of parts) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - p.y) < 2.5) line.parts.push({ x: p.x, text: p.text });
    else lines.push({ y: p.y, parts: [{ x: p.x, text: p.text }] });
  }
  return lines
    .map((l) =>
      l.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

export type PdfText = { text: string; pages: number; truncated: boolean };
/** Oltre questo tempo la lettura si abbandona con un messaggio (un PDF anomalo non tiene ferma la persona). */
export const pdfReadTimeoutMs = 30_000;
const timeout = () => new FileReadError("Il PDF è troppo complesso da leggere nel prototipo: prova con un file più piccolo.");
function within<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(timeout());
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(timeout()), left)))]).finally(() => clearTimeout(timer));
}

/** Testo di un PDF già in memoria. Messaggi chiari per PDF protetti, danneggiati o senza testo (scansioni). */
export async function extractPdfText(bytes: Uint8Array, load: () => Promise<PdfLibrary> = loadUnpdf): Promise<PdfText> {
  if (!bytes.byteLength) throw new FileReadError("Il file è vuoto.");
  if (bytes.byteLength > fileLimits.documentBytes) throw new FileReadError("Il PDF è troppo grande: il massimo è 15 MB.");
  const deadline = Date.now() + pdfReadTimeoutMs;
  let lib: PdfLibrary;
  try {
    lib = await load();
  } catch {
    throw new FileReadError("Il lettore dei PDF non si è caricato: ricarica la pagina e riprova.");
  }
  let pdf: PdfProxy;
  try {
    // Copia: PDF.js trasferisce il buffer che riceve.
    pdf = await within(lib.getDocumentProxy(bytes.slice(), { isEvalSupported: false, useSystemFonts: false, useWasm: false, disableFontFace: true, stopAtErrors: false, verbosity: 0 }), deadline);
  } catch (error) {
    if (error instanceof FileReadError) throw error;
    const name = error && typeof error === "object" ? String(Reflect.get(error, "name") ?? "") : "";
    if (name === "PasswordException") throw new FileReadError("Il PDF è protetto da password: aprilo, salvalo senza password e riprova.");
    throw new FileReadError("Il PDF non si apre: potrebbe essere danneggiato.");
  }
  try {
    if (pdf.numPages > fileLimits.pdfPages) throw new FileReadError(`Il PDF ha ${pdf.numPages} pagine: nel prototipo se ne leggono al massimo ${fileLimits.pdfPages}.`);
    const pages: string[] = [];
    let length = 0;
    let truncated = false;
    const budget = { left: fileLimits.pdfItems };
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await within(pdf.getPage(n), deadline);
      const text = pdfItemsText(await pageItems(page, budget, deadline));
      page.cleanup();
      pages.push(text);
      length += text.length;
      if (length > fileLimits.textChars) {
        truncated = true;
        break;
      }
    }
    const text = pages.join("\n").slice(0, fileLimits.textChars);
    if (!text.replace(/\s/g, "")) throw new FileReadError("Il PDF non contiene testo: probabilmente è una scansione (una foto delle pagine). Il prototipo non legge le scansioni: compila i campi a mano guardando il documento.");
    return { text, pages: pdf.numPages, truncated };
  } catch (error) {
    if (error instanceof FileReadError) throw error;
    throw new FileReadError("Il testo del PDF non si legge: potrebbe essere danneggiato.");
  } finally {
    void pdf.destroy?.()?.catch?.(() => undefined);
  }
}
