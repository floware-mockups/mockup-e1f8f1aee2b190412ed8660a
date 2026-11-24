// WZ-2153 (template v11): viste dei modelli di struttura del sito. Si caricano a parte, solo se
// la specifica ha un `layout`: il bundle iniziale resta quello di v10. Ogni vista legge i dati
// della pagina (righe, indicatori, form) e scrive solo con le funzioni del template (aggiungi o
// aggiorna una riga, apri il Dettaglio): chat veloce e assistente avanzato restano gli stessi.
// Bacheca e schede usano le viste kanban e card già presenti (layoutDefaultView), il registro
// è la pagina di sempre. Copia identica in shared/mockupLayoutViews/index.tsx (anteprima).
import RowMapsLink from "./RowMapsLink";
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  agendaDays,
  compareFields,
  comparePairs,
  codeColumnOf,
  dashboardColumns,
  dateColumnOf,
  datedItems,
  findRequests,
  foldText,
  formatLayoutDate,
  initialMonth,
  layoutApplies,
  layoutOf,
  monthLabel,
  monthWeeks,
  monthlyCounts,
  nextRequestCode,
  numericColumns,
  outcomeColumnOf,
  pairedRows,
  parseLayoutNumber,
  placeColumnOf,
  placeGroups,
  placeSpots,
  rowCoordinates,
  shiftMonth,
  timeColumnOf,
  titleColumnOf,
  todayLayoutIso,
  wizardSteps,
  type DatedItem,
  type LayoutPage,
  type LayoutRow,
} from "./layoutLogic";

/** Funzioni del template (src/logic.ts), passate dalla pagina: stesso comportamento del form nativo. */
export type LayoutTools = {
  fieldOf: (page: LayoutPage, column: number) => { kind: string; options: string[] };
  /** Pipeline unica dell'inserimento (src/logic.ts, prepareFormRow), la stessa del modulo nativo. */
  prepareFormRow: (page: LayoutPage, values: readonly string[], auto?: Readonly<Record<number, string>>, options?: { photos?: boolean }) => { issues: Record<number, string>; row: LayoutRow | null; values: string[]; empty: number | null };
  /** Foto preparate nel modulo per la riga nuova (un dato utile anche con i campi vuoti). */
  newPhotos?: (pageId: string) => number;
  statusColumnOf: (page: LayoutPage) => number;
  distinctValues: (rows: readonly LayoutRow[], column: number) => string[];
  fieldVisible: (page: LayoutPage, column: number, values: readonly string[]) => boolean;
  fieldRequired: (page: LayoutPage, column: number) => boolean;
  /** WZ-2158 (v12): colore della riga evidenziata (regole di riga), per il segnaposto. */
  tone?: (page: LayoutPage, row: LayoutRow) => { tone: string } | null;
};
// WZ-2157 (v12): la mappa vera (Leaflet e tessere di OpenStreetMap) è un altro pezzo caricato a
// parte, solo quando la pagina ha righe con coordinate.
const LeafletMap = lazy(() => import("./LeafletMap").then((m) => ({ default: m.LeafletMap })));
export type MockupLayoutProps = {
  layout: string;
  page: LayoutPage;
  pages: readonly { id: string; title: string }[];
  tools: LayoutTools;
  /**
   * Aggiunge la riga come il modulo nativo: conferma su misura, foto preparate, messaggio.
   * `after` parte solo a inserimento avvenuto (mai se la conferma è annullata).
   */
  onAdd: (row: LayoutRow, message: string, after?: () => void) => void;
  /** Foto da allegare alla riga nuova (PhotoAttach del modulo nativo), se la pagina le ha. */
  photos?: ReactNode;
  onUpdate: (index: number, row: LayoutRow, message: string) => void;
  onDetail: (index: number) => void;
  onNavigate: (pageId: string) => void;
  /** Anteprima in modalità selezione: controlli visibili ma inattivi. */
  inert?: boolean;
  /**
   * WZ-2157 (review Codex): pagine con i dati di esempio della specifica. La mappa online (tessere
   * di OpenStreetMap) mostra e inquadra solo le coordinate di questi dati: le righe importate da un
   * file o scritte nel modulo non decidono quali tessere si chiedono, così restano nel browser.
   */
  samples?: readonly { id: string; columns: string[]; rows: LayoutRow[] }[];
};

const card = "rounded-xl border border-(--mk-divider) bg-(--mk-surface) shadow-sm";
const field = "rounded-md border border-(--mk-border) bg-(--mk-surface) px-3 py-2";
const primary = "rounded-lg bg-(--mk-primary) px-4 py-2 font-medium text-(--mk-on-primary) disabled:opacity-60";
const secondary = "rounded-lg border border-(--mk-border) px-4 py-2 font-medium disabled:opacity-60";
const link = "font-medium text-(--mk-primary) underline-offset-2 hover:underline";
const present = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t && t !== "—" && t !== "-" ? t : "";
};

export function MockupLayoutView(props: MockupLayoutProps) {
  const layout = layoutOf({ layout: props.layout });
  // Senza i dati adatti (date, luoghi, campi…) la pagina resta quella standard.
  if (!layoutApplies(layout, props.page) && !(layout === "mappa" && mapPoints(props).some((p) => p.online))) return null;
  switch (layout) {
    case "cruscotto":
      return <Dashboard {...props} />;
    case "agenda":
      return <Agenda {...props} />;
    case "mappa":
      return <PlacesMap {...props} />;
    case "pratica":
      return <Wizard {...props} />;
    case "fascicolo":
      return <Timeline {...props} />;
    case "sportello":
      return <Counter {...props} />;
    case "confronto":
      return <Comparison {...props} />;
    default:
      return null;
  }
}

/** Righe brevi di una riga: le colonne oltre il titolo, senza valori vuoti (al massimo `limit`). */
function rowFacts(page: LayoutPage, row: LayoutRow, skip: number[], limit = 3) {
  return page.columns
    .map((label, i) => ({ label, value: present(row[i]), i }))
    .filter((f) => f.value && !skip.includes(f.i))
    .slice(0, limit);
}
function StatusBadge({ page, row, tools }: { page: LayoutPage; row: LayoutRow; tools: LayoutTools }) {
  const status = tools.statusColumnOf(page);
  const value = status >= 0 ? present(row[status]) : "";
  return value ? <span className="inline-block rounded-full border border-(--mk-border) px-2 py-0.5 text-xs font-semibold">{value}</span> : null;
}
function DetailButton({ index, label, onDetail, inert }: { index: number; label: string; onDetail: (i: number) => void; inert?: boolean }) {
  return (
    <button type="button" className={`text-sm ${link}`} disabled={inert} tabIndex={inert ? -1 : undefined} onClick={() => onDetail(index)} aria-label={`Dettaglio di ${label}`}>
      Dettaglio
    </button>
  );
}

// 1. Cruscotto: indicatori grandi, grafici per i valori che si ripetono e andamento per mese.
function Dashboard({ page, tools }: MockupLayoutProps) {
  const columns = dashboardColumns(page);
  const numbers = numericColumns(page);
  const months = monthlyCounts(page);
  // Il primo indicatore è più largo solo se così la riga si chiude (numero dispari di indicatori).
  const wide = page.metrics.length % 2 === 1;
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="my-8 grid gap-6" data-layout-view="cruscotto">
      <h3 id={`${id}-title`} className="sr-only">
        Cruscotto
      </h3>
      {page.metrics.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicatori principali">
          {page.metrics.map((m, i) => (
            // WZ-2158 (v12): un indicatore colorato ha lo sfondo chiaro della tavolozza (anche il primo, con il testo del tema).
            <li key={i} className={i === 0 && !m.color ? `rounded-xl bg-(--mk-primary) p-6 text-(--mk-on-primary) shadow-sm ${wide ? "sm:col-span-2" : ""}` : `${card} p-6 ${i === 0 && wide ? "sm:col-span-2" : ""}`} style={m.color ? { background: `var(--mk-c-${m.color}-soft)` } : undefined}>
              <p className={`text-sm [overflow-wrap:break-word] ${i === 0 && !m.color ? "" : "text-(--mk-muted)"}`}>{m.label}</p>
              <p className={`mt-3 font-bold [overflow-wrap:break-word] ${m.value.length > 12 ? "text-2xl" : "text-4xl"}`}>{m.value}</p>
            </li>
          ))}
        </ul>
      )}
      {(columns.length > 0 || numbers.length > 0 || months.length > 1) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {numbers.map((c) => {
            const bars = page.rows.slice(0, 8).map((r, i) => ({ key: i, label: present(r[0]) || `Riga ${i + 1}`, text: present(r[c]), value: Math.max(0, parseLayoutNumber(r[c] ?? "") ?? 0) }));
            const max = Math.max(1, ...bars.map((b) => b.value));
            return (
              <figure key={`n${c}`} className={`${card} p-5`}>
                <figcaption className="mb-4 font-semibold first-letter:uppercase">
                  {page.columns[c]} per {page.columns[0].toLowerCase()}
                </figcaption>
                <ul className="grid gap-2">
                  {bars.map((bar) => (
                    <li key={bar.key} className="grid grid-cols-[minmax(0,8rem)_1fr_minmax(0,6rem)] items-center gap-3 text-sm">
                      <span className="truncate" title={bar.label}>
                        {bar.label}
                      </span>
                      <span className="h-3 rounded bg-(--mk-subtle)" aria-hidden="true">
                        <span className="block h-3 rounded bg-(--mk-primary)" style={{ width: `${Math.round((bar.value / max) * 100)}%` }} />
                      </span>
                      <span className="truncate text-right font-medium">{bar.text}</span>
                    </li>
                  ))}
                </ul>
              </figure>
            );
          })}
          {columns.map((c) => {
            const values = tools.distinctValues(page.rows, c).filter((v) => v !== "—");
            const counts = values.map((v) => ({ label: v, count: page.rows.filter((r) => foldText(r[c] ?? "") === foldText(v)).length }));
            const max = Math.max(1, ...counts.map((x) => x.count));
            return (
              <figure key={c} className={`${card} p-5`}>
                <figcaption className="mb-4 font-semibold">Per {page.columns[c].toLowerCase()}</figcaption>
                <ul className="grid gap-2">
                  {counts.map((bar) => (
                    <li key={bar.label} className="grid grid-cols-[minmax(0,8rem)_1fr_2.5rem] items-center gap-3 text-sm">
                      <span className="truncate" title={bar.label}>
                        {bar.label}
                      </span>
                      <span className="h-3 rounded bg-(--mk-subtle)" aria-hidden="true">
                        <span className="block h-3 rounded bg-(--mk-primary)" style={{ width: `${Math.round((bar.count / max) * 100)}%` }} />
                      </span>
                      <span className="text-right font-medium">{bar.count}</span>
                    </li>
                  ))}
                </ul>
              </figure>
            );
          })}
          {months.length > 1 && (
            <figure className={`${card} p-5`}>
              <figcaption className="mb-4 font-semibold">Andamento per mese</figcaption>
              <ul className="flex h-40 items-end gap-2" aria-label="Elementi per mese">
                {months.slice(-12).map((m) => {
                  const max = Math.max(1, ...months.map((x) => x.count));
                  return (
                    <li key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 text-xs">
                      <span className="font-medium">{m.count}</span>
                      <span className="w-full rounded-t bg-(--mk-primary)" style={{ height: `${Math.max(6, Math.round((m.count / max) * 100))}%` }} aria-hidden="true" />
                      <span className="truncate text-(--mk-muted)">{m.label}</span>
                    </li>
                  );
                })}
              </ul>
            </figure>
          )}
        </div>
      )}
    </section>
  );
}

