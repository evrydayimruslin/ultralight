# Root SQL Migration Archive

These SQL files were moved out of the repo root during Wave 4 launch
hardening.

They are preserved as historical reference only. They are not the canonical
schema source for launch work.

Use [supabase/migrations/](../../supabase/migrations/)
for all new platform schema changes.

Archive rule:

- do not add new `migration-*.sql` files at the repo root
- do not treat these archived files as the active migration chain
- if a historical migration still contains unique context, reference it from
  docs or backfill that context into canonical migrations rather than reviving
  the old root-level workflow
