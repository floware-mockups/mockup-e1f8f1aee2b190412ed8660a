// WZ-2156 (template v10): documenti scaricabili generati nel browser dai dati del
// prototipo, senza librerie e senza rete: un Word (.docx, archivio ZIP con l'XML di
// WordprocessingML) e un PDF di testo (Helvetica, codifica WinAnsi). Funzioni pure e
// deterministiche: stessi dati, stessi byte. Le usano il sito pubblicato e
// l'anteprima di FlowareHub.
// Copia identica in shared/mockupKinds/fileWriters.ts (verificata da un test).

export type FileDocBlock =
  | { heading: string }
  | { paragraph: string; bold?: boolean }
  | { fields: [string, string][] }
  | { table: { columns: string[]; rows: string[][] } };
export type FileDoc = { title: string; subtitle?: string; blocks: FileDocBlock[]; footer: string };

export const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const pdfType = "application/pdf";

// --- ZIP senza compressione -------------------------------------------------------

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** Archivio ZIP «stored» (senza compressione): Word lo apre come ogni .docx. */
export function zipStored(files: { name: string; content: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // Data fissa (1/1/2026): stessi dati, stessi byte.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = enc.encode(file.content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomi in UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, dosTime, true);
    head.setUint16(14, dosDate, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, data.length, true);
    head.setUint32(24, data.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    central.push(new Uint8Array(head.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- Word ------------------------------------------------------------------------

// Solo i caratteri ammessi in XML 1.0, con le cinque entità.
const xmlAllowed = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0;
  return c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000;
};
const xml = (text: string) =>
  [...String(text ?? "")]
    .filter(xmlAllowed)
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const run = (text: string, opts: { bold?: boolean; size?: number; italic?: boolean } = {}) => {
  const props = `${opts.bold ? "<w:b/>" : ""}${opts.italic ? "<w:i/>" : ""}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ""}`;
  // Gli a capo diventano interruzioni di riga dentro lo stesso paragrafo.
  const pieces = String(text ?? "").split(/\r?\n/);
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${pieces.map((p, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${xml(p)}</w:t>`).join("")}</w:r>`;
};
const para = (content: string, opts: { center?: boolean; after?: number; style?: string } = {}) =>
  `<w:p><w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ""}<w:spacing w:after="${opts.after ?? 120}"/>${opts.center ? '<w:jc w:val="center"/>' : ""}</w:pPr>${content}</w:p>`;
const border = '<w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/>';
const wordTable = (columns: string[], rows: string[][], bold = true) => {
  const cell = (text: string, b: boolean) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(run(text, { bold: b, size: 18 }), { after: 0 })}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${columns.length ? `<w:tr>${columns.map((c) => cell(c, bold)).join("")}</w:tr>` : ""}${rows.map((r) => `<w:tr>${r.map((c) => cell(c, false)).join("")}</w:tr>`).join("")}</w:tbl>${para("", { after: 120 })}`;
};

/** File .docx (Word) con titolo, sezioni, campi, tabelle e nota finale. */
export function buildDocx(doc: FileDoc): Uint8Array {
  const body: string[] = [para(run(doc.title, { bold: true, size: 32 }), { style: "Title", after: 80 })];
  if (doc.subtitle) body.push(para(run(doc.subtitle, { size: 20, italic: true }), { after: 240 }));
  for (const block of doc.blocks) {
    if ("heading" in block) body.push(para(run(block.heading, { bold: true, size: 26 }), { style: "Heading1", after: 120 }));
    else if ("paragraph" in block) body.push(para(run(block.paragraph, { bold: block.bold })));
    // Una tabella di Word senza righe darebbe un file da riparare: si omette.
    else if ("fields" in block) {
      if (block.fields.length) body.push(wordTable([], block.fields.map(([k, v]) => [k, v])));
    } else if (block.table.columns.length) body.push(wordTable(block.table.columns, block.table.rows));
  }
  body.push(para(run(doc.footer, { italic: true, size: 16 }), { after: 0 }));
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="it-IT"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240"/><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`;
  return zipStored([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "word/document.xml", content: document },
    { name: "word/styles.xml", content: styles },
  ]);
}

// --- PDF -------------------------------------------------------------------------

const winAnsiExtra: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97 };
const plainPdf = (text: string) =>
  String(text ?? "")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/−/g, "-")
    .replace(/\s+/g, " ");
const winAnsi = (text: string) =>
  [...plainPdf(text)]
    .map((ch) => {
      if (winAnsiExtra[ch] !== undefined) return String.fromCharCode(winAnsiExtra[ch]);
      const code = ch.charCodeAt(0);
      // Lettere accentate di altri alfabeti latini: la lettera senza accento.
      if (code > 0xff) return ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\u0020-\u00ff]/g, "?");
      return code >= 0x20 && !(code >= 0x7f && code < 0xa0) ? ch : "?";
    })
    .join("");
const literal = (text: string) => "(" + winAnsi(text).replace(/[\\()]/g, (c) => "\\" + c) + ")";
// Larghezza media di Helvetica, prudente: basta per andare a capo e per le colonne.
const charW = (size: number, bold?: boolean) => size * (bold ? 0.56 : 0.52);

type PdfLine = { text: string; size: number; bold?: boolean; x?: number; before?: number };
const pageW = 595;
const pageH = 842;
const margin = 50;

function wrap(text: string, size: number, width: number, bold?: boolean): string[] {
  const max = Math.max(8, Math.floor(width / charW(size, bold)));
  const out: string[] = [];
  for (const word of plainPdf(text).split(" ").filter(Boolean)) {
    const last = out[out.length - 1];
    if (last !== undefined && (last + " " + word).length <= max) out[out.length - 1] = `${last} ${word}`;
    else for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
  }
  return out.length ? out : [""];
}
const fit = (text: string, chars: number) => {
  const t = plainPdf(text).trim();
  return t.length <= chars ? t : `${t.slice(0, Math.max(1, chars - 1))}…`;
};

/** PDF di testo A4 (con a capo, tabelle e numero di pagina) dallo stesso modello del Word. */
export function buildPdf(doc: FileDoc): Uint8Array {
  const usable = pageW - margin * 2;
  const lines: PdfLine[] = [];
  const push = (text: string, size: number, opts: { bold?: boolean; before?: number; indent?: number } = {}) =>
    wrap(text, size, usable - (opts.indent ?? 0), opts.bold).forEach((t, i) => lines.push({ text: t, size, bold: opts.bold, x: margin + (opts.indent ?? 0), before: i ? 0 : (opts.before ?? 0) }));
  push(doc.title, 16, { bold: true });
  if (doc.subtitle) push(doc.subtitle, 9, { before: 4 });
  let shortened = false;
  for (const block of doc.blocks) {
    if ("heading" in block) push(block.heading, 12, { bold: true, before: 14 });
    else if ("paragraph" in block) push(block.paragraph, 10, { bold: block.bold, before: 4 });
    else if ("fields" in block)
      for (const [k, v] of block.fields) {
        push(`${k}: ${v || "—"}`, 10, { before: 2 });
      }
    else {
      const { columns, rows } = block.table;
      if (!columns.length) continue;
      const size = columns.length > 6 ? 7 : 8;
      const widths = columns.map((c, i) => Math.min(40, Math.max(c.length, 4, ...rows.map((r) => (r[i] ?? "").length))) + 2);
      const total = widths.reduce((a, b) => a + b, 0);
      const colW = widths.map((w) => (w / total) * usable);
      const row = (cells: string[], bold: boolean, before = 0) => {
        let x = margin;
        cells.forEach((cell, i) => {
          const chars = Math.max(3, Math.floor((colW[i] - 4) / charW(size, bold)));
          if (plainPdf(cell ?? "").trim().length > chars) shortened = true;
          lines.push({ text: fit(cell ?? "", chars), size, bold, x, before: i ? undefined : before });
          x += colW[i];
        });
      };
      row(columns, true, 8);
      for (const r of rows) row(r, false);
    }
  }
  if (shortened) push("Nella tabella i testi lunghi sono abbreviati: il file Word li riporta interi.", 8, { before: 10 });
  push(doc.footer, 8, { before: 14 });

  // Impaginazione: le celle di una riga di tabella hanno `before` undefined dopo la prima e restano sulla stessa riga.
  const pages: string[][] = [[]];
  let y = pageH - margin;
  for (const line of lines) {
    const sameRow = line.before === undefined && line.x !== margin;
    if (!sameRow) {
      const lead = line.size * 1.4 + (line.before ?? 0);
      if (y - lead < margin + 20) {
        pages.push([]);
        y = pageH - margin;
      }
      y -= lead;
    }
    pages[pages.length - 1].push(`BT /${line.bold ? "F2" : "F1"} ${line.size} Tf 1 0 0 1 ${(line.x ?? margin).toFixed(1)} ${y.toFixed(1)} Tm ${literal(line.text)} Tj ET`);
  }
  const streams = pages.map((ops, i) => [...ops, `BT /F1 7 Tf 1 0 0 1 ${margin} 28 Tm ${literal(`Prototipo dimostrativo · pagina ${i + 1} di ${pages.length}`)} Tj ET`].join("\n"));
  return assemblePdf(streams, doc.title);
}

function assemblePdf(pages: string[], title: string): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add("");
  const pagesObj = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const content of pages) {
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  const info = add(`<< /Producer (Prototipo Floware) /Title ${literal(title)} >>`);
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Ogni carattere è già un byte (WinAnsi o ASCII).
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}

