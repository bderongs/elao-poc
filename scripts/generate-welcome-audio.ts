/**
 * Generates the welcome page's narration (roadmap L-05) for every interface
 * language: public/audio/welcome/<lang>.mp3, and the text hashes in
 * lib/welcome-audio.json that tell the page the audio is current.
 *
 *   npx tsx scripts/generate-welcome-audio.ts            # languages whose text changed
 *   npx tsx scripts/generate-welcome-audio.ts --all      # every language
 *   npx tsx scripts/generate-welcome-audio.ts --lang de  # one language
 *
 * Re-run after any change to the welcome texts in lib/ui-strings.ts (or to
 * SESSION_LENGTH_MODE, which changes the lead): until then the "Listen"
 * button is hidden for that language. Uses the live TTS provider of the
 * matching test language (lib/tts/registry.ts), falling back to Azure, and
 * ffmpeg to turn the 24 kHz PCM into a small MP3.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);

import { UI_LANGS, UI_STRINGS, isUiLang, type UiLang } from "@/lib/ui-strings";
import { WELCOME_VOICE_LANG, narrationHash, welcomeNarration } from "@/lib/welcome-narration";
import { LIVE_TTS_PROVIDER_BY_LANG, getProvider } from "@/lib/tts/registry";

const MANIFEST = "lib/welcome-audio.json";
const OUT_DIR = "public/audio/welcome";
/** Same as the conversation's natural pace (app/api/chat/route.ts NORMAL_RATE); only Azure honours it. */
const RATE = "-3%";

const args = process.argv.slice(2);
const all = args.includes("--all");
const only = args.includes("--lang") ? args[args.indexOf("--lang") + 1] : null;
if (only && !isUiLang(only)) throw new Error(`Unknown interface language: ${only}`);

async function pcmFor(text: string, lang: UiLang): Promise<{ pcm: Buffer; provider: string }> {
  const language = WELCOME_VOICE_LANG[lang];
  for (const id of [...new Set([LIVE_TTS_PROVIDER_BY_LANG[language], "azure"])]) {
    const reader = await getProvider(id).synthesize({ text, language, rate: RATE }).catch(() => null);
    if (!reader) continue;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const pcm = Buffer.concat(chunks);
    if (pcm.length > 24_000) return { pcm, provider: id };
  }
  throw new Error(`No TTS provider produced audio for ${lang}`);
}

async function main() {
  const manifest: Partial<Record<UiLang, string>> = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "welcome-audio-"));
  try {
    for (const lang of only ? [only as UiLang] : UI_LANGS) {
      const text = welcomeNarration(UI_STRINGS[lang]);
      const hash = narrationHash(text);
      if (!all && !only && manifest[lang] === hash && existsSync(join(OUT_DIR, `${lang}.mp3`))) {
        console.log(`${lang}: up to date`);
        continue;
      }
      const { pcm, provider } = await pcmFor(text, lang);
      const raw = join(tmp, `${lang}.pcm`);
      writeFileSync(raw, pcm);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", raw, "-codec:a", "libmp3lame", "-b:a", "48k", join(OUT_DIR, `${lang}.mp3`)]);
      manifest[lang] = hash;
      writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
      console.log(`${lang}: ${provider}, ${(pcm.length / 48_000).toFixed(1)} s`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
