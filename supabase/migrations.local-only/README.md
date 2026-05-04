These four numbered migrations describe the schema as it exists on the
**production** LFL Supabase project (`ebwzrgctrqucqtcrstkq`), but they
were never recorded against that project's `supabase_migrations.schema_migrations`
history.

**Why they're moved aside, not committed as live migrations:**

- The Supabase CLI was originally linked to a different project
  (`gbyaagbqrjsnohntkwlg`, an abandoned staging) and these migrations
  were applied there.
- The live LFL project was bootstrapped through Supabase Studio with a
  separate, timestamp-named migration history (`20260423193135` etc.).
- We re-linked the CLI to the live project on 2026-05-04. New migrations
  written from that point forward live in `supabase/migrations/` with
  timestamp names matching the prod convention.
- Pushing these numbered files via `supabase db push` would attempt to
  re-create tables that already exist on prod, which would fail.

Treat these files as **schema documentation** — they're the source of
truth for what shape the live tables have, even though prod's CLI
migration history is independent. Future schema reconciliation is a
separate cleanup task.
