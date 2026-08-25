import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWasmSimdPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

// The wasm binary (~150-160KB) and the AudioWorklet module registration are
// both reusable across every call/mic-toggle in this tab, so both are
// fetched/registered at most once rather than on every installVoiceGate().
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;
const workletRegisteredOn = new WeakSet<AudioContext>();

function loadWasmBinary(): Promise<ArrayBuffer> {
  wasmBinaryPromise ??= loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseWasmSimdPath });
  return wasmBinaryPromise;
}

async function ensureWorkletRegistered(audioContext: AudioContext): Promise<void> {
  if (workletRegisteredOn.has(audioContext)) return;
  await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);
  workletRegisteredOn.add(audioContext);
}

// RNNoise (xiph/rnnoise via shiguredo/rnnoise-wasm): a small neural-net model
// specifically trained to suppress background noise while preserving speech,
// running in real time inside an AudioWorklet. Assumes a 48kHz AudioContext,
// which is what WebRTC/LiveKit already uses.
export async function createRnnoiseNode(audioContext: AudioContext): Promise<RnnoiseWorkletNode> {
  const [wasmBinary] = await Promise.all([loadWasmBinary(), ensureWorkletRegistered(audioContext)]);
  return new RnnoiseWorkletNode(audioContext, { maxChannels: 1, wasmBinary });
}
