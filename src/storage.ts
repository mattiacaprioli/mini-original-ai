import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// Archivio dei file originali. Qui è una cartella locale; in produzione la stessa interfaccia
// userebbe S3 (o un object storage svizzero): cambierebbe solo questo file.
const ROOT = process.env.UPLOAD_DIR ?? "uploads";

export async function saveFile(key: string, file: Blob) {
  const path = join(ROOT, key);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, file);
}

export async function readText(key: string) {
  return Bun.file(join(ROOT, key)).text();
}