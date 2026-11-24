// v7: per primo, così il token dell'assistente lascia l'indirizzo prima di ogni altro modulo.
import { agentToken } from "./token";
import { Component, useState, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import rawSeed from "./spec.json";
type MockupData = {title:string;description:string;accent:string;theme?:{palette:string;fonts:string};resetPlacement?:string;navigation?:string;layout?:string;colors?:{title?:string;background?:string};custom?:{name:string;title:string;description:string;role:string;pageId?:string;position?:string;events?:string[];column?:string}[];pages:{id:string;title:string;description:string;metrics:{label:string;value:string;color?:string}[];columns:string[];rows:string[][];form:string[];sections?:string[];view?:string;statusColumn?:number;chartColumn?:number;behavior?:unknown;files?:string[]}[]};
const seed: MockupData = rawSeed;
import "./style.css";
import "./theme.css";
// v7 (WZ-2123): componenti su misura scritti dall'assistente avanzato in src/custom/,
// richiamati per nome dalla specifica e agganciati ai cinque ruoli qui sotto.
import {
  Button,
  CustomSlotContext,
  Dialog,
  FlowareRuntime,
  customComponentStopped,
  newCustomSlot,
  stopCustomComponent,
  subscribeCustomStops,
  type CustomAction,
  type Runtime,
} from "./floware";
import { customTextAttributes, customTextsPhishing } from "./customGuard";
import { customComponents, preloadCustomComponents } from "./custom";
import {
  chartBars,
  chartColumnOf,
  detailOnlyColumnCount,
  distinctValues,
  emptyTableState,
  fieldIssue,
  fieldOf,
  fieldRequired,
  fieldVisible,
  formIssues,
  kanbanLanes,
  prepareFormRow,
  columnColor,
  rowHighlight,
  rowsStriped,
  rowToneStyle,
  statusColumnOf,
  tableColumnLimit,
  tableFilters,
  toggleSort,
  viewOf,
  visibleRows,
  withNextStatus,
  type MockupTableState,
} from "./logic";
// v6: assistente AI (docs/mockup-ai-agent.md §2.2). La rete è solo in
// src/agent/gateway.ts, verso il gateway fissato alla build.
import type { AgentBridge } from "./agent/AgentPanel";
import { addAgentRecord, agentGatewayOrigin } from "./agent/boot";
// Il pannello si carica a parte: il bundle iniziale resta quasi quello di v5.
const AgentPanel = lazy(() => import("./agent/AgentPanel").then((m) => ({ default: m.AgentPanel })));
// Il token arriva come #fa=<token>: src/token.ts lo toglie dall'indirizzo prima che il
// prototipo legga l'hash per la navigazione (e prima dei componenti su misura).
// WZ-2126: tipi di pagina (scadenzario, lista di controllo…), caricati a parte
// solo se il prototipo ne ha. Dati in memoria e, se si può, nel browser.
import { clearKindStates, kindStorageKey } from "./kinds/storage";
import { createKindAi } from "./kinds/ai";
const MockupKindPage = lazy(() => import("./kinds/index").then((m) => ({ default: m.MockupKindPage })));
// v10 (WZ-2156): file veri nelle pagine ordinarie (`pages[].files`), solo nel browser e in
// memoria. Il pannello e i lettori (Excel, PDF) si caricano a parte, solo se servono.
import { fileFeaturesOf } from "./kinds/filesBasics";
import { clearPhotos, commitNewPhotos, noteRowEdit, photosOf, useRowIds } from "./kinds/filesPhotos";
const FilesPanel = lazy(() => import("./kinds/FilesPanel").then((m) => ({ default: m.FilesPanel })));
const RowFiles = lazy(() => import("./kinds/FilesPanel").then((m) => ({ default: m.RowFiles })));
const PhotoAttach = lazy(() => import("./kinds/FilesPanel").then((m) => ({ default: m.PhotoAttach })));
const kindOf = (page: object) => typeof Reflect.get(page, "kind") === "string";
// Lo stesso token catturato da src/token.ts (una sola cattura: dopo, l'indirizzo non lo ha più).
const kindAi = createKindAi(agentGatewayOrigin, agentToken);
// WZ-2039: palette e font sono token CSS (theme.css); la struttura non cambia.
// Senza tema resta l'aspetto storico, con l'accento scelto dal modello.
const theme = Reflect.get(seed, "theme") as
  { palette: string; fonts: string } | undefined;
document.documentElement.dataset.accent = seed.accent;
if (theme) {
  document.documentElement.dataset.palette = theme.palette;
  document.documentElement.dataset.fonts = theme.fonts;
  // Solo la coppia scelta viene scaricata (font OFL incorporati, vedi fonts/OFL.txt).
  const fonts = import.meta.glob("./fonts/*.css");
  void fonts[`./fonts/${theme.fonts}.css`]?.();
}
// WZ-2158 (v12): titolo e sfondo dalla tavolozza semantica (regole in theme.css).
const colors = (Reflect.get(seed, "colors") ?? {}) as { title?: string; background?: string };
const color = "bg-(--mk-primary) text-(--mk-on-primary)";
const card = "rounded-xl border border-(--mk-divider) bg-(--mk-surface) shadow-sm";
const field = "rounded-md border border-(--mk-border) bg-(--mk-surface) px-3 py-2";
// WZ-2037: campi opzionali della specifica; in assenza valgono ordine e
// posizione storici.
const defaultSections = ["metrics", "table", "form"];
const sectionsOf = (page: object): string[] => {
  const sections = (page as { sections?: unknown }).sections;
  return Array.isArray(sections) && sections.length === 3
    ? sections
    : defaultSections;
};
const resetPlacement =
  Reflect.get(seed, "resetPlacement") === "top" ? "top" : "bottom";
// WZ-2153 (v11): modello di struttura del sito (`layout`); assente = registro, la pagina di
// sempre. Le viste si caricano a parte (src/layouts), solo se servono.
const layout = String(Reflect.get(seed, "layout") ?? "");
// WZ-2088: navigazione in alto o laterale (predefinita); i modelli larghi la portano in alto,
// salvo la scelta laterale esplicita (`navigation: "side"`, solo con un layout).
const navigationChoice = Reflect.get(seed, "navigation");
const topNavigation = navigationChoice === "top" || (navigationChoice !== "side" && !!layout && layout !== "agenda" && layout !== "fascicolo");
// Sezione in cui sta la vista del layout (segue `sections`, quindi «sposta la sezione»).
const layoutSlot = layout === "cruscotto" ? "metrics" : layout === "pratica" || layout === "sportello" ? "form" : "table";
const LayoutView = lazy(() => import("./layouts/index").then((m) => ({ default: m.MockupLayoutView })));
// v12 (WZ-2158): colore della riga evidenziata per i punti della mappa vera.
const layoutTools = { fieldOf, prepareFormRow, statusColumnOf, distinctValues, fieldVisible, fieldRequired, newPhotos: (pageId: string) => photosOf(pageId, "new").length, tone: rowHighlight };
// v12 (WZ-2157): «Apri in Google Maps» nel Dettaglio, a parte con la lettura delle coordinate.
const RowMapsLink = lazy(() => import("./layouts/RowMapsLink"));
// WZ-2123: descrizione dei componenti su misura (il codice è in src/custom/). Un
// componente senza file nel registro è ignorato: il prototipo resta quello standard.
type CustomMeta = {
  name: string;
  title: string;
  role: "section" | "confirm" | "detail" | "cell" | "floating";
  pageId?: string;
  position?: string;
  events?: string[];
  column?: string;
};
const rawCustom = Reflect.get(seed, "custom");
const customs: CustomMeta[] = (Array.isArray(rawCustom) ? (rawCustom as CustomMeta[]) : []).filter(
  (c) => c && typeof c.name === "string" && Object.prototype.hasOwnProperty.call(customComponents, c.name) && customComponents[c.name] != null,
);
const foldName = (text: string) =>
  String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const onPage = (c: CustomMeta, pageId: string) => !c.pageId || c.pageId === pageId;
// Un errore in un componente su misura mostra un riquadro (o il comportamento
// standard, per conferme e dettaglio) e non ferma il resto del prototipo.
class CustomBoundary extends Component<{ title: string; fallback?: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    // fallback={null} vale: il componente rotto sparisce senza riquadro.
    if ("fallback" in this.props) return this.props.fallback;
    return (
      (
        <p role="note" data-testid="custom-unavailable" className="my-4 rounded-lg border border-dashed border-(--mk-border) p-3 text-sm text-(--mk-muted)">
          «{this.props.title}» non è disponibile in questo prototipo.
        </p>
      )
    );
  }
}
// Valori nuovi per ogni componente su misura: copie dei dati (righe, azione) e funzioni
// proprie, così il componente non riceve mai oggetti che il template continua a usare.
const customValue = (value: unknown, depth = 0): unknown => {
  if (typeof value === "function") return () => (value as () => unknown)();
  if (Array.isArray(value)) return depth > 3 ? [] : value.map((item) => customValue(item, depth + 1));
  if (value && typeof value === "object") return depth > 3 ? {} : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, customValue(v, depth + 1)]));
  return value;
};
// Ogni componente su misura sta in un riquadro contenuto e di misura limitata: ciò che
// disegna non esce dal suo spazio (contain: paint fa da contenitore anche per gli elementi
// fixed e absolute) e il riquadro non diventa grande come la pagina: oltre il limite
// scorre. Le finestre dell'API (Dialog, Drawer) escono con un portal.
const smallBox = { contain: "paint", maxWidth: "min(24rem, 100%)", maxHeight: "min(70vh, 32rem)", overflow: "auto", pointerEvents: "auto" } as const;
const customBoxes = {
  section: { contain: "paint", maxHeight: "min(80vh, 48rem)", overflow: "auto" },
  // L'elemento fisso sta sopra la pagina: su un telefono resta piccolo (vedi il contenitore).
  floating: { ...smallBox, maxWidth: "100%", maxHeight: "min(40vh, 20rem)" },
  confirm: smallBox,
  detail: smallBox,
  cell: { ...smallBox, display: "inline-block", verticalAlign: "top" },
} as const;
// Un componente escluso (vedi stopCustomComponent in src/floware.tsx) lascia il posto al
// riquadro di errore o al comportamento standard del suo ErrorBoundary.
function Stopped(): ReactNode {
  throw new Error("custom_component_stopped");
}
function CustomSlot({ meta, props, fallback }: { meta: CustomMeta; props: Record<string, unknown>; fallback?: ReactNode }) {
  const Custom = customComponents[meta.name] as unknown as ComponentType<Record<string, unknown>>;
  // Stato del riquadro per le finestre del componente (gesti, chiusure): uno per punto di
  // aggancio, quindi nuovo a ogni conferma o dettaglio aperto dall'utente.
  const [slot] = useState(() => newCustomSlot(meta.name));
  const stopped = useSyncExternalStore(subscribeCustomStops, () => customComponentStopped(meta.name));
  // Il componente si carica a parte: intanto la cella mostra il suo valore, il resto niente.
  const loading = meta.role === "cell" ? (props.value as ReactNode) : null;
  const boundary = fallback === undefined ? {} : { fallback };
  // Dopo ogni rendering il testo completo del riquadro e delle sue finestre (anche ricomposto
  // da più pezzi) non deve essere da modulo di accesso o di pagamento: se lo è, il
  // componente si esclude prima che il browser lo mostri.
  const box = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = box.current;
    if (!root || stopped) return;
    const check = () => {
      const roots = [root, ...slot.portals];
      if (!customTextsPhishing(roots)) return;
      for (const node of roots) if (node instanceof HTMLElement) node.style.visibility = "hidden";
      stopCustomComponent(meta.name, "testi da modulo di accesso o di pagamento");
    };
    const observer = new MutationObserver(check);
    const options = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: customTextAttributes };
    observer.observe(root, options);
    for (const portal of slot.portals) observer.observe(portal, options);
    slot.watch = (portal) => {
      observer.observe(portal, options);
      check();
    };
    check();
    return () => {
      observer.disconnect();
      slot.watch = undefined;
    };
  }, [slot, stopped, meta.name]);
  // Il contesto avvolge solo il componente: il comportamento standard (fallback) resta del template.
  const content = stopped ? (
    <Stopped />
  ) : (
    <CustomSlotContext.Provider value={slot}>
      <Suspense fallback={loading}>
        <Custom {...(customValue(props) as Record<string, unknown>)} />
      </Suspense>
    </CustomSlotContext.Provider>
  );
  return (
    <CustomBoundary title={meta.title} {...boundary}>
      {meta.role === "cell" ? (
        <span ref={box} data-custom-box="cell" style={customBoxes.cell}>
          {content}
        </span>
      ) : (
        <div ref={box as React.RefObject<HTMLDivElement>} data-custom-box={meta.role} style={customBoxes[meta.role]}>
          {content}
        </div>
      )}
    </CustomBoundary>
  );
}
function App() {
  const [pages, setPages] = useState(structuredClone(seed.pages));
  const [active, setActive] = useState(
    location.hash.slice(1) || seed.pages[0].id,
  );
  const [table, setTable] = useState<MockupTableState>(emptyTableState);
  // v7: il dettaglio ricorda la pagina, così un componente può aprire il dettaglio
  // di una riga di un'altra pagina (dati collegati).
  const [detail, setDetailState] = useState<{ pageId: string; index: number } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ action: CustomAction; apply: () => void; meta: CustomMeta } | null>(null);
  const [message, setMessage] = useState("");
  // v9 (WZ-2154): valori del modulo (per i campi che compaiono solo per una scelta) ed errori.
  const [formValues, setFormValues] = useState<string[]>([]);
  const [formErrors, setFormErrors] = useState<Record<number, string>>({});
  // «Ripristina demo» fa ripartire da capo anche i tipi di pagina.
  const [resets, setResets] = useState(0);
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  // v7: i componenti su misura si caricano a parte; li si scarica subito dopo l'avvio.
  useEffect(() => {
    preloadCustomComponents();
  }, []);
  // Ponte stabile fra l'assistente e i dati del prototipo (solo in memoria).
  const agentBridge = useMemo<AgentBridge>(() => ({
    onRecord: (record) => {
      const current = pagesRef.current;
      const result = addAgentRecord(current, record);
      if (result.pageIndex < 0) return;
      setPages(result.pages);
      setMessage("Esempio aggiunto dall'assistente");
      location.hash = current[result.pageIndex].id;
      return current[result.pageIndex].title;
    },
    onMetrics: (metrics) => {
      setPages((current) => current.map((p, i) => (i === 0 ? { ...p, metrics: metrics.slice(0, 6) } : p)));
    },
  }), []);
  const page = pages.find((p) => p.id === active) ?? pages[0];
  // v10: identificativo stabile di ogni riga, solo in memoria (le foto seguono la riga).
  const rowIdOf = useRowIds(pages);
  const setDetail = (index: number | null) => setDetailState(index === null ? null : { pageId: page.id, index });
  useEffect(() => {
    const changed = () => {
      const next = location.hash.slice(1);
      setActive(next);
      setTable(emptyTableState);
      setFormValues([]);
      setFormErrors({});
      // Il dettaglio aperto da un componente su un'altra pagina resta aperto.
      setDetailState((d) => (d && d.pageId === next ? d : null));
      setPendingAction(null);
      setMessage("");
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (detail === null) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setDetailState(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [detail]);
  // Aggiornamento funzionale sullo stato corrente: più scritture nello stesso gestore
  // (due setCell, due addRow) si sommano invece di sovrascriversi.
  const setRowsOf = (pageId: string, update: (rows: string[][]) => string[][], done?: string) => {
    setPages((current) => current.map((p) => (p.id === pageId ? { ...p, rows: update(p.rows) } : p)));
    if (done) setMessage(done);
  };
  // Stato condiviso con i componenti su misura (src/floware.tsx).
  const runtime: Runtime = {
    title: seed.title,
    pages,
    pageId: page.id,
    setRows: setRowsOf,
    navigate: (pageId) => {
      if (pages.some((p) => p.id === pageId)) location.hash = pageId;
    },
    openDetail: (pageId, index) => {
      const target = pages.find((p) => p.id === pageId);
      if (!target || !target.rows[index]) return;
      setDetailState({ pageId, index });
      if (pageId !== page.id) location.hash = pageId;
    },
    notify: (text) => setMessage(String(text ?? "").slice(0, 200)),
  };
  // Un componente di conferma, se c'è, si apre prima dell'azione; altrimenti l'azione parte subito.
  const confirmFor = (kind: CustomAction["kind"]) =>
    customs.find((c) => c.role === "confirm" && onPage(c, page.id) && (c.events?.length ? c.events : ["status"]).includes(kind));
  const request = (action: CustomAction, apply: () => void) => {
    const meta = confirmFor(action.kind);
    if (!meta) return apply();
    setPendingAction({ action, apply, meta });
  };
  const cellMeta = (column: number) =>
    customs.find((c) => c.role === "cell" && onPage(c, page.id) && foldName(c.column ?? "") === foldName(page.columns[column] ?? ""));
  const cellView = (value: string, column: number, rowIndex: number) => {
    const meta = cellMeta(column);
    if (!meta) return value;
    return <CustomSlot meta={meta} props={{ pageId: page.id, rowIndex, column: page.columns[column], value, row: page.rows[rowIndex] }} fallback={value} />;
  };
  const sectionsAt = (position: string) =>
    customs
      .filter((c) => c.role === "section" && onPage(c, page.id) && (c.position ?? "bottom") === position)
      .map((meta) => (
        <div key={meta.name} data-custom={meta.name}>
          <CustomSlot meta={meta} props={{ pageId: page.id }} />
        </div>
      ));
  // Un solo elemento fisso per pagina (la specifica non ne ammette di più): il primo.
  const floating = customs.filter((c) => c.role === "floating" && onPage(c, page.id)).slice(0, 1);
  const status = statusColumnOf(page);
  const statuses = distinctValues(page.rows, status);
  const items = visibleRows(page, table);
  // v11: bacheca e schede mostrano le righe come kanban e card, se la pagina non dice altro.
  const view = viewOf(!Reflect.get(page, "view") && (layout === "bacheca" || layout === "schede") ? { ...page, view: layout === "bacheca" ? "kanban" : "cards" } : page);
  // v11: sezione nativa sostituita dalla vista del layout (layoutReplaces in src/layouts/layoutLogic.ts).
  const replaced = layout === "cruscotto" && page.metrics.length ? "metrics" : (layout === "pratica" || layout === "sportello") && page.form.length ? "form" : "";
  const chart = chartColumnOf(page);
  const files = kindOf(page) ? [] : fileFeaturesOf(page);
  // v9 (WZ-2154): filtri, righe evidenziate o alterne e regole dei campi della specifica.
  const filters = tableFilters(page);
  const striped = rowsStriped(page);
  const highlight = (row: string[]) => rowHighlight(page, row);
  const rowBadge = (row: string[]) => {
    const h = highlight(row);
    return h ? <span className="mr-2 inline-block rounded-full border border-(--mk-border) bg-(--mk-surface) px-2 py-0.5 text-xs font-semibold text-(--mk-text)">{h.label}</span> : null;
  };
  // Una cella che non rispetta una regola di validazione: segno e testo, non solo il colore.
  const cellChecked = (value: string, column: number, content: ReactNode) => {
    const issue = fieldIssue(page, column, value);
    return issue ? (
      <span className="text-(--mk-danger)" title={issue}>
        {content} <span aria-hidden="true">⚠</span>
        <span className="sr-only"> (valore non valido: {issue})</span>
      </span>
    ) : (
      content
    );
  };
  const actions = (index: number) => (
    <div className="flex flex-wrap gap-3 text-sm">
      {status >= 0 && statuses.length > 1 && (
        <button
          className="font-medium text-(--mk-primary)"
          onClick={() => {
            const rows = withNextStatus(page, index);
            const pageId = page.id;
            request(
              { kind: "status", pageId, rowIndex: index, row: page.rows[index], from: page.rows[index][status], to: rows[index][status] },
              // Calcolato sullo stato al momento della conferma: le modifiche fatte nel
              // frattempo dal componente (per esempio una nota) restano.
              () => {
                setPages((current) =>
                  current.map((p) => {
                    if (p.id !== pageId) return p;
                    const next = withNextStatus(p, index);
                    // v10: la riga cambiata in posizione dal template tiene il suo identificativo (e le foto).
                    noteRowEdit(p.rows, next);
                    return { ...p, rows: next };
                  }),
                );
                setMessage("Stato aggiornato nella demo");
              },
            );
          }}
        >
          Cambia stato
        </button>
      )}
      <button className="font-medium text-(--mk-primary)" onClick={() => setDetail(index)}>
        Dettaglio
      </button>
      <button
        className="font-medium text-(--mk-danger)"
        onClick={() =>
          request({ kind: "remove", pageId: page.id, rowIndex: index, row: page.rows[index] }, () => {
            const pageId = page.id;
            setPages((current) => current.map((p) => (p.id === pageId ? { ...p, rows: p.rows.filter((_, i) => i !== index) } : p)));
            setMessage("Elemento rimosso dalla demo");
            setDetailState(null);
          })
        }
      >
        Rimuovi
      </button>
    </div>
  );
  const rowCard = (row: string[], index: number) => (
    <article key={index} className={`${card} grid gap-2 p-4`} style={rowToneStyle(highlight(row)?.tone ?? null, false, 0)}>
      <h4 className="font-semibold" data-mk-text={columnColor(page, 0)}>{rowBadge(row)}{cellChecked(row[0], 0, cellView(row[0], 0, index))}</h4>
      <dl className="grid gap-1 text-sm">
        {row.slice(1, tableColumnLimit).map((cell, i) => (
          <div key={i} className="flex justify-between gap-3">
            <dt className="text-(--mk-muted)">{page.columns[i + 1]}</dt>
            <dd className="text-right" data-mk-text={columnColor(page, i + 1)}>{cellChecked(cell, i + 1, cellView(cell, i + 1, index))}</dd>
          </div>
        ))}
      </dl>
      {actions(index)}
    </article>
  );
  const resetButton = (
    <button
      className="mt-4 rounded border border-(--mk-sidebar-muted) px-3 py-2 text-sm"
      onClick={() => {
        setPages(structuredClone(seed.pages));
        setTable(emptyTableState);
        setDetail(null);
        clearKindStates();
        clearPhotos();
        setResets((n) => n + 1);
        setMessage("Dati dimostrativi ripristinati");
      }}
    >
      Ripristina demo
    </button>
  );
  const navigation = (
    <nav
      aria-label="Schermate"
      className={topNavigation ? "flex flex-wrap gap-2" : "mt-8 flex flex-wrap gap-2 md:flex-col"}
    >
      {pages.map((p) => (
        <a
          key={p.id}
          href={`#${p.id}`}
          aria-current={page.id === p.id ? "page" : undefined}
          className={`rounded-lg px-4 py-3 text-sm font-medium ${page.id === p.id ? "bg-(--mk-nav-active) text-(--mk-on-nav-active)" : "text-(--mk-on-sidebar) hover:bg-(--mk-sidebar-hover)"}`}
        >
          {p.title}
        </a>
      ))}
    </nav>
  );
  const notice = (
    <p className={`${topNavigation ? "" : "mt-8 "}text-xs leading-relaxed text-(--mk-sidebar-muted)`}>
      Prototipo pubblico · Dati di esempio: Floware sostituisce i dati
      personali più comuni con dati inventati e maschera codici fiscali e
      IBAN. Le modifiche durano soltanto in questa sessione.
    </p>
  );
  const shown = detail === null || detail.pageId !== page.id ? undefined : page.rows[detail.index];
  // v7: un componente su misura con ruolo «detail» sostituisce questa finestra (per
  // esempio un pannello laterale); se non si carica resta la finestra standard.
  const detailMeta = customs.find((c) => c.role === "detail" && onPage(c, page.id));
  const builtInDetail = shown && (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4" onClick={() => setDetail(null)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Dettaglio di ${shown[0]}`}
        className={`${card} max-h-[90vh] w-full max-w-md overflow-y-auto p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold">{shown[0]}</h3>
        <dl className="grid gap-2 text-sm">
          {page.columns.map((c, i) => (
            <div key={i} className="flex justify-between gap-3">
              <dt className="text-(--mk-muted)">{c}</dt>
              <dd className="text-right">{shown[i]}</dd>
            </div>
          ))}
        </dl>
        {/* WZ-2157 (v12): coordinate della riga → Google Maps in una nuova scheda (solo con un clic). */}
        {shown && (
          <Suspense fallback={null}>
            <RowMapsLink page={page} row={shown} />
          </Suspense>
        )}
        {(files.includes("photos") || files.includes("export")) && detail && (
          <Suspense fallback={null}>
            <RowFiles page={page} rowIndex={detail.index} rowId={rowIdOf(page.id, detail.index)} prototypeTitle={seed.title} />
          </Suspense>
        )}
        <button autoFocus className={`mt-6 rounded-lg px-4 py-2 ${color}`} onClick={() => setDetail(null)}>
          Chiudi
        </button>
      </div>
    </div>
  );
  // v11: vista del layout, nel punto della sua sezione; usa la pipeline e le foto del modulo nativo.
  const layoutView = (
    <Suspense fallback={null}>
      <LayoutView
        key={`${page.id}-${resets}`}
        layout={layout}
        page={page}
        pages={pages}
        samples={seed.pages}
        tools={layoutTools}
        photos={
          files.includes("photos") ? (
            <Suspense fallback={null}>
              <PhotoAttach pageId={page.id} row="new" />
            </Suspense>
          ) : null
        }
        onAdd={(row, done, after) => {
          const pageId = page.id;
          request({ kind: "add", pageId, rowIndex: page.rows.length, row }, () => {
            commitNewPhotos(pageId, row);
            setRowsOf(pageId, (rows) => [...rows, row], done);
            after?.();
          });
        }}
        onUpdate={(index, row, done) => {
          // Come «Cambia stato»: un componente di conferma su misura può intercettarlo.
          const pageId = page.id;
          const at = row.findIndex((c, i) => c !== page.rows[index][i]);
          request({ kind: "status", pageId, rowIndex: index, row: page.rows[index], from: page.rows[index][at] ?? "", to: row[at] ?? "" }, () =>
            setRowsOf(pageId, (rows) => {
              const next = rows.map((r, i) => (i === index ? row : r));
              noteRowEdit(rows, next);
              return next;
            }, done),
          );
        }}
        onDetail={setDetail}
        onNavigate={(id) => (location.hash = id)}
      />
    </Suspense>
  );
  return (
    <FlowareRuntime.Provider value={runtime}>
    <div data-layout={layout || undefined} data-title-color={colors.title} data-bg-color={colors.background} className={`min-h-screen bg-(--mk-bg) text-(--mk-text) ${topNavigation ? "" : "md:flex"}`}>
      <aside
        className={
          topNavigation
            ? "border-b border-(--mk-divider) bg-(--mk-sidebar) px-6 py-4 text-(--mk-on-sidebar)"
            : "border-b border-(--mk-divider) bg-(--mk-sidebar) p-6 text-(--mk-on-sidebar) md:min-h-screen md:w-64 md:border-r"
        }
      >
        {/* La barra laterale resta ferma mentre la pagina scorre. */}
        <div className={topNavigation ? "" : "md:sticky md:top-6"}>
        {resetPlacement === "top" && <div className="mb-5">{resetButton}</div>}
        <div className={topNavigation ? "flex flex-wrap items-center gap-x-6 gap-y-3" : ""}>
          <div
            className={`${topNavigation ? "" : "mb-5 "}inline-flex h-10 w-10 items-center justify-center rounded-xl font-bold ${color}`}
          >
            M
          </div>
          <div>
        <h1 data-testid="mockup-title" className="text-xl font-bold">{seed.title}</h1>
            <p className={`${topNavigation ? "" : "mt-2 "}text-sm text-(--mk-sidebar-muted)`}>
              {seed.description}
            </p>
          </div>
          {navigation}
        </div>
        {notice}
        {resetPlacement === "bottom" && resetButton}
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl p-5 md:p-10">
        <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-(--mk-primary)">
          Spazio dimostrativo ·{" "}
          <span data-testid="mockup-sample-data">Dati di esempio</span>
        </p>
        <h2 className="text-3xl font-bold">{page.title}</h2>
        <p className="mt-2 text-(--mk-muted)">{page.description}</p>
        {sectionsAt("top")}
        {kindOf(page) && (
          <Suspense fallback={<p className="mt-8 text-(--mk-muted)">Caricamento…</p>}>
            <MockupKindPage key={`${page.id}-${resets}`} page={page} ai={kindAi} storageKey={kindStorageKey(page)} />
          </Suspense>
        )}
        {files.length > 0 && (
          <Suspense fallback={<p className="mt-6 text-(--mk-muted)">Caricamento…</p>}>
            <FilesPanel
              key={`${page.id}-${resets}`}
              page={page}
              prototypeTitle={seed.title}
              onAddRows={(rows, done) => setRowsOf(page.id, (current) => [...current, ...rows], done)}
            />
          </Suspense>
        )}
        {!kindOf(page) && sectionsOf(page).map((section) => (
          <div key={section} data-section={section}>
            {layout && section === layoutSlot && layoutView}
            {section === "metrics" && replaced !== "metrics" && (
              <div className="my-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {page.metrics.map((m, i) => (
                  <div key={i} className={`${card} min-w-0 p-5`} data-mk-fill={Reflect.get(m, "color")}>
                    <p className="text-sm text-(--mk-muted) [overflow-wrap:break-word] [text-wrap:balance]">{m.label}</p>
                    {/* Valori lunghi più piccoli e a capo fra le parole: mai tagliati a metà. */}
                    <p className={`mt-3 font-semibold [overflow-wrap:break-word] ${m.value.length > 12 ? "text-2xl" : "text-3xl"}`}>{m.value}</p>
                  </div>
                ))}
              </div>
            )}
            {section === "table" && page.columns.length > 0 && (
              <>
                {chart >= 0 && (
                  <section aria-label={`Grafico per ${page.columns[chart]}`} className={`${card} mb-6 p-5`}>
                    <h3 className="mb-4 font-semibold">{page.columns[chart]}</h3>
                    <div className="grid gap-2">
                      {chartBars(page.rows, chart).map((bar) => (
                        <div key={bar.label} className="grid grid-cols-[8rem_1fr_2rem] items-center gap-3 text-sm">
                          <span className="truncate">{bar.label}</span>
                          <span className="h-3 rounded bg-(--mk-subtle)">
                            <span className={`block h-3 rounded ${color}`} style={{ width: `${bar.percent}%` }} />
                          </span>
                          <span className="text-right">{bar.count}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <section className={`overflow-hidden ${card}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--mk-divider) p-5">
                    <h3 className="font-semibold">Elenco</h3>
                    <div className="flex flex-wrap gap-3 text-sm">
                      <label>
                        Cerca{" "}
                        <input
                          className={`ml-2 ${field}`}
                          value={table.search}
                          onChange={(e) => setTable({ ...table, search: e.target.value })}
                          placeholder="Cerca nel prototipo"
                        />
                      </label>
                      {statuses.length > 1 && (
                        <label>
                          {page.columns[status]}{" "}
                          <select
                            className={`ml-2 ${field}`}
                            value={table.status}
                            onChange={(e) => setTable({ ...table, status: e.target.value })}
                          >
                            <option value="">Tutti</option>
                            {statuses.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {filters.map((f) => (
                        <label key={f.column}>
                          {f.label}{" "}
                          <select
                            className={`ml-2 ${field}`}
                            value={table.filters?.[String(f.column)] ?? ""}
                            onChange={(e) => setTable({ ...table, filters: { ...table.filters, [String(f.column)]: e.target.value } })}
                          >
                            <option value="">Tutti</option>
                            {f.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                  {view === "table" && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-(--mk-subtle)">
                          <tr>
                            {page.columns.slice(0, tableColumnLimit).map((c, i) => (
                              <th
                                key={i}
                                className="px-5 py-3"
                                aria-sort={table.sort?.column === i ? (table.sort.direction === 1 ? "ascending" : "descending") : undefined}
                              >
                                <button onClick={() => setTable({ ...table, sort: toggleSort(table.sort, i) })}>
                                  {c}
                                  {table.sort?.column === i ? (table.sort.direction === 1 ? " ↑" : " ↓") : ""}
                                </button>
                              </th>
                            ))}
                            <th className="px-5 py-3">Azioni</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(({ row, index }, position) => {
                            // Sfondo sulla riga, bordo colorato sulla prima cella (i browser non disegnano ombre sulle righe).
                            const { boxShadow, ...tone } = rowToneStyle(highlight(row)?.tone ?? null, striped, position);
                            return (
                            <tr key={index} className="border-t border-(--mk-divider)" style={tone}>
                              {row.slice(0, tableColumnLimit).map((cell, i) => (
                                <td key={i} className="px-5 py-4" style={i === 0 && boxShadow ? { boxShadow } : undefined} data-mk-text={columnColor(page, i)}>
                                  {i === 0 && rowBadge(row)}
                                  {cellChecked(cell, i, cellView(cell, i, index))}
                                </td>
                              ))}
                              <td className="px-5 py-4">{actions(index)}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {view === "cards" && (
                    <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
                      {items.map(({ row, index }) => rowCard(row, index))}
                    </div>
                  )}
                  {view === "kanban" && (
                    <div className="grid gap-4 overflow-x-auto p-5 md:grid-flow-col md:auto-cols-[minmax(14rem,1fr)]">
                      {kanbanLanes(page, items).map((lane) => (
                        <section key={lane.status} aria-label={lane.status} className="grid content-start gap-3 rounded-xl bg-(--mk-subtle) p-3">
                          <h4 className="font-semibold">
                            {lane.status} · {lane.items.length}
                          </h4>
                          {lane.items.map(({ row, index }) => rowCard(row, index))}
                        </section>
                      ))}
                    </div>
                  )}
                  {items.length === 0 && (
                    <p className="p-5 text-(--mk-muted)">Nessun elemento trovato.</p>
                  )}
                  {items.length > 0 && detailOnlyColumnCount(page) > 0 && (
                    <p className="border-t border-(--mk-divider) px-5 py-3 text-sm text-(--mk-muted)">
                      Altri {detailOnlyColumnCount(page)} campi in Dettaglio: {page.columns.slice(tableColumnLimit).join(", ")}.
                    </p>
                  )}
                </section>
              </>
            )}
            {section === "form" && replaced !== "form" && page.form.length > 0 && (
              <section className={`mt-6 ${card} p-5`}>
                <h3 className="mb-4 font-semibold">Aggiungi un esempio inventato</h3>
                <form
                  key={page.id}
                  className="grid gap-4 sm:grid-cols-2"
                  onChange={(e) => {
                    const data = new FormData(e.currentTarget);
                    const values = page.form.map((_, i) => String(data.get(`field-${i}`) ?? ""));
                    setFormValues(values);
                    // Un errore già mostrato sparisce appena il campo è corretto.
                    const now = formIssues(page, values);
                    setFormErrors((prev) => Object.fromEntries(Object.keys(prev).filter((k) => now[Number(k)]).map((k) => [k, now[Number(k)]])));
                  }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const data = new FormData(form);
                    const values = page.form.map((_, i) => String(data.get(`field-${i}`) ?? ""));
                    // v9: regole di validazione dei campi visibili; il primo campo sbagliato prende il fuoco.
                    // v11: stessa pipeline di pratica guidata e sportello (prepareFormRow).
                    // Una foto preparata nel modulo è un dato utile anche con i campi vuoti.
                    const { issues, row } = prepareFormRow(page, values, {}, { photos: photosOf(page.id, "new").length > 0 });
                    setFormErrors(issues);
                    const first = Object.keys(issues)[0];
                    if (first !== undefined || !row) {
                      (form.elements.namedItem(`field-${first}`) as HTMLElement | null)?.focus();
                      return;
                    }
                    const pageId = page.id;
                    request({ kind: "add", pageId, rowIndex: page.rows.length, row }, () => {
                      // v10: le foto preparate nel modulo passano alla riga nuova.
                      commitNewPhotos(pageId, row);
                      setPages((current) => current.map((p) => (p.id === pageId ? { ...p, rows: [...p.rows, row] } : p)));
                      setMessage("Esempio aggiunto nella sessione");
                      form.reset();
                      setFormValues([]);
                    });
                  }}
                >
                  {page.form.map((f, i) => {
                    // v9: un campo che compare solo per una certa scelta di un altro campo.
                    if (!fieldVisible(page, i, formValues)) return null;
                    // Tipo del campo riconosciuto dalla colonna, come nell'anteprima di FlowareHub.
                    const kind = fieldOf(page, i);
                    const name = `field-${i}`;
                    const required = fieldRequired(page, i);
                    const error = formErrors[i];
                    const invalid = error ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};
                    return (
                      <label key={i} className={`grid content-start gap-2 text-sm ${kind.kind === "long" ? "sm:col-span-2" : ""}`}>
                        {f}
                        {kind.kind === "choice" ? (
                          <select required={required} name={name} className={field} defaultValue="" {...invalid}>
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
                          <textarea required={required} maxLength={120} rows={3} name={name} className={field} {...invalid} />
                        ) : (
                          <input
                            required={required}
                            {...invalid}
                            maxLength={120}
                            name={name}
                            className={field}
                            autoComplete="off"
                            type={kind.kind === "date" ? "date" : "text"}
                            inputMode={kind.kind === "number" ? "decimal" : undefined}
                          />
                        )}
                        {error && (
                          <span id={`${name}-error`} role="alert" className="text-(--mk-danger)">
                            {error}
                          </span>
                        )}
                      </label>
                    );
                  })}
                  {files.includes("photos") && (
                    <div className="sm:col-span-2">
                      <Suspense fallback={null}>
                        <PhotoAttach pageId={page.id} row="new" />
                      </Suspense>
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <button type="submit" className={`rounded-lg px-5 py-2.5 font-medium ${color}`}>
                      Aggiungi
                    </button>
                  </div>
                </form>
              </section>
            )}
            {sectionsAt(section)}
          </div>
        ))}
        {sectionsAt("bottom")}
        <p role="status" className="mt-5 text-sm text-(--mk-muted)">
          {message}
        </p>
      </main>
      {pendingAction && (
        <PendingConfirm key={`${pendingAction.action.kind}-${pendingAction.action.rowIndex}`} pending={pendingAction} onDone={() => setPendingAction(null)} />
      )}
      {shown && detailMeta && detail && (
        <CustomSlot
          meta={detailMeta}
          props={{ pageId: page.id, rowIndex: detail.index, row: shown, close: () => setDetailState(null) }}
          fallback={builtInDetail}
        />
      )}
      {shown && !detailMeta && builtInDetail}
      {floating.length > 0 && (
        // Gli elementi fissi stanno nel contenitore del template, in basso a destra: un
        // componente non si posiziona da solo (niente fixed, sticky o z-index alti).
        // Misura limitata (al massimo min(40vh, 20rem) di altezza, 20rem di larghezza su un
        // telefono, 24rem dagli schermi più larghi), il resto si taglia; i clic passano
        // attraverso le parti vuote: solo il riquadro del componente li riceve.
        <div
          data-custom-floating
          className="pointer-events-none fixed right-4 bottom-4 z-30 flex max-h-[min(40vh,20rem)] w-[min(20rem,calc(100vw-2rem))] flex-col items-end gap-2 overflow-hidden sm:w-[min(24rem,calc(100vw-2rem))]"
        >
          {floating.map((meta) => (
            <CustomSlot key={meta.name} meta={meta} props={{ pageId: page.id }} fallback={null} />
          ))}
        </div>
      )}
      {agentGatewayOrigin && (
        <Suspense fallback={null}>
          <AgentPanel token={agentToken} bridge={agentBridge} />
        </Suspense>
      )}
    </div>
    </FlowareRuntime.Provider>
  );
}
// v7: conferma di un'azione con il componente su misura; se il componente non si
// carica resta la conferma standard. L'azione parte al massimo una volta.
function PendingConfirm({ pending, onDone }: { pending: { action: CustomAction; apply: () => void; meta: CustomMeta }; onDone: () => void }) {
  const done = useRef(false);
  const confirm = () => {
    if (done.current) return;
    done.current = true;
    pending.apply();
    onDone();
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  const standard = (
    <Dialog title="Confermi?" onClose={cancel} footer={<><Button variant="secondary" onClick={cancel}>Annulla</Button><Button onClick={confirm} autoFocus>Conferma</Button></>}>
      <p>{pending.action.kind === "status" ? `Lo stato passa da «${pending.action.from ?? ""}» a «${pending.action.to ?? ""}».` : pending.action.kind === "remove" ? "L'elemento viene rimosso dalla demo." : "L'esempio viene aggiunto alla demo."}</p>
    </Dialog>
  );
  return <CustomSlot meta={pending.meta} props={{ action: pending.action, confirm, cancel }} fallback={standard} />;
}
createRoot(document.getElementById("root")!).render(<App />);
