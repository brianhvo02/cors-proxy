# Generic CORS Proxy (Cloudflare Worker)

A small Cloudflare Worker that works as a general CORS proxy, in the style of cors-anywhere. Your browser calls the Worker, the Worker fetches the target URL on the server side (where CORS does not apply), adds CORS headers, and sends the result back. It passes through any method, so it works for plain GET data calls and for JSON POST API calls.

You run your own copy. A free Cloudflare account is enough (100k requests per day). No custom domain needed. You get a free `your-name.workers.dev` URL.

## How you call it

Put the target URL, URL-encoded, in the `url` query parameter:

```
https://your-worker.workers.dev/?url=<encoded-target-url>
```

The older `?uri=` spelling also works, to match cors-anywhere forks.

GET example:

```
https://your-worker.workers.dev/?url=https://query1.finance.yahoo.com/v8/finance/chart/AAPL
```

POST example (from browser JavaScript):

```js
fetch("https://your-worker.workers.dev/?url=" + encodeURIComponent("https://api.example.com/data"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ hello: "world" }),
});
```

## The four locks (all optional)

Out of the box this Worker is fully open so it just works. Turn locks on before you rely on it.

1. `ALLOWED_ORIGINS` in the code. Which websites may call it. The browser sets the `Origin` header and page JavaScript cannot fake it, so this is the main browser-side lock. `["*"]` allows any site. To lock it to your own apps, list them: `["https://yourapp.com"]`.
2. `ALLOWED_TARGETS` in the code. Which destination hosts it may fetch. `["*"]` allows any URL. Narrowing this is the strongest single control. If you only proxy one API, list just that host.
3. `API_KEY` as a Worker secret. If you set it, every caller must send a matching `X-API-Key` header. Good for scripts. For a browser app, do not hardcode the key in your frontend code. Give the user a small box to paste their own key, and the page sends it as the header.
4. Rate limit. Optional Cloudflare rate-limit binding. See the commented block in `wrangler.toml`.

A note on origin: "Origin" is the website the request comes from (a domain like `https://yourapp.com`), not anyone's laptop IP. For real browser requests the browser sets it and JavaScript cannot change it, so it is a reliable browser-side filter. It is not foolproof against non-browser callers (a script can send any Origin it likes), so for stronger control add an API key, narrow the target list, or add a rate limit.

A note on safety: Cloudflare Workers cannot fetch private or localhost addresses, so this proxy only reaches the public web. On the free plan, the worst case if an open proxy is abused is that it stops working for the day once the 100k cap is hit. It fails closed. You do not get a surprise bill.

## Deploy

Two ways.

Dashboard, no tools:

1. Go to dash.cloudflare.com and open Workers and Pages, then Create, then Create Worker.
2. Give it a name, click Deploy, then Edit code.
3. Delete the default code, paste in `cors-proxy-worker.js`, click Save and Deploy.
4. Your URL shows at the top: `https://your-name.workers.dev`.

CLI, or let your AI coder do it:

```
CLOUDFLARE_API_TOKEN=your_token npx wrangler deploy
```

You need one Cloudflare API token with "Edit Cloudflare Workers" permission. Create it at dash.cloudflare.com/profile/api-tokens using the "Edit Cloudflare Workers" template.

To turn on the API key lock:

```
npx wrangler secret put API_KEY
```

## Files

- `cors-proxy-worker.js` - the Worker.
- `wrangler.toml` - config, including the optional rate-limit binding.

## Useful posts on CORS

- [CORS Anywhere Alternative: A Free Cloudflare Worker CORS Proxy](https://www.tigzig.com/post/cors-anywhere-alternative-cloudflare-worker) - the full write-up for this repo. A generic, self-hosted cors-anywhere style proxy: any method including POST, any URL, and how to lock it down.
- [Free CORS Proxy for Yahoo Finance and Any API](https://www.tigzig.com/post/fast-tips-what-is-cors-and-how-to-fix-it) - CORS explained simply (preflight, the no-cors trap), plus a simpler GET-only file proxy for GitHub, Google Drive, Dropbox, and Yahoo Finance.

## Author

Built by [Amar Harolikar](https://www.linkedin.com/in/amarharolikar/)

Explore 30+ open source AI tools for analytics, databases & automation at [tigzig.com](https://tigzig.com)
