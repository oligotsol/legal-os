-- 20260505141109_firms_vertical.sql
-- Adds the vertical concept to firms. Two columns:
--   vertical      -- top-level industry pack (legal, roofing, medical, hvac, ...)
--   sub_vertical  -- practice area / specialization within the vertical
--
-- Examples:
--   vertical='legal',   sub_vertical='estate_planning'
--   vertical='legal',   sub_vertical='ip'
--   vertical='legal',   sub_vertical='family_law'
--   vertical='roofing', sub_vertical='residential'
--   vertical='medical', sub_vertical='dental'
--
-- Without this, every assumption in code (action types, ethics scanner,
-- intake config, drip cadence) is implicitly law-shaped. Adding the
-- column doesn't migrate those assumptions — that's a separate refactor —
-- but it's the foundation for any vertical-aware branching.

ALTER TABLE firms
  ADD COLUMN IF NOT EXISTS vertical TEXT NOT NULL DEFAULT 'legal',
  ADD COLUMN IF NOT EXISTS sub_vertical TEXT;

CREATE INDEX IF NOT EXISTS idx_firms_vertical ON firms(vertical);

-- Backfill LFL's sub-vertical so it's tagged accurately.
UPDATE firms
   SET sub_vertical = 'estate_planning'
 WHERE id = '00000000-0000-0000-0000-000000000001'
   AND sub_vertical IS NULL;
