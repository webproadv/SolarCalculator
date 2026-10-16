# Procedura: evitare la pausa di Supabase Free (progetti su Vercel)

Un progetto Supabase Free va in pausa dopo 7 giorni senza attività. Soluzione: un cron di Vercel chiama ogni 3 giorni una rotta API del progetto, che esegue una query vera sul database.

## 1. Rotta API `app/api/cron/supabase-keepalive/route.js`
- `GET`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- Controlla `Authorization: Bearer ${process.env.CRON_SECRET}`; se la variabile manca o l'header non coincide risponde 401 (fail-closed).
- Esegue una o due query leggere con la service role key (es. `select("id", { count: "exact", head: true })` su una tabella esistente) e restituisce solo i conteggi.

## 2. `vercel.json`
```json
{ "crons": [ { "path": "/api/cron/supabase-keepalive", "schedule": "0 6 */3 * *" } ] }
```
Se esiste già un `vercel.json`, aggiungere solo la voce in `crons`. Sul piano Hobby sono ammessi cron al massimo una volta al giorno: `*/3` sui giorni del mese va bene (il buco massimo è 3 giorni, anche a cavallo del mese).

## 3. Autenticazione dell'app
Se l'app ha un middleware di login (Clerk, NextAuth…), escludere `/api/cron(.*)` dalle rotte protette: la rotta si autentica da sola con `CRON_SECRET`.

## 4. Variabile d'ambiente su Vercel (una volta per progetto)
Vercel → progetto → Settings → Environment Variables → `CRON_SECRET` = stringa casuale lunga (≥ 24 caratteri, es. `openssl rand -hex 24`), ambiente Production. Poi **redeploy** (le variabili non si applicano ai deploy esistenti). Vercel invierà l'header Bearer automaticamente.

## 5. Verifica
- Vercel → progetto → Settings → Cron Jobs: la voce compare dopo il deploy; il pulsante "Run" la esegue subito. Esito in Logs.
- Da terminale: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<dominio>/api/cron/supabase-keepalive` → `{"ok":true,...}`. Senza header → 401.

## Note
- Se il progetto Supabase è **già in pausa**, il cron non basta: va ripristinato a mano dalla dashboard Supabase (Restore project).
- I cron girano solo sul deploy di produzione.
- Alternativa se un progetto non è su Vercel: GitHub Actions con `schedule` + `curl` sulla REST API di Supabase (`/rest/v1/<tabella>?select=id&limit=1` con la anon key).
