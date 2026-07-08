import { readFile } from "node:fs/promises";
import { createEnv } from "../src/config/env.js";
import { closeDbPool } from "../src/db/pool.js";
import { DEFAULT_SHIPPING_LINES } from "../src/shipping/default-lines.js";
import { importShippingLines } from "../src/shipping/shipping-line-import.js";
import { createPgShippingRepository } from "../src/shipping/shipping-repository.js";

async function main() {
  const env = createEnv({ requireDatabase: true });
  const repository = createPgShippingRepository(env);
  const filePath = process.argv[2];
  const lines = filePath
    ? JSON.parse(await readFile(filePath, "utf8"))
    : DEFAULT_SHIPPING_LINES;
  const result = await importShippingLines(repository, lines);
  console.log(JSON.stringify({
    imported: result.imported,
    source: filePath || "default",
    first_code: result.codes[0] || null,
    last_code: result.codes.at(-1) || null
  }));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
