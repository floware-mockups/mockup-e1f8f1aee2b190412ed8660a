// WZ-2156 (template v10): file veri in una pagina ordinaria del prototipo, attivati da
// `pages[].files`. Caricare un Excel o un CSV (anteprima delle colonne riconosciute, da
// correggere prima di confermare), leggere un PDF o un P7M firmato (campi proposti dal
// testo e scelti dalla persona), allegare foto alle righe, scaricare un PDF o un Word
// con i dati della pagina o di una riga. Tutto solo nel browser e in memoria: nessuna
// rete, nessun salvataggio. I campi che il file non contiene restano vuoti.
// Copia identica in shared/mockupKinds/FilesPanel.tsx (verificata da un test).
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { CompareFileError, compareLimits, type CompareRawTable } from "./compareLogic.ts";
import { readCompareFile } from "./compareFiles.ts";
import {
  FileReadError,
  documentKindOf,
  extractP7m,
  xmlText,
  fileFeaturesOf,
  fileLimits,
  filesPrivacyNotice,
  importPreview,
  pdfFieldProposals,
  type ImportPreview,
  type PdfProposal,
} from "./filesLogic.ts";
import { extractPdfText } from "./filesPdf.ts";
import { buildDocx, buildPdf, docxType, fileSlug, pageReportDoc, pdfType, rowDoc, type FilesPage } from "./fileWriters.ts";
import { addPhotos, removePhoto, usePhotos, type RowKey } from "./filesPhotos.ts";

const card = "rounded-xl border border-(--mk-divider) bg-(--mk-surface) shadow-sm";
const field = "rounded-md border border-(--mk-border) bg-(--mk-surface) px-3 py-2";
const primary = "rounded-lg bg-(--mk-primary) px-4 py-2.5 text-sm font-medium text-(--mk-on-primary) disabled:opacity-60";
const secondary = "rounded-lg border border-(--mk-border) bg-(--mk-surface) px-4 py-2.5 text-sm font-medium disabled:opacity-60";
const fileButton = `${secondary} inline-flex cursor-pointer items-center gap-2`;

export type FilesPanelPage = FilesPage & { id: string; form: string[] };

