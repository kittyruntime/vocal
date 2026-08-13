# Custom stream quality — design

## Goal

Finish stage 2 of the advanced voice/video quality work by allowing users to enter custom numeric settings for microphone audio, webcam video, screen-share video, and screen-share audio. The existing presets remain the default and the current `Advanced mode` switch is the entry point for these controls.

The feature changes settings only. A new selection or value is used the next time the corresponding stream is enabled; it never interrupts or republishes an active stream.

## Scope

The four existing quality selectors gain a `Custom` choice:

- Microphone audio: bitrate.
- Webcam: width, height, frame rate, and bitrate.
- Screen share: width, height, frame rate, and bitrate.
- Screen-share audio: bitrate.

Custom codecs, manual simulcast configuration, automatic bitrate adaptation, and live republishing are out of scope.

## Settings model

The selected-quality types gain a `"custom"` value. Screen share retains its additional `"game"` preset:

```ts
type MediaQuality = "low" | "standard" | "high";
type CustomMediaQuality = MediaQuality | "custom";
type ScreenQuality = MediaQuality | "game";
type CustomScreenQuality = ScreenQuality | "custom";

type CustomAudioSettings = {
  bitrateKbps: number;
};

type CustomVideoSettings = {
  width: number;
  height: number;
  frameRate: number;
  bitrateKbps: number;
};
```

`VoiceSettings` stores four independent custom-value objects alongside the selected qualities. They use these defaults and inclusive limits:

| Stream | Defaults | Limits |
| --- | --- | --- |
| Microphone | 48 kb/s | bitrate 16–320 kb/s |
| Webcam | 1280 × 720, 30 fps, 1700 kb/s | width 320–3840; height 180–2160; 5–60 fps; bitrate 100–20,000 kb/s |
| Screen share | 1920 × 1080, 15 fps, 2500 kb/s | width 640–3840; height 360–2160; 1–60 fps; bitrate 200–30,000 kb/s |
| Screen-share audio | 96 kb/s | bitrate 16–320 kb/s |

The existing `vocal.voice-settings.v1` local-storage key remains in use. Loading treats unknown quality names as the current preset defaults and independently validates every custom number. Missing, non-finite, or out-of-range stored numbers fall back to the corresponding default. This preserves compatibility with old settings and prevents hand-edited storage from reaching LiveKit.

## Profile resolution

The preset records in `web/src/voice/quality.ts` remain immutable and unchanged. Pure resolver functions produce the effective LiveKit profile:

- A preset selection returns its existing profile.
- Custom microphone audio keeps the standard voice capture and publication behavior (mono, echo cancellation, noise suppression, automatic gain control, DTX, and RED) and replaces only `audioPreset.maxBitrate`.
- Custom screen-share audio keeps the existing high-quality system-audio publication behavior (stereo, RED, no DTX) and replaces only `audioPreset.maxBitrate`.
- Custom webcam video maps width, height, and frame rate to `capture.resolution`; maps bitrate and frame rate to `publish.videoEncoding`; and retains simulcast.
- Custom screen video maps width, height, and frame rate to `capture.resolution`; maps bitrate and frame rate to `publish.screenShareEncoding`. Below 30 fps it uses `contentHint: "detail"` and `degradationPreference: "maintain-resolution"`; at 30 fps or above it uses `contentHint: "motion"` and `degradationPreference: "maintain-framerate"`.

Bitrates are displayed and stored in kb/s, then multiplied by 1,000 when building LiveKit options.

All microphone, push-to-talk, camera, and screen-share activation paths call these resolvers. This avoids duplicating custom-option construction in `VoiceView` and ensures that joining a room, toggling media, and pressing push-to-talk use identical settings.

## User interface

When Advanced mode is enabled, `Custom` appears after the existing options in each quality selector. Selecting it renders the associated numeric `TextField` controls directly below that selector, within the current streaming-quality grid. Labels include their unit or dimension, and the fields expose matching `min`, `max`, and `step` attributes.

Advanced mode gates access to the feature, not the saved configuration:

- Turning Advanced mode off hides all custom fields and retains their values.
- If a stream is currently set to Custom, its selector keeps a selected `Custom` option while Advanced mode is off so the UI never displays an invalid or silently changed value.
- While Advanced mode is off, a user may switch that stream back to a visible preset but cannot select Custom again until Advanced mode is re-enabled.

Each custom field keeps a local text draft so users can clear and replace a number naturally. A finite in-range draft is saved immediately. An empty, non-numeric, or out-of-range draft shows an accessible inline error and does not replace the last valid persisted value. On blur, an out-of-range finite number is clamped to the nearest boundary and saved; an empty or non-numeric draft resets visually to the last valid value. Therefore LiveKit always receives the last valid settings.

Changing a selector or a valid custom value while its stream is active displays the existing “applies the next time it is turned on” toast. Screen-share audio is considered active when screen sharing is active. No Apply button and no automatic stream restart are introduced.

## Error handling and compatibility

This feature does not add a new media failure path. The existing device-error messages and the screen-share retry-without-audio behavior remain unchanged. Custom screen-share audio uses the same partial-failure behavior as its preset equivalent: video remains shared if audio publication fails.

Invalid stored data is handled at the settings boundary. Invalid editing drafts are handled at the form boundary. Resolver functions accept validated numeric settings, keeping media activation code free of UI validation concerns.

## Testing

### Unit tests

- Each resolver returns unchanged preset profiles for preset selections.
- Each resolver maps valid custom values to the exact expected LiveKit capture and publication options.
- Custom microphone and screen-share audio retain their distinct mono/stereo and DTX behavior.
- Screen-share custom profiles select the documented detail/motion behavior on either side of 30 fps.
- Settings loading accepts valid custom selections and values, supplies defaults for old storage, and rejects malformed, non-finite, and out-of-range values.

### Component tests

- Custom choices are available in Advanced mode and custom fields appear only for the selected stream.
- Turning Advanced mode off hides custom fields without changing the saved selection or values; a selected Custom option remains representable.
- Invalid drafts expose accessible errors and do not overwrite valid persisted settings; blur performs the documented clamp/reset behavior.
- Valid edits persist and an active matching stream produces the deferred-application toast.
- Joining/toggling the microphone, push-to-talk, webcam, screen share, and screen-share audio sends the exact resolved custom options to the mocked LiveKit client.
- Existing preset and screen-share audio fallback tests continue to pass.

### Final verification

Run the focused tests, the complete web test suite, TypeScript checking, and the production build sequentially. Then inspect the modal in Chromium at desktop and narrow viewport widths, including validation messages and Advanced-mode toggling.
