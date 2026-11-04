/**
 * Copies onnxruntime-web's WASM runtime into public/vad/, next to the
 * committed Silero model, so lib/silero-vad.ts loads it from our own origin
 * (school networks block CDNs) and it always matches the installed package.
 * Runs before `dev` and `build`; the copies are gitignored.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/onnxruntime-web/dist");
const dest = join(root, "public/vad");

mkdirSync(dest, { recursive: true });
// The only file onnxruntime-web/wasm fetches: its JS glue is bundled into ort.wasm.bundle.min.mjs.
for (const file of ["ort-wasm-simd-threaded.wasm"]) copyFileSync(join(src, file), join(dest, file));
