// WZ-2153 (template v11): logica pura dei modelli di struttura del sito (`layout` della
// specifica). Legge solo i dati della pagina (colonne, righe, form, indicatori): nessun campo
// in più, nessuna rete. Copia identica in shared/mockupLayoutViews/layoutLogic.ts (anteprima di
// FlowareHub), verificata da un test.

/** Stesso elenco e stesso ordine di shared/mockupLayouts.ts (verificato da un test). */
export const layoutNames = ["cruscotto", "bacheca", "agenda", "mappa", "pratica", "schede", "fascicolo", "sportello", "registro", "confronto"] as const;
export type LayoutName = (typeof layoutNames)[number];
export type LayoutRow = string[];
export type LayoutPage = {
  id: string;
  title: string;
  description: string;
  /** WZ-2158 (v12): `color` = sfondo chiaro dalla tavolozza semantica. */
  metrics: { label: string; value: string; color?: string }[];
  columns: string[];
  rows: LayoutRow[];
  form: string[];
};

/** Layout della specifica, letto con prudenza: un valore sconosciuto vale come registro. */
export function layoutOf(spec: object): LayoutName {
  const value = Reflect.get(spec, "layout");
  return typeof value === "string" && (layoutNames as readonly string[]).includes(value) ? (value as LayoutName) : "registro";
}

export const foldText = (text: string) =>
  String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const present = (value: string | undefined) => {
  const v = (value ?? "").trim();
  return v && v !== "—" && v !== "-" ? v : "";
};

// Nomi di colonna riconosciuti (minuscole, senza accenti).
const dateName = /\b(data|scadenza|giorno|quando|appuntamento|udienza|inizio|dal|termine)\b/;
const timeName = /\b(ora|orario|alle)\b/;
const placeName = /\b(luogo|luoghi|zona|quartiere|indirizzo|via|localita|sede|frazione|area|posizione|sito|plesso|cantiere|punto|ubicazione|territorio|aula|sala|edificio|scuola|parco|impianto|struttura)\b/;
const eventName = /\b(evento|attivita|descrizione|tappa|azione|oggetto|intervento|passaggio|atto|segnalazione|titolo|nome|denominazione)\b/;
const codeName = /\b(numero|codice|protocollo|pratica|ticket|identificativo|riferimento|n)\b/;
const outcomeName = /^(esito|conformita|verifica|risultato|controllo)\b/;
const categoryName = /\b(categoria|tipo|tipologia|genere|settore|servizio|ufficio|classe)\b/;

const months = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const weekdays = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

