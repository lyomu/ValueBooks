CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Local runtime role. Migrations run as the Compose owner (`valuebooks`); the API connects as
-- this restricted role, which is intentionally not a superuser and cannot bypass RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valuebooks_app') THEN
    CREATE ROLE valuebooks_app
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS
      PASSWORD 'valuebooks-app-local';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE valuebooks TO valuebooks_app;
GRANT USAGE ON SCHEMA public TO valuebooks_app;
ALTER DEFAULT PRIVILEGES FOR ROLE valuebooks IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO valuebooks_app;
ALTER DEFAULT PRIVILEGES FOR ROLE valuebooks IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO valuebooks_app;
