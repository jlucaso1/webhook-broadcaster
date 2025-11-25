import { serve } from "bun";
import { watch } from "fs";

const PORT = Number(process.env.PORT) || 3000;

type Routes = Record<string, Array<string>>;

const routesFile = "./routes.json";

let routes: Routes = {};

async function loadConfig() {
  try {
    const file = Bun.file(routesFile);
    if (await file.exists()) {
      const data = await file.json();
      routes = data;
      console.log(`Loaded config with ${Object.keys(routes).length} route(s)`);
      for (const [path, targets] of Object.entries(routes)) {
        console.log(`  ${path} → ${targets.length} target(s)`);
      }
    } else {
      routes = { "/webhook/meta": [] };
      await Bun.write(routesFile, JSON.stringify(routes, null, 2));
      console.log("Created empty routes.json");
    }
  } catch (e) {
    console.error("Failed to load routes.json → using empty config", e);
    routes = {};
  }
}

await loadConfig();

const watcher = watch(routesFile, async (eventType, filename) => {
  if (eventType === "change") {
    console.log("routes.json changed → reloading…");
    await loadConfig();
  }
});

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    const targets = routes[pathname];
    if (!targets || targets.length === 0) {
      return new Response("Not Found", { status: 404 });
    }

    const mainTarget = targets[0];
    if (!mainTarget) {
      return new Response("No main target", { status: 500 });
    }

    const mainPromise = Promise.withResolvers<Response>();

    const mainTargetUrl = mainTarget + url.search;

    // we need to ignore host header to avoid issues
    const headersObj: Record<string, string> = {};

    for (const [key, value] of req.headers.entries()) {
      if (key.toLowerCase() !== "host") {
        headersObj[key] = value;
      }
    }

    fetch(mainTargetUrl, {
      method: req.method,
      headers: headersObj,
      body: req.body,
      signal: AbortSignal.timeout(10_000),
    })
      .then((res) => mainPromise.resolve(res))
      .catch((e) => mainPromise.reject(e));

    targets.slice(1).forEach((target) => {
      try {
        const targetUrl = target + url.search;

        fetch(targetUrl, {
          method: req.method,
          headers: headersObj,
          body: req.body,
          signal: AbortSignal.timeout(10_000),
        }).catch((e) => {
          console.error(`Failed to send to target ${targetUrl}:`, e);
        });
      } catch (err) {}
    });

    try {
      const mainResponse = await mainPromise.promise;

      console.log(
        `Forwarded ${req.method} ${pathname} to ${mainTarget} → ${mainResponse.status}`
      );

      return new Response(mainResponse.body, {
        status: mainResponse.status,
        statusText: mainResponse.statusText,
        headers: mainResponse.headers,
      });
    } catch (e) {
      console.error("Main target request failed:", e);
      return new Response("Main target down", { status: 502 });
    }
  },
});

console.log(`Dynamic webhook broadcaster ready on :${PORT}`);
console.log(`Edit routes.json → changes apply instantly (via fs.watch)`);

process.on("SIGINT", () => {
  watcher.close();
  process.exit();
});

process.on("SIGTERM", () => {
  watcher.close();
  process.exit();
});
