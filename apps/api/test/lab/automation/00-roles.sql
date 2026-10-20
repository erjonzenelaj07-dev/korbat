-- As the superuser, like infra/postgres/init/01-roles.sh, in a database of its own (pattern of research-3c/gap-G5-lab/00-roles.sql).
CREATE ROLE korbat_migrate LOGIN;
CREATE ROLE korbat_api LOGIN;
CREATE ROLE korbat_auth LOGIN;
CREATE DATABASE lab;
\c lab
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON DATABASE lab TO korbat_migrate;
GRANT ALL ON SCHEMA public TO korbat_migrate;
GRANT USAGE ON SCHEMA public TO korbat_api;
