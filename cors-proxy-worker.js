/**
 * Generic CORS Proxy - Cloudflare Worker (a cors-anywhere style proxy)
 *
 * What it does: your browser calls this Worker, the Worker fetches the target
 * URL on the server side (where CORS does not apply), adds CORS headers, and
 * sends the result back. It passes through any method (GET, POST, PUT, PATCH,
 * DELETE) and forwards the request body and headers. So it works for plain GET
 * data calls and for JSON POST API calls.
 *
 * How you call it:
 *   https://your-worker.workers.dev/?url=<encoded-target-url>
 * The older "?uri=" spelling also works, to match cors-anywhere forks.
 *
 * The four locks (all optional). Out of the box this file is fully OPEN so it
 * just works. Turn locks on before you rely on it in production:
 *   1. ALLOWED_ORIGINS - which websites may call it. The browser sets the
 *      Origin header and page JavaScript cannot fake it, so this is the main
 *      browser-side lock. "*" means any site may call it.
 *   2. ALLOWED_TARGETS - which destination hosts it is allowed to fetch. "*"
 *      means any URL. Narrowing this is the strongest single control.
 *   3. API_KEY - if you set a Worker secret named API_KEY, every caller must
 *      send a matching X-API-Key header. Good for scripts. For a browser app,
 *      do not hardcode the key in your frontend code - give the user a small
 *      box to paste their own key, which the page then sends as the header.
 *   4. Rate limit - optional Cloudflare rate-limit binding (see wrangler.toml).
 *
 * A free Cloudflare account is enough (100k requests/day). No custom domain
 * needed - you get a free your-name.workers.dev URL. On the free plan the worst
 * case if someone abuses an open proxy is that it stops for the day once the
 * 100k cap is hit. It fails closed. You do not get a surprise bill.
 *
 * Note: Cloudflare Workers cannot fetch private or localhost addresses, so this
 * proxy cannot be pointed at internal networks. It only reaches the public web.
 */

// 1. Which websites may call this proxy. Use ["*"] to allow any site.
//    To lock it to your own apps: ["https://yourapp.com", "https://www.yourapp.com"]
const ALLOWED_ORIGINS = ["*"];

// 2. Which destination hosts this proxy may fetch. Use ["*"] for any URL.
//    To lock it down: ["api.example.com", "query1.finance.yahoo.com"]
const ALLOWED_TARGETS = ["*"];

// Methods passed through to the target.
const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function originAllowed(origin) {
  if (ALLOWED_ORIGINS.includes("*")) return true;
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function targetAllowed(targetUrl) {
  if (ALLOWED_TARGETS.includes("*")) return true;
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    return ALLOWED_TARGETS.some(d => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const open = ALLOWED_ORIGINS.includes("*");
  const headers = {
    "Access-Control-Allow-Origin": open ? "*" : (origin || ""),
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, Accept",
    "Access-Control-Max-Age": "86400",
  };
  if (!open) headers["Vary"] = "Origin";
  return headers;
}

function jsonResponse(obj, status, origin) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    // Answer the browser preflight first.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    // Lock 1: origin allowlist. Reject early so disallowed sites cost nothing.
    if (!originAllowed(origin)) {
      return jsonResponse({ error: "Origin not allowed" }, 403, origin);
    }

    // Lock 3: optional API key (set a Worker secret named API_KEY to turn on).
    if (env && env.API_KEY) {
      if (request.headers.get("X-API-Key") !== env.API_KEY) {
        return jsonResponse({ error: "Missing or invalid X-API-Key" }, 401, origin);
      }
    }

    // Lock 4: optional rate limit (only runs if the binding is configured).
    if (env && env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return jsonResponse({ error: "Rate limit exceeded" }, 429, origin);
    }

    // Read the target URL from ?url= (or ?uri=).
    const reqUrl = new URL(request.url);
    const targetUrl = reqUrl.searchParams.get("url") || reqUrl.searchParams.get("uri");
    if (!targetUrl) {
      return jsonResponse({
        name: "Generic CORS Proxy",
        usage: `${request.method} ${reqUrl.origin}/?url=<encoded-target-url>`,
        note: "Put the target URL, URL-encoded, in the url (or uri) query parameter.",
      }, 400, origin);
    }

    // Lock 2: target allowlist.
    if (!targetAllowed(targetUrl)) {
      return jsonResponse({ error: "Target host not allowed" }, 403, origin);
    }

    // Build the upstream request. Copy method, body, and most headers, but drop
    // headers that should not be forwarded (our own X-API-Key, and the
    // Cloudflare / origin headers the platform adds).
    const upstreamHeaders = new Headers(request.headers);
    ["host", "origin", "referer", "x-api-key",
     "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "x-forwarded-proto"]
      .forEach(h => upstreamHeaders.delete(h));

    const hasBody = !["GET", "HEAD"].includes(request.method);

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: request.method,
        headers: upstreamHeaders,
        body: hasBody ? request.body : undefined,
        redirect: "follow",
      });
    } catch (err) {
      return jsonResponse({ error: "Upstream fetch failed", message: err.message }, 502, origin);
    }

    // Send the response back, adding our CORS headers and removing headers that
    // would block the browser from reading or embedding it.
    const respHeaders = new Headers(upstream.headers);
    const ch = corsHeaders(origin);
    Object.keys(ch).forEach(k => respHeaders.set(k, ch[k]));
    respHeaders.set("Access-Control-Expose-Headers", "*");
    respHeaders.delete("content-security-policy");
    respHeaders.delete("x-frame-options");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};
