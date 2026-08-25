import type { Track, AudioProcessorOptions, TrackProcessor } from "livekit-client";
import type { RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";

export const VOICE_GATE_HOLD_MS = 280;
export function shouldOpenVoiceGate(level: number, threshold: number, now: number, lastActivity: number): boolean {
  return level >= threshold || now - lastActivity < VOICE_GATE_HOLD_MS;
}

// LiveKit only allows one processor per track (setProcessor replaces
// whatever was there), so noise reduction is wired into the same processor
// as the VAD gate rather than as a second one: source -> [rnnoise] -> gate
// -> destination, denoising before the gate decides whether to pass
// anything through at all.
export class VoiceGateProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "vocal-threshold-gate";
  processedTrack?: MediaStreamTrack;
  private source?: MediaStreamAudioSourceNode;
  private rnnoise?: RnnoiseWorkletNode;
  private gain?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;

  constructor(private readonly noiseReduction: boolean = false) {}

  async init({ audioContext, track }: AudioProcessorOptions): Promise<void> {
    this.source = audioContext.createMediaStreamSource(new MediaStream([track]));
    this.gain = audioContext.createGain();
    this.destination = audioContext.createMediaStreamDestination();
    this.gain.gain.value = 0;

    let input: AudioNode = this.source;
    if (this.noiseReduction) {
      try {
        // Dynamic: this package's classes extend AudioWorkletNode at
        // module-evaluation time, which doesn't exist in the jsdom test
        // environment -- a static import would crash merely importing this
        // file (and everything that imports it, i.e. all of VoiceView's
        // tests), not just the untestable init() call itself.
        const { createRnnoiseNode } = await import("./noiseReduction");
        this.rnnoise = await createRnnoiseNode(audioContext);
        input.connect(this.rnnoise);
        input = this.rnnoise;
      } catch {
        // Falls back to the plain gate; the mic still works without
        // denoising rather than failing the whole call setup.
      }
    }
    input.connect(this.gain).connect(this.destination);
    this.processedTrack = this.destination.stream.getAudioTracks()[0];
  }

  async restart(options: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(options);
  }

  setOpen(open: boolean): void {
    if (!this.gain) return;
    const now = this.gain.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(open ? 1 : 0, now, open ? 0.008 : 0.035);
  }

  async destroy(): Promise<void> {
    this.source?.disconnect();
    this.rnnoise?.disconnect();
    this.rnnoise?.destroy();
    this.gain?.disconnect();
    this.processedTrack?.stop();
    this.source = undefined;
    this.rnnoise = undefined;
    this.gain = undefined;
    this.destination = undefined;
    this.processedTrack = undefined;
  }
}
