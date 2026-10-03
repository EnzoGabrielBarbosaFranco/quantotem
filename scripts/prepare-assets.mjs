import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".dist");
const vendor = resolve(root, "vendor");
const files = ["index.html", "style.css", "script.js", "reports.js", "favicon.svg", "quantotem-simbolo.svg", "manifest.webmanifest", "service-worker.js"];
const libraries = [
  ["jspdf/dist/jspdf.umd.min.js", "jspdf.umd.min.js"],
  ["jspdf-autotable/dist/jspdf.plugin.autotable.min.js", "jspdf.plugin.autotable.min.js"],
  ["jspdf/LICENSE", "jspdf-LICENSE.txt"],
  ["jspdf-autotable/LICENSE.txt", "jspdf-autotable-LICENSE.txt"]
];

// O servidor estático e a versão preparada usam os mesmos arquivos locais.
await mkdir(vendor, { recursive: true });
await Promise.all(libraries.map(([source, filename]) => copyFile(resolve(root, "node_modules", source), resolve(vendor, filename))));

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map(file => copyFile(resolve(root, file), resolve(output, file))));
await cp(resolve(root, "assets"), resolve(output, "assets"), { recursive: true });
await cp(vendor, resolve(output, "vendor"), { recursive: true });
process.stdout.write(`✓ ${files.length} arquivos preparados em .dist\n`);
