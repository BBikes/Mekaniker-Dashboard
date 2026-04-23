-- Rename the "today" board title from "I dag" to "I går"
-- The board already shows yesterday's data; the label now matches.
UPDATE dashboard_view_settings
SET board_title = 'I går'
WHERE board_type = 'today'
  AND board_title = 'I dag';
