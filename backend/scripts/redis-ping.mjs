import { createEnv } from "../src/config/env.js";
import { checkRedis, closeRedisClient } from "../src/queue/redis.js";

const env = createEnv({ requireRedis: true });
const result = await checkRedis(env);
console.log(JSON.stringify(result, null, 2));
await closeRedisClient();

if (!result.ok) {
  process.exitCode = 1;
}
