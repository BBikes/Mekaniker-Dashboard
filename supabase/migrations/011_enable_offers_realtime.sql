-- Enable Supabase Realtime on the shared offers table so the mechanic
-- dashboard (TV display) can receive live push events when a customer
-- accepts or rejects an offer from the Tilbudsmodul.
--
-- The offers table lives in the shared Supabase project (xhqqiyokwbxpjfiqdnqb)
-- and is owned by the Tilbudsmodul, but both apps share the same database.
-- The anon key already has public read access via the existing RLS policy
-- "Public read on offers", so no additional RLS changes are needed.

alter publication supabase_realtime add table public.offers;