// --- Modelli dai dati del prototipo -------------------------------------------------

export type FilesPage = { title: string; description: string; columns: string[]; rows: string[][]; metrics: { label: string; value: string }[]; statusColumn?: number };
const footer = "Documento generato nel browser da un prototipo dimostrativo Floware, con dati inventati. Non ha valore amministrativo.";
const dateText = (now: Date) => `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
const numberOf = (text: string): number | null => {
  const t = String(text ?? "").replace(/[€\s]/g, "");
  if (!/^-?[\d.,]+$/.test(t)) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};
const formatNumber = (n: number) => {
  const [int, dec] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return dec === "00" ? grouped : `${grouped},${dec}`;
};
const statusIndexOf = (page: FilesPage) => {
  if (Number.isInteger(page.statusColumn) && page.statusColumn! >= 0 && page.statusColumn! < page.columns.length) return page.statusColumn!;
  return page.columns.findIndex((c) => /^(stato|fase|esito|priorit[aà])$/i.test(c.trim()));
};

/** Statistiche della tabella: righe, conteggio per stato, somme delle colonne numeriche. */
export function pageStatistics(page: FilesPage): [string, string][] {
  const out: [string, string][] = [["Righe", String(page.rows.length)]];
  const status = statusIndexOf(page);
  if (status >= 0) {
    const counts = new Map<string, number>();
    for (const r of page.rows) if (r[status]) counts.set(r[status], (counts.get(r[status]) ?? 0) + 1);
    for (const [k, n] of counts) out.push([`${page.columns[status]}: ${k}`, String(n)]);
  }
  page.columns.forEach((c, i) => {
    if (i === status || !page.rows.length) return;
    const values = page.rows.map((r) => numberOf(r[i]));
    // Solo colonne con almeno una cifra decimale o «importo»: un numero di pratica non si somma.
    if (values.some((v) => v === null) || !/import|total|euro|€|spesa|costo|valore|somma|quantit|ore|giorni|sanzion/i.test(c)) return;
    out.push([`Totale ${c}`, formatNumber(values.reduce<number>((a, b) => a + (b ?? 0), 0))]);
  });
  return out;
}

/** Report della pagina (indicatori, statistiche, tabella completa) per il PDF o il Word. */
export function pageReportDoc(page: FilesPage, prototypeTitle: string, now = new Date()): FileDoc {
  const blocks: FileDocBlock[] = [];
  if (page.description) blocks.push({ paragraph: page.description });
  if (page.metrics.length) blocks.push({ heading: "Indicatori" }, { fields: page.metrics.map((m) => [m.label, m.value]) });
  blocks.push({ heading: "Statistiche" }, { fields: pageStatistics(page) });
  if (page.columns.length) blocks.push({ heading: `Elenco (${page.rows.length})` }, { table: { columns: page.columns, rows: page.rows } });
  return { title: page.title, subtitle: `${prototypeTitle} · ${dateText(now)}`, blocks, footer };
}

/** Documento di una riga (per esempio la bozza di un ricorso): i testi lunghi diventano paragrafi. */
export function rowDoc(page: FilesPage, row: string[], prototypeTitle: string, now = new Date()): FileDoc {
  const short: [string, string][] = [];
  const long: FileDocBlock[] = [];
  page.columns.forEach((c, i) => {
    const v = row[i] ?? "";
    if (v.length > 80) long.push({ heading: c }, { paragraph: v });
    else short.push([c, v]);
  });
  return {
    title: row[0] ? `${page.title}: ${row[0]}` : page.title,
    subtitle: `${prototypeTitle} · bozza del ${dateText(now)}`,
    blocks: [...(short.length ? [{ fields: short }] : []), ...long],
    footer,
  };
}

export const fileSlug = (text: string) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "documento";
