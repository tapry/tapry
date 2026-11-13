// Background blur works out where the person is with MediaPipe, in the browser. Its WebAssembly
// runtime is served by this server (never a CDN: nothing about a session leaves the install), so
// it is copied from the npm package into public/mediapipe/ before `next dev` and `next build`.
// The model (public/models/selfie_segmenter.tflite) is in the repository; see NOTICE.md.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const from = join(dirname(require.resolve("@mediapipe/tasks-vision")), "wasm");
const to = join(root, "public", "mediapipe");

mkdirSync(to, { recursive: true });
for (const name of readdirSync(from)) {
  const source = join(from, name);
  const target = join(to, name);
  // Unchanged files are left alone, so a running dev server doesn't see them move.
  if (existsSync(target) && statSync(target).size === statSync(source).size) continue;
  copyFileSync(source, target);
}
