/**
 * Candidates' voice recordings live in the private "recordings" Storage
 * bucket (supabase/migrations/0015_private_recordings.sql). Rows still store
 * the bucket's public-format URL (`…/storage/v1/object/public/recordings/<path>`)
 * — it's only used as a handle for the file's path, never served as is:
 *   - pages get a short-lived signed URL instead (signRecordingUrls);
 *   - server-side replays download the file with the service-role key
 *     (fetchRecording).
 *
 * Server-only (service-role client).
 */

import { getSupabaseServer } from "@/lib/supabase-server";

const BUCKET = "recordings";
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;

/** Long enough to listen to a whole session from one page load. */
const SIGNED_URL_TTL_SECONDS = 2 * 60 * 60;

/** The file's path inside the bucket, or null for a URL that isn't one of ours. */
export function recordingPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const at = url.indexOf(PUBLIC_MARKER);
  if (at === -1) return null;
  return decodeURIComponent(url.slice(at + PUBLIC_MARKER.length).split("?")[0]);
}

/**
 * Signed, expiring URLs for the given stored recording URLs, same order. A
 * URL outside the bucket is returned unchanged; one that can't be signed
 * becomes null (the page just shows no player).
 */
export async function signRecordingUrls(urls: Array<string | null>): Promise<Array<string | null>> {
  const paths = urls.map(recordingPath);
  const toSign = [...new Set(paths.filter((p): p is string => p !== null))];
  if (!toSign.length) return urls;

  const { data, error } = await getSupabaseServer().storage.from(BUCKET).createSignedUrls(toSign, SIGNED_URL_TTL_SECONDS);
  if (error) console.error("[recordings] signing failed:", error.message);
  const signed = new Map((data ?? []).filter((d) => d.path && d.signedUrl && !d.error).map((d) => [d.path!, d.signedUrl]));

  return urls.map((url, i) => {
    const path = paths[i];
    return path === null ? url : (signed.get(path) ?? null);
  });
}

/** A recording's bytes for a server-side replay (pronunciation lab, STT lab). */
export async function fetchRecording(url: string): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const path = recordingPath(url);
  if (path) {
    const { data, error } = await getSupabaseServer().storage.from(BUCKET).download(path);
    if (error || !data) throw new Error(`failed to fetch recording: ${error?.message ?? "no data"}`);
    return { audio: await data.arrayBuffer(), contentType: data.type || "audio/webm;codecs=opus" };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch recording: HTTP ${res.status}`);
  return { audio: await res.arrayBuffer(), contentType: res.headers.get("content-type") || "audio/webm;codecs=opus" };
}
