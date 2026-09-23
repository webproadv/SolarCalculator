# SolarCalculator

MVP della webapp di preventivazione fotovoltaica: partendo da Partita IVA, foto della bolletta (fasce F1/F2/F3, consumo annuo e spesa annua), calcola la geometria del tetto (Google Solar API), dimensiona impianto e accumulo, stima autoconsumo/immesso in rete e il beneficio economico annuo (risparmio + vendita energia GSE + CER). Impianto, accumulo e costo proposti restano sempre modificabili a mano in dashboard.

Deriva dalla bozza di progetto discussa in chat — vedi lì per architettura completa, formule e roadmap.

## Flusso applicativo (3 step)

1. **Azienda** — Partita IVA → ragione sociale/indirizzo/coordinate precompilati automaticamente, ma tutti i campi (ragione sociale, indirizzo, CAP, comune, provincia, lat/lng) sono modificabili a mano.
2. **Consumi e spesa** — un'unica schermata: foto della bolletta (lettura automatica di ripartizione F1/F2/F3, consumo annuo e spesa annua, dove leggibili) oppure inserimento manuale dei consumi mese per mese (il totale annuo e la ripartizione F1/F2/F3 si calcolano automaticamente dalla tabella). Nella stessa schermata si inseriscono anche: la spesa energetica annua, la **produzione annuale FV (kWh/kWp)** del sito — inserita manualmente, non calcolata da PVGIS — e i **giorni lavorativi** settimanali dell'azienda (5/6/7), usati per stimare il fabbisogno diurno/notturno. Non c'è uno step successivo che richiede di nuovo questi dati.
3. **Risultati** — dashboard con foto satellitare (generata automaticamente), producibilità dell'impianto, profilo di consumo (F1/F2/F3 e diurno/notturno), dimensionamento impianto/accumulo (editabile), vantaggi economici e dati di partenza.

## Stato attuale

Questo è un **MVP funzionante in "modalità demo"**: senza le chiavi API configurate, ogni step usa dati di esempio (con banner `DATI DI ESEMPIO` in dashboard) così l'intero flusso — dal form ai risultati — è testabile end-to-end da subito. Con le chiavi configurate (vedi sotto), ogni step passa a dati reali.

La produzione dell'impianto (kWh/kWp) si inserisce sempre manualmente (vedi sotto): non richiede alcuna chiave, in modalità demo o reale.

## Variabili d'ambiente

Configurale nel progetto Vercel (Settings → Environment Variables) o in un file `.env.local` in locale.

| Variabile | Serve per | Senza di essa |
|---|---|---|
| `GOOGLE_SOLAR_API_KEY` | Geometria tetto e producibilità aggregata (Google Solar API — Building Insights) **e** geocodifica indirizzo→lat/lng (Google Geocoding API, stessa chiave: va abilitata anche questa API sul progetto) | Usa il rilievo reale di esempio (Mecprogetti Srl, Parma) |
| `APIFY_API_TOKEN` | Lookup ragione sociale/indirizzo da Partita IVA tramite l'actor Apify `dltik/italy-company-registry-scraper` (Registro Imprese/VIES) — fonte preferita | Se assente, si usa `OPENAPI_KEY` come alternativa |
| `OPENAPI_KEY` | Lookup ragione sociale/indirizzo da Partita IVA (openapi.com) — fallback se `APIFY_API_TOKEN` non è configurato | Usa un&apos;azienda di esempio con la P.IVA che hai inserito |
| `ANTHROPIC_API_KEY` | Lettura automatica del grafico F1/F2/F3 dalla foto bolletta (Claude Vision) | L&apos;utente inserisce le percentuali manualmente con gli slider |
| `ANTHROPIC_MODEL` | Facoltativa, default `claude-haiku-4-5-20251001` (rapido ed economico, sufficiente per leggere un grafico a barre) | — |

Nessuna chiave è inclusa nel repository: vanno impostate separatamente da chi effettua il deploy.

## Foto satellitare e simulazione pannelli sul tetto

Appena la dashboard è pronta, l'app genera **automaticamente** (nessun bottone da premere) due immagini a partire dallo stesso layer RGB:

1. la foto aerea "pulita" del sito — mostrata una sola volta, in alto in dashboard (riquadro anagrafica azienda);
2. la stessa foto con sovrimpressi i pannelli dell'impianto proposto (in verde, i primi N per producibilità, N = pannelli stimati dall'impianto suggerito al momento del calcolo) e il resto del layout massimo installabile come riferimento (in grigio) — mostrata nella sezione A ("Producibilità fotovoltaica"). Se l'utente modifica in seguito il campo "Impianto proposto" in dashboard, questa simulazione fotografica non si rigenera automaticamente (il numero di pannelli evidenziati resta quello del valore suggerito iniziale).

Entrambe derivano dal layer RGB della Google Solar API (`dataLayers.get`, endpoint `/api/roof-image`) e dalla lista pannelli di `buildingInsights` (`quote.roof.solarPanels`) già usata per il dimensionamento — nessuna nuova API da configurare, serve solo `GOOGLE_SOLAR_API_KEY` (la stessa già usata per `/api/solar` e `/api/quote`).

**Nota costi:** a differenza di `buildingInsights` (livello di prezzo "Essentials"), `dataLayers` è nel livello "Enterprise", più caro. Essendo generata automaticamente ad ogni preventivo (non più su richiesta esplicita), viene chiamata una volta per ogni preventivo generato con dati reali (non demo). Verificare il prezzo aggiornato per SKU nella console Google Cloud del progetto prima di un uso in produzione su volumi alti, ed eventualmente impostare un quota/budget cap giornaliero sul progetto.

