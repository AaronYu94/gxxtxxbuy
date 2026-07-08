import { createEnv, EnvError } from "./config/env.js";
import { closeDbPool } from "./db/pool.js";
import { closeRedisClient } from "./queue/redis.js";
import { createApp } from "./app.js";

async function main() {
  const env = createEnv();
  const app = createApp({ env });
  const server = app.listen(env.port, () => {
    console.log(
      JSON.stringify({
        level: "info",
        event: "server_started",
        service: env.serviceName,
        port: env.port,
        environment: env.nodeEnv
      })
    );
  });

  const shutdown = async (signal) => {
    console.log(JSON.stringify({ level: "info", event: "server_shutdown", signal }));
    server.close(async () => {
      await Promise.allSettled([closeDbPool(), closeRedisClient()]);
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  if (error instanceof EnvError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
