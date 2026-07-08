import { createEnv } from "../src/config/env.js";
import { checkDatabase, closeDbPool } from "../src/db/pool.js";

const env = createEnv({ requireDatabase: true });
const result = await checkDatabase(env);
console.log(JSON.stringify(result, null, 2));
await closeDbPool();

if (!result.ok) {
  process.exitCode = 1;
}
