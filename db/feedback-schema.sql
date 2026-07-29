-- Trailward feedback store (spec 29). Run ONCE against your Neon project's
-- database (SQL editor or psql), replacing <choose-a-strong-password>.
--
-- Security model for a backend-less static site: the connection string that
-- ships in the frontend bundle belongs to trailward_writer, which can do
-- EXACTLY ONE thing — insert feedback rows. It cannot read them back, update,
-- delete, or see any other table. Worst case for an abuser is spam inserts
-- (same blast radius as any public form), bounded by the CHECK constraints.

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('feedback', 'suggest-trek')),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  trek_name text CHECK (length(trek_name) <= 200),
  place text CHECK (length(place) <= 200),
  email text CHECK (length(email) <= 200),
  page_url text CHECK (length(page_url) <= 500),
  reviewed boolean NOT NULL DEFAULT false
);

-- The public, insert-only role whose connection string goes into
-- VITE_NEON_FEEDBACK_URL (and the GitHub Actions secret of the same name).
CREATE ROLE trailward_writer WITH LOGIN PASSWORD '<choose-a-strong-password>';
GRANT INSERT ON feedback TO trailward_writer;
-- No SELECT / UPDATE / DELETE, no other tables, no sequences (uuid default).
