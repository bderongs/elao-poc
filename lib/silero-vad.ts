/**
 * Silero VAD v5 (MIT, github.com/snakers4/silero-vad) run in the browser
 * with onnxruntime-web — the speech-probability source for lib/turn-vad.ts
 * (doc/feature-1-background-noise-plan.md, Part A).
 *
 * Only gives a probability per audio buffer; TurnVad keeps every timing
 * decision (silence budgets, burst merging, barge-in). Deliberately not
 * @ricky0123/vad-web's MicVAD, which brings its own audio graph and its own
 * start/end segmentation that would fight TurnVad's.
 *
 * Model protocol, as in Silero's own Python wrapper (OnnxWrapper): 16 kHz
 * mono, windows of 512 new samples preceded by the previous window's last
 * 64 samples (576 in total), a [2,1,128] recurrent state carried from one
 * window to the next, and `sr` = 16000.
 *
 * Assets are self-hosted under public/vad/ (school networks block CDNs): the
 * model is committed, ORT's .wasm is copied from node_modules by
 * scripts/copy-vad-assets.mjs so it always matches the installed package.
 */

import type * as Ort from "onnxruntime-web";

const MODEL_URL = "/vad/silero_vad_v5.onnx";
/** The .wasm file only, not a folder: given a folder, ORT also fetches its JS
 *  glue from there instead of using the copy bundled into the app (seen
 *  failing in Chrome: "Failed to fetch dynamically imported module"). */
const WASM_URL = "/vad/ort-wasm-simd-threaded.wasm";
const SAMPLE_RATE = 16000;
const WINDOW = 512;
const CONTEXT = 64;

/** What lib/turn-vad.ts needs from a speech classifier. */
export interface SpeechClassifier {
  /** Highest speech probability (0-1) among the model windows this buffer completed. Buffers must arrive in order. */
  probability(float32: Float32Array, sampleRate: number): Promise<number>;
  /** Forget all audio so far (recurrent state, carried samples). */
  reset(): void;
}

let loading: Promise<SileroVad> | null = null;

export class SileroVad implements SpeechClassifier {
  private state: Ort.Tensor;
  private srTensor: Ort.Tensor;
  /** Last CONTEXT samples of the previous window. */
  private context = new Float32Array(CONTEXT);
  /** 16 kHz samples not yet part of a window. */
  private pending = new Float32Array(0);
  /** Resampler position, in input samples relative to the next buffer's start (-1 = the previous buffer's last sample). */
  private resamplePos = 0;
  private resampleTail = 0;
  private lastProb = 0;
  private windows = 0;
  private inferenceMs = 0;

  private constructor(private ort: typeof Ort, private session: Ort.InferenceSession) {
    this.state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    this.srTensor = new ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
  }

  /** Browser: loads ORT (WASM, single thread — threads need cross-origin isolation) and the model, once per page. */
  static load(): Promise<SileroVad> {
    loading ??= (async () => {
      const ort = await import("onnxruntime-web/wasm");
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = { wasm: WASM_URL };
      const res = await fetch(MODEL_URL);
      if (!res.ok) throw new Error(`Silero model: HTTP ${res.status}`);
      return SileroVad.create(ort, new Uint8Array(await res.arrayBuffer()));
    })();
    // A failed load must not stick: the next caller retries.
    loading.catch(() => { loading = null; });
    return loading;
  }

  /** Any runtime (also Node, for offline checks): builds from an ORT module and the model bytes, with one warm-up run. */
  static async create(ort: typeof Ort, model: Uint8Array): Promise<SileroVad> {
    const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    const vad = new SileroVad(ort, session);
    await vad.runWindow(new Float32Array(WINDOW));
    vad.reset();
    return vad;
  }

  reset() {
    this.state = new this.ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    this.context = new Float32Array(CONTEXT);
    this.pending = new Float32Array(0);
    this.resamplePos = 0;
    this.resampleTail = 0;
    this.lastProb = 0;
  }

  /** Mean inference time per 512-sample window (32 ms of audio) since load. */
  stats() {
    return { windows: this.windows, meanInferenceMs: this.windows ? this.inferenceMs / this.windows : 0 };
  }

  async probability(float32: Float32Array, sampleRate: number): Promise<number> {
    const resampled = this.resample(float32, sampleRate);
    const all = new Float32Array(this.pending.length + resampled.length);
    all.set(this.pending);
    all.set(resampled, this.pending.length);

    let max = -1;
    let offset = 0;
    for (; offset + WINDOW <= all.length; offset += WINDOW) {
      max = Math.max(max, await this.runWindow(all.subarray(offset, offset + WINDOW)));
    }
    this.pending = all.slice(offset);
    // A buffer too short to complete a window keeps the last known probability.
    return max < 0 ? this.lastProb : max;
  }

  private async runWindow(window: Float32Array): Promise<number> {
    const input = new Float32Array(CONTEXT + WINDOW);
    input.set(this.context);
    input.set(window, CONTEXT);
    this.context = input.slice(input.length - CONTEXT);

    const t0 = performance.now();
    const out = await this.session.run({
      input: new this.ort.Tensor("float32", input, [1, input.length]),
      state: this.state,
      sr: this.srTensor,
    });
    this.inferenceMs += performance.now() - t0;
    this.windows++;
    this.state = out.stateN as Ort.Tensor;
    this.lastProb = (out.output.data as Float32Array)[0];
    return this.lastProb;
  }

  /** Linear-interpolation resampler to 16 kHz that carries its phase across
   *  buffers. No anti-aliasing filter — the model only needs speech energy
   *  under 8 kHz to be right, not playback fidelity. */
  private resample(input: Float32Array, rate: number): Float32Array {
    if (rate === SAMPLE_RATE) return input;
    const step = rate / SAMPLE_RATE;
    const n = input.length;
    const out = new Float32Array(Math.ceil((n - this.resamplePos) / step) + 1);
    let count = 0;
    let pos = this.resamplePos;
    for (; pos <= n - 1; pos += step) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = i0 < 0 ? this.resampleTail : input[i0];
      const s1 = i0 + 1 < n ? input[i0 + 1] : s0;
      out[count++] = s0 + (s1 - s0) * frac;
    }
    this.resamplePos = pos - n;
    this.resampleTail = input[n - 1];
    return out.subarray(0, count);
  }
}
