// WZ-2088: logica pura dei controlli del prototipo. La usano sia il template
// pubblicato (main.tsx) sia l'anteprima di FlowareHub, così i due si
// comportano allo stesso modo. Solo dati in memoria: nessuna rete, nessun backend.

export type MockupRow = string[];
export type MockupPageData = {
  columns: string[];
  rows: MockupRow[];
  view?: string;
  statusColumn?: number;
  chartColumn?: number;
  /** WZ-2154 (v9): comportamento di tabella, modulo e bacheca, già validato dal server. */
  behavior?: unknown;
  form?: string[];
};
export type MockupSort = { column: number; direction: 1 | -1 } | null;
/** `filters`: valore scelto in ogni filtro della pagina, per indice di colonna ("" = tutti). */
export type MockupTableState = { search: string; status: string; sort: MockupSort; filters?: Record<string, string> };
export const emptyTableState: MockupTableState = { search: "", status: "", sort: null };

const statusName = /^(stato|status|fase|esito|priorit[aà])\b/i;
const valid = (index: unknown, length: number) =>
  typeof index === "number" && Number.isInteger(index) && index >= 0 && index < length;

/** Colonna degli stati: quella indicata, altrimenti la prima chiamata «Stato» (o simile). -1 se nessuna. */
export function statusColumnOf(page: MockupPageData): number {
  if (valid(page.statusColumn, page.columns.length)) return page.statusColumn as number;
  return page.columns.findIndex((c) => statusName.test(c.trim()));
}
// WZ-2155: la tabella e le card mostrano al massimo 8 colonne, così restano leggibili anche
// su un portatile; le colonne successive (fino a 16) si vedono nel Dettaglio e nel form.
export const tableColumnLimit = 8;
/** Indici delle colonne mostrate in tabella e nelle card: le prime 8. */
export function tableColumnsOf(page: MockupPageData): number[] {
  return page.columns.slice(0, tableColumnLimit).map((_, i) => i);
}
/** Quante colonne si vedono solo nel Dettaglio (e nel form). */
export function detailOnlyColumnCount(page: MockupPageData): number {
  return Math.max(0, page.columns.length - tableColumnLimit);
}
/** Colonna del grafico a barre, -1 se la pagina non ha un grafico. */
export function chartColumnOf(page: MockupPageData): number {
  return valid(page.chartColumn, page.columns.length) ? (page.chartColumn as number) : -1;
}
/** Vista delle righe; il kanban senza colonna degli stati ricade sulle card. */
export function viewOf(page: MockupPageData): "table" | "cards" | "kanban" {
  if (page.view === "kanban") return statusColumnOf(page) >= 0 ? "kanban" : "cards";
  return page.view === "cards" ? "cards" : "table";
}

/** Valori distinti di una colonna, nell'ordine in cui compaiono. */
export function distinctValues(rows: readonly MockupRow[], column: number): string[] {
  if (column < 0) return [];
  const seen: string[] = [];
  for (const row of rows) {
    const value = (row[column] ?? "").trim();
    if (value && !seen.includes(value)) seen.push(value);
  }
  return seen;
}
/** Stato successivo nel ciclo dei valori presenti (il cambio stato di una riga). */
export function nextStatus(values: readonly string[], current: string): string {
  if (!values.length) return current;
  const at = values.indexOf(current.trim());
  return values[(at + 1) % values.length];
}

