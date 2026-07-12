// V2-10-07 — email template variables (pure). Templates use {{var}} placeholders.
// Publishing requires every referenced variable to be declared; rendering
// substitutes provided values and leaves unknown/missing ones empty.

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

// All distinct variable names referenced in a template body/subject.
export function referencedVars(...texts) {
  const set = new Set();
  for (const t of texts) {
    const s = String(t || "");
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(s)) !== null) set.add(m[1]);
  }
  return [...set];
}

// A template is publishable only if every referenced variable is declared.
export function validateTemplate({ subject, body, variables }) {
  const declared = new Set(Array.isArray(variables) ? variables : []);
  const used = referencedVars(subject, body);
  const undeclared = used.filter((v) => !declared.has(v));
  if (undeclared.length > 0) return { ok: false, reason: `undeclared variables: ${undeclared.join(", ")}` };
  return { ok: true };
}

// Render a template with values. Unknown placeholders render as empty strings.
export function render({ subject, body }, values = {}) {
  const sub = (text) => String(text || "").replace(TOKEN_RE, (_, name) => (values[name] != null ? String(values[name]) : ""));
  return { subject: sub(subject), body: sub(body) };
}
