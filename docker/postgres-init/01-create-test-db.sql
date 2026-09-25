-- Runs once, on the first start of the Postgres container.
-- The integration tests use their own database, separate from dev data.
CREATE DATABASE contract_mgmt_test OWNER cms;
