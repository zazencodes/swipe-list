// Builds everything the server ships: the dashboard (dist/web), the bundled server and
// admin script, the standalone CLI, and the agent skill tarball.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

execFileSync("npx", ["vite", "build"], { stdio: "inherit" });

const node = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "warning",
  // Some bundled dependencies are CommonJS and call require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};
await build({ ...node, entryPoints: ["src/server/index.ts"], outfile: "dist/server.mjs" });
await build({ ...node, entryPoints: ["src/server/admin.ts"], outfile: "dist/admin.mjs" });
await build({
  ...node,
  sourcemap: false,
  entryPoints: ["src/cli/index.ts"],
  outfile: "dist/swipe.mjs",
  banner: {}, // esbuild keeps the source file's shebang
});
// Plain ustar archive owned by root: no macOS metadata or local uid, which GNU tar on agents chokes on.
// These flags work in both macOS's bsdtar and GNU tar; COPYFILE_DISABLE keeps macOS's metadata out.
execFileSync(
  "tar",
  [
    "--format", "ustar", "--owner", "root:0", "--group", "root:0",
    "-czf", "dist/inspo-swipe-list.tar.gz", "-C", "skill", "inspo-swipe-list",
  ],
  { stdio: "inherit", env: { ...process.env, COPYFILE_DISABLE: "1" } },
);
console.log("built dist/");
