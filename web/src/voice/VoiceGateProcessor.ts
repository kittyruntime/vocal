import { Track, type AudioProcessorOptions, type TrackProcessor } from "livekit-client";

export const VOICE_GATE_HOLD_MS = 280;
export function shouldOpenVoiceGate(level: number, threshold: number, now: number, lastActivity: number): boolean {
  return level >= threshold || now - lastActivity < VOICE_GATE_HOLD_MS;
}

export class VoiceGateProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "vocal-threshold-gate";
  processedTrack?: MediaStreamTrack;
  private source?: MediaStreamAudioSourceNode;
  private gain?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;

  async init({ audioContext, track }: AudioProcessorOptions): Promise<void> {
    this.source = audioContext.createMediaStreamSource(new MediaStream([track]));
    this.gain = audioContext.createGain();
    this.destination = audioContext.createMediaStreamDestination();
    this.gain.gain.value = 0;
    this.source.connect(this.gain).connect(this.destination);
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
    this.gain?.disconnect();
    this.processedTrack?.stop();
    this.source = undefined;
    this.gain = undefined;
    this.destination = undefined;
    this.processedTrack = undefined;
  }
}
