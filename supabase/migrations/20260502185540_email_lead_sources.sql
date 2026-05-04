-- Extend leads.source CHECK constraint to allow email-channel sources
-- (postmark inbound webhooks and gmail poller). Without this, every
-- inbound email from a new sender fails to create a lead.

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_source_check
  CHECK (source IN (
    'legalmatch', 'nonstop', 'dialpad',
    'gmail', 'postmark',
    'manual', 'website', 'referral'
  ));
