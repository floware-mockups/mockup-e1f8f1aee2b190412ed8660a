// WZ-2156 (template v10): foto allegate alle righe, solo nella memoria di questa scheda.
// Ogni foto è un Blob locale mostrato con un indirizzo blob: (CSP img-src 'self' blob:):
// nessun caricamento, nessun salvataggio. Ricaricando la pagina o con «Ripristina demo»
// le foto spariscono.
//
// Le foto sono legate a un identificativo stabile della riga, mai alla sua posizione: le
// righe ricevono un numero al caricamento (`useRowIds`), solo in memoria e mai nella
// specifica. Una riga inserita in testa (per esempio «Mostra nella Dashboard»), tolta,
// spostata o modificata da un componente su misura tiene le sue foto.
// Copia identica in shared/mockupKinds/filesPhotos.ts (verificata da un test).
import { useEffect, useRef, useSyncExternalStore } from "react";
import { fileLimits, photoIssue, sniffPhoto } from "./filesBasics.ts";

export type Photo = { id: number; name: string; url: string; size: number };
/** Chiave della riga: il suo identificativo stabile, oppure "new" per il modulo di inserimento. */
export type RowKey = number | "new";
type Store = Map<string, Photo[]>;
let store: Store = new Map();
let version = 0;
let nextId = 1;
// Generazione di ogni chiave: una lettura iniziata prima di un cambio (riga tolta, modulo
// inviato, demo ripristinata) non scrive più nulla quando finisce.
const generations = new Map<string, number>();
let resetGeneration = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  for (const l of listeners) l();
};
const keyOf = (pageId: string, row: RowKey) => `${pageId}#${row}`;
const bump = (key: string) => generations.set(key, (generations.get(key) ?? 0) + 1);
const revoke = (photos: readonly Photo[] | undefined) => {
  for (const p of photos ?? []) {
    try {
      URL.revokeObjectURL(p.url);
    } catch {
      // già revocato
    }
  }
};

