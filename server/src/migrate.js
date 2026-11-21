// Schema migrations. The seed SQL (deploy/db-init) only runs on an EMPTY database volume,
// so every schema change after that lives here and is applied to existing databases too.
//
// Runs as its own short-lived container (pos-migrate in docker-compose.yml) with the
// database admin login: the API's own user (pos_app) can only read and write rows.
// Each migration checks the current schema first, so re-running one is safe.
import bcrypt from "bcryptjs"

const SEEDED_PASSWORD = "Juniper@2026"

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  )
  return rows.length > 0
}
async function columnType(conn, table, column) {
  const [rows] = await conn.query(
    "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  )
  return rows[0]?.DATA_TYPE
}
async function indexExists(conn, table, index) {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    [table, index],
  )
  return rows.length > 0
}
async function constraintExists(conn, table, name) {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?",
    [table, name],
  )
  return rows.length > 0
}
async function addColumn(conn, table, column, definition) {
  if (!(await columnExists(conn, table, column)))
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
}

export const migrations = [
  {
    name: "001_must_change_password",
    // Accounts still on the published seed password, or on a temporary password an admin
    // set, must choose their own password at the next sign-in.
    async up(conn) {
      await addColumn(conn, "users", "must_change_password", "tinyint(1) NOT NULL DEFAULT 0 AFTER `is_active`")
      const [users] = await conn.query("SELECT id, password_hash FROM users")
      for (const user of users) {
        if (await bcrypt.compare(SEEDED_PASSWORD, user.password_hash))
          await conn.query("UPDATE users SET must_change_password = 1 WHERE id = ?", [user.id])
      }
    },
  },
  {
    name: "002_made_to_order_and_decimal_stock",
    // track_stock = 0: made to order (a latte has no shelf count; selling it uses up its
    // recipe's ingredients instead). Stock and movements get 3 decimals, because a recipe
    // can use 0.2 of an egg or 18.5 g of beans.
    async up(conn) {
      await addColumn(conn, "products", "track_stock", "tinyint(1) NOT NULL DEFAULT 1 AFTER `reorder_level`")
      if ((await columnType(conn, "products", "stock_quantity")) !== "decimal")
        await conn.query(
          "ALTER TABLE products MODIFY `stock_quantity` decimal(12,3) NOT NULL DEFAULT 0.000 CHECK (`stock_quantity` >= 0)",
        )
      if ((await columnType(conn, "stock_movements", "quantity_change")) !== "decimal")
        await conn.query("ALTER TABLE stock_movements MODIFY `quantity_change` decimal(12,3) NOT NULL")
      // New movement types: PRODUCTION (a batch is made) and VOID (a cancelled sale is reversed).
      if (await constraintExists(conn, "stock_movements", "chk_movement_type"))
        await conn.query("ALTER TABLE stock_movements DROP CONSTRAINT `chk_movement_type`")
      await conn.query(
        "ALTER TABLE stock_movements ADD CONSTRAINT `chk_movement_type` CHECK (`movement_type` IN ('SALE','PURCHASE','ADJUSTMENT','PRODUCTION','VOID'))",
      )
    },
  },
  {
    name: "003_discount_cash_and_voids",
    async up(conn) {
      await addColumn(conn, "transactions", "discount_reason", "varchar(100) DEFAULT NULL AFTER `discount`")
      await addColumn(conn, "transactions", "cash_received", "decimal(12,2) DEFAULT NULL AFTER `payment_method`")
      await addColumn(conn, "transactions", "voided_by", "int(11) DEFAULT NULL")
      await addColumn(conn, "transactions", "voided_at", "timestamp NULL DEFAULT NULL")
      await addColumn(conn, "transactions", "void_reason", "varchar(200) DEFAULT NULL")
      if (!(await constraintExists(conn, "transactions", "fk_transactions_voided_by")))
        await conn.query(
          "ALTER TABLE transactions ADD CONSTRAINT `fk_transactions_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `users` (`id`)",
        )
    },
  },
  {
    name: "004_product_options",
    // Options such as "Large +RM 2.00" or "Oat milk +RM 1.50". Sold lines keep a copy of
    // the option name and price, so editing an option later never changes old receipts.
    async up(conn) {
      await conn.query(`CREATE TABLE IF NOT EXISTS product_options (
        id int(11) NOT NULL AUTO_INCREMENT,
        product_id int(11) NOT NULL,
        name varchar(60) NOT NULL CHECK (name <> ''),
        price_delta decimal(12,2) NOT NULL DEFAULT 0.00 CHECK (price_delta >= 0),
        sort_order int(11) NOT NULL DEFAULT 0,
        is_active tinyint(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (id),
        KEY fk_options_product (product_id),
        CONSTRAINT fk_options_product FOREIGN KEY (product_id) REFERENCES products (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
      await conn.query(`CREATE TABLE IF NOT EXISTS transaction_item_options (
        id int(11) NOT NULL AUTO_INCREMENT,
        transaction_item_id int(11) NOT NULL,
        option_id int(11) DEFAULT NULL,
        name varchar(60) NOT NULL,
        price_delta decimal(12,2) NOT NULL DEFAULT 0.00,
        PRIMARY KEY (id),
        KEY fk_item_options_item (transaction_item_id),
        CONSTRAINT fk_item_options_item FOREIGN KEY (transaction_item_id) REFERENCES transaction_items (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
    },
  },
  {
    name: "005_unique_category_names",
    async up(conn) {
      if (!(await indexExists(conn, "categories", "uq_categories_name")))
        await conn.query("ALTER TABLE categories ADD UNIQUE KEY `uq_categories_name` (`name`)")
    },
  },
]

/** Applies every migration not yet recorded in schema_migrations, in order. Returns the names applied. */
export async function migrate(pool, log = console.log) {
  const conn = await pool.getConnection()
  try {
    // Two API containers starting together must not migrate at the same time.
    const [[lock]] = await conn.query("SELECT GET_LOCK('juniper_pos_migrate', 120) AS ok")
    if (!lock.ok) throw new Error("Could not get the migration lock")
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name varchar(100) NOT NULL PRIMARY KEY,
      applied_at timestamp NOT NULL DEFAULT current_timestamp()
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
    const [rows] = await conn.query("SELECT name FROM schema_migrations")
    const done = new Set(rows.map((r) => r.name))
    const applied = []
    for (const m of migrations) {
      if (done.has(m.name)) continue
      log(`migration ${m.name}: applying`)
      await m.up(conn)
      await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [m.name])
      applied.push(m.name)
    }
    log(applied.length ? `migrations applied: ${applied.join(", ")}` : "database schema is up to date")
    return applied
  } finally {
    await conn.query("SELECT RELEASE_LOCK('juniper_pos_migrate')").catch(() => {})
    conn.release()
  }
}
