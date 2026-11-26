import * as esbuild from "esbuild";
import { execFile } from "node:child_process";
import os from "node:os";

function serveUrls(hosts, port) {
  const names = new Set(
    (hosts?.length ? hosts : ["127.0.0.1"]).flatMap((host) => {
      if (host === "0.0.0.0" || host === "::") return ["127.0.0.1"];
      return [host.includes(":") ? `[${host}]` : host];
    }),
  );

  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.internal || net.family !== "IPv4") continue;
      names.add(net.address);
    }
  }

  return [...names].map((host) => `http://${host}:${port}`);
}

const isServe = process.argv.includes("--serve");

function packZip() {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["./pack-zip.js"], (err, stdout, stderr) => {
      if (err) {
        console.error("Error packing zip:", stderr || err);
        reject(err);
        return;
      }
      if (stdout.trim()) console.log(stdout.trim());
      resolve();
    });
  });
}

const zipPlugin = {
  name: "zip-plugin",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) {
        await packZip();
      }
    });
  },
};

const buildConfig = {
  entryPoints: {
    main: "src/main.ts",
  },
  bundle: true,
  minify: true,
  platform: "browser",
  target: ["chrome90"],
  format: "iife",
  logLevel: "info",
  color: true,
  outdir: "dist",
  loader: {
    ".css": "text",
  },
  plugins: [zipPlugin],
};

(async function () {
  if (isServe) {
    console.log("Starting development server...");
    const ctx = await esbuild.context(buildConfig);
    await ctx.watch();
    const { hosts, port } = await ctx.serve({
      servedir: ".",
      port: 3000,
    });
    for (const url of serveUrls(hosts, port)) {
      console.log(`Development server: ${url}/dist.zip`);
    }
  } else {
    console.log("Building for production...");
    await esbuild.build(buildConfig);
    console.log("Production build complete.");
  }
})();
