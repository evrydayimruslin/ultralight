# Supabase Migrations

This `supabase/` directory is now the canonical home for Ultralight's platform
database migration history.

## Rules

- Put new platform schema changes in `supabase/migrations/*.sql`.
- Do not add new launch-critical schema changes to root-level
  `migration-*.sql` files.
- The legacy root SQL files now live under `archive/root-migrations/` as
  historical reference only. New schema work should live in
  `supabase/migrations/`.

## Baseline Status

Ultralight's production schema was originally managed by hand in the Supabase
SQL editor. That one-time gap has now been closed: the production schema has
been captured into a checked-in baseline migration, and the fresh staging
project has been bootstrapped from that same baseline.

Current baseline:
- `supabase/migrations/20260418155845_ultralight_prod_baseline.sql`

Future schema work should build on top of that file through new migrations.

## One-Time Baseline Capture Reference

Keep this flow for reference when repeating the process in another environment
or recovering from drift.

1. Log in to the Supabase CLI:
   `supabase login`
   If you do not have the CLI installed globally yet, `npx --yes supabase@latest`
   works too.
2. Export the production project ref and database password:
   `export SUPABASE_PROJECT_ID=<prod-project-ref>`
   `export SUPABASE_DB_PASSWORD=<prod-db-password>`
3. Link the repo to production:
   `supabase link --project-ref "$SUPABASE_PROJECT_ID" -p "$SUPABASE_DB_PASSWORD" --workdir .`
4. Pull the live schema into a baseline migration:
   `supabase db pull ultralight_prod_baseline --linked --workdir .`
5. If the CLI prompts to update the remote migration history table, answer `Y`.
   Supabase recommends syncing that history so future `db push` runs do not try
   to replay the baseline onto production.
6. Commit the generated file from `supabase/migrations/`.

Reference: Supabase's environment guide recommends `supabase db pull` for
existing projects, and their troubleshooting docs note that syncing or
repairing remote migration history may be required after the pull.

## Ongoing Workflow

1. Start local services: `./scripts/supabase/validate-local.sh`
2. Create a migration: `supabase migration new add_feature_name`
3. Edit the generated SQL file in `supabase/migrations/`
4. Re-run `./scripts/supabase/validate-local.sh`
5. Open a PR

## Promotion Model

- Pull requests validate the migration set locally in GitHub Actions.
- Pushes to `main` deploy checked-in migrations to the staging Supabase project.
- Release tags like `v0.1.0` deploy checked-in migrations to production.

## Important Non-SQL Project Setup

Database migrations do not configure everything in Supabase. Staging and
production still need their own project-level settings, including:

- Auth providers and redirect URLs
- Storage buckets and bucket policies
- API keys / JWT secret choices
- Any dashboard-only config that lives outside SQL
