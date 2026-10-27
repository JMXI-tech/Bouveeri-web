export async function api(path, opt = {}) {
  const r = await fetch("/api" + path, { credentials: "same-origin", headers: { "Content-Type": "application/json" },
    ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || "Request failed"), { data: d, status: r.status });
  return d;
}
