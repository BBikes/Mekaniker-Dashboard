-- Migration 014: Set B15 product numbers for all mechanics
-- These are the only item numbers tracked for statistics.
-- VERIFY: Run `SELECT mechanic_name, mechanic_item_no FROM mechanic_item_mapping ORDER BY display_order;`
--         before applying to confirm ILIKE patterns match your actual names.

-- Update existing mechanics to their B15 item numbers
UPDATE public.mechanic_item_mapping SET mechanic_item_no = '2403B15', updated_at = now() WHERE mechanic_name ILIKE '%yasin%';
UPDATE public.mechanic_item_mapping SET mechanic_item_no = '3826B15', updated_at = now() WHERE mechanic_name ILIKE '%max%';
UPDATE public.mechanic_item_mapping SET mechanic_item_no = '0064B15', updated_at = now() WHERE mechanic_name ILIKE '%nick%';
UPDATE public.mechanic_item_mapping SET mechanic_item_no = '0113B15', updated_at = now() WHERE mechanic_name ILIKE '%frederik%';
UPDATE public.mechanic_item_mapping SET mechanic_item_no = '3485B15', updated_at = now() WHERE mechanic_name ILIKE '%mathias%';

-- Upsert Tilbud (BB15): update if row exists by name, otherwise insert
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mechanic_item_mapping WHERE mechanic_name ILIKE '%tilbud%') THEN
    UPDATE public.mechanic_item_mapping
    SET mechanic_item_no = 'BB15', updated_at = now()
    WHERE mechanic_name ILIKE '%tilbud%';
  ELSE
    INSERT INTO public.mechanic_item_mapping (mechanic_name, mechanic_item_no, daily_target_hours, display_order, active)
    VALUES ('Tilbud', 'BB15', 0.00, 99, true);
  END IF;
END;
$$;

-- Sync the denormalized mechanic_item_no field on existing baseline rows
UPDATE public.daily_ticket_item_baselines b
SET mechanic_item_no = m.mechanic_item_no
FROM public.mechanic_item_mapping m
WHERE b.mechanic_id = m.id
  AND b.mechanic_item_no IS DISTINCT FROM m.mechanic_item_no;
