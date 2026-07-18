-- Syria Aviation Portal — flight schedule table
-- Run once in Supabase SQL Editor

create table if not exists flights (
  id             text primary key,
  airport        text not null check (airport in ('ALP', 'DAM')),
  flight_number  text not null,
  icao_callsign  text,
  airline        text not null,
  direction      text not null check (direction in ('arrival', 'departure')),
  origin         text,
  destination    text,
  scheduled_date date not null,
  scheduled_time time not null,
  status         text default 'scheduled',
  gate           text,
  fetched_at     timestamptz default now()
);

create index if not exists idx_flights_date_dir
  on flights (scheduled_date, direction);

create index if not exists idx_flights_callsign
  on flights (icao_callsign) where icao_callsign is not null;

-- Public read (data is not sensitive)
alter table flights enable row level security;

create policy "public read"
  on flights for select using (true);
