// WZ-2156 (template v10): file veri nel prototipo, solo nel browser e solo in memoria.
// Logica pura: riconoscimento delle colonne di un Excel o CSV, proposte di valori dal
// testo di un PDF, estrazione del documento da una busta firmata .p7m, riconoscimento
// delle foto. Nessuna rete, nessun salvataggio: i dati mancanti restano vuoti, mai
// inventati.
// Copia identica in shared/mockupKinds/filesLogic.ts (anteprima di FlowareHub, verificata da un test).
import type { CompareCell, CompareRawTable } from "./compareLogic.ts";
import { FileReadError, fileLimits, startsWith } from "./filesBasics.ts";
// La parte usata all'avvio sta in filesBasics.ts (bundle iniziale piccolo): qui si riesporta.
export {
  FileReadError,
  fileFeaturesOf,
  fileLimits,
  filesPrivacyNotice,
  mockupFileFeatureLabels,
  mockupFileFeatures,
  photoIssue,
  sniffPhoto,
  type MockupFileFeature,
  type PhotoType,
} from "./filesBasics.ts";


// --- Nomi delle colonne -----------------------------------------------------------

export const foldFileName = (text: string) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Gruppi di parole che negli uffici indicano lo stesso campo. Un nome di colonna e
// un'intestazione del file si abbinano se stanno nello stesso gruppo.
const synonymGroups: string[][] = [
  ["data", "giorno", "data documento", "data richiesta", "data atto"],
  ["scadenza", "termine", "entro il", "data scadenza"],
  ["importo", "euro", "totale", "valore", "somma", "spesa", "costo", "importo euro", "ammontare"],
  ["stato", "esito", "fase", "situazione"],
  ["descrizione", "oggetto", "causale", "note", "dettaglio", "motivo", "motivazione"],
  ["nome", "denominazione", "ragione sociale", "ditta", "impresa", "richiedente", "intestatario", "titolare"],
  ["indirizzo", "via", "luogo", "ubicazione", "sede", "localita"],
  ["comune", "citta", "localita"],
  ["numero", "n", "nr", "num", "numero pratica", "protocollo", "n protocollo", "codice", "id", "identificativo"],
  ["capitolo", "cap", "voce di bilancio"],
  ["fornitore", "beneficiario", "creditore", "operatore economico"],
  ["responsabile", "referente", "incaricato", "rup", "assegnatario"],
  ["ufficio", "servizio", "settore", "area"],
  ["tipo", "tipologia", "categoria", "genere"],
  ["targa", "veicolo"],
  ["email", "posta elettronica", "pec", "e mail"],
  ["telefono", "tel", "cellulare", "recapito"],
  ["anno", "esercizio", "annualita"],
  ["quantita", "qta", "pezzi"],
  ["sanzione", "multa", "importo sanzione"],
  ["norma", "riferimento normativo", "articolo", "art"],
];
const groupsOf = (folded: string) => synonymGroups.filter((g) => g.includes(folded));
const stopWords = new Set(["del", "della", "dello", "dei", "degli", "delle", "dal", "dalla", "dai", "per", "con", "sul", "sulla", "nel", "nella", "the", "and"]);
/** Punteggio di somiglianza fra il nome di una colonna del prototipo e un'intestazione del file (0 = nessuna). */
export function nameScore(column: string, header: string): number {
  const a = foldFileName(column);
  const b = foldFileName(header);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const ga = groupsOf(a);
  if (ga.length && ga.some((g) => g.includes(b))) return 80;
  // «Data richiesta» e «Data della richiesta»: le stesse parole significative (60, abbinamento
  // automatico). Se uno ha parole in più («Data» e «Data di nascita») l'abbinamento è parziale e
  // ambiguo: 40, mostrato ma lasciato da scegliere alla persona.
  const significant = (w: string) => w.split(" ").filter((x) => x.length > 2 && !stopWords.has(x));
  const sa = significant(a);
  const sb = significant(b);
  const same = sa.length > 0 && sa.length === sb.length && sa.every((x) => sb.includes(x)) && sb.every((x) => sa.includes(x));
  if (same) return 60;
  if (sa.length && sb.length && (sa.every((x) => sb.includes(x)) || sb.every((x) => sa.includes(x)))) return 40;
  if (sa.some((x) => groupsOf(x).some((g) => sb.some((y) => g.includes(y))))) return 40;
  return 0;
}