// Tipi dei campi del form, riconosciuti da nome e valori della colonna (nessun
// dato in più nella specifica): lo stesso risultato in anteprima e nel sito pubblicato.
export type MockupFieldKind = "text" | "long" | "date" | "number" | "choice";
export type MockupField = { kind: MockupFieldKind; options: string[] };
const longName = /^(note|nota|descrizione|motivazione|dettagli?|osservazioni|commento|messaggio)\b/i;
const dateName = /\b(data|scadenza|giorno|nascita)\b/i;
const numberName = /\b(importo|totale|punteggio|quantit[aà]|numero|prezzo|costo|isee|euro|ore|posti|et[aà])\b|€/i;
const itDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;
const numeric = /^[€\s]*-?\d{1,3}(?:[.\s]?\d{3})*(?:,\d+)?\s*(?:€|%)?$|^-?\d+(?:[.,]\d+)?\s*(?:€|%)?$/;
const isDate = (value: string) => itDate.test(value) || isoDate.test(value);
/** Data in formato confrontabile «aaaammgg», oppure null. */
function dateKey(value: string): string | null {
  const it = itDate.exec(value.trim());
  if (it) return `${it[3]}${it[2].padStart(2, "0")}${it[1].padStart(2, "0")}`;
  const iso = isoDate.exec(value.trim());
  return iso ? `${iso[1]}${iso[2]}${iso[3]}` : null;
}
/** Tipo del campo per la colonna `column`, con le opzioni se è un menu a tendina. */
export function fieldOf(page: MockupPageData, column: number): MockupField {
  // WZ-2154: opzioni scritte nella specifica («30, 60 o 90 giorni»), nell'ordine dato.
  const set = behaviorField(page, column);
  if (set?.options && set.options.length >= 2) return { kind: "choice", options: set.options.slice(0, 12) };
  // Un tipo dichiarato con le regole di validazione vince sul menu riconosciuto dai valori:
  // un campo «numero» non diventa una tendina con i valori di testo delle righe.
  const typed = set?.validation;
  if (typed?.kind === "date" || typed?.notPast || typed?.notFuture) return { kind: "date", options: [] };
  if (typed?.kind === "number" || typed?.kind === "integer" || typed?.min !== undefined || typed?.max !== undefined) return { kind: "number", options: [] };
  const name = (page.columns[column] ?? "").trim();
  const values = distinctValues(page.rows, column).filter((v) => v !== "—");
  const all = (test: (v: string) => boolean) => values.length > 0 && values.every(test);
  if (column === statusColumnOf(page) && values.length >= 2) return { kind: "choice", options: values.slice(0, 12) };
  if (longName.test(name)) return { kind: "long", options: [] };
  if (dateName.test(name) || all(isDate)) return { kind: "date", options: [] };
  if (numberName.test(name) || all((v) => numeric.test(v))) return { kind: "number", options: [] };
  // Pochi valori che si ripetono (per esempio Servizio o Ufficio): menu a tendina.
  if (values.length >= 2 && values.length <= 8 && values.length < page.rows.filter((r) => (r[column] ?? "").trim()).length && all((v) => v.length <= 40))
    return { kind: "choice", options: values };
  return { kind: "text", options: [] };
}
/** Valore del campo come compare in tabella: le date del calendario diventano gg/mm/aaaa. */
export function fieldValue(field: MockupField, value: string): string {
  const iso = field.kind === "date" ? isoDate.exec(value.trim()) : null;
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value;
}

const fold = (text: string) =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const compare = (a: string, b: string) => {
  // Le date gg/mm/aaaa si ordinano per data, non come testo.
  const da = dateKey(a);
  const db = dateKey(b);
  if (da && db) return da.localeCompare(db);
  const na = Number(a.replace(/\./g, "").replace(",", "."));
  const nb = Number(b.replace(/\./g, "").replace(",", "."));
  if (a.trim() && b.trim() && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, "it", { numeric: true, sensitivity: "base" });
};

/** Righe visibili con il loro indice originale: ricerca, filtro per stato, ordinamento. */
export function visibleRows(page: MockupPageData, state: MockupTableState, today: Date = new Date()) {
  const search = fold(state.search.trim());
  const status = statusColumnOf(page);
  const filters = tableFilters(page).filter((f) => state.filters?.[String(f.column)]);
  const list = page.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !search || fold(row.join(" ")).includes(search))
    .filter(({ row }) => !state.status || status < 0 || (row[status] ?? "").trim() === state.status)
    .filter(({ row }) => filters.every((f) => filterMatches(f, row[f.column] ?? "", state.filters![String(f.column)], today)));
  const sort = state.sort;
  if (sort && valid(sort.column, page.columns.length))
    list.sort((a, b) => compare(a.row[sort.column] ?? "", b.row[sort.column] ?? "") * sort.direction || a.index - b.index);
  return list;
}
/** Clic sull'intestazione: crescente, decrescente, nessun ordinamento. */
export function toggleSort(sort: MockupSort, column: number): MockupSort {
  if (!sort || sort.column !== column) return { column, direction: 1 };
  return sort.direction === 1 ? { column, direction: -1 } : null;
}