/** Scarica dati generati nel browser (Blob locale), senza rete. false se il browser non lo permette. */
export function downloadBytes(name: string, data: Uint8Array, type: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([data.slice().buffer as ArrayBuffer], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}
const errorText = (error: unknown, fallback: string) => (error instanceof FileReadError || error instanceof CompareFileError ? error.message : fallback);
export function FilesNotice({ children }: { children?: ReactNode }) {
  return (
    <p role="note" data-testid="files-notice" className="rounded-lg border border-(--mk-border) bg-(--mk-subtle) px-4 py-3 text-sm">
      <strong>File solo nel browser.</strong> {filesPrivacyNotice} {children}
    </p>
  );
}

type ImportState = { name: string; table: CompareRawTable; preview: ImportPreview };
type PdfState = { name: string; text: string; values: string[]; proposals: PdfProposal[]; note: string; inner?: { name: string; bytes: Uint8Array } };

export function FilesPanel({
  page,
  prototypeTitle,
  onAddRows,
  inert = false,
}: {
  page: FilesPanelPage;
  prototypeTitle: string;
  onAddRows: (rows: string[][], message: string) => void;
  inert?: boolean;
}) {
  const features = fileFeaturesOf(page);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [imported, setImported] = useState<ImportState | null>(null);
  const [pdf, setPdf] = useState<PdfState | null>(null);
  const textBox = useRef<HTMLPreElement | null>(null);
  const ticket = useRef(0);
  if (!features.length || !page.columns.length) return null;

  const start = () => {
    setError("");
    setMessage("");
    setBusy(true);
    return ++ticket.current;
  };
  const chooseTable = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const mine = start();
    setPdf(null);
    try {
      // La dimensione si controlla prima di leggere il file in memoria.
      if (file.size > compareLimits.fileBytes) throw new FileReadError("Il file è troppo grande: il massimo è 5 MB.");
      const table = await readCompareFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (mine !== ticket.current) return;
      const preview = importPreview(table, page.columns);
      setImported({ name: file.name, table, preview });
    } catch (e) {
      if (mine === ticket.current) {
        setImported(null);
        setError(errorText(e, "Il file non si apre: potrebbe essere danneggiato."));
      }
    } finally {
      if (mine === ticket.current) setBusy(false);
    }
  };
  const remap = (column: number, source: number) => {
    if (!imported) return;
    const mapping = imported.preview.mapping.map((m, i) => (i === column ? source : m === source && source >= 0 ? -1 : m));
    setImported({ ...imported, preview: importPreview(imported.table, page.columns, mapping, imported.preview.headerRow) });
  };
  const confirmImport = () => {
    if (!imported || !imported.preview.rows.length) return;
    const n = imported.preview.rows.length;
    onAddRows(imported.preview.rows, `${n} ${n === 1 ? "riga aggiunta" : "righe aggiunte"} da «${imported.name}» (solo in questa sessione).`);
    setImported(null);
  };

  const chooseDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const mine = start();
    setImported(null);
    try {
      if (file.size > fileLimits.documentBytes) throw new FileReadError("Il file è troppo grande: il massimo è 15 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = documentKindOf(file.name, bytes);
      let text = "";
      let note = "";
      let inner: PdfState["inner"];
      if (kind === "p7m") {
        const signed = extractP7m(file.name, bytes);
        const firme = signed.layers > 1 ? `${signed.layers} firme` : "una firma";
        if (signed.kind === "pdf") {
          inner = { name: /\.pdf$/i.test(signed.name) ? signed.name : `${signed.name}.pdf`, bytes: signed.content };
          text = (await extractPdfText(signed.content)).text;
          note = `File firmato (${firme}): ecco il PDF contenuto. La firma non è verificata nel prototipo.`;
        } else if (signed.kind === "xml") {
          text = xmlText(signed.content);
          note = `File firmato (${firme}) con un documento XML. La firma non è verificata nel prototipo.`;
        } else throw new FileReadError(`Il file firmato contiene «${signed.name}», che non è un PDF: il prototipo legge solo i PDF.`);
      } else if (kind === "pdf") {
        const read = await extractPdfText(bytes);
        text = read.text;
        note = `${read.pages} ${read.pages === 1 ? "pagina letta" : "pagine lette"}${read.truncated ? " (solo l'inizio: il testo è molto lungo)" : ""}.`;
      } else throw new FileReadError("Il file non è un PDF né un file firmato .p7m.");
      if (mine !== ticket.current) return;
      const proposals = pdfFieldProposals(text, page.columns);
      setPdf({ name: file.name, text, proposals, values: proposals.map((p) => p?.value ?? ""), note, inner });
    } catch (e) {
      if (mine === ticket.current) {
        setPdf(null);
        setError(errorText(e, "Il file non si legge: potrebbe essere danneggiato."));
      }
    } finally {
      if (mine === ticket.current) setBusy(false);
    }
  };
  const setValue = (i: number, value: string) => pdf && setPdf({ ...pdf, values: pdf.values.map((v, k) => (k === i ? value.slice(0, fileLimits.valueChars) : v)) });
  const takeSelection = (i: number) => {
    const selection = globalThis.getSelection?.();
    const box = textBox.current;
    const text = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!text || !box || !selection?.anchorNode || !box.contains(selection.anchorNode)) {
      setError("Seleziona prima una parte del testo del documento, poi premi «Usa la selezione».");
      return;
    }
    setError("");
    setValue(i, text);
  };
  const confirmPdf = () => {
    if (!pdf || pdf.values.every((v) => !v.trim())) return;
    onAddRows([pdf.values.map((v) => v.trim())], `Riga aggiunta dal documento «${pdf.name}» (solo in questa sessione).`);
    setPdf(null);
  };
  const report = (format: "pdf" | "docx") => {
    const doc = pageReportDoc(page, prototypeTitle);
    const ok = format === "pdf" ? downloadBytes(`${fileSlug(page.title)}.pdf`, buildPdf(doc), pdfType) : downloadBytes(`${fileSlug(page.title)}.docx`, buildDocx(doc), docxType);
    setMessage(ok ? `${format === "pdf" ? "PDF" : "Word"} scaricato, creato in questo browser con i dati della pagina.` : "Il browser non permette di scaricare il file.");
  };

  return (
    <section aria-label="File" data-testid="files-panel" className={`${card} my-6 grid gap-4 p-5`}>
      <h3 className="font-semibold">File</h3>
      <FilesNotice>{features.includes("photos") ? "Le foto si allegano dal Dettaglio di ogni riga o dal modulo." : ""}</FilesNotice>
      <div className="flex flex-wrap gap-3">
        {features.includes("import") && (
          <label className={fileButton} aria-disabled={inert || busy}>
            Carica Excel o CSV
            <input type="file" className="sr-only" accept=".xlsx,.csv,.txt" disabled={inert || busy} onChange={chooseTable} data-testid="files-import-input" />
          </label>
        )}
        {features.includes("pdf") && (
          <label className={fileButton} aria-disabled={inert || busy}>
            Leggi un PDF o un P7M firmato
            <input type="file" className="sr-only" accept=".pdf,.p7m,application/pdf" disabled={inert || busy} onChange={chooseDocument} data-testid="files-pdf-input" />
          </label>
        )}
        {features.includes("export") && (
          <>
            <button type="button" className={secondary} disabled={inert} onClick={() => report("pdf")}>
              Scarica PDF
            </button>
            <button type="button" className={secondary} disabled={inert} onClick={() => report("docx")}>
              Scarica Word
            </button>
          </>
        )}
      </div>
      {busy && <p className="text-sm text-(--mk-muted)">Lettura del file in questo browser…</p>}
      {error && (
        <p role="alert" className="text-sm text-(--mk-danger)">
          {error}
        </p>
      )}

      {imported && (
        <div className="grid gap-4" data-testid="files-import-preview">
          <p className="text-sm">
            «{imported.name}»: {imported.preview.rows.length} {imported.preview.rows.length === 1 ? "riga da aggiungere" : "righe da aggiungere"}
            {imported.preview.skipped > 0 && ` (altre ${imported.preview.skipped} oltre il limite di ${fileLimits.importRows} non si aggiungono)`}. Controlla le colonne riconosciute e
            correggile se serve.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {page.columns.map((c, i) => (
              <label key={i} className="grid gap-1 text-sm">
                <span>
                  {c} <span className="text-(--mk-muted)">← dal file</span>
                </span>
                <select className={field} value={imported.preview.mapping[i]} disabled={inert} onChange={(e) => remap(i, Number(e.target.value))}>
                  <option value={-1}>— nessuna: resta vuota —</option>
                  {imported.preview.header.map((h, k) => (
                    <option key={k} value={k}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {imported.preview.missing.length > 0 && (
            <p className="text-sm text-(--mk-muted)">Senza corrispondenza nel file, restano vuote: {imported.preview.missing.join(", ")}.</p>
          )}
          {imported.preview.unused.length > 0 && <p className="text-sm text-(--mk-muted)">Colonne del file non usate: {imported.preview.unused.join(", ")}.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="mb-2 text-left text-(--mk-muted)">Anteprima delle prime righe</caption>
              <thead className="bg-(--mk-subtle)">
                <tr>
                  {page.columns.map((c, i) => (
                    <th key={i} className="px-3 py-2">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {imported.preview.rows.slice(0, 5).map((row, r) => (
                  <tr key={r} className="border-t border-(--mk-divider)">
                    {row.map((cell, i) => (
                      <td key={i} className="px-3 py-2">
                        {cell || <span className="text-(--mk-muted)">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primary} disabled={inert || !imported.preview.rows.length} onClick={confirmImport}>
              Aggiungi {imported.preview.rows.length} {imported.preview.rows.length === 1 ? "riga" : "righe"} alla tabella
            </button>
            <button type="button" className={secondary} onClick={() => setImported(null)}>
              Annulla
            </button>
          </div>
        </div>
      )}

      {pdf && (
        <div className="grid gap-4" data-testid="files-pdf-preview">
          <p className="text-sm">
            «{pdf.name}»: {pdf.note} I campi sotto sono proposti dal testo senza intelligenza artificiale: controllali, correggili o prendi un pezzo di testo
            selezionandolo e premendo «Usa la selezione». Quelli che il documento non contiene restano vuoti.
          </p>
          {pdf.inner && (
            <div>
              <button type="button" className={secondary} onClick={() => setMessage(downloadBytes(pdf.inner!.name, pdf.inner!.bytes, pdfType) ? `PDF contenuto scaricato: ${pdf.inner!.name}.` : "Il browser non permette di scaricare il file.")}>
                Scarica il PDF contenuto
              </button>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid content-start gap-3">
              {page.columns.map((c, i) => (
                <div key={i} className="grid gap-1 text-sm">
                  <label htmlFor={`files-pdf-${page.id}-${i}`}>{c}</label>
                  <div className="flex gap-2">
                    <input
                      id={`files-pdf-${page.id}-${i}`}
                      className={`${field} min-w-0 flex-1`}
                      value={pdf.values[i]}
                      maxLength={fileLimits.valueChars}
                      autoComplete="off"
                      disabled={inert}
                      onChange={(e) => setValue(i, e.target.value)}
                    />
                    <button type="button" className={secondary} disabled={inert} onMouseDown={(e) => e.preventDefault()} onClick={() => takeSelection(i)}>
                      Usa la selezione
                    </button>
                  </div>
                  <span className="text-xs text-(--mk-muted)">{pdf.proposals[i] ? `Dal testo: «${pdf.proposals[i]!.line.slice(0, 90)}»` : "Non trovato nel documento: resta vuoto se non lo compili."}</span>
                </div>
              ))}
            </div>
            <div className="grid content-start gap-2">
              <span className="text-sm font-medium">Testo del documento</span>
              <pre ref={textBox} tabIndex={0} className="max-h-96 overflow-auto rounded-md border border-(--mk-border) bg-(--mk-subtle) p-3 text-xs whitespace-pre-wrap">
                {pdf.text}
              </pre>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primary} disabled={inert || pdf.values.every((v) => !v.trim())} onClick={confirmPdf}>
              Aggiungi alla tabella
            </button>
            <button type="button" className={secondary} onClick={() => setPdf(null)}>
              Annulla
            </button>
          </div>
        </div>
      )}
      <p role="status" className="text-sm text-(--mk-muted)">
        {message}
      </p>
    </section>
  );
}

/**
 * Foto di una riga (nel Dettaglio, `row` = identificativo stabile della riga) o della riga che
 * si sta aggiungendo (nel modulo, `row = "new"`).
 */
export function PhotoAttach({ pageId, row, inert = false }: { pageId: string; row: RowKey | undefined; inert?: boolean }) {
  const photos = usePhotos(pageId, row);
  const [issues, setIssues] = useState<string[]>([]);
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (row === undefined) return;
    setIssues(await addPhotos(pageId, row, files));
  };
  return (
    <div className="grid gap-2 text-sm" data-testid="files-photos">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Foto</span>
        <label className={`${fileButton} px-3 py-1.5`} aria-disabled={inert}>
          {photos.length ? "Aggiungi foto" : "Allega foto"}
          <input type="file" className="sr-only" accept="image/jpeg,image/png,image/gif,image/webp" multiple disabled={inert} onChange={choose} />
        </label>
        <span className="text-xs text-(--mk-muted)">Restano solo in questo browser.</span>
      </div>
      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <li key={p.id} className="grid gap-1">
              <img src={p.url} alt={`Foto allegata: ${p.name}`} className="h-24 w-24 rounded-md border border-(--mk-border) object-cover" />
              <button type="button" className="text-xs text-(--mk-danger)" disabled={inert || row === undefined} onClick={() => row !== undefined && removePhoto(pageId, row, p.id)}>
                Togli
              </button>
            </li>
          ))}
        </ul>
      )}
      {issues.map((m, i) => (
        <p key={i} role="alert" className="text-xs text-(--mk-danger)">
          {m}
        </p>
      ))}
    </div>
  );
}

/** Nel Dettaglio di una riga: foto (se attive) e documento della riga in PDF o Word (per esempio una bozza). */
export function RowFiles({
  page,
  rowIndex,
  rowId,
  prototypeTitle,
  inert = false,
}: {
  page: FilesPanelPage;
  rowIndex: number;
  /** Identificativo stabile della riga (useRowIds): le foto seguono la riga, non la posizione. */
  rowId: number | undefined;
  prototypeTitle: string;
  inert?: boolean;
}) {
  const features = fileFeaturesOf(page);
  const [message, setMessage] = useState("");
  const row = page.rows[rowIndex];
  if (!row || (!features.includes("photos") && !features.includes("export"))) return null;
  const download = (format: "pdf" | "docx") => {
    const doc = rowDoc(page, row, prototypeTitle);
    const base = fileSlug(`${page.title} ${row[0] ?? ""}`);
    const ok = format === "pdf" ? downloadBytes(`${base}.pdf`, buildPdf(doc), pdfType) : downloadBytes(`${base}.docx`, buildDocx(doc), docxType);
    setMessage(ok ? "Documento creato in questo browser e scaricato." : "Il browser non permette di scaricare il file.");
  };
  return (
    <div className="mt-5 grid gap-4 border-t border-(--mk-divider) pt-4" data-testid="files-row">
      {features.includes("photos") && <PhotoAttach pageId={page.id} row={rowId} inert={inert} />}
      {features.includes("export") && (
        <div className="flex flex-wrap gap-2 text-sm">
          <button type="button" className={`${secondary} px-3 py-1.5`} disabled={inert} onClick={() => download("docx")}>
            Scarica in Word
          </button>
          <button type="button" className={`${secondary} px-3 py-1.5`} disabled={inert} onClick={() => download("pdf")}>
            Scarica in PDF
          </button>
        </div>
      )}
      <p role="status" className="text-xs text-(--mk-muted)">
        {message}
      </p>
    </div>
  );
}
