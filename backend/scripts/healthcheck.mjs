const url = process.env.HEALTHCHECK_URL || "http://127.0.0.1:3000/health";

const response = await fetch(url, {
  headers: {
    "x-request-id": "local-healthcheck"
  }
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`Healthcheck failed: ${response.status} ${body}`);
}

console.log(await response.text());
