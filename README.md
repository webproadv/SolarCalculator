# SolarCalculator

MVP della webapp di preventivazione fotovoltaica: partendo da Partita IVA, foto della bolletta (fasce F1/F2/F3), spesa annua e kWh consumati, calcola geometria e producibilità del tetto (Google Solar API + PVGIS), dimensiona impianto e accumulo, stima autoconsumo/immesso in rete e il beneficio economico annuo (risparmio + GSE + CER).

Deriva dalla bozza di progetto discussa in chat — vedi lì per architettura completa, formule e roadmap.

## Stato attuale

Questo è un **MVP funzionante in "modalità demo"**: senza le chiavi API configurate, ogni step usa dati di esempio (con banner `DATI DI ESEMPIO` in dashboard) così l'intero flusso — dal form ai risultati — è testabile end-to-end da subito. Con le chiavi configurate (vedi sotto), ogni step passa a dati reali.

PVGIS è l'unica fonte che **funziona già con dati reali senza alcuna configurazione**: non richiede API key.

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

In dashboard, sezione B ("Sito e producibilità"), c'è un bottone **"Genera foto tetto"** che produce due immagini:

1. la foto aerea "pulita" del sito;
2. la stessa foto con sovrimpressi i pannelli dell'impianto proposto (in verde, i primi N per producibilità, N = pannelli stimati dal dimensionamento) e il resto del layout massimo installabile come riferimento (in grigio).

Entrambe derivano dal layer RGB della Google Solar API (`dataLayers.get`, endpoint `/api/roof-image`) e dalla lista pannelli di `buildingInsights` (`quote.roof.solarPanels`) già usata per il dimensionamento — nessuna nuova API da configurare, serve solo `GOOGLE_SOLAR_API_KEY` (la stessa già usata per `/api/solar` e `/api/quote`).

**Nota costi:** a differenza di `buildingInsights` (livello di prezzo "Essentials"), `dataLayers` è nel livello "Enterprise", più caro — per questo il bottone è un'azione a parte e non viene chiamato automaticamente ad ogni preventivo. Verificare il prezzo aggiornato per SKU nella console Google Cloud del progetto prima di un uso in produzione su volumi alti, ed eventualmente impostare un quota/budget cap giornaliero sul progetto.

Se la copertura satellitare Solar API per il sito non è disponibile o di qualità sufficiente, il bottone resta attivo ma la richiesta può fallire (errore mostrato in dashboard); il resto del preventivo (numeri, dimensionamento, economics) non ne risente, perché la generazione immagini è indipendente da `/api/quote`.

## Sviluppo locale

```bash
npm install
npm run dev
```

## Note tecniche

- Next.js 16 (App Router), nessuna dipendenza UI esterna — CSS puro, grafici SVG fatti a mano.
- Le formule di dimensionamento ed economiche sono in `lib/calc.js`, documentate inline.
- Le chiamate alle fonti esterne sono centralizzate in `lib/sources.js`.
- Tariffe GSE (0,0475 €/kWh, valore ufficiale ARERA 2026) e CER (0,075 €/kWh, stima media) sono default configurabili in `lib/calc.js` — non hard-coded nel senso stretto, ma non ancora esposte come impostazione utente in UI (prossimo passo naturale).
- Le percentuali di autoconsumo (`lib/calc.js`, `estimateSelfConsumption`) sono una euristica di partenza basata sul rapporto produzione/consumo, non su un profilo di carico orario reale — da tarare con dati di settore prima di un uso commerciale vincolante.

## Limiti noti (MVP)

- Nessun salvataggio dei preventivi generati (nessun database collegato).
- Nessuna generazione PDF del preventivo.
- Nessuna mappa interattiva per confermare/spostare il pin sull&apos;edificio (solo campi lat/lng editabili).
- Il conteggio pannelli e l&apos;area occupata restano stime aggregate (modulo da 530 Wp, densità 0,20 kWp/m²); la simulazione fotografica del layout (vedi sopra) usa le posizioni candidate calcolate dall&apos;algoritmo di Google, non un progetto elettrico/strutturale reale del tetto.
