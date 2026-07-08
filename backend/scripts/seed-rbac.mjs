import { createEnv } from "../src/config/env.js";
import { getDbPool, closeDbPool } from "../src/db/pool.js";
import { PERMISSIONS, ROLE_DEFINITIONS } from "../src/rbac/permissions.js";

const env = createEnv({ requireDatabase: true });
const pool = getDbPool(env);

try {
  for (const [code, description] of PERMISSIONS) {
    await pool.query(
      `insert into permissions (code, description)
       values ($1, $2)
       on conflict (code) do update set description = excluded.description`,
      [code, description]
    );
  }

  for (const role of ROLE_DEFINITIONS) {
    const result = await pool.query(
      `insert into roles (code, name, description, is_system)
       values ($1, $2, $3, true)
       on conflict (code) do update
       set name = excluded.name,
           description = excluded.description,
           is_system = true
       returning id`,
      [role.code, role.name, role.description]
    );

    for (const permissionCode of role.permissions) {
      await pool.query(
        `insert into role_permissions (role_id, permission_code)
         values ($1, $2)
         on conflict do nothing`,
        [result.rows[0].id, permissionCode]
      );
    }
  }

  console.log(`RBAC seed ok: ${ROLE_DEFINITIONS.length} roles, ${PERMISSIONS.length} permissions`);
} finally {
  await closeDbPool();
}
