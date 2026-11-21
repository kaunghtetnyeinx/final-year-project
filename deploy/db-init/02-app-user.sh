#!/bin/bash
# Runs once, the first time the MariaDB container starts with an empty data volume.
# Creates the limited user the API connects as: it can read/write rows, but cannot
# drop tables or change the schema.
set -euo pipefail
mariadb --protocol=socket -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS 'pos_app'@'%' IDENTIFIED BY '${POS_APP_DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${MARIADB_DATABASE}\`.* TO 'pos_app'@'%';
FLUSH PRIVILEGES;
SQL
echo "pos_app user created"
