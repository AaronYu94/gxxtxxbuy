import { createPgAccountRepository } from "../src/account/account-repository.js";
import { createAccountService } from "../src/account/account-service.js";
import { createEnv } from "../src/config/env.js";

export async function runAccountDeletionWorker({ env = createEnv({ requireDatabase: true }), once = false, logger = console } = {}) {
  const service = createAccountService({ repository: createPgAccountRepository(env), env });
  let running = true;
  const stop = () => { running = false; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    do {
      const processed = await service.processNextDeletion();
      if (processed) logger.info?.(`Processed account deletion ${processed.id}.`);
      if (once) return processed;
      if (!processed) await new Promise((resolve) => setTimeout(resolve, env.accountDeletionPollMs));
    } while (running);
    return null;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAccountDeletionWorker({ once: process.argv.includes("--once") }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