/** Barre del grafico: quante righe per valore della colonna (al massimo 8 valori). */
export function chartBars(rows: readonly MockupRow[], column: number) {
  const counts = new Map<string, number>();
  for (const value of distinctValues(rows, column)) counts.set(value, 0);
  for (const row of rows) {
    const value = (row[column] ?? "").trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const bars = [...counts].slice(0, 8).map(([label, count]) => ({ label, count }));
  const max = Math.max(1, ...bars.map((b) => b.count));
  return bars.map((b) => ({ ...b, percent: Math.round((b.count / max) * 100) }));
}
/** Colonne del kanban: una per stato, con le righe visibili di quello stato. */
export function kanbanLanes(page: MockupPageData, items: ReturnType<typeof visibleRows>) {
  const status = statusColumnOf(page);
  return laneValues(page, distinctValues(page.rows, status)).map((value) => ({
    status: value,
    items: items.filter(({ row }) => (row[status] ?? "").trim() === value),
  }));
}

/** Righe dopo il cambio di stato della riga `index`. */
export function withNextStatus(page: MockupPageData, index: number): MockupRow[] {
  const status = statusColumnOf(page);
  if (status < 0) return page.rows;
  const values = distinctValues(page.rows, status);
  return page.rows.map((row, i) =>
    i === index ? row.map((cell, c) => (c === status ? nextStatus(values, cell) : cell)) : row,
  );
}
/** Riga nuova dal form: i campi riempiono le prime colonne, le altre prendono un valore sensato. */
export function rowFromForm(page: MockupPageData, fields: readonly string[]): MockupRow {
  const status = statusColumnOf(page);
  const first = distinctValues(page.rows, status)[0];
  return page.columns.map((_, i) => {
    // WZ-2154: un campo nascosto (compare solo per un'altra scelta) non conta.
    const shown = i < fields.length ? fieldVisible(page, i, fields) : true;
    const value = shown ? fieldValue(fieldOf(page, i), (fields[i] ?? "").trim()) : "";
    if (value) return value.slice(0, 120);
    return i === status && first ? first : "—";
  });
}

// ---------------------------------------------------------------------------
// WZ-2154 (template v9): comportamento di tabella, modulo e bacheca, scritto nella
// specifica (`pages[].behavior`, validato da shared/mockupBehavior.ts). Senza il campo
// tutto resta come prima. Qui solo letture difensive: nessun dato in più.

// WZ-2158 (v12): anche i colori della tavolozza semantica (variabili --mk-c-*, theme.css).
export type MockupRowTone = "danger" | "warning" | "success" | "info" | "muted" | "red" | "orange" | "yellow" | "green" | "purple" | "gray";
// I valori sono già validati dal server (shared/mockupBehavior.ts): qui non si ricontrollano.
type Rule = { column: number; when: string; value?: string; tone: MockupRowTone; label: string };
type Validation = {
  optional?: boolean;
  kind?: "number" | "integer" | "date";
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  notPast?: boolean;
  notFuture?: boolean;
  message?: string;
};
type FieldRules = { column: number; options?: string[]; showWhen?: { column: number; values: string[] }; validation?: Validation };
type Behavior = { striped?: boolean; stripe?: string; columnColors?: { column: number; color: string }[]; rowRules?: Rule[]; filters?: { column: number; kind: "values" | "date" }[]; fields?: FieldRules[]; laneOrder?: string[] };
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
function behaviorOf(page: MockupPageData): Behavior {
  const b = page.behavior;
  return b && typeof b === "object" && (b as { v?: unknown }).v === 1 ? (b as Behavior) : {};
}
function behaviorField(page: MockupPageData, column: number): FieldRules | undefined {
  return list<FieldRules>(behaviorOf(page).fields).find((f) => f && f.column === column);
}
const same = (a: string, b: string) => fold(a.trim()) === fold(b.trim());
/** Giorni da oggi alla data della cella (negativi se passata), oppure null se non è una data. */
export function daysFromToday(value: string, today: Date = new Date()): number | null {
  const key = dateKey(value);
  if (!key) return null;
  const [y, m, d] = [Number(key.slice(0, 4)), Number(key.slice(4, 6)), Number(key.slice(6, 8))];
  const date = Date.UTC(y, m - 1, d);
  // Date impossibili (31/02, 99/99) non sono date.
  const check = new Date(date);
  if (!Number.isFinite(date) || check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((date - now) / 86_400_000);
}
/** Numero scritto all'italiana («1.234,50 €», «30 giorni»), oppure null. */
export function numberOf(value: string): number | null {
  const clean = value.replace(/[€%\s]/g, "").replace(/giorn[oi]$/i, "");
  if (!/^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:[.,]\d+)?$/.test(clean)) return null;
  const n = Number(/,/.test(clean) || /^-?\d{1,3}(?:\.\d{3})+$/.test(clean) ? clean.replace(/\./g, "").replace(",", ".") : clean);
  return Number.isFinite(n) ? n : null;
}
const empty = (value: string) => !value.trim() || value.trim() === "—";
// Due valori uguali, anche se sono la stessa data scritta in modi diversi (24/11/2026 = 2026-11-24).
const sameValue = (a: string, b: string) => {
  const da = dateKey(a);
  const db = dateKey(b);
  return da && db ? da === db : same(a, b);
};
function ruleMatches(rule: Rule, value: string, today: Date): boolean {
  const v = value.trim();
  const target = rule.value ?? "";
  switch (rule.when) {
    case "equals":
      return sameValue(v, target);
    case "not_equals":
      return !empty(v) && !sameValue(v, target);
    case "contains":
      return fold(v).includes(fold(target.trim()));
    case "empty":
      return empty(v);
    case "not_empty":
      return !empty(v);
    case "greater":
    case "less": {
      const days = daysFromToday(v, today);
      const date = dateKey(target);
      if (days !== null && date) {
        const other = daysFromToday(target, today)!;
        return rule.when === "greater" ? days > other : days < other;
      }
      const a = numberOf(v);
      const b = numberOf(target);
      return a !== null && b !== null && (rule.when === "greater" ? a > b : a < b);
    }
    case "overdue": {
      const days = daysFromToday(v, today);
      return days !== null && days < 0;
    }
    case "within_days": {
      const days = daysFromToday(v, today);
      return days !== null && days >= 0 && days <= Number(target);
    }
  }
  return false;
}
/** Evidenziazione della riga: la prima regola che vale (colore ed etichetta), oppure null. */
export function rowHighlight(page: MockupPageData, row: MockupRow, today: Date = new Date()): { tone: MockupRowTone; label: string } | null {
  for (const rule of list<Rule>(behaviorOf(page).rowRules))
    if (rule && valid(rule.column, page.columns.length) && ruleMatches(rule, row[rule.column] ?? "", today)) return { tone: rule.tone, label: rule.label };
  return null;
}
/** Righe a colori alterni: true, oppure il colore della tavolozza (v12). */
export function rowsStriped(page: MockupPageData): boolean | string {
  const b = behaviorOf(page);
  return b.striped === true && (b.stripe || true);
}
/** WZ-2158 (v12): colore della tavolozza per il testo di una colonna (attributo data-mk-text), o undefined. */
export function columnColor(page: MockupPageData, column: number): string | undefined {
  return list<{ column: number; color: string }>(behaviorOf(page).columnColors).find((x) => x && x.column === column)?.color;
}
/**
 * Sfondo e bordo di una riga: colori presi dai token del tema (--mk-*), mescolati con la
 * superficie, così il testo resta quello del tema e il contrasto non cambia.
 */
export function rowToneStyle(tone: MockupRowTone | null, striped: boolean | string, position: number): { background?: string; boxShadow?: string } {
  const tint = (color: string, amount: number) => `color-mix(in srgb, ${color} ${amount}%, var(--mk-surface))`;
  const colors: Record<string, string> = {
    danger: "var(--mk-danger)",
    warning: "#d97706",
    success: "#15803d",
    info: "var(--mk-primary)",
    muted: "var(--mk-muted)",
  };
  // WZ-2158 (v12): un colore della tavolozza (non del tema) ha la sua variante chiara, già verificata AA.
  if (tone && !colors[tone]) return { background: `var(--mk-c-${tone}-soft)`, boxShadow: `inset 4px 0 0 var(--mk-c-${tone})` };
  if (tone) return { background: tint(colors[tone], tone === "muted" ? 10 : 14), boxShadow: `inset 4px 0 0 ${colors[tone]}` };
  if (typeof striped == "string") return position % 2 ? { background: `var(--mk-c-${striped}-soft)` } : {};
  // Una velatura del colore del testo: si vede anche con il tema storico, dove --mk-subtle è quasi bianco.
  return striped && position % 2 === 1 ? { background: tint("var(--mk-text)", 6) } : {};
}
export type MockupTableFilter = { column: number; kind: "values" | "date"; label: string; options: { value: string; label: string }[] };
const dateFilterOptions = [
  { value: "scadute", label: "Scadute" },
  { value: "7", label: "Entro 7 giorni" },
  { value: "30", label: "Entro 30 giorni" },
  { value: "90", label: "Entro 90 giorni" },
];
/** Filtri sopra la tabella (oltre a ricerca e stato), con le loro opzioni. */
export function tableFilters(page: MockupPageData): MockupTableFilter[] {
  const status = statusColumnOf(page);
  return list<{ column: number; kind: "values" | "date" }>(behaviorOf(page).filters)
    .filter((f) => f && valid(f.column, page.columns.length) && !(f.kind === "values" && f.column === status))
    .map((f) => {
      const values = behaviorField(page, f.column)?.options ?? distinctValues(page.rows, f.column).filter((v) => v !== "—");
      return {
        column: f.column,
        kind: f.kind,
        label: page.columns[f.column],
        options: f.kind === "date" ? dateFilterOptions : values.slice(0, 20).map((v) => ({ value: v, label: v })),
      };
    });
}
function filterMatches(filter: MockupTableFilter, value: string, chosen: string, today: Date): boolean {
  if (filter.kind === "values") return same(value, chosen);
  const days = daysFromToday(value, today);
  if (days === null) return false;
  return chosen === "scadute" ? days < 0 : days >= 0 && days <= Number(chosen);
}
/** Ordine delle colonne della bacheca: prima gli stati indicati, poi gli altri. */
export function laneValues(page: MockupPageData, values: string[]): string[] {
  const order = list<string>(behaviorOf(page).laneOrder);
  if (!order.length) return values;
  const rank = (v: string) => {
    const at = order.findIndex((o) => same(o, v));
    return at < 0 ? order.length : at;
  };
  return values.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i).map((x) => x.v);
}
/** Il campo `column` del modulo è visibile con i valori correnti degli altri campi. */
export function fieldVisible(page: MockupPageData, column: number, values: readonly string[], depth = 0): boolean {
  const when = behaviorField(page, column)?.showWhen;
  // Una catena di condizioni si ferma dopo pochi passi (nessun giro infinito).
  if (!when || !valid(when.column, page.columns.length) || depth > 4) return true;
  // Il campo che decide deve essere visibile a sua volta.
  if (!fieldVisible(page, when.column, values, depth + 1)) return false;
  return list<string>(when.values).some((v) => same(v, values[when.column] ?? ""));
}
/** Il campo è obbligatorio nel modulo (predefinito sì, come prima). */
export function fieldRequired(page: MockupPageData, column: number): boolean {
  return behaviorField(page, column)?.validation?.optional !== true;
}
/** Testo della regola che il valore non rispetta, oppure null. `form`: controllo nel modulo. */
export function fieldIssue(page: MockupPageData, column: number, value: string, today: Date = new Date(), form = false): string | null {
  const rules = behaviorField(page, column)?.validation;
  if (!rules) return null;
  const v = value.trim();
  if (empty(v)) return form && rules.optional !== true ? rules.message ?? "Campo obbligatorio." : null;
  const say = (text: string) => rules.message ?? text;
  if (rules.kind === "number" || rules.kind === "integer" || rules.min !== undefined || rules.max !== undefined) {
    const n = numberOf(v);
    if (n === null) return say("Scrivi un numero.");
    if (rules.kind === "integer" && !Number.isInteger(n)) return say("Scrivi un numero intero.");
    if (rules.min !== undefined && n < rules.min) return say(`Il valore minimo è ${rules.min}.`);
    if (rules.max !== undefined && n > rules.max) return say(`Il valore massimo è ${rules.max}.`);
  }
  if (rules.kind === "date" || rules.notPast || rules.notFuture) {
    const days = daysFromToday(v, today);
    if (days === null) return say("Scrivi una data (gg/mm/aaaa).");
    if (rules.notPast && days < 0) return say("La data non può essere passata.");
    if (rules.notFuture && days > 0) return say("La data non può essere futura.");
  }
  if (rules.minLength !== undefined && v.length < rules.minLength) return say(`Servono almeno ${rules.minLength} caratteri.`);
  if (rules.maxLength !== undefined && v.length > rules.maxLength) return say(`Al massimo ${rules.maxLength} caratteri.`);
  return null;
}
/**
 * WZ-2153: pipeline unica dell'inserimento dal modulo (modulo nativo, pratica guidata, sportello).
 * `auto` sono i valori che assegna il prototipo (numero della pratica, stato iniziale): entrano
 * nei campi vuoti PRIMA di visibilità, obbligatorietà e validazione, così un campo che compare
 * per lo stato iniziale è chiesto davvero. Senza almeno un dato utile non si salva nulla: un
 * valore scritto dalla persona che non sia vuoto né il segnaposto «—», oppure una foto allegata
 * nel modulo (`photos`). Restituisce gli errori per campo, oppure la riga da aggiungere.
 */