export function subscribePhotos(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function photosOf(pageId: string, row: RowKey): Photo[] {
  return store.get(keyOf(pageId, row)) ?? [];
}
/** Foto di una riga, aggiornate quando cambiano. */
export function usePhotos(pageId: string, row: RowKey | undefined): Photo[] {
  useSyncExternalStore(subscribePhotos, () => version);
  return row === undefined ? [] : photosOf(pageId, row);
}

export const photoReadCancelled = "Lettura della foto annullata: nel frattempo la riga è cambiata.";

/**
 * Aggiunge le foto scelte. Ogni lettura è legata a questo invio: se nel frattempo la riga
 * sparisce, il modulo viene inviato o la demo ripristinata, la foto non si aggiunge.
 * Restituisce i messaggi dei file rifiutati (non immagini, troppo grandi, HEIC, annullati).
 */
export async function addPhotos(pageId: string, row: RowKey, files: readonly File[]): Promise<string[]> {
  const issues: string[] = [];
  const key = keyOf(pageId, row);
  const started = { key: generations.get(key) ?? 0, reset: resetGeneration };
  const stale = () => (generations.get(key) ?? 0) !== started.key || resetGeneration !== started.reset;
  const full = () => (store.get(key) ?? []).length >= fileLimits.photosPerRow;
  for (const file of files) {
    if (stale()) {
      issues.push(photoReadCancelled);
      break;
    }
    if (full()) {
      issues.push(`Al massimo ${fileLimits.photosPerRow} foto per riga.`);
      break;
    }
    // La dimensione si controlla prima di leggere il file.
    if (file.size > fileLimits.photoBytes) {
      issues.push(`«${file.name}» è troppo grande: il massimo è 12 MB per foto.`);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (stale()) {
      issues.push(photoReadCancelled);
      break;
    }
    const issue = photoIssue(file.name, bytes);
    if (issue) {
      issues.push(issue);
      continue;
    }
    // Lo stato si rilegge dopo la lettura: nel frattempo una foto può essere stata tolta o aggiunta.
    if (full()) {
      issues.push(`Al massimo ${fileLimits.photosPerRow} foto per riga.`);
      break;
    }
    const type = sniffPhoto(bytes) as string;
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    store = new Map(store);
    store.set(key, [...(store.get(key) ?? []), { id: nextId++, name: file.name.slice(0, 80), url, size: bytes.byteLength }]);
    emit();
  }
  return issues;
}
export function removePhoto(pageId: string, row: RowKey, id: number) {
  const key = keyOf(pageId, row);
  const current = store.get(key) ?? [];
  revoke(current.filter((p) => p.id === id));
  store = new Map(store);
  store.set(key, current.filter((p) => p.id !== id));
  emit();
}

// Foto del modulo in attesa della riga appena inviata (la riga si riconosce dall'oggetto).
let pendingRows = new WeakMap<object, { pageId: string; photos: Photo[] }>();
/**
 * Invio del modulo: le foto preparate passano alla riga `row` (l'array della riga nuova), che
 * riceverà il suo identificativo da `useRowIds`. Le letture ancora in corso si annullano.
 */
export function commitNewPhotos(pageId: string, row: object) {
  const key = keyOf(pageId, "new");
  bump(key);
  const pending = store.get(key);
  if (!pending?.length) return;
  pendingRows.set(row, { pageId, photos: pending });
  store = new Map(store);
  store.delete(key);
  emit();
}
/** Una riga sparita porta via le sue foto e annulla le letture in corso per lei. */
export function dropRowPhotos(pageId: string, row: number) {
  const key = keyOf(pageId, row);
  bump(key);
  if (!store.has(key)) return;
  revoke(store.get(key));
  store = new Map(store);
  store.delete(key);
  emit();
}
/** Foto in attesa per una riga nuova: passano al suo identificativo. */
export function attachPendingPhotos(pageId: string, id: number, row: object) {
  const pending = pendingRows.get(row);
  if (!pending || pending.pageId !== pageId) return;
  pendingRows.delete(row);
  const key = keyOf(pageId, id);
  store = new Map(store);
  store.set(key, [...(store.get(key) ?? []), ...pending.photos]);
  emit();
}
/** «Ripristina demo»: tutte le foto spariscono e le letture in corso si annullano. */
export function clearPhotos() {
  for (const photos of store.values()) revoke(photos);
  store = new Map();
  pendingRows = new WeakMap();
  resetGeneration++;
  emit();
}

// --- Identificativi stabili delle righe ---------------------------------------------

let nextRowId = 1;
// Righe modificate in posizione dal template (riga nuova → riga che sostituisce).
const rowEdits = new WeakMap<object, object>();
/**
 * Il template ha sostituito le righe `before` con `after` modificandole in posizione (oggi
 * «Cambia stato» su una riga): ogni riga cambiata tiene l'identificativo, e le sue foto.
 */
export function noteRowEdit(before: readonly object[], after: readonly object[]) {
  if (before.length !== after.length) return;
  after.forEach((row, i) => {
    if (row !== before[i]) rowEdits.set(row, before[i]);
  });
}
/**
 * Identificativi delle righe dopo un cambio, mai per posizione alla cieca:
 * 1. una riga che resta lo stesso oggetto tiene il suo numero (inserimenti in testa, rimozioni,
 *    spostamenti);
 * 2. una riga nuova con lo stesso contenuto di una riga sparita ne prende il numero (righe
 *    clonate o riordinate da un componente su misura);
 * 3. una riga che il TEMPLATE ha modificato in posizione (oggi «Cambia stato», registrato con
 *    `noteRowEdit`) tiene il numero della riga che sostituisce.
 * Nessuna eredità per posizione negli altri casi: una riga con contenuto diverso (per esempio
 * aggiunta da un componente su misura al posto di una tolta) riceve un numero nuovo, e foto e
 * letture della riga sparita si scartano. Meglio perdere una foto che attaccarla alla pratica
 * sbagliata.
 */
export function reconcileRowIds(
  oldRows: readonly object[],
  oldIds: readonly number[],
  newRows: readonly object[],
  next: () => number,
  editedFrom: (row: object) => object | undefined = (row) => rowEdits.get(row),
): number[] {
  const byRow = new Map<object, number>();
  oldRows.forEach((r, i) => {
    if (!byRow.has(r) && oldIds[i] !== undefined) byRow.set(r, oldIds[i]);
  });
  const used = new Set<number>();
  const ids: (number | undefined)[] = newRows.map((r) => {
    const id = byRow.get(r);
    if (id === undefined || used.has(id)) return undefined;
    used.add(id);
    return id;
  });
  // 2. Stesso contenuto (in ordine, così due righe uguali restano nel loro ordine).
  const content = (r: object) => (Array.isArray(r) ? JSON.stringify(r) : null);
  const free = new Map<string, number[]>();
  oldRows.forEach((r, i) => {
    const key = content(r);
    const id = oldIds[i];
    if (key === null || id === undefined || used.has(id)) return;
    free.set(key, [...(free.get(key) ?? []), id]);
  });
  ids.forEach((id, j) => {
    if (id !== undefined) return;
    const key = content(newRows[j]);
    const candidates = key === null ? undefined : free.get(key);
    const found = candidates?.find((c) => !used.has(c));
    if (found === undefined) return;
    ids[j] = found;
    used.add(found);
  });
  // 3. Righe modificate in posizione dal template: la nuova riga indica quella che sostituisce.
  ids.forEach((id, j) => {
    if (id !== undefined) return;
    const from = editedFrom(newRows[j]);
    const inherited = from === undefined ? undefined : byRow.get(from);
    if (inherited === undefined || used.has(inherited)) return;
    ids[j] = inherited;
    used.add(inherited);
  });
  return ids.map((id) => id ?? next());
}

export type RowPages = readonly { id: string; rows: readonly object[] }[];
export type RowIdState = { pages: RowPages; ids: Map<string, number[]>; vanished: [string, number][]; fresh: [string, number, object][] };
/** Stato degli identificativi dopo un cambio delle pagine (funzione pura, provata dai test). */
export function nextRowIdState(previous: RowIdState | null, pages: RowPages): RowIdState {
  const ids = new Map<string, number[]>();
  const vanished: [string, number][] = [];
  const fresh: [string, number, object][] = [];
  for (const page of pages) {
    const before = previous?.pages.find((p) => p.id === page.id);
    const oldIds = (before && previous?.ids.get(page.id)) || [];
    const known = new Set(oldIds);
    const now = reconcileRowIds(before?.rows ?? [], oldIds, page.rows, () => nextRowId++);
    now.forEach((id, i) => {
      if (!known.has(id)) fresh.push([page.id, id, page.rows[i]]);
    });
    const kept = new Set(now);
    for (const id of oldIds) if (!kept.has(id)) vanished.push([page.id, id]);
    ids.set(page.id, now);
  }
  for (const page of previous?.pages ?? []) if (!pages.some((p) => p.id === page.id)) for (const id of previous?.ids.get(page.id) ?? []) vanished.push([page.id, id]);
  // Effetti del cambio precedente non ancora applicati (due render prima dell'effetto): restano.
  const alive = (pageId: string, id: number) => ids.get(pageId)?.includes(id) ?? false;
  for (const v of previous?.vanished ?? []) if (!alive(v[0], v[1])) vanished.push(v);
  for (const f of previous?.fresh ?? []) if (alive(f[0], f[1])) fresh.push(f);
  return { pages, ids, vanished, fresh };
}
/** Applica gli effetti di un cambio: foto delle righe sparite tolte, foto del modulo alla riga nuova. */
export function applyRowIdChanges(state: RowIdState) {
  for (const [pageId, id] of state.vanished) dropRowPhotos(pageId, id);
  for (const [pageId, id, row] of state.fresh) attachPendingPhotos(pageId, id, row);
  state.vanished = [];
  state.fresh = [];
}
/**
 * Identificativo stabile di ogni riga (pagina, posizione) → numero, solo in memoria. Le foto
 * delle righe sparite si tolgono e quelle del modulo passano alla riga appena aggiunta.
 */
export function useRowIds(pages: RowPages): (pageId: string, index: number) => number | undefined {
  const state = useRef<RowIdState | null>(null);
  if (!state.current || state.current.pages !== pages) state.current = nextRowIdState(state.current, pages);
  const current = state.current;
  useEffect(() => applyRowIdChanges(current), [current]);
  return (pageId, index) => current.ids.get(pageId)?.[index];
}