const cellText = (cell: CompareCell | undefined) => (cell === null || cell === undefined ? "" : String(cell).trim());

/**
 * Riga delle intestazioni: fra le prime righe, quella con più nomi riconosciuti fra le
 * colonne del prototipo; a parità, la prima con almeno due celle di testo.
 */
export function importHeaderRow(table: CompareRawTable, columns: readonly string[]): number {
  let best = -1;
  let bestScore = 0;
  const scan = Math.min(table.rows.length, 10);
  for (let r = 0; r < scan; r++) {
    const cells = table.rows[r].map(cellText);
    const score = columns.reduce((sum, c) => sum + Math.max(0, ...cells.map((h) => nameScore(c, h))), 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  if (best >= 0) return best;
  for (let r = 0; r < scan; r++) {
    const texts = table.rows[r].filter((c) => typeof c === "string" && c.trim() && !/^[\d.,\s€%-]+$/.test(c));
    if (texts.length >= 2) return r;
  }
  return 0;
}

/**
 * Per ogni colonna del prototipo, l'indice della colonna del file che le corrisponde
 * (-1 = nessuna: la colonna resta vuota). Ogni colonna del file si usa una volta sola,
 * assegnando prima gli abbinamenti più sicuri.
 */
export function guessImportMapping(header: readonly string[], columns: readonly string[]): number[] {
  const pairs: { c: number; h: number; score: number }[] = [];
  columns.forEach((column, c) =>
    header.forEach((h, i) => {
      const score = nameScore(column, h);
      if (score >= 60) pairs.push({ c, h: i, score });
    }),
  );
  // Sotto 60 (una sola parola in comune per sinonimo) l'abbinamento è troppo incerto: la
  // colonna resta «nessuna» e la persona la sceglie nell'anteprima.
  pairs.sort((x, y) => y.score - x.score || x.c - y.c || x.h - y.h);
  const mapping = columns.map(() => -1);
  const used = new Set<number>();
  for (const p of pairs) {
    if (mapping[p.c] !== -1 || used.has(p.h)) continue;
    mapping[p.c] = p.h;
    used.add(p.h);
  }
  return mapping;
}

/**
 * Valore di una cella in testo: interi senza separatori (anni, numeri di pratica), decimali
 * con la virgola e fino a 6 cifre (aliquote e coefficienti restano come nel file).
 */
export function importCellText(cell: CompareCell | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return "";
    if (Number.isInteger(cell)) return Math.abs(cell) < 1e21 ? cell.toFixed(0) : String(cell);
    return cell.toFixed(6).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  }
  return String(cell).replace(/\s+/g, " ").trim().slice(0, fileLimits.valueChars);
}

export type ImportPreview = {
  header: string[];
  headerRow: number;
  mapping: number[];
  /** Righe pronte per la tabella, già nell'ordine delle colonne del prototipo. */
  rows: string[][];
  /** Righe di dati del file oltre il limite, non aggiunte. */
  skipped: number;
  /** Colonne del prototipo senza corrispondenza nel file: restano vuote. */
  missing: string[];
  /** Intestazioni del file non usate. */
  unused: string[];
};

/** Righe del file nell'ordine delle colonne del prototipo. Le righe vuote si saltano; i campi assenti restano "". */
export function importRows(table: CompareRawTable, headerRow: number, mapping: readonly number[], limit: number = fileLimits.importRows) {
  const rows: string[][] = [];
  let skipped = 0;
  for (const raw of table.rows.slice(headerRow + 1)) {
    const row = mapping.map((m) => (m >= 0 ? importCellText(raw[m]) : ""));
    if (row.every((v) => !v)) continue;
    if (rows.length >= limit) {
      skipped++;
      continue;
    }
    rows.push(row);
  }
  return { rows, skipped };
}

/** Anteprima completa dell'import: intestazioni, abbinamento proposto (o quello corretto dalla persona), righe. */
export function importPreview(table: CompareRawTable, columns: readonly string[], mapping?: readonly number[], headerRow?: number): ImportPreview {
  if (!table.rows.length) throw new FileReadError("Il file non contiene righe.");
  const h = headerRow ?? importHeaderRow(table, columns);
  const header = (table.rows[h] ?? []).map((c, i) => cellText(c) || `Colonna ${i + 1}`);
  const map = mapping ? columns.map((_, i) => (Number.isInteger(mapping[i]) && mapping[i] >= -1 && mapping[i] < header.length ? mapping[i] : -1)) : guessImportMapping(header, columns);
  const { rows, skipped } = importRows(table, h, map);
  const usedSet = new Set(map.filter((m) => m >= 0));
  return {
    header,
    headerRow: h,
    mapping: map,
    rows,
    skipped,
    missing: columns.filter((_, i) => map[i] < 0),
    unused: header.filter((_, i) => !usedSet.has(i)),
  };
}

// --- Testo dei PDF -----------------------------------------------------------------

export type PdfProposal = { value: string; line: string } | null;
const linkWords = /^(di|del|della|dello|dei|degli|delle|dal|dalla|per|a|al|alla|in|e|ed|da|con|su|sul|sulla)\b/i;
const separators = /^\s*(?:[:=\-–—]+|(?:n|nr|num)\.?(?=\s|\d)|n\.)\s*/i;
/** Resto della riga dopo l'etichetta `name` (già normalizzata); null se la riga non comincia così. */
function afterLabel(line: string, name: string): { rest: string; separated: boolean } | null {
  const tokens = line.split(" ");
  let acc = "";
  for (let k = 0; k < tokens.length; k++) {
    const f = foldFileName(tokens[k]);
    if (f) acc = acc ? `${acc} ${f}` : f;
    if (acc === name) {
      const raw = tokens.slice(k + 1).join(" ");
      const separated = /[:=]$/.test(tokens[k]) || separators.test(raw);
      return { rest: raw.replace(separators, "").trim(), separated };
    }
    if (acc && !name.startsWith(acc)) return null;
  }
  return null;
}
/** Una riga che comincia con un'etichetta: «Qualcosa:» oppure un nome noto seguito da un separatore. */
function isLabelLine(line: string, labels: readonly string[]): boolean {
  // Solo lettere prima dei due punti: un orario («10:30», «Ore 10:30») o un indirizzo con il numero
  // civico è un valore, non un'etichetta.
  if (/^\p{L}[\p{L} .°'’()/-]{0,39}[:=]/u.test(line)) return true;
  const folded = foldFileName(line);
  return labels.some((name) => folded === name || (folded.startsWith(name + " ") && (afterLabel(line, name)?.separated ?? false)));
}
/**
 * Proposte di valori per i campi a partire dal testo di un PDF, senza intelligenza
 * artificiale: per ogni colonna si cerca una riga che comincia con il suo nome (o un
 * sinonimo) seguito da «:», «-» o «n.» e si propone il resto della riga; se la riga
 * contiene solo il nome, la riga successiva. Senza separatore vale solo il nome esatto
 * della colonna («Targa AB123CD»). Nessuna riga = nessuna proposta (null): il campo
 * resta vuoto e la persona lo compila o lo prende dal testo.
 */
export function pdfFieldProposals(text: string, columns: readonly string[]): PdfProposal[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const used = new Set<number>();
  // Tutte le etichette note (colonne e sinonimi): servono a riconoscere una riga-etichetta.
  const labels = [...new Set(columns.flatMap((c) => {
    const f = foldFileName(c);
    return f ? [f, ...groupsOf(f).flat().filter((n) => n.length > 2)] : [];
  }))];
  return columns.map((column) => {
    const folded = foldFileName(column);
    if (!folded) return null;
    const names = [folded, ...groupsOf(folded).flat().filter((n) => n.length > 2 && n !== folded)];
    for (const name of names)
      for (let i = 0; i < lines.length; i++) {
        if (used.has(i)) continue;
        const hit = afterLabel(lines[i], name);
        if (!hit) continue;
        if (!hit.rest) {
          // Etichetta da sola sulla riga: il valore è la riga successiva, purché non sia a sua
          // volta un'etichetta («Numero:» seguito da «Data: …» lascia Numero vuoto).
          if (foldFileName(lines[i]) !== name || i + 1 >= lines.length || used.has(i + 1) || isLabelLine(lines[i + 1], labels)) continue;
          used.add(i);
          used.add(i + 1);
          return { value: lines[i + 1].slice(0, fileLimits.valueChars), line: `${lines[i]} ${lines[i + 1]}` };
        }
        // Senza separatore: solo il nome esatto, senza «:» dopo e senza una parola di
        // collegamento («Data di nascita 01/01/1990» non è la Data).
        if (!hit.separated && (name !== folded || hit.rest.includes(":") || linkWords.test(hit.rest))) continue;
        used.add(i);
        return { value: hit.rest.slice(0, fileLimits.valueChars), line: lines[i] };
      }
    // «N. 45/2026», «N° 12», «Nr. 7» per le colonne del numero.
    if (groupsOf(folded).some((g) => g.includes("numero")))
      for (let i = 0; i < lines.length; i++) {
        const m = used.has(i) ? null : /^(?:n|nr|num)\s*[.°º:]\s*(\S.*)$/i.exec(lines[i]);
        if (!m) continue;
        used.add(i);
        return { value: m[1].slice(0, fileLimits.valueChars), line: lines[i] };
      }
    return null;
  });
}

// --- Busta firmata .p7m (CAdES) ----------------------------------------------------

type Tlv = { tag: number; constructed: boolean; start: number; contentStart: number; end: number; indefinite: boolean };
const p7mDamaged = () => new FileReadError("Il file .p7m non si legge: potrebbe essere danneggiato o non essere un file firmato.");

// Budget di lettura di una busta: ogni elemento letto conta una volta sola (una cache per
// posizione evita di rileggere i figli a lunghezza indefinita), e i byte del documento si
// contano prima di copiarli. Oltre, il file si rifiuta subito: niente lavoro né memoria senza
// limite su un .p7m costruito ad arte, e nessun rifiuto di una busta lecita di 15 MB.
type Budget = { nodes: number; seen: Map<number, Tlv> };
const p7mTooComplex = () => new FileReadError("Il file .p7m è troppo complesso per il prototipo: potrebbe essere danneggiato.");

/** Un elemento ASN.1 (DER o BER, anche a lunghezza indefinita) che comincia in `at`. */
function readTlv(bytes: Uint8Array, at: number, limit: number, budget: Budget, depth = 0): Tlv {
  const known = budget.seen.get(at);
  if (known) {
    if (known.end > limit) throw p7mDamaged();
    return known;
  }
  if (--budget.nodes < 0) throw p7mTooComplex();
  if (depth > 40 || at + 2 > limit) throw p7mDamaged();
  const tlv = readTlvAt(bytes, at, limit, budget, depth);
  budget.seen.set(at, tlv);
  return tlv;
}
function readTlvAt(bytes: Uint8Array, at: number, limit: number, budget: Budget, depth: number): Tlv {
  const first = bytes[at];
  if ((first & 0x1f) === 0x1f) throw p7mDamaged(); // tag a più byte: non usato da CMS
  let p = at + 1;
  let len = bytes[p++];
  let indefinite = false;
  if (len === 0x80) {
    indefinite = true;
    if (!(first & 0x20)) throw p7mDamaged();
  } else if (len & 0x80) {
    const n = len & 0x7f;
    if (n > 4 || p + n > limit) throw p7mDamaged();
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + bytes[p++];
  }
  const contentStart = p;
  if (!indefinite) {
    if (contentStart + len > limit) throw p7mDamaged();
    return { tag: first, constructed: Boolean(first & 0x20), start: at, contentStart, end: contentStart + len, indefinite };
  }
  // Lunghezza indefinita: i figli fino ai due byte a zero.
  let q = contentStart;
  for (;;) {
    if (q + 2 > limit) throw p7mDamaged();
    if (bytes[q] === 0 && bytes[q + 1] === 0) return { tag: first, constructed: true, start: at, contentStart, end: q + 2, indefinite };
    q = readTlv(bytes, q, limit, budget, depth + 1).end;
  }
}
/** I primi `max` figli di un elemento costruito: gli altri non si leggono nemmeno. */
function children(bytes: Uint8Array, tlv: Tlv, budget: Budget, max: number): Tlv[] {
  const out: Tlv[] = [];
  const stop = tlv.indefinite ? tlv.end - 2 : tlv.end;
  for (let q = tlv.contentStart; q < stop && out.length < max; ) {
    const child = readTlv(bytes, q, stop, budget);
    out.push(child);
    q = child.end;
  }
  return out;
}
/** Contenuto di una OCTET STRING, anche spezzata in pezzi (forma costruita del BER), con un tetto di byte. */
function octets(bytes: Uint8Array, tlv: Tlv, budget: Budget): Uint8Array {
  if ((tlv.tag & 0x1f) !== 0x04) throw p7mDamaged();
  if (!tlv.constructed) return bytes.subarray(tlv.contentStart, tlv.end);
  // Pezzi raccolti uno alla volta, contando i byte prima di copiarli.
  const parts: Uint8Array[] = [];
  let total = 0;
  const collect = (node: Tlv, depth: number) => {
    if (depth > 8 || (node.tag & 0x1f) !== 0x04) throw p7mDamaged();
    if (!node.constructed) {
      total += node.end - node.contentStart;
      if (total > fileLimits.documentBytes) throw new FileReadError("Il documento dentro il .p7m è troppo grande: il massimo è 15 MB.");
      parts.push(bytes.subarray(node.contentStart, node.end));
      return;
    }
    const stop = node.indefinite ? node.end - 2 : node.end;
    for (let q = node.contentStart; q < stop; ) {
      const child = readTlv(bytes, q, stop, budget);
      collect(child, depth + 1);
      q = child.end;
    }
  };
  collect(tlv, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
// 1.2.840.113549.1.7.2 (signedData) in DER.
const signedDataOid = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
const isOid = (bytes: Uint8Array, tlv: Tlv, oid: readonly number[]) =>
  tlv.tag === 0x06 && tlv.end - tlv.contentStart === oid.length && oid.every((b, i) => bytes[tlv.contentStart + i] === b);

/** Un .p7m salvato come testo (Base64, anche con le righe «-----BEGIN …-----»). null se non lo è. */
function fromBase64Text(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length > fileLimits.documentBytes * 2) return null;
  const text = new TextDecoder("latin1").decode(bytes);
  const body = text.replace(/-----(BEGIN|END)[^-]*-----/g, "").replace(/\s+/g, "");
  if (body.length < 16 || !/^[A-Za-z0-9+/]+=*$/.test(body)) return null;
  try {
    const binary = atob(body);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** true se i byte sembrano una busta CMS SignedData (o il suo testo Base64). */
export function looksLikeP7m(bytes: Uint8Array): boolean {
  try {
    return signedContent(bytes) !== undefined;
  } catch {
    return false;
  }
}
/** Documento dentro una busta SignedData; null se la busta non lo contiene (firma separata); undefined se non è una busta. */
function signedContent(input: Uint8Array): Uint8Array | null | undefined {
  const bytes = input[0] === 0x30 ? input : fromBase64Text(input);
  if (!bytes || bytes[0] !== 0x30) return undefined;
  const budget: Budget = { nodes: fileLimits.p7mNodes, seen: new Map() };
  const root = readTlv(bytes, 0, bytes.length, budget);
  const [type, explicit] = children(bytes, root, budget, 2);
  if (!type || !isOid(bytes, type, signedDataOid)) return undefined;
  if (!explicit || explicit.tag !== 0xa0) throw p7mDamaged();
  const [signed] = children(bytes, explicit, budget, 1);
  if (!signed || signed.tag !== 0x30) throw p7mDamaged();
  const parts = children(bytes, signed, budget, 3);
  // version, digestAlgorithms, encapContentInfo, …
  const encap = parts[2];
  if (!encap || encap.tag !== 0x30) throw p7mDamaged();
  const [, content] = children(bytes, encap, budget, 2);
  if (!content) return null;
  if (content.tag !== 0xa0) throw p7mDamaged();
  const [octet] = children(bytes, content, budget, 1);
  if (!octet) return null;
  return octets(bytes, octet, budget);
}

export type P7mContent = { content: Uint8Array; kind: "pdf" | "xml" | "other"; layers: number; name: string };
/** «Verbale.pdf.p7m» → «Verbale.pdf»; «atto.p7m» → «atto». */
export const p7mInnerName = (name: string) => name.replace(/(\.p7m)+$/i, "") || "documento";

/**
 * Documento contenuto in un file firmato .p7m (CAdES, anche firmato più volte e anche
 * salvato in Base64). La firma non si verifica: il prototipo mostra solo il contenuto.
 */
export function extractP7m(name: string, bytes: Uint8Array): P7mContent {
  if (!bytes.byteLength) throw new FileReadError("Il file è vuoto.");
  if (bytes.byteLength > fileLimits.documentBytes) throw new FileReadError("Il file è troppo grande: il massimo è 15 MB.");
  let current: Uint8Array = bytes;
  let layers = 0;
  for (;;) {
    const inner = signedContent(current);
    if (inner === undefined) {
      if (!layers) throw new FileReadError("Il file non sembra un file firmato .p7m: se è un PDF, caricalo con l'estensione .pdf.");
      break;
    }
    if (inner === null)
      throw new FileReadError("Il file .p7m contiene solo la firma, senza il documento (firma «separata»): carica anche il documento originale.");
    layers++;
    current = inner;
    if (layers > fileLimits.p7mLayers) throw new FileReadError("Il file .p7m ha troppe firme una dentro l'altra.");
  }
  const kind = startsWith(current, "%PDF") ? "pdf" : /^\s*<\?xml|^\s*</.test(new TextDecoder().decode(current.subarray(0, 64))) ? "xml" : "other";
  return { content: current, kind, layers, name: p7mInnerName(name) };
}

/**
 * Testo di un XML (per esempio una fattura elettronica firmata): un valore per riga, «Nome:
 * valore». Lettura lineare con indexOf, senza espressioni regolari che un file ostile
 * renderebbe lentissime; al massimo i primi 2 MB.
 */
export function xmlText(bytes: Uint8Array): string {
  const source = new TextDecoder().decode(bytes.subarray(0, 2 * 1024 * 1024));
  const lines: string[] = [];
  let tag = "";
  let length = 0;
  for (let i = 0; i < source.length && length < fileLimits.textChars; ) {
    const open = source.indexOf("<", i);
    const text = (open < 0 ? source.slice(i) : source.slice(i, open)).replace(/\s+/g, " ").trim();
    if (text) {
      const line = tag ? `${tag}: ${text}` : text;
      lines.push(line);
      length += line.length + 1;
    }
    if (open < 0) break;
    const close = source.indexOf(">", open + 1);
    if (close < 0) break;
    const inside = source.slice(open + 1, close);
    // Nome dell'elemento aperto, senza prefisso dello spazio dei nomi; chiusure, commenti e istruzioni lo azzerano.
    if (/^[A-Za-z_]/.test(inside)) {
      const name = inside.split(/[\s/]/)[0];
      tag = name.slice(name.lastIndexOf(":") + 1).slice(0, 60);
    } else tag = "";
    i = close + 1;
  }
  return lines.join("\n").slice(0, fileLimits.textChars);
}

// --- Riconoscimento del file --------------------------------------------------------

export type DocumentKindOfFile = "pdf" | "p7m" | "unknown";
/** PDF o P7M, dai primi byte; il nome conta solo per il .p7m in Base64. */
export function documentKindOf(name: string, bytes: Uint8Array): DocumentKindOfFile {
  if (startsWith(bytes, "%PDF")) return "pdf";
  // Un .p7m va sempre a extractP7m, che spiega se è danneggiato o senza documento.
  if (/\.p7m$/i.test(name)) return "p7m";
  // Prima la busta firmata: contiene il PDF, quindi anche «%PDF-» nei primi byte.
  if (bytes[0] === 0x30 && looksLikeP7m(bytes)) return "p7m";
  // Alcuni PDF hanno qualche byte prima dell'intestazione.
  if (new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) return "pdf";
  return "unknown";
}
