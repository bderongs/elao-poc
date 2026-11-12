/**
 * Copies the integrator API spec (doc/api/openapi.yaml, the one to edit) into
 * public/api-docs/, where it's served next to the Redoc page that renders it
 * (public/api-docs/index.html → /api-docs). Runs before `dev` and `build`;
 * the copy is gitignored.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "public/api-docs");

mkdirSync(dest, { recursive: true });
copyFileSync(join(root, "doc/api/openapi.yaml"), join(dest, "openapi.yaml"));
