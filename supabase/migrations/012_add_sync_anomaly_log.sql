-- Migration 012: Tilføj sync_anomaly_log tabel
-- Detaljeret log over sync-anomalier per material/mekaniker.
-- Bruges til at identificere og eliminere årsager til manglende kvarterer.

CREATE TABLE IF NOT EXISTS public.sync_anomaly_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  stat_date             date NOT NULL,
  sync_event_id         uuid REFERENCES public.sync_event_log(id) ON DELETE SET NULL,

  -- Ticket og materialeinfo
  ticket_id             bigint NOT NULL,
  ticket_material_id    bigint NOT NULL,
  mechanic_item_no      text NOT NULL,
  mechanic_name         text,

  -- Hvad der var registreret FØR anomalien
  previous_current_qty  numeric(10,2),
  previous_today_added  numeric(10,2),

  -- Resultat af dobbelt-sync verifikation
  -- 'confirmed_missing'   = stadig væk efter dobbelt-sync (reel sletning/fejl)
  -- 'auto_recovered'      = dukkede op igen i dobbelt-sync (API-glitch)
  resolution            text NOT NULL DEFAULT 'confirmed_missing',

  -- Kun udfyldt hvis auto_recovered
  recovered_current_qty numeric(10,2),
  recovered_today_added numeric(10,2),

  -- Fri tekst til debugging
  notes                 text
);

-- Hurtige opslag på dato og mekaniker
CREATE INDEX IF NOT EXISTS sync_anomaly_log_stat_date_idx
  ON public.sync_anomaly_log (stat_date DESC);

CREATE INDEX IF NOT EXISTS sync_anomaly_log_mechanic_idx
  ON public.sync_anomaly_log (mechanic_item_no, stat_date DESC);

-- RLS: kun service-role (admin client) kan skrive og læse
ALTER TABLE public.sync_anomaly_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only"
  ON public.sync_anomaly_log
  USING (false)
  WITH CHECK (false);
