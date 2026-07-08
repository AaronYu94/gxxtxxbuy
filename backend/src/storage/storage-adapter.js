import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export function createStorageAdapter(env) {
  if (env.storageDriver === "memory") {
    return createMemoryStorageAdapter();
  }
  return createLocalStorageAdapter({
    rootDir: env.storageLocalDir,
    bucket: env.storageBucket
  });
}

export function createLocalStorageAdapter({ rootDir, bucket }) {
  const root = resolve(rootDir || ".data/storage");
  const bucketName = bucket || "goatedbuy-local-private";

  return {
    bucket: bucketName,

    async putObject({ key, body, contentType }) {
      assertStorageKey(key);
      if (!body || !Buffer.isBuffer(body)) {
        throw new Error("Storage upload body must be a Buffer.");
      }
      const filePath = resolve(root, key);
      if (!filePath.startsWith(root)) {
        throw new Error("Storage key resolved outside local storage root.");
      }
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, body);
      await writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType, sizeBytes: body.length }));
      return {
        bucket: bucketName,
        key,
        contentType,
        sizeBytes: body.length
      };
    },

    async getObject({ key }) {
      assertStorageKey(key);
      const filePath = resolve(root, key);
      if (!filePath.startsWith(root)) {
        throw new Error("Storage key resolved outside local storage root.");
      }
      try {
        const [body, metaText] = await Promise.all([
          readFile(filePath),
          readFile(`${filePath}.meta.json`, "utf8").catch(() => "{}")
        ]);
        const meta = JSON.parse(metaText);
        return {
          bucket: bucketName,
          key,
          body,
          contentType: meta.contentType || "application/octet-stream",
          sizeBytes: meta.sizeBytes || body.length
        };
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    }
  };
}

export function createMemoryStorageAdapter() {
  const objects = new Map();
  return {
    bucket: "memory-private",
    objects,
    async putObject({ key, body, contentType }) {
      assertStorageKey(key);
      if (!body || !Buffer.isBuffer(body)) {
        throw new Error("Storage upload body must be a Buffer.");
      }
      objects.set(key, { body, contentType, sizeBytes: body.length });
      return {
        bucket: "memory-private",
        key,
        contentType,
        sizeBytes: body.length
      };
    },
    async getObject({ key }) {
      assertStorageKey(key);
      const object = objects.get(key);
      if (!object) return null;
      return {
        bucket: "memory-private",
        key,
        body: object.body,
        contentType: object.contentType,
        sizeBytes: object.sizeBytes
      };
    }
  };
}

export function assertStorageKey(key) {
  if (!/^[a-z0-9][a-z0-9/_..-]{1,240}$/i.test(String(key || ""))) {
    throw new Error("Storage key is invalid.");
  }
  if (String(key).includes("..")) {
    throw new Error("Storage key cannot contain parent traversal.");
  }
}
