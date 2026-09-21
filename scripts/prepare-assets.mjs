import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".dist");
const files = ["index.html", "style.css", "script.js", "favicon.svg", "quantotem-simbolo.svg", "manifest.webmanifest", "service-worker.js"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map(file => copyFile(resolve(root, file), resolve(output, file))));
process.stdout.write(`✓ ${files.length} arquivos preparados em .dist\n`);
