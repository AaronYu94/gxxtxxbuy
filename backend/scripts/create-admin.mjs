// Bootstrap / reset a backend admin user (the first super_admin, since the console's
// own "create admin" requires an existing admin:manage session).
//
//   node --env-file=.env scripts/create-admin.mjs
//   ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=secret node --env-file=.env scripts/create-admin.mjs
//
// Idempotent: re-running updates the password and re-grants super_admin.
// Note: admin login enforces mandatory TOTP 2FA — on first login the admin console
// walks you through TOTP setup (scan the QR), then issues a session.
import { Pool } from "pg";
import { hashPassword } from "../src/security/password.js";

const email = (process.env.ADMIN_EMAIL || "admin@goatedbuy.com").trim();
const emailNormalized = email.toLowerCase();
const password = process.env.ADMIN_PASSWORD || "admin123";
const displayName = process.env.ADMIN_NAME || "Admin";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (pass --env-file=.env).");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const passwordHash = await hashPassword(password);

  const existing = await pool.query(
    "select id from admin_users where email_normalized = $1 and deleted_at is null limit 1",
    [emailNormalized]
  );

  let adminId;
  if (existing.rows[0]) {
    adminId = existing.rows[0].id;
    await pool.query(
      "update admin_users set password_hash = $2, status = 'enabled', display_name = $3, updated_at = now() where id = $1",
      [adminId, passwordHash, displayName]
    );
    console.log(`Updated existing admin ${email} (${adminId}) — password reset, status=enabled.`);
  } else {
    const inserted = await pool.query(
      `insert into admin_users (email, email_normalized, display_name, password_hash, status)
       values ($1, $2, $3, $4, 'enabled') returning id`,
      [email, emailNormalized, displayName, passwordHash]
    );
    adminId = inserted.rows[0].id;
    console.log(`Created admin ${email} (${adminId}).`);
  }

  const role = await pool.query("select id from roles where code = 'super_admin' limit 1");
  if (!role.rows[0]) throw new Error("super_admin role not found — run `npm run seed:rbac` first.");
  await pool.query(
    "insert into admin_user_roles (admin_user_id, role_id) values ($1, $2) on conflict do nothing",
    [adminId, role.rows[0].id]
  );

  const roles = await pool.query(
    "select r.code from admin_user_roles ur join roles r on r.id = ur.role_id where ur.admin_user_id = $1",
    [adminId]
  );
  console.log(`Roles: ${roles.rows.map((r) => r.code).join(", ")}`);
  console.log(`\nLogin (admin console): email = ${email} · password = ${password}`);
  console.log("First login prompts TOTP 2FA setup (scan QR with an authenticator app).");
} catch (err) {
  console.error("Failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
