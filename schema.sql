-- Database schema for FandomEntryPass

create table if not exists orders (
  id bigserial primary key,
  payment_intent_id text not null,
  amount integer not null,
  currency text not null,
  seller_account text not null,
  buyer_id text,
  status text not null,
  capture_at timestamptz not null,
  created_at timestamptz default now(),
  captured_at timestamptz
);
