import { cp, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });

await Promise.all([
  cp("manifest.json", "dist/manifest.json"),
  cp("src/prompt.html", "dist/prompt.html"),
  cp("src/prompt.css", "dist/prompt.css"),
  cp("src/stats.html", "dist/stats.html"),
  cp("src/stats.css", "dist/stats.css")
]);