Se la copertura satellitare Solar API per il sito non è disponibile o di qualità sufficiente, la generazione può fallire (errore mostrato in dashboard, con fallback allo schema tetto disegnato); il resto del preventivo (numeri, dimensionamento, economics) non ne risente, perché la generazione immagini è indipendente da `/api/quote`.

## Calcolo di produzione, dimensionamento e fabbisogno diurno/notturno

`/api/quote` **non chiama più PVGIS**: la producibilità specifica annua del sito (kWh/kWp/anno) si inserisce manualmente nello step "Consumi" (tipicamente presa da PVGIS o da una stima già in possesso del commerciale). Tutto il resto si deriva da lì, in `lib/calc.js`:

- **Fabbisogno diurno/notturno** — dai consumi per fascia F1/F2/F3 (in kWh, non solo percentuali) e dai giorni lavorativi dichiarati (`diurnoNotturno`):
  - 5 giorni/settimana: `Diurno = F1`
  - 6 giorni/settimana: `Diurno = F1 + F2 × 0,33`
  - 7 giorni/settimana: `Diurno = F1 + F2 × 0,33 + F3 × 0,5`
  - `Notturno = Totale − Diurno`
- **Impianto proposto (suggerito)** — `sizeSystemFromProduzione`: `Consumo totale annuo ÷ Produzione annuale FV (kWh/kWp)`.
- **Accumulo proposto (suggerito)** — `sizeBatteryFromNotturno`: `Consumo notturno annuo ÷ 365`.
- **Impianto proposto, Accumulo proposto e Costo impianto proposto** sono tre campi editabili in dashboard (sezione B), precompilati con i valori suggeriti sopra ma sempre modificabili: da questi tre valori si ricalcolano in tempo reale produzione, autoconsumo, benefici economici e payback.
- **Produzione mensile dell'impianto** — `monthlyProductionFromShares`: `Produzione annua totale (= produzione FV inserita × impianto proposto)` ripartita secondo un profilo mensile fisso (`MONTHLY_PRODUCTION_SHARES` in `lib/calc.js`): 5% · 5,7% · 8% · 9,8% · 10,5% · 12% · 13% · 11% · 8,7% · 7% · 5,1% · 4,2% (gen→dic, somma 100%).
- **Grafico combinato mensile** (fondo sezione "Vantaggi") — consumi mensili impilati (diurno/notturno) affiancati alla produzione mensile stimata, sulla stessa scala kWh. In modalità "foto bolletta" (nessun dettaglio mensile disponibile) il consumo annuo è distribuito in parti uguali sui 12 mesi; in modalità manuale usa i valori reali della tabella mensile.

La geometria del tetto (Google Solar API `buildingInsights`) resta usata solo come riferimento (area massima disponibile, foto satellitare), non per calcolare la produzione. L'endpoint standalone `/api/pvgis` e le funzioni PVGIS in `lib/sources.js` restano nel codice come utility indipendente, ma non sono più richiamate dal flusso principale.

## Sviluppo locale

```bash
npm install
npm run dev
```

## Note tecniche

- Next.js 16 (App Router), nessuna dipendenza UI esterna — CSS puro, grafici SVG fatti a mano.
- Le formule di dimensionamento ed economiche sono in `lib/calc.js`, documentate inline.
- Le chiamate alle fonti esterne sono centralizzate in `lib/sources.js`.
- Tariffe di vendita energia GSE (0,11 €/kWh) e CER (0,07 €/kWh) sono default configurabili in `lib/calc.js` — non hard-coded nel senso stretto, ma non ancora esposte come impostazione utente in UI (prossimo passo naturale).
- Le percentuali di autoconsumo (`lib/calc.js`, `estimateSelfConsumption`) sono una euristica di partenza basata sul rapporto produzione/consumo, non su un profilo di carico orario reale — da tarare con dati di settore prima di un uso commerciale vincolante.

## Limiti noti (MVP)

- Nessun salvataggio dei preventivi generati (nessun database collegato).
- Nessuna generazione PDF del preventivo.
- Nessuna mappa interattiva per confermare/spostare il pin sull&apos;edificio (solo campi lat/lng editabili).
- Il conteggio pannelli e la superficie utile restano stime aggregate (modulo da 505 Wp, ≈4,1 m²/kWp); la simulazione fotografica del layout (vedi sopra) usa le posizioni candidate calcolate dall&apos;algoritmo di Google, non un progetto elettrico/strutturale reale del tetto.
- La scheda con la geometria di dettaglio dei segmenti di tetto (aree, pitch, azimuth) non è più mostrata in dashboard: resta usata solo internamente per la foto satellitare e la simulazione pannelli.
- In modalità "foto bolletta", la lettura automatica di consumo annuo e spesa annua dipende da quanto è effettivamente leggibile nella foto caricata (molte bollette non riportano un totale annuo esplicito): quando non rilevabili, questi due campi vanno inseriti a mano nella stessa schermata.
- Il grafico combinato mensile consumi/produzione usa, in modalità "foto bolletta", un consumo distribuito in parti uguali sui 12 mesi (nessuna stagionalità): è un'approssimazione dichiarata in dashboard, non un profilo di carico reale. In modalità manuale il grafico riflette invece i valori mensili realmente inseriti.
- La produzione annua specifica (kWh/kWp) è un dato inserito manualmente: la sua accuratezza dipende interamente dalla fonte usata dal commerciale (PVGIS, un altro tool, o una stima) al momento dell'inserimento.