export function prepareFormRow(page: MockupPageData, values: readonly string[], auto: Readonly<Record<number, string>> = {}, { photos = false, today = new Date() }: { photos?: boolean; today?: Date } = {}) {
  const form = page.form ?? [];
  const filled = form.map((_, i) => ((values[i] ?? "").trim() || auto[i] === undefined ? values[i] ?? "" : auto[i]));
  const issues = formIssues(page, filled, today);
  const shown = form.map((_, i) => i).filter((i) => fieldVisible(page, i, filled));
  for (const i of shown) if (!issues[i] && fieldRequired(page, i) && !filled[i].trim()) issues[i] = "Campo obbligatorio.";
  const typed = shown.filter((i) => auto[i] === undefined || (values[i] ?? "").trim());
  const useful = (i: number) => {
    const v = (values[i] ?? "").trim();
    return v !== "" && v !== "—";
  };
  // Indice del campo che porta il messaggio «Compila almeno un campo.» (la riga sarebbe vuota).
  let empty: number | null = null;
  if (!Object.keys(issues).length && !photos && !typed.some(useful) && shown.length) issues[(empty = typed[0] ?? shown[0])] = "Compila almeno un campo.";
  if (Object.keys(issues).length) return { issues, row: null, values: filled, empty };
  const row = rowFromForm(page, filled);
  // Valori automatici delle colonne fuori dal modulo (per esempio il numero in fondo alla tabella).
  for (const [i, v] of Object.entries(auto)) if (Number(i) >= form.length && row[Number(i)] === "—") row[Number(i)] = v;
  return { issues, row, values: filled, empty };
}
/** Errori del modulo per campo visibile (indice → testo); vuoto se si può aggiungere. */
export function formIssues(page: MockupPageData, values: readonly string[], today: Date = new Date()): Record<number, string> {
  const out: Record<number, string> = {};
  for (let i = 0; i < values.length; i++) {
    if (!fieldVisible(page, i, values)) continue;
    const field = fieldOf(page, i);
    const issue = fieldIssue(page, i, fieldValue(field, values[i] ?? ""), today, true);
    if (issue) out[i] = issue;
  }
  return out;
}