const pad = (n: number) => String(n).padStart(2, "0");
function validDay(y: number, m: number, d: number) {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** Data «aaaa-mm-gg» da gg/mm/aaaa, gg-mm-aaaa, gg.mm.aaaa, aaaa-mm-gg o «3 marzo 2026»; altrimenti null. */
export function parseLayoutDate(text: string): string | null {
  const v = foldText(text);
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(v);
  if (m && validDay(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  m = /^(\d{4})-(\d{2})-(\d{2})\b/.exec(v);
  if (m && validDay(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(?:[a-z]+ )?(\d{1,2}) ([a-z]+) (\d{4})\b/.exec(v);
  if (m) {
    const month = months.findIndex((name) => name.startsWith(m![2].slice(0, 3)) && name.startsWith(m![2]));
    if (month >= 0 && validDay(+m[3], month + 1, +m[1])) return `${m[3]}-${pad(month + 1)}-${pad(+m[1])}`;
  }
  return null;
}
/** Orario «hh:mm» da «9:30», «09.30» o «ore 9»; altrimenti null. */
export function parseLayoutTime(text: string): string | null {
  const v = foldText(text);
  const m = /(?:^|\b(?:ore|alle)\s+)(\d{1,2})(?:[:.](\d{2}))?\b/.exec(v);
  if (!m || (!m[2] && !/\b(ore|alle)\b/.test(v))) return null;
  const h = +m[1];
  const min = m[2] ? +m[2] : 0;
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null;
}
/** «martedì 3 marzo 2026» (calendario gregoriano, senza fuso orario). */
export function formatLayoutDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${weekdays[day]} ${d} ${months[m - 1]} ${y}`;
}
export function monthLabel(year: number, month: number): string {
  return `${months[month - 1]} ${year}`;
}

/** Indice della prima colonna con il nome giusto o, in mancanza, con tutti i valori adatti. */
function columnBy(page: LayoutPage, name: RegExp, value?: (v: string) => boolean, skip: number[] = []): number {
  const byName = page.columns.findIndex((c, i) => !skip.includes(i) && name.test(foldText(c)));
  if (byName >= 0 || !value) return byName;
  return page.columns.findIndex((_, i) => {
    if (skip.includes(i)) return false;
    const values = page.rows.map((r) => present(r[i])).filter(Boolean);
    return values.length > 0 && values.every(value);
  });
}
/**
 * Colonna delle date: fra tutte le colonne candidate (nome da data, oppure valori che sono date)
 * quella con più date leggibili; a parità vince il nome. Una colonna «Data» senza date
 * leggibili non serve al calendario.
 */
export function dateColumnOf(page: LayoutPage): number {
  let best = -1;
  let bestScore = 0;
  page.columns.forEach((c, i) => {
    const dates = page.rows.filter((r) => parseLayoutDate(r[i] ?? "")).length;
    const score = dates * 2 + (dateName.test(foldText(c)) ? 1 : 0);
    if (dates > 0 && score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}
export function timeColumnOf(page: LayoutPage): number {
  const date = dateColumnOf(page);
  // Solo una colonna che contiene davvero orari: «Ora» vuota non toglie l'ora scritta dopo la data.
  const named = page.columns.findIndex((c, i) => i !== date && timeName.test(foldText(c)) && page.rows.some((r) => parseLayoutTime(r[i] ?? "")));
  return named >= 0 ? named : columnBy(page, /$^/, (v) => /^\d{1,2}[:.]\d{2}$/.test(v.trim()), [date]);
}
/** Orario scritto nella stessa cella dopo la data («12/05/2026 10:30», «3 marzo 2026, ore 9»). */
export function timeAfterDate(text: string): string | null {
  const rest = foldText(text).replace(/^(?:[a-z]+ )?(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2} [a-z]+ \d{4})/, "");
  // Un orario è «ore 9», «alle 9.30» oppure «9:30»: mai un numero qualsiasi del testo («costo 5.50»).
  const m = /\b(?:ore|alle)\s+(\d{1,2})(?:[:.](\d{2}))?(?![\d.,])|(?:^|[\s,])(\d{1,2}):(\d{2})(?![\d.,])/.exec(rest);
  if (!m) return null;
  const h = +(m[1] ?? m[3]);
  const min = +(m[2] ?? m[4] ?? 0);
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null;
}
export function placeColumnOf(page: LayoutPage): number {
  // WZ-2157: una colonna di coordinate («Posizione GPS») non è un luogo da raggruppare.
  const coordinates = page.columns.flatMap((c, i) => (/\b(coordinat[ae]|gps|lat|latitudine|lon|lng|longitudine)\b/.test(foldText(c)) ? [i] : []));
  return columnBy(page, placeName, undefined, coordinates);
}
export function codeColumnOf(page: LayoutPage): number {
  return columnBy(page, codeName);
}
export function outcomeColumnOf(page: LayoutPage): number {
  return columnBy(page, outcomeName);
}
/** Colonna che dà il titolo a una riga nelle viste: un evento o una descrizione, altrimenti la prima. */
export function titleColumnOf(page: LayoutPage, skip: number[] = []): number {
  const event = columnBy(page, eventName, undefined, skip);
  if (event >= 0) return event;
  const first = page.columns.findIndex((_, i) => !skip.includes(i));
  return first >= 0 ? first : 0;
}

export type DatedItem = { index: number; row: LayoutRow; date: string | null; time: string | null };
/** Righe con la loro data (e l'ora), in ordine di data; quelle senza data in fondo, nell'ordine dato. */
export function datedItems(page: LayoutPage): DatedItem[] {
  const dateCol = dateColumnOf(page);
  const timeCol = timeColumnOf(page);
  const items = page.rows.map((row, index) => {
    const date = dateCol >= 0 ? parseLayoutDate(row[dateCol] ?? "") : null;
    const time = (timeCol >= 0 ? parseLayoutTime(row[timeCol] ?? "") : null) ?? (date && dateCol >= 0 ? timeAfterDate(row[dateCol] ?? "") : null);
    return { index, row, date, time };
  });
  return items.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.index - b.index;
    if (a.date) return -1;
    if (b.date) return 1;
    return a.index - b.index;
  });
}
/** Giorni con almeno una riga, in ordine: l'agenda per giorno. */
export function agendaDays(page: LayoutPage): { date: string; items: DatedItem[] }[] {
  const days = new Map<string, DatedItem[]>();
  for (const item of datedItems(page)) if (item.date) days.set(item.date, [...(days.get(item.date) ?? []), item]);
  return [...days].map(([date, items]) => ({ date, items }));
}
/** Mese da mostrare: quello della prima data da oggi in poi, altrimenti dell'ultima passata, altrimenti il mese corrente. */
export function initialMonth(page: LayoutPage, today: string): { year: number; month: number } {
  const dates = agendaDays(page).map((d) => d.date);
  const pick = dates.find((d) => d >= today) ?? dates[dates.length - 1] ?? today;
  const [year, month] = pick.split("-").map(Number);
  return { year, month };
}
export function shiftMonth(at: { year: number; month: number }, delta: number) {
  const index = at.year * 12 + (at.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
/** Settimane del mese, da lunedì a domenica; null = giorno fuori dal mese. */
export function monthWeeks(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (first + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}
export function todayLayoutIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Luoghi della pagina, nell'ordine in cui compaiono, con le righe di ciascuno (al massimo 12 luoghi). */
export function placeGroups(page: LayoutPage): { place: string; indexes: number[] }[] {
  const column = placeColumnOf(page);
  if (column < 0) return [];
  const groups = new Map<string, { place: string; indexes: number[] }>();
  page.rows.forEach((row, index) => {
    const place = present(row[column]);
    if (!place) return;
    const key = foldText(place);
    const group = groups.get(key) ?? { place, indexes: [] };
    group.indexes.push(index);
    groups.set(key, group);
  });
  return [...groups.values()].slice(0, 12);
}
/**
 * Posizione schematica di un luogo sulla griglia della mappa (colonne × righe), stabile per nome
 * e senza sovrapposizioni. Non è una posizione geografica: la mappa è dichiarata «non in scala».
 */
export function placeSpots(places: readonly string[], cols = 4, rows = 3): { col: number; row: number }[] {
  const taken = new Set<number>();
  const size = cols * rows;
  return places.map((name) => {
    let h = 0;
    for (const ch of foldText(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    let at = h % size;
    for (let tries = 0; taken.has(at) && tries < size; tries++) at = (at + 5) % size;
    taken.add(at);
    return { col: (at % cols) + 1, row: Math.floor(at / cols) + 1 };
  });
}

/** Colonne «categoriche» da contare nel cruscotto: pochi valori che si ripetono, al massimo `limit`. */
export function dashboardColumns(page: LayoutPage, limit = 3): number[] {
  const out: number[] = [];
  page.columns.forEach((_, i) => {
    if (i === 0 || out.length >= limit) return;
    const values = page.rows.map((r) => present(r[i])).filter(Boolean);
    const distinct = new Set(values.map(foldText));
    if (values.length >= 3 && distinct.size >= 2 && distinct.size <= 8 && distinct.size < values.length && values.every((v) => v.length <= 40 && !parseLayoutDate(v))) out.push(i);
  });
  return out;
}
/** Righe per mese (aaaa-mm) della colonna delle date, in ordine: l'andamento del cruscotto. */
export function monthlyCounts(page: LayoutPage): { month: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of datedItems(page)) if (item.date) counts.set(item.date.slice(0, 7), (counts.get(item.date.slice(0, 7)) ?? 0) + 1);
  return [...counts].map(([month, count]) => {
    const [y, m] = month.split("-").map(Number);
    return { month, label: `${months[m - 1].slice(0, 3)} ${y}`, count };
  });
}
/** Numero di una cella («€ 286.400», «1.380», «8,2 giorni»), oppure null. */
export function parseLayoutNumber(text: string): number | null {
  const m = /^[€\s]*(-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?)(?:\s*(?:€|%|[a-z]+))?$/.exec(foldText(text));
  return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null;
}
/** Colonne con un numero in ogni riga (non la prima, non le date): i valori del cruscotto, al massimo `limit`. */
export function numericColumns(page: LayoutPage, limit = 2): number[] {
  const out: number[] = [];
  page.columns.forEach((_, i) => {
    if (i === 0 || out.length >= limit) return;
    const values = page.rows.map((r) => present(r[i])).filter(Boolean);
    if (values.length >= 2 && values.every((v) => parseLayoutNumber(v) !== null && !parseLayoutDate(v))) out.push(i);
  });
  return out;
}
export function categoryColumnOf(page: LayoutPage): number {
  const byName = columnBy(page, categoryName, undefined, [0]);
  return byName >= 0 ? byName : (dashboardColumns(page, 1)[0] ?? -1);
}

/** Passi della pratica guidata: i campi del form a gruppi di `size` (almeno un passo se c'è un campo). */
export function wizardSteps(fields: number, size = 3): number[][] {
  const steps: number[][] = [];
  for (let i = 0; i < fields; i += size) steps.push(Array.from({ length: Math.min(size, fields - i) }, (_, k) => i + k));
  return steps;
}

/** Codice della prossima richiesta allo sportello, nel formato dei codici già presenti se ce n'è uno. */
export function nextRequestCode(page: LayoutPage, year: number): string {
  const column = codeColumnOf(page);
  const codes = column >= 0 ? page.rows.map((r) => present(r[column])).filter(Boolean) : [];
  const sample = codes.find((c) => /\d+\s*$/.test(c));
  if (sample) {
    const prefix = sample.replace(/\d+\s*$/, "");
    const width = (/(\d+)\s*$/.exec(sample)?.[1] ?? "").length;
    const top = Math.max(0, ...codes.filter((c) => c.startsWith(prefix)).map((c) => Number(/(\d+)\s*$/.exec(c)?.[1] ?? 0)));
    return prefix + String(top + 1).padStart(width, "0");
  }
  return `RIC-${year}-${String(page.rows.length + 1).padStart(4, "0")}`;
}
/** Righe che corrispondono al codice o al nome cercato allo sportello (al massimo 5). */
export function findRequests(page: LayoutPage, query: string): number[] {
  const q = foldText(query);
  if (q.length < 2) return [];
  const column = codeColumnOf(page);
  const exact = column >= 0 ? page.rows.map((r, i) => (foldText(r[column] ?? "") === q ? i : -1)).filter((i) => i >= 0) : [];
  if (exact.length) return exact.slice(0, 5);
  return page.rows
    .map((r, i) => (r.some((cell) => foldText(cell).includes(q)) ? i : -1))
    .filter((i) => i >= 0)
    .slice(0, 5);
}

// Confronto a coppie: «Importo dichiarato» e «Importo verificato» hanno la stessa base.
const pairWord = /\b(dichiarat[oaie]|verificat[oaie]|rilevat[oaie]|attes[oaie]|previst[oaie]|effettiv[oaie]|richiest[oaie]|document[oi]|controll[oi]|original[ei]|nuov[oaie]|preventiv[oi]|consuntiv[oi]|autocertificat[oaie]|accertat[oaie]|offert[oaie]|banca dati|registro)\b/;
export type ComparePair = { base: string; left: number; right: number; leftLabel: string; rightLabel: string };
/** Coppie di colonne da confrontare (stessa base, parola di confronto diversa), nell'ordine delle colonne. */
export function comparePairs(page: LayoutPage): ComparePair[] {
  const parts = page.columns.map((c) => {
    const f = foldText(c);
    const word = pairWord.exec(f)?.[0] ?? "";
    return { word, base: word ? f.replace(word, "").replace(/\s+/g, " ").trim() : "" };
  });
  const pairs: ComparePair[] = [];
  const used = new Set<number>();
  parts.forEach((a, i) => {
    if (!a.word || used.has(i)) return;
    const j = parts.findIndex((b, k) => k > i && !used.has(k) && b.word && b.word !== a.word && b.base === a.base);
    if (j < 0) return;
    used.add(i).add(j);
    pairs.push({ base: page.columns[i].replace(new RegExp(a.word, "i"), "").trim() || a.base, left: i, right: j, leftLabel: a.word, rightLabel: parts[j].word });
  });
  return pairs;
}
/**
 * Una sola coppia di colonne: ogni riga è un controllo (per esempio un indicatore dichiarato e
 * verificato). Restituisce le righe con un'etichetta (prima colonna e colonna descrittiva).
 */
export function pairedRows(page: LayoutPage): { index: number; label: string; left: string; right: string; same: boolean }[] {
  const pairs = comparePairs(page);
  if (pairs.length !== 1) return [];
  const [p] = pairs;
  const outcome = outcomeColumnOf(page);
  const extra = page.columns.findIndex((_, i) => i > 0 && i !== p.left && i !== p.right && i !== outcome);
  return page.rows.map((row, index) => ({
    index,
    label: [present(row[0]), extra >= 0 ? present(row[extra]) : ""].filter(Boolean).join(" · ") || `Riga ${index + 1}`,
    left: row[p.left] ?? "",
    right: row[p.right] ?? "",
    same: sameValue(row[p.left] ?? "", row[p.right] ?? ""),
  }));
}
/** Valori uguali a meno di spazi, maiuscole, accenti e separatori delle migliaia. */
export function sameValue(a: string, b: string): boolean {
  const norm = (v: string) => foldText(v).replace(/(\d)[.\s](?=\d{3}\b)/g, "$1").replace(/\s*€\s*/g, "");
  return norm(a) === norm(b);
}
/** Confronto campo per campo di due righe (o di una riga con le sue coppie di colonne). */
export function compareFields(page: LayoutPage, left: number, right: number): { label: string; left: string; right: string; same: boolean }[] {
  const pairs = comparePairs(page);
  if (pairs.length) {
    const row = page.rows[left] ?? [];
    return pairs.map((p) => ({ label: p.base, left: row[p.left] ?? "", right: row[p.right] ?? "", same: sameValue(row[p.left] ?? "", row[p.right] ?? "") }));
  }
  const a = page.rows[left] ?? [];
  const b = page.rows[right] ?? [];
  return page.columns.map((label, i) => ({ label, left: a[i] ?? "", right: b[i] ?? "", same: sameValue(a[i] ?? "", b[i] ?? "") }));
}

/**
 * La vista del layout si può mostrare su questa pagina? Le pagine pronte (`kind`) hanno la loro
 * vista; per le altre servono i dati adatti (date, luoghi, campi del form…). Altrimenti la pagina
 * resta quella standard.
 */
export function layoutApplies(layout: LayoutName, page: LayoutPage): boolean {
  switch (layout) {
    case "cruscotto":
      return page.metrics.length > 0 || dashboardColumns(page).length > 0;
    case "agenda":
    case "fascicolo":
      return datedItems(page).some((i) => i.date);
    case "mappa":
      return placeGroups(page).length > 0;
    case "pratica":
    case "sportello":
      return page.form.length > 0;
    case "confronto":
      return page.rows.length > 0 && (comparePairs(page).length > 0 || page.rows.length >= 2);
    default:
      return false;
  }
}
/**
 * Sezione nativa che la vista del layout sostituisce su questa pagina: gli indicatori nel
 * cruscotto, il modulo nella pratica guidata e allo sportello. La vista c'è sempre in quei casi
 * (layoutApplies), quindi nulla si perde. Il template (main.tsx) ripete questa regola in forma
 * breve, per non portare questo file nel bundle iniziale: un test le confronta.
 */
export function layoutReplaces(layout: LayoutName, page: LayoutPage): "metrics" | "form" | null {
  if (layout === "cruscotto") return page.metrics.length > 0 ? "metrics" : null;
  return (layout === "pratica" || layout === "sportello") && page.form.length > 0 ? "form" : null;
}
/** Vista predefinita delle righe nelle pagine senza `view`: bacheca = kanban, schede = card. */
export function layoutDefaultView(layout: LayoutName): "kanban" | "cards" | undefined {
  return layout === "bacheca" ? "kanban" : layout === "schede" ? "cards" : undefined;
}
/** Barra delle pagine in alto per i layout che usano la larghezza (laterale per agenda, fascicolo e registro). */
export function layoutTopNavigation(layout: LayoutName): boolean {
  return !["registro", "agenda", "fascicolo"].includes(layout);
}

// ---------------------------------------------------------------------------
// WZ-2157 (template v12): coordinate delle righe e collegamento a Google Maps. Nessuna rete:
// le coordinate si leggono dai dati di esempio; il collegamento si apre solo con un clic.

const coordinateName = /^(coordinat[ae]|coordinate gps|gps|posizione gps|lat(itudine)?[ ,/-]+lon(gitudine)?)\b/i;
const coordinate = (v: string) => (/^-?\d{1,3}(?:[.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(",", ".")) : NaN);
const pair = (lat: number, lon: number): [number, number] | null =>
  Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0) ? [lat, lon] : null;
/** Colonne delle coordinate: una sola («Coordinate»: «45.0703, 11.7899») o Latitudine e Longitudine. */
export function coordinateColumnsOf(page: Pick<LayoutPage, "columns">): number[] {
  const one = page.columns.findIndex((c) => coordinateName.test(c.trim()));
  if (one >= 0) return [one];
  const lat = page.columns.findIndex((c) => /^lat(itudine)?$/i.test(c.trim()));
  const lon = page.columns.findIndex((c) => /^(lon|lng|long|longitudine)$/i.test(c.trim()));
  return lat >= 0 && lon >= 0 ? [lat, lon] : [];
}
/** Coordinate di una riga (latitudine, longitudine), oppure null. */
export function rowCoordinates(page: Pick<LayoutPage, "columns">, row: LayoutRow): [number, number] | null {
  const cols = coordinateColumnsOf(page);
  if (cols.length === 2) return pair(coordinate(row[cols[0]] ?? ""), coordinate(row[cols[1]] ?? ""));
  if (!cols.length) return null;
  const text = (row[cols[0]] ?? "").trim();
  // «45.0703, 11.7899», «45,0703; 11,7899» o «45.0703 11.7899».
  // «45,0703, 11,7899»: virgola decimale e virgola seguita da uno spazio fra i due numeri.
  const parts = text.includes(";") ? text.split(";") : text.includes(".") ? text.split(/[,\s]+/) : /\d,\s+-?\d/.test(text) ? text.split(/,\s+/) : text.split(/\s+/);
  return parts.length === 2 ? pair(coordinate(parts[0]), coordinate(parts[1])) : null;
}
/** Domini che il prototipo apre in una nuova scheda: soltanto Google Maps. */
export const externalLinks = [{ origin: "https://www.google.com", path: "/maps/" }] as const;
export function externalLinkAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return externalLinks.some((l) => u.origin === l.origin && u.pathname.startsWith(l.path) && !u.username && !u.password);
  } catch {
    return false;
  }
}
/** Collegamento «Apri in Google Maps» (URL ufficiale di ricerca per coordinate). */
export function googleMapsUrl(lat: number, lon: number): string {
  const f = (n: number) => String(Math.round(n * 1e6) / 1e6);
  return `https://www.google.com/maps/search/?api=1&query=${f(lat)}%2C${f(lon)}`;
}
