-- SolarCalculator — schema iniziale: whitelist accessi + archivio progetti.
--
-- Tutte le tabelle sono accedute SOLO dalle API route server-side dell'app
-- (con la service role key, che bypassa la Row Level Security). Il
-- browser non parla mai direttamente con Supabase: per questo la RLS è
-- abilitata ma senza alcuna policy pubblica — di fatto blocca completamente
-- l'accesso da anon/authenticated, lasciando passare solo la service role.

-- ============================================================
-- Whitelist email autorizzate ad usare l'applicazione
-- ============================================================
create table if not exists public.authorized_emails (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.authorized_emails is
  'Elenco delle email autorizzate ad accedere a SolarCalculator (controllato dal middleware Clerk). Aggiungi/rimuovi righe qui per gestire chi può usare l''app.';

alter table public.authorized_emails enable row level security;

-- ============================================================
-- Progetti/preventivi salvati
-- ============================================================
create table if not exists public.progetti (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  creato_da_clerk_user_id text,
  creato_da_email text,

  nome_progetto text,
  piva text,
  ragione_sociale text,
  comune text,
  provincia text,

  -- Colonne "piatte" per ordinare/filtrare velocemente l'elenco progetti
  -- senza dover interrogare il JSON.
  impianto_proposto_kwp numeric,
  accumulo_proposto_kwh numeric,
  costo_impianto_proposto numeric,

  -- Snapshot completo di tutto ciò che serve per ricostruire la dashboard
  -- (azienda, preventivo, tabella mensile, valori proposti) — anche in
  -- vista della futura generazione PDF, senza richiamare le API esterne.
  dati jsonb not null
);

comment on table public.progetti is
  'Archivio dei preventivi fotovoltaici generati con SolarCalculator, con lo snapshot completo dei dati (colonna dati) per riaprire/ristampare il progetto in futuro.';

create index if not exists progetti_created_at_idx on public.progetti (created_at desc);
create index if not exists progetti_piva_idx on public.progetti (piva);

alter table public.progetti enable row level security;
