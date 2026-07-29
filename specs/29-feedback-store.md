# 29 — Feedback store (Neon)

## Purpose

Feedback — above all the spec-28 **name suggestions** — must come back to the maintainer as
queryable data, not vanish. The maintainer's other projects use a dedicated Neon Postgres per
project (see resumefit / vital-mosaic); this adapts that pattern to a **backend-less** static
site.

## Security model (why a DB write from a public bundle is fine)

The browser holds the connection string of **`trailward_writer`**, a role that can do exactly one
thing: `INSERT` into the `feedback` table (`db/feedback-schema.sql`). No SELECT, UPDATE, DELETE,
no other tables, no sequences (uuid PK). Worst case for an abuser is spam inserts — the same blast
radius as any public form — bounded by CHECK length constraints. Reading data back requires the
**owner** connection string, which lives only in the maintainer's environment.

## Mechanics

- **Write path (browser)**: Neon's HTTP SQL endpoint (`https://<endpoint-host>/sql`, the
  @neondatabase/serverless wire format) called with plain `fetch` — no driver, no npm dependency.
  `buildNeonRequest` (pure, tested) derives the endpoint from the connection string and builds the
  parameterised INSERT (kind, message, trek_name, place, email, page_url).
- **Sink preference**: Neon first; **Web3Forms email remains as fallback** when a key is
  configured and Neon fails; a setup hint appears when neither is set.
- **Read path (maintainer)**: `npm run feedback:list` (recent 50) and
  `npm run feedback:list -- --names` (only spec-28 name suggestions, recognised by the `d12-…`
  pin id in the prefill) with `TRAILWARD_DATABASE_URL` set to the owner string. Applied names are
  protected — `build:names` never overwrites a name that no longer starts with "Unnamed".

## One-time setup (maintainer)

1. Create a Neon project (or a branch of an existing one); open the SQL editor.
2. Run `db/feedback-schema.sql` (choose a real password for `trailward_writer`).
3. GitHub → repo → Settings → Secrets → Actions: add **`VITE_NEON_FEEDBACK_URL`** =
   `postgres://trailward_writer:<password>@<endpoint-host>/<db>?sslmode=require`.
4. (Local dev: put the same line in `.env`.) The next Pages deploy picks it up
   (`deploy.yml` passes it to `npm run build`).
5. To read: `TRAILWARD_DATABASE_URL=<owner-string> npm run feedback:list -- --names`.

## Verification

Unit: `buildNeonRequest` (endpoint derivation, header, parameter order), sink preference (Neon
wins; fallback fires only when a key exists; honest error otherwise), `feedbackConfigured`,
readback formatting + name-suggestion recognition. The live write path needs a real Neon project,
so it is verified at setup time via `feedback:list`.
