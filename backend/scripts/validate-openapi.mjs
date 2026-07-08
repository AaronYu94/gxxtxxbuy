import { createOpenApiDocument } from "../src/openapi/document.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  const document = createOpenApiDocument({
    serviceName: "goatedbuy-backend",
    appVersion: "0.1.0"
  });
  const errors = validateOpenApiDocument(document);

  if (errors.length) {
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
  } else {
    console.log(`OpenAPI ${document.openapi} ok: ${Object.keys(document.paths).length} paths`);
  }
}

export function validateOpenApiDocument(document) {
  const errors = [];

  if (!document || typeof document !== "object") {
    return ["Document must be an object."];
  }

  if (!/^3\.(0|1)\./.test(document.openapi || "")) {
    errors.push("openapi must be 3.0.x or 3.1.x.");
  }

  if (!document.info?.title || !document.info?.version) {
    errors.push("info.title and info.version are required.");
  }

  if (!document.paths || typeof document.paths !== "object") {
    errors.push("paths object is required.");
    return errors;
  }

  for (const requiredPath of ["/health", "/ready", "/version", "/openapi.json"]) {
    if (!document.paths[requiredPath]) {
      errors.push(`${requiredPath} path is required.`);
    }
  }

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "patch", "delete", "options", "head"].includes(method)) {
        errors.push(`${path}.${method} is not a supported HTTP method.`);
        continue;
      }

      if (!operation.operationId) {
        errors.push(`${method.toUpperCase()} ${path} missing operationId.`);
      }

      if (!operation.responses || !Object.keys(operation.responses).length) {
        errors.push(`${method.toUpperCase()} ${path} missing responses.`);
      }

      for (const [statusCode, response] of Object.entries(operation.responses || {})) {
        if (!/^[1-5][0-9][0-9]$/.test(statusCode)) {
          errors.push(`${method.toUpperCase()} ${path} has invalid status code ${statusCode}.`);
        }
        if (!response.description) {
          errors.push(`${method.toUpperCase()} ${path} ${statusCode} missing description.`);
        }
      }
    }
  }

  const schemas = document.components?.schemas || {};
  for (const [schemaName, schema] of Object.entries(schemas)) {
    validateSchema(schema, `components.schemas.${schemaName}`, errors);
  }

  return errors;
}

function validateSchema(schema, location, errors) {
  if (!schema || typeof schema !== "object") {
    errors.push(`${location} must be an object.`);
    return;
  }

  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/components/schemas/")) {
      errors.push(`${location} has unsupported $ref ${schema.$ref}.`);
    }
    return;
  }

  if (schema.type === "object" && !schema.properties && schema.additionalProperties !== true) {
    errors.push(`${location} object schema should define properties.`);
  }

  for (const [key, child] of Object.entries(schema.properties || {})) {
    validateSchema(child, `${location}.properties.${key}`, errors);
  }

  if (schema.items) {
    validateSchema(schema.items, `${location}.items`, errors);
  }
}
