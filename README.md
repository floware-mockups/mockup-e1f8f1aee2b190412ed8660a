# Prototipo pubblico Floware

Interfaccia dimostrativa React/TypeScript/Vite/Tailwind. Tutti i dati sono sintetici.
Nessun backend né autenticazione propri. L'unica connessione è quella dell'assistente
(`src/agent/`) verso il gateway Floware fissato alla build, e solo se il prototipo è
aperto da FlowareHub; senza, l'assistente resta spento e il prototipo funziona come prima.
Non inserire dati personali o riservati. I dati inseriti restano in memoria e scompaiono al reload.
Dal template v10 le pagine con `files` caricano Excel, CSV, PDF, P7M e foto e scaricano PDF e Word
solo nel browser (`src/kinds/Files*`, `src/kinds/file*`): nessun file viene salvato o inviato.

Dal template v11 la specifica può avere un `layout` (cruscotto, bacheca, agenda, mappa, pratica, schede,
fascicolo, sportello, confronto; assente = registro): le viste stanno in `src/layouts` e si caricano a parte.

Dal template v12 la specifica può usare la tavolozza semantica (`colors`, colori di indicatori,
colonne e righe: regole in `src/theme.css`), e la vista `mappa` mostra una mappa vera (Leaflet e
tessere di OpenStreetMap, caricate a parte) con «Apri in Google Maps» per le righe con coordinate.

Con Node 24: `npm ci`, `npm run dev` oppure `npm run build`.
La specifica delle schermate è `src/spec.json`; il renderer e le dipendenze sono controllati dal template `mockup-v1`.
