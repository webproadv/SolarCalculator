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
| `GOOGLE_SOLAR_API_KEY` | Geometria tetto e producibilità aggregata (Google Solar API — Building Insights) **e** geocodifica indirizzo→lat/lng (Google Geocoding API) — stessa chiave: vanno abilitate entrambe le API sul progetto | Usa il rilievo reale di esempio (Mecprogetti Srl, Parma) |
| `MAPBOX_ACCESS_TOKEN` | Foto satellitare del sito (Mapbox Static Images API, stile `satellite-v9`) — vedi sezione dedicata sotto | La foto satellitare non viene generata (errore mostrato in dashboard, con fallback allo schema tetto disegnato); il resto del preventivo non ne risente |
| `APIFY_API_TOKEN` | Lookup ragione sociale/indirizzo da Partita IVA tramite l'actor Apify `dltik/italy-company-registry-scraper` (Registro Imprese/VIES) — fonte preferita | Se assente, si usa `OPENAPI_KEY` come alternativa |
| `OPENAPI_KEY` | Lookup ragione sociale/indirizzo da Partita IVA (openapi.com) — fallback se `APIFY_API_TOKEN` non è configurato | Usa un&apos;azienda di esempio con la P.IVA che hai inserito |
| `ANTHROPIC_API_KEY` | Lettura automatica del grafico F1/F2/F3 dalla foto bolletta (Claude Vision) | L&apos;utente inserisce le percentuali manualmente con gli slider |
| `ANTHROPIC_MODEL` | Facoltativa, default `claude-sonnet-4-5-20250929` (più accurato di un modello Haiku nel leggere bollette con layout e grafici molto variabili) | — |

| `NEXT_PUBLIC_SUPABASE_URL` | URL del progetto Supabase (archivio progetti + whitelist accessi) | L'app non si avvia in modo funzionante: salvataggio/recupero progetti e verifica accessi falliscono |
| `SUPABASE_SERVICE_ROLE_KEY` | Chiave service role Supabase (Settings → API), usata **solo lato server** nelle API route e nel middleware — non è mai esposta al browser | Come sopra |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Chiave pubblica Clerk (autenticazione) | L'app non si avvia: Clerk richiede questa chiave |
| `CLERK_SECRET_KEY` | Chiave segreta Clerk, usata lato server | Come sopra |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Impostare a `/sign-in` (pagina di login personalizzata) | Clerk userebbe l'URL di default, non la pagina del progetto |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Impostare a `/sign-up` (pagina di registrazione personalizzata) | Come sopra |

Nessuna chiave è inclusa nel repository: vanno impostate separatamente da chi effettua il deploy (su Vercel: Settings → Environment Variables).

## Accesso controllato (Clerk) e archivio progetti (Supabase)

L'app è protetta da autenticazione: **nessuna pagina è raggiungibile senza aver effettuato l'accesso** (`middleware.js` la blocca a livello di richiesta, non solo lato interfaccia). Il modello di autorizzazione è "registrazione libera + whitelist email":

1. Chiunque può creare un account con Clerk (`/sign-up`) usando la propria email.
2. Dopo il login, il middleware verifica che l'email dell'utente sia presente nella tabella Supabase `authorized_emails`. Se non lo è, viene mostrata la pagina `/non-autorizzato` (o, per le chiamate API, un errore 403) e l'app resta inaccessibile.
3. Per autorizzare una persona, basta aggiungere una riga nella tabella `authorized_emails` (colonna `email`) dal SQL editor di Supabase — non serve nessuna modifica al codice o un nuovo deploy:
   ```sql
   insert into public.authorized_emails (email, note) values ('nome.cognome@lenergy.it', 'Commerciale');
   ```

Ogni preventivo generato può essere salvato con il pulsante **"💾 Salva progetto"** in dashboard: viene creata una riga nella tabella Supabase `progetti`, con uno snapshot completo di azienda, preventivo, consumi mensili e valori proposti (impianto, accumulo, costo) — pensato anche per la futura funzione di stampa PDF, che potrà leggere questi stessi dati senza richiamare di nuovo le API esterne. La pagina **"📂 I miei progetti"** (in alto, sempre visibile) elenca tutti i progetti salvati da chiunque sia autorizzato — è un archivio condiviso di lavoro, non separato per singolo utente — e permette di riaprirli in dashboard con i valori con cui erano stati salvati.

