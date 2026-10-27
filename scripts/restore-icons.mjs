import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconNames = ["berta-192.png", "berta-512.png"];

for (const name of iconNames) {
  const base64 = readFileSync(resolve(root, "assets", `${name}.base64`), "utf8").trim();
  const destination = resolve(root, "public/icons", name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, Buffer.from(base64, "base64"));
}

console.log("Berta PWA icons restored.");