function ItemLine({ page, item, tools, onDetail, inert, skip }: { page: LayoutPage; item: DatedItem; tools: LayoutTools; onDetail: (i: number) => void; inert?: boolean; skip: number[] }) {
  const title = titleColumnOf(page, skip);
  const label = present(item.row[title]) || present(item.row[0]) || "Elemento";
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-(--mk-divider) py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="font-medium">
          {item.time && <span className="mr-2 tabular-nums text-(--mk-primary)">{item.time}</span>}
          {label}
        </p>
        <p className="mt-1 text-sm text-(--mk-muted)">
          {rowFacts(page, item.row, [...skip, title, tools.statusColumnOf(page)], 2)
            .map((f) => `${f.label}: ${f.value}`)
            .join(" · ")}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <StatusBadge page={page} row={item.row} tools={tools} />
        <DetailButton index={item.index} label={label} onDetail={onDetail} inert={inert} />
      </div>
    </li>
  );
}

// 3. Agenda: calendario del mese con i giorni che hanno scadenze o appuntamenti, e l'elenco del giorno.
function Agenda({ page, tools, onDetail, inert }: MockupLayoutProps) {
  const today = todayLayoutIso();
  const days = useMemo(() => agendaDays(page), [page]);
  const [month, setMonth] = useState(() => initialMonth(page, today));
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const byDay = new Map(days.map((d) => [d.date, d.items]));
  const shown = selected ? (byDay.get(selected) ?? []) : days.filter((d) => d.date >= today).flatMap((d) => d.items).slice(0, 8);
  const fallback = !selected && !shown.length ? days.flatMap((d) => d.items).slice(-8) : shown;
  const skip = [dateColumnOf(page), timeColumnOf(page)].filter((c) => c >= 0);
  return (
    <section aria-labelledby={`${id}-title`} className="my-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" data-layout-view="agenda">
      <div className={`${card} p-5`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 id={`${id}-title`} className="text-lg font-semibold first-letter:uppercase">
            {monthLabel(month.year, month.month)}
          </h3>
          <div className="flex gap-2">
            <button type="button" className={secondary} disabled={inert} onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Mese precedente">
              ‹
            </button>
            <button type="button" className={secondary} disabled={inert} onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Mese successivo">
              ›
            </button>
          </div>
        </div>
        <table className="w-full table-fixed text-center text-sm">
          <caption className="sr-only">Calendario di {monthLabel(month.year, month.month)}: i giorni con un pulsante hanno elementi in agenda</caption>
          <thead>
            <tr className="text-(--mk-muted)">
              {["lun", "mar", "mer", "gio", "ven", "sab", "dom"].map((d) => (
                <th key={d} scope="col" className="pb-2 font-medium">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthWeeks(month.year, month.month).map((week, w) => (
              <tr key={w}>
                {week.map((day, d) => {
                  if (!day) return <td key={d} />;
                  const items = byDay.get(day) ?? [];
                  const n = Number(day.slice(8));
                  const isToday = day === today;
                  return (
                    <td key={d} className="p-0.5">
                      {items.length ? (
                        <button
                          type="button"
                          disabled={inert}
                          aria-pressed={selected === day}
                          aria-label={`${formatLayoutDate(day)}: ${items.length} ${items.length === 1 ? "elemento" : "elementi"}`}
                          onClick={() => setSelected(selected === day ? null : day)}
                          className={`grid h-12 w-full place-items-center rounded-lg font-semibold ${selected === day ? "bg-(--mk-primary) text-(--mk-on-primary)" : "bg-(--mk-subtle) hover:outline hover:outline-2 hover:outline-(--mk-primary)"}`}
                        >
                          <span>{n}</span>
                          <span className="text-[0.65rem] font-normal">{items.length === 1 ? "1 elemento" : `${items.length} elementi`}</span>
                        </button>
                      ) : (
                        <span className={`grid h-12 place-items-center rounded-lg ${isToday ? "border border-(--mk-primary) font-semibold" : "text-(--mk-muted)"}`}>
                          {n}
                          {isToday && <span className="sr-only"> (oggi)</span>}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={`${card} p-5`} aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold first-letter:uppercase">{selected ? formatLayoutDate(selected) : shown.length ? "Prossimi in agenda" : "Ultimi in agenda"}</h3>
          {selected && (
            <button type="button" className={`text-sm ${link}`} disabled={inert} onClick={() => setSelected(null)}>
              Mostra i prossimi
            </button>
          )}
        </div>
        <ul className="mt-2">
          {fallback.map((item) => (
            <ItemLine key={item.index} page={page} item={item} tools={tools} onDetail={onDetail} inert={inert} skip={skip} />
          ))}
        </ul>
        {!selected &&
          fallback.length > 0 &&
          fallback.some((i) => i.date) && (
            <p className="mt-3 text-sm text-(--mk-muted)">Scegli un giorno nel calendario per vedere solo i suoi elementi.</p>
          )}
      </div>
    </section>
  );
}

// 4. Mappa. Con le coordinate (v12, WZ-2157) una mappa vera con i punti delle righe, l'elenco a
// lato e un clic sul punto che apre il Dettaglio; senza, i luoghi su una mappa schematica (non in
// scala). In entrambi i casi l'elenco a lato si filtra per luogo o per punto.
function mapPoints({ page, samples }: Pick<MockupLayoutProps, "page" | "samples">) {
  const sample = samples?.find((p) => p.id === page.id);
  const known = new Set(sample ? sample.rows.flatMap((row) => { const at = rowCoordinates(sample, row); return at ? [String(at)] : []; }) : []);
  return page.rows.flatMap((row, index) => {
    const at = rowCoordinates(page, row);
    // `online`: coordinate dei dati di esempio, le sole che diventano punti sulla mappa online.
    return at ? [{ index, lat: at[0], lon: at[1], online: known.has(String(at)) }] : [];
  });
}
function PlacesMap({ page, tools, onDetail, inert, samples }: MockupLayoutProps) {
  const groups = useMemo(() => placeGroups(page), [page]);
  const located = useMemo(() => mapPoints({ page, samples }), [page, samples]);
  const points = useMemo(() => located.filter((p) => p.online), [located]);
  const spots = placeSpots(groups.map((g) => g.place));
  const [selected, setSelected] = useState<string | null>(null);
  const [chosen, setFocus] = useState<number | null>(null);
  // Un punto scelto che non c'è più (riga rimossa) non vale più.
  const focus = chosen !== null && chosen < page.rows.length && points.some((p) => p.index === chosen) ? chosen : null;
  const placeCol = placeColumnOf(page);
  const id = useId();
  const real = points.length > 0;
  const current = real ? null : groups.find((g) => g.place === selected);
  const indexes = real ? (focus !== null ? [focus] : located.map((p) => p.index)) : current ? current.indexes : groups.flatMap((g) => g.indexes);
  const title = titleColumnOf(page, [placeCol]);
  const labelOf = (index: number) => present(page.rows[index]?.[title]) || present(page.rows[index]?.[0]) || "Elemento";
  // Stessi punti fra un rendering e l'altro: la mappa non si riposiziona se i dati non cambiano.
  const pins = useMemo(
    () => points.map(({ index, lat, lon }) => ({ index, lat, lon, label: present(page.rows[index][title]) || present(page.rows[index][0]) || "Elemento", tone: tools.tone?.(page, page.rows[index])?.tone ?? null })),
    [points, page, tools.tone, title],
  );
  return (
    <section aria-labelledby={`${id}-title`} className="my-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" data-layout-view="mappa">
      <div className={`${card} p-5`}>
        <h3 id={`${id}-title`} className="font-semibold">
          {real ? "Mappa" : "Mappa dei luoghi"}
        </h3>
        {real ? (
          <>
            <p className="mb-4 text-sm text-(--mk-muted)">Punti alle coordinate di esempio delle righe: un clic su un punto apre il dettaglio.</p>
            <Suspense fallback={<div className="aspect-[4/3] rounded-lg bg-(--mk-subtle)" />}>
              <LeafletMap
                points={pins}
                selected={focus}
                inert={inert}
                onOpen={(index) => {
                  setFocus(index);
                  onDetail(index);
                }}
              />
            </Suspense>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-(--mk-muted)">Mappa schematica, non in scala: ogni segnaposto è un luogo con i suoi elementi.</p>
            <div
              className="relative grid aspect-[4/3] grid-cols-4 grid-rows-3 gap-2 overflow-hidden rounded-lg border border-(--mk-divider) bg-(--mk-subtle) p-3"
              style={{ backgroundImage: "linear-gradient(var(--mk-divider) 1px, transparent 1px), linear-gradient(90deg, var(--mk-divider) 1px, transparent 1px)", backgroundSize: "25% 33.34%" }}
            >
              {groups.map((g, i) => (
                <button
                  key={g.place}
                  type="button"
                  disabled={inert}
                  aria-pressed={selected === g.place}
                  onClick={() => setSelected(selected === g.place ? null : g.place)}
                  style={{ gridColumn: spots[i].col, gridRow: spots[i].row }}
                  className={`z-[1] flex min-w-0 flex-col items-center justify-center gap-1 self-center rounded-lg px-2 py-2 text-xs font-semibold shadow-sm ${selected === g.place ? "bg-(--mk-primary) text-(--mk-on-primary)" : "bg-(--mk-surface) text-(--mk-text) hover:outline hover:outline-2 hover:outline-(--mk-primary)"}`}
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    ●
                  </span>
                  <span className="max-w-full truncate">{g.place}</span>
                  <span className="font-normal">{g.indexes.length === 1 ? "1 elemento" : `${g.indexes.length} elementi`}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className={`${card} p-5`} aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{current ? current.place : focus !== null ? labelOf(focus) : real ? "Tutti i punti" : "Tutti i luoghi"}</h3>
          {(current || focus !== null) && (
            <button
              type="button"
              className={`text-sm ${link}`}
              disabled={inert}
              onClick={() => {
                setSelected(null);
                setFocus(null);
              }}
            >
              Mostra tutti
            </button>
          )}
        </div>
        <ul className="mt-2 max-h-[28rem] overflow-y-auto">
          {indexes.map((index) => {
            const row = page.rows[index];
            const label = labelOf(index);
            const at = rowCoordinates(page, row);
            const online = points.some((p) => p.index === index);
            return (
              <li key={index} className="flex flex-wrap items-start justify-between gap-3 border-b border-(--mk-divider) py-3 last:border-b-0">
                <div className="min-w-0">
                  <p className="font-medium">{label}</p>
                  {at && real && !online && <p className="mt-1 text-xs text-(--mk-muted)">Non mostrata sulla mappa online: i tuoi dati restano nel browser.</p>}
                  <p className="mt-1 text-sm text-(--mk-muted)">
                    {[present(row[placeCol]), ...rowFacts(page, row, [title, placeCol, tools.statusColumnOf(page)], 1).map((f) => f.value)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge page={page} row={row} tools={tools} />
                  {online && (
                    <button type="button" className={`text-sm ${link}`} disabled={inert} aria-pressed={focus === index} onClick={() => setFocus(focus === index ? null : index)} aria-label={`Mostra sulla mappa ${label}`}>
                      Sulla mappa
                    </button>
                  )}
                  <DetailButton index={index} label={label} onDetail={onDetail} inert={inert} />
                  {at && !inert && <RowMapsLink page={page} row={row} className={`text-sm ${link}`} />}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function FormField({ page, tools, index, value, error, onChange, inert, id }: { page: LayoutPage; tools: LayoutTools; index: number; value: string; error?: string; onChange: (v: string) => void; inert?: boolean; id: string }) {
  const kind = tools.fieldOf(page, index);
  const name = `${id}-field-${index}`;
  const required = tools.fieldRequired(page, index);
  const invalid = error ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};
  const common = { id: name, required, disabled: inert, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value), className: field, ...invalid };
  return (
    <div className={`grid content-start gap-2 text-sm ${kind.kind === "long" ? "sm:col-span-2" : ""}`}>
      <label htmlFor={name}>
        {page.form[index]}
        {!required && <span className="text-(--mk-muted)"> (facoltativo)</span>}
      </label>
      {kind.kind === "choice" ? (
        <select {...common}>
          <option value="" disabled>
            Scegli…
          </option>
          {kind.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : kind.kind === "long" ? (
        <textarea {...common} rows={3} maxLength={120} />
      ) : (
        <input {...common} maxLength={120} type={kind.kind === "date" ? "date" : "text"} inputMode={kind.kind === "number" ? "decimal" : undefined} />
      )}
      {error && (
        <p id={`${name}-error`} className="text-(--mk-danger)">
          {error}
        </p>
      )}
    </div>
  );
}
/**
 * Valori che assegna il prototipo (numero della pratica e stato iniziale): non si chiedono, ma
 * entrano nella pipeline prima di visibilità e obbligatorietà. Se il modulo ha solo quei campi,
 * si chiedono tutti.
 */
function formPlan(page: LayoutPage, tools: LayoutTools) {
  const code = codeColumnOf(page);
  const status = tools.statusColumnOf(page);
  const auto: Record<number, string> = {};
  if (code >= 0) auto[code] = nextRequestCode(page, new Date().getFullYear());
  const first = status >= 0 ? tools.distinctValues(page.rows, status).find((v) => present(v)) : undefined;
  if (first) auto[status] = first;
  const all = page.form.map((_, i) => i);
  const asked = all.filter((i) => auto[i] === undefined);
  if (asked.length) return { auto, asked };
  // Restano modificabili solo i campi del modulo: un numero fuori dal modulo resta automatico.
  for (const i of all) delete auto[i];
  return { auto, asked: all };
}
/** Stato del modulo della vista sopra la pipeline unica del template, con il fuoco sul primo campo sbagliato. */
function useLayoutForm(page: LayoutPage, tools: LayoutTools) {
  const plan = formPlan(page, tools);
  const [values, setValues] = useState<string[]>(() => page.form.map(() => ""));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const id = useId();
  const photos = () => ({ photos: (tools.newPhotos?.(page.id) ?? 0) > 0 });
  const prepared = () => tools.prepareFormRow(page, values, plan.auto, photos());
  const filled = prepared().values;
  const set = (i: number, v: string) => {
    const next = values.map((x, k) => (k === i ? v : x));
    setValues(next);
    // Come il modulo nativo: un errore già mostrato sparisce appena non c'è più (anche «Compila almeno un campo»).
    const now = tools.prepareFormRow(page, next, plan.auto, photos()).issues;
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => now[Number(k)])));
  };
  /**
   * Errori dei campi `only` (tutti se assente), mostrati e con il fuoco sul primo; null se vanno
   * bene. Su un solo passo «Compila almeno un campo» non conta: i dati possono arrivare dopo.
   */
  const check = (only?: number[], keepEmpty = false) => {
    const result = prepared();
    const issues = Object.fromEntries(Object.entries(result.issues).filter(([k]) => !only || (only.includes(Number(k)) && (keepEmpty || Number(k) !== result.empty))));
    setErrors(issues);
    const first = Object.keys(issues)[0];
    if (first !== undefined) document.getElementById(`${id}-field-${first}`)?.focus();
    return first === undefined ? result : null;
  };
  const reset = () => {
    setValues(page.form.map(() => ""));
    setErrors({});
  };
  const visible = (i: number) => tools.fieldVisible(page, i, filled);
  // Un valore assegnato dal prototipo (numero, stato) che non rispetta le regole del modulo: il
  // campo non si vede, quindi l'errore si mostra in testa al modulo invece di bloccarlo in silenzio.
  const hidden = Object.entries(errors).find(([k]) => !plan.asked.includes(Number(k)));
  const notice = hidden ? (
    <p role="alert" className="text-sm text-(--mk-danger) sm:col-span-2">
      {page.form[Number(hidden[0])]} (assegnato dal prototipo): {hidden[1]}
    </p>
  ) : null;
  return { ...plan, values, errors, set, check, reset, id, visible, prepared, notice };
}

// 5. Pratica guidata: i campi del form in passi, con riepilogo e invio; la pagina successiva è il passo dopo.
function Wizard({ page, pages, tools, onAdd, onNavigate, inert, photos }: MockupLayoutProps) {
  const form = useLayoutForm(page, tools);
  const { asked, visible } = form;
  const steps = wizardSteps(asked.length).map((step) => step.map((k) => asked[k]));
  const [step, setStep] = useState(0);
  const [sent, setSent] = useState<string | null>(null);
  const last = step === steps.length;
  const at = pages.findIndex((p) => p.id === page.id);
  const nextPage = at >= 0 ? pages[at + 1] : undefined;
  const id = useId();
  // Cambiando passo il fuoco va al titolo del passo (chi usa la tastiera o un lettore di schermo sa dove si trova).
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step]);
  const go = (n: number) => setStep(n);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!last) {
      if (form.check(steps[step])) go(step + 1);
      return;
    }
    const { issues } = form.prepared();
    // Il primo errore (anche «Compila almeno un campo») si mostra sul suo passo, dopo il cambio.
    const wrong = steps.findIndex((s) => s.some((i) => issues[i]));
    // (Un errore su un valore assegnato dal prototipo non ha passo: lo mostra `notice` con check().)
    if (wrong >= 0) {
      go(wrong);
      setTimeout(() => form.check(steps[wrong], true), 0);
      return;
    }
    const ready = form.check();
    if (!ready?.row) return;
    const row = ready.row;
    onAdd(row, "Pratica inviata nella demo", () => {
      setSent(present(row[codeColumnOf(page) >= 0 ? codeColumnOf(page) : 0]) || "la pratica");
      form.reset();
      go(0);
    });
  };
  return (
    <section aria-labelledby={`${id}-title`} className={`my-8 ${card} p-6`} data-layout-view="pratica">
      <h3 id={`${id}-title`} className="text-lg font-semibold">
        Procedura guidata
      </h3>
      {at >= 0 && pages.length > 1 && (
        <p className="mt-1 text-sm text-(--mk-muted)">
          Passo {at + 1} di {pages.length} della procedura
        </p>
      )}
      <ol className="mt-5 flex flex-wrap gap-2" aria-label="Passi del modulo">
        {[...steps.map((s) => page.form[s[0]] + (s.length > 1 ? " e altri dati" : "")), "Riepilogo e invio"].map((label, i) => (
          <li
            key={i}
            aria-current={i === step ? "step" : undefined}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${i === step ? "border-(--mk-primary) bg-(--mk-primary) text-(--mk-on-primary)" : i < step ? "border-(--mk-primary) text-(--mk-primary)" : "border-(--mk-border) text-(--mk-muted)"}`}
          >
            <span className="font-semibold">{i + 1}</span> {label}
            {i < step && <span className="sr-only"> (completato)</span>}
          </li>
        ))}
      </ol>
      {sent && (
        <p role="status" className="mt-5 rounded-lg border border-(--mk-primary) p-3 text-sm">
          Pratica «{sent}» inviata: la trovi nell'elenco qui sotto.
          {nextPage && (
            <>
              {" "}
              <button type="button" className={link} disabled={inert} onClick={() => onNavigate(nextPage.id)}>
                Vai al passo successivo: {nextPage.title}
              </button>
            </>
          )}
        </p>
      )}
      <form className="mt-6" onSubmit={submit} noValidate>
        {form.notice}
        <h4 ref={heading} tabIndex={-1} className="mb-3 font-medium outline-offset-4">
          {last ? "Riepilogo prima dell'invio" : `Passo ${step + 1} di ${steps.length + 1}`}
        </h4>
        {!last ? (
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="sr-only">Passo {step + 1}</legend>
            {steps[step].filter(visible).map((i) => (
              <FormField key={i} id={form.id} page={page} tools={tools} index={i} value={form.values[i] ?? ""} error={form.errors[i]} onChange={(v) => form.set(i, v)} inert={inert} />
            ))}
            {!steps[step].some(visible) && <p className="text-sm text-(--mk-muted)">Nessun dato da inserire in questo passo: prosegui.</p>}
          </fieldset>
        ) : (
          <div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {asked.map((i) =>
                visible(i) ? (
                  <div key={i} className="flex justify-between gap-3 border-b border-(--mk-divider) py-2">
                    <dt className="text-(--mk-muted)">{page.form[i]}</dt>
                    <dd className="text-right">{form.values[i]?.trim() || "—"}</dd>
                  </div>
                ) : null,
              )}
            </dl>
            {photos && <div className="mt-4">{photos}</div>}
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {step > 0 && (
            <button type="button" className={secondary} disabled={inert} onClick={() => go(step - 1)}>
              Indietro
            </button>
          )}
          <button type="submit" className={primary} disabled={inert}>
            {last ? "Invia la pratica" : "Avanti"}
          </button>
        </div>
      </form>
    </section>
  );
}

// 7. Fascicolo: intestazione con gli indicatori e la linea del tempo delle tappe, in ordine di data.
function Timeline({ page, tools, onDetail, inert }: MockupLayoutProps) {
  const [recent, setRecent] = useState(false);
  const items = useMemo(() => datedItems(page), [page]);
  const ordered = recent ? [...items.filter((i) => i.date).reverse(), ...items.filter((i) => !i.date)] : items;
  const skip = [dateColumnOf(page), timeColumnOf(page)].filter((c) => c >= 0);
  const title = titleColumnOf(page, skip);
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="my-8 grid gap-6" data-layout-view="fascicolo">
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id={`${id}-title`} className="text-lg font-semibold">
            Linea del tempo
          </h3>
          <button type="button" className={`text-sm ${link}`} disabled={inert} onClick={() => setRecent(!recent)}>
            {recent ? "Dal più vecchio" : "Dal più recente"}
          </button>
        </div>
        {page.metrics.length > 0 && (
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {page.metrics.map((m, i) => (
              <div key={i}>
                <dt className="text-(--mk-muted)">{m.label}</dt>
                <dd className="text-lg font-semibold">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <ol className="relative mt-6 border-l-2 border-(--mk-divider) pl-6">
          {ordered.map((item) => {
            const label = present(item.row[title]) || present(item.row[0]) || "Tappa";
            return (
              <li key={item.index} className="relative mb-6 last:mb-0">
                <span className="absolute -left-[1.95rem] top-1 h-3.5 w-3.5 rounded-full border-2 border-(--mk-surface) bg-(--mk-primary)" aria-hidden="true" />
                <p className="text-sm font-semibold text-(--mk-primary) first-letter:uppercase">
                  {item.date ? formatLayoutDate(item.date) : "Senza data"}
                  {item.time ? ` · ${item.time}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{label}</p>
                    <p className="mt-1 text-sm text-(--mk-muted)">
                      {rowFacts(page, item.row, [...skip, title, tools.statusColumnOf(page)], 3)
                        .map((f) => `${f.label}: ${f.value}`)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge page={page} row={item.row} tools={tools} />
                    <DetailButton index={item.index} label={label} onDetail={onDetail} inert={inert} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

// 8. Sportello: modulo pubblico per il cittadino, ricevuta con il numero e verifica dello stato.
function Counter({ page, tools, onAdd, inert, photos }: MockupLayoutProps) {
  const form = useLayoutForm(page, tools);
  const [receipt, setReceipt] = useState<{ code: string; status: string } | null>(null);
  const [query, setQuery] = useState("");
  const status = tools.statusColumnOf(page);
  const codeCol = codeColumnOf(page);
  const statuses = tools.distinctValues(page.rows, status).filter((v) => present(v));
  const found = findRequests(page, query);
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ready = form.check();
    if (!ready?.row) return;
    const row = ready.row;
    // La ricevuta e il modulo vuoto arrivano solo a inserimento avvenuto (dopo un'eventuale conferma).
    onAdd(row, "Richiesta inviata nella demo", () => {
      setReceipt({ code: codeCol >= 0 ? present(row[codeCol]) : "", status: status >= 0 ? present(row[status]) : "" });
      form.reset();
    });
  };
  const steps = (current: string): ReactNode =>
    statuses.length > 1 && (
      <ol className="mt-3 grid gap-1 text-sm" aria-label="Avanzamento della richiesta">
        {statuses.map((s) => (
          <li key={s} aria-current={s === current ? "step" : undefined} className={`flex items-center gap-2 ${s === current ? "font-semibold text-(--mk-primary)" : "text-(--mk-muted)"}`}>
            <span aria-hidden="true">{s === current ? "●" : "○"}</span>
            {s}
            {s === current && <span className="sr-only"> (stato attuale)</span>}
          </li>
        ))}
      </ol>
    );
  return (
    <section aria-labelledby={`${id}-title`} className="my-8 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" data-layout-view="sportello">
      <div className={`${card} p-6`}>
        <h3 id={`${id}-title`} className="text-lg font-semibold">
          Presenta una richiesta
        </h3>
        <p className="mt-1 text-sm text-(--mk-muted)">Servizio online per il cittadino: compila i campi e invia. Riceverai il numero della richiesta.</p>
        {receipt && (
          <div role="status" className="mt-4 rounded-lg border border-(--mk-primary) p-4 text-sm">
            <p className="font-semibold">Richiesta inviata</p>
            <p className="mt-1">
              {receipt.code && (
                <>
                  Numero: <strong>{receipt.code}</strong>
                </>
              )}
              {receipt.code && receipt.status && " · "}
              {receipt.status && <>Stato: {receipt.status}</>}
            </p>
            {receipt.code && <p className="mt-1 text-(--mk-muted)">Conserva il numero per verificare lo stato qui a lato.</p>}
          </div>
        )}
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
          {form.notice}
          {form.asked.map((i) =>
            form.visible(i) ? (
              <FormField key={i} id={form.id} page={page} tools={tools} index={i} value={form.values[i] ?? ""} error={form.errors[i]} onChange={(v) => form.set(i, v)} inert={inert} />
            ) : null,
          )}
          {photos && <div className="sm:col-span-2">{photos}</div>}
          <div className="sm:col-span-2">
            <button type="submit" className={primary} disabled={inert}>
              Invia la richiesta
            </button>
          </div>
        </form>
      </div>
      <div className={`${card} p-6`}>
        <h3 className="text-lg font-semibold">Verifica lo stato</h3>
        <label className="mt-3 grid gap-2 text-sm">
          Numero della richiesta o nome
          <input className={field} value={query} disabled={inert} onChange={(e) => setQuery(e.target.value)} placeholder={codeCol >= 0 ? present(page.rows[0]?.[codeCol]) || "Numero" : "Cerca"} />
        </label>
        <div aria-live="polite">
          {query.trim().length >= 2 && !found.length && <p className="mt-4 text-sm text-(--mk-muted)">Nessuna richiesta trovata con questo numero o nome.</p>}
          <ul className="mt-2">
            {found.map((index) => {
              const row = page.rows[index];
              const current = status >= 0 ? present(row[status]) : "";
              return (
                <li key={index} className="border-b border-(--mk-divider) py-3 last:border-b-0">
                  <p className="font-medium">
                    {codeCol >= 0 && present(row[codeCol]) ? `${present(row[codeCol])} · ` : ""}
                    {present(row[codeCol === 0 ? 1 : 0])}
                  </p>
                  {current && <p className="mt-1 text-sm">Stato: {current}</p>}
                  {steps(current)}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

// 10. Confronto: due colonne affiancate, campo per campo, con l'esito della verifica.
function Comparison({ page, tools, onUpdate, inert }: MockupLayoutProps) {
  const pairs = comparePairs(page);
  const listed = pairedRows(page);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(Math.min(1, page.rows.length - 1));
  const id = useId();
  const outcome = outcomeColumnOf(page);
  const current = outcome >= 0 ? tools.distinctValues(page.rows, outcome).filter((v) => v !== "—") : [];
  // Gli esiti possibili sono quelli di partenza più quelli di adesso: segnare tutto «Conforme» non li fa sparire.
  const [initial] = useState(current);
  const outcomes = [...new Set([...initial, ...current])];
  const name = (i: number) => present(page.rows[i]?.[0]) || `Riga ${i + 1}`;
  const setOutcome = (index: number, value: string) => {
    const row = page.rows[index].map((c, i) => (i === outcome ? value : c));
    onUpdate(index, row, `Esito di «${name(index)}»: ${value}`);
  };
  const verdict = (same: boolean) => <td className={`py-2 pr-3 font-semibold ${same ? "" : "text-(--mk-danger)"}`}>{same ? "✓ Coincide" : "⚠ Diverso"}</td>;
  const head = (cells: string[]) => (
    <thead className="border-b border-(--mk-divider) text-(--mk-muted)">
      <tr>
        {cells.map((c) => (
          <th key={c} scope="col" className="py-2 pr-3 font-medium first-letter:uppercase">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
  // Una coppia per riga: tutte le righe a confronto, con l'esito di ciascuna da registrare.
  if (listed.length) {
    const same = listed.filter((r) => r.same).length;
    return (
      <section aria-labelledby={`${id}-title`} className={`my-8 ${card} p-6`} data-layout-view="confronto">
        <h3 id={`${id}-title`} className="text-lg font-semibold">
          Verifica documentale
        </h3>
        <p className="mt-2 text-sm" role="status">
          {same} controlli su {listed.length} coincidono{listed.length - same ? `, ${listed.length - same} da approfondire` : ""}.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Confronto per riga fra {pairs[0].leftLabel} e {pairs[0].rightLabel}</caption>
            {head(["Controllo", pairs[0].leftLabel, pairs[0].rightLabel, "Confronto", ...(outcome >= 0 ? [page.columns[outcome]] : [])])}
            <tbody>
              {listed.map((r) => (
                <tr key={r.index} className={`border-b border-(--mk-divider) ${r.same ? "" : "bg-(--mk-subtle)"}`}>
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {r.label}
                  </th>
                  <td className="py-2 pr-3">{r.left || "—"}</td>
                  <td className="py-2 pr-3">{r.right || "—"}</td>
                  {verdict(r.same)}
                  {outcome >= 0 && (
                    <td className="py-2">
                      {outcomes.length > 1 ? (
                        <select className={field} value={page.rows[r.index][outcome]} disabled={inert} aria-label={`${page.columns[outcome]} di ${r.label}`} onChange={(e) => setOutcome(r.index, e.target.value)}>
                          {[...new Set([page.rows[r.index][outcome], ...outcomes])].map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        present(page.rows[r.index][outcome]) || "—"
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  // Una riga scelta può essere stata rimossa dalla tabella: gli indici restano dentro le righe.
  const l = Math.max(0, Math.min(left, page.rows.length - 1));
  const r = Math.max(0, Math.min(right, page.rows.length - 1));
  const fields = compareFields(page, l, r);
  // Le intestazioni «dichiarato» e «verificato» valgono per tutte le coppie solo se usano le stesse parole.
  const sameWords = pairs.every((p) => p.leftLabel === pairs[0].leftLabel && p.rightLabel === pairs[0].rightLabel);
  const same = fields.filter((f) => f.same).length;
  const pick = (label: string, value: number, set: (v: number) => void) => (
    <label className="grid gap-2 text-sm">
      {label}
      <select className={field} value={value} disabled={inert} onChange={(e) => set(Number(e.target.value))}>
        {page.rows.map((_, i) => (
          <option key={i} value={i}>
            {name(i)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section aria-labelledby={`${id}-title`} className={`my-8 ${card} p-6`} data-layout-view="confronto">
      <h3 id={`${id}-title`} className="text-lg font-semibold">
        {pairs.length ? "Verifica documentale" : "Confronto fra due documenti"}
      </h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {pick(pairs.length ? "Pratica da verificare" : "Primo documento", l, setLeft)}
        {!pairs.length && pick("Secondo documento", r, setRight)}
      </div>
      <p className="mt-4 text-sm" role="status">
        {same} campi su {fields.length} coincidono{fields.length - same ? `, ${fields.length - same} da controllare` : ""}.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <caption className="sr-only">Confronto campo per campo</caption>
          {head(["Campo", pairs.length ? (sameWords ? pairs[0].leftLabel : "Primo valore") : name(l), pairs.length ? (sameWords ? pairs[0].rightLabel : "Secondo valore") : name(r), "Esito"])}
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} className={`border-b border-(--mk-divider) ${f.same ? "" : "bg-(--mk-subtle)"}`}>
                <th scope="row" className="py-2 pr-3 font-medium first-letter:uppercase">
                  {f.label}
                </th>
                <td className="py-2 pr-3">{f.left || "—"}</td>
                <td className="py-2 pr-3">{f.right || "—"}</td>
                {verdict(f.same)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {outcome >= 0 && outcomes.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
          <span>
            {page.columns[outcome]} di «{name(l)}»: <strong>{present(page.rows[l]?.[outcome]) || "—"}</strong>
          </span>
          {outcomes.map((o) => (
            <button key={o} type="button" className={secondary} disabled={inert || !page.rows[l] || page.rows[l][outcome] === o} onClick={() => setOutcome(l, o)}>
              Segna «{o}»
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