Lo schema del database si trova in `supabase/migrations/` (compatibile con l'integrazione GitHub di Supabase per la sincronizzazione automatica delle migrazioni: se collegata, basta un push su `main` per applicarlo; in alternativa va incollato manualmente nello SQL editor di Supabase).

## Foto satellitare del sito

Appena la dashboard è pronta, l'app genera **automaticamente** (nessun bottone da premere) una foto aerea del sito, centrata sulle coordinate dell'azienda — mostrata sia in alto in dashboard (riquadro anagrafica azienda) sia nella sezione A ("Producibilità fotovoltaica") sia nel PDF stampabile.

La foto viene presa dalla **Mapbox Static Images API** (stile `satellite-v9`, vista satellitare pura senza etichette; endpoint `/api/roof-image`).

**Perché Mapbox e non Google.** Una versione precedente usava la Google Maps Static API (`maptype=satellite`), ma dall'8 luglio 2025 Google blocca le immagini satellitari/hybrid per i progetti con fatturazione in area EEA (Europa), come adeguamento al Digital Markets Act — la richiesta risponde `403` con `"satellite and hybrid map types are not available for your account and region"` (vedi [Maps Static API adjustments for EEA customers](https://developers.google.com/maps/comms/eea/maps-static) e, per lo stesso motivo, [Map Tiles API adjustments for EEA customers](https://developers.google.com/maps/comms/eea/map-tiles)). Per un account italiano l'unica via che Google lascia aperta per il satellite è lato browser (Maps JavaScript API) o negli SDK nativi Android/iOS — non utilizzabile per generare una singola immagine statica lato server come serve qui (dashboard/PDF). Mapbox non ha questa restrizione ed espone la stessa identica logica (chiamata REST → immagine statica): è quindi il sostituto più diretto, cambia solo il fornitore, non l'architettura.

Ancora prima, la foto veniva presa dal layer RGB della Google Solar API (`dataLayers.get`): quella richiesta è nel livello di prezzo "Enterprise", disponibile solo dove Google ha fatto un rilievo dettagliato dell'edificio, e falliva spesso ("nessun layer RGB disponibile") anche per indirizzi normalmente coperti da satellite. Mapbox ha invece copertura satellitare pressoché ovunque, quindi la foto viene generata anche quando `buildingInsights` non ha un rilievo del tetto per l'indirizzo (`roofDataUnavailable`).

**Configurazione.** Serve un access token Mapbox (separato dalla chiave Google usata per Solar/Geocoding):
1. Crea un account gratuito su [mapbox.com](https://www.mapbox.com/) (il piano gratuito copre circa 50.000 richieste di Static Images API al mese, ben oltre l'uso previsto).
2. In **Account → Tokens** copia il "Default public token" (inizia con `pk.`).
3. Impostalo come variabile d'ambiente `MAPBOX_ACCESS_TOKEN` (su Vercel: Settings → Environment Variables; in locale: `.env.local`).

Nota: una versione ancora precedente disegnava anche i singoli pannelli sovrapposti alla foto; è stata rimossa perché l'allineamento non era affidabile su tutti i siti — la superficie utile per i pannelli si stima dai dati aggregati di `buildingInsights` (area massima/numero pannelli), mostrati in sezione A, non da un disegno pixel-per-pixel.

Se la generazione fallisce comunque (errore di rete, token mancante o non valido, ecc.), l'errore è mostrato in dashboard con fallback allo schema tetto disegnato; il resto del preventivo (numeri, dimensionamento, economics) non ne risente, perché la generazione immagine è indipendente da `/api/quote`.

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

- Ogni "Salva progetto" crea una nuova riga in `progetti` (nessun "aggiorna" esplicito su un progetto esistente): utile come storico automatico delle revisioni per uno stesso cliente, ma l'elenco può accumulare più salvataggi dello stesso preventivo.
- Aprendo un progetto salvato da "I miei progetti", la foto satellitare non viene rigenerata automaticamente (per non consumare quota Mapbox ad ogni apertura): va rigenerato un nuovo preventivo per averla.
- L'archivio progetti è condiviso tra tutti gli utenti autorizzati (non è diviso per singolo utente): adatto a un piccolo team che lavora sugli stessi clienti.
- Nessuna generazione PDF del preventivo (previsto in seguito: i dati necessari sono già salvati per intero nella colonna `dati` di `progetti`).
- Nessuna mappa interattiva per confermare/spostare il pin sull&apos;edificio (solo campi lat/lng editabili).
- Il conteggio pannelli e la superficie utile restano stime aggregate (modulo da 505 Wp, ≈4,1 m²/kWp) dai dati di `buildingInsights`, non un progetto elettrico/strutturale reale del tetto.
- La scheda con la geometria di dettaglio dei segmenti di tetto (aree, pitch, azimuth) non è più mostrata in dashboard: resta usata solo internamente per dimensionare l'inquadratura della foto satellitare.
- In modalità "foto bolletta", la lettura automatica di consumo annuo e spesa annua dipende da quanto è effettivamente leggibile nella foto caricata (molte bollette non riportano un totale annuo esplicito): quando non rilevabili, questi due campi vanno inseriti a mano nella stessa schermata.
- Il grafico combinato mensile consumi/produzione usa, in modalità "foto bolletta", un consumo distribuito in parti uguali sui 12 mesi (nessuna stagionalità): è un'approssimazione dichiarata in dashboard, non un profilo di carico reale. In modalità manuale il grafico riflette invece i valori mensili realmente inseriti.
- La produzione annua specifica (kWh/kWp) è un dato inserito manualmente: la sua accuratezza dipende interamente dalla fonte usata dal commerciale (PVGIS, un altro tool, o una stima) al momento dell'inserimento.
