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
| `ANTHROPIC_MODEL` | Facoltativa, default `claude-3-5-sonnet-latest` | — |

Nessuna chiave è inclusa nel repository: vanno impostate separatamente da chi effettua il deploy.

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
- Il conteggio pannelli e l&apos;area occupata sono stime (modulo da 530 Wp, densità 0,20 kWp/m²), non un layout reale sul tetto.
