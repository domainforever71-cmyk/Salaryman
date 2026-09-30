// Cloudflare Worker (used by "Workers & Pages -> Create -> Connect to Git" + `npx wrangler deploy`).
// Cloudflare can't run Flask itself, so the backend runs on a normal host (see
// DEPLOY_CLOUDFLARE.md) and this Worker forwards every request to it.
// Set BACKEND_URL (https://...) under the Worker's Settings -> Variables and Secrets.

export default {
  async fetch(request, env) {
    const backend = String(env.BACKEND_URL || "").trim().replace(/\/+$/, "");
    if (!/^https:\/\//i.test(backend)) {
      return new Response("Astra: BACKEND_URL is not set (must start with https://).", { status: 503 });
    }

    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", url.host);
    headers.set("X-Forwarded-Proto", "https");
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip) headers.set("X-Forwarded-For", ip);

    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    // Static game files rarely change: let Cloudflare cache them briefly at the edge.
    if (request.method === "GET" && url.pathname.startsWith("/static/")) {
      init.cf = { cacheEverything: true, cacheTtl: 300 };
    }

    let upstream;
    try {
      upstream = await fetch(backend + url.pathname + url.search, init);
    } catch (e) {
      return new Response("Astra server is unreachable right now. Try again in a moment.", { status: 502 });
    }

    const out = new Response(upstream.body, upstream);   // keeps multiple Set-Cookie headers
    const loc = out.headers.get("Location");
    if (loc && loc.startsWith(backend)) {
      out.headers.set("Location", url.origin + loc.slice(backend.length));
    }
    return out;
  },
};
