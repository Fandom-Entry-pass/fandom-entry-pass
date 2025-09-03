create table if not exists listings (
  id uuid primary key,
  "group" text not null,
  date text not null,
  city text,
  seat text,
  face numeric,
  price numeric,
  pay text,
  seller text,
  seller_email text,
  qty integer,
  remaining integer,
  edit_token text,
  manage_code text,
  proof_url text,
  status text default 'pending',
  created_at timestamptz default now()
);
