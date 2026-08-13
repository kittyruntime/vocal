# Custom Stream Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add validated custom bitrate, resolution, and frame-rate controls for microphone, webcam, screen share, and screen-share audio behind the existing Advanced mode.

**Architecture:** Keep the preset tables immutable and resolve preset/custom selections through pure functions in `quality.ts`. Move persisted voice-setting parsing into a focused `settings.ts` module, use a reusable numeric draft field for accessible validation, and make every LiveKit activation path consume the same resolved profiles.

**Tech Stack:** React 19, TypeScript 7, LiveKit Client 2.21, Vitest 4, Testing Library, Vite 8.

## Global Constraints

- Existing preset values and behavior must remain unchanged.
- Custom microphone bitrate is 16–320 kb/s; defaults to 48 kb/s.
- Custom webcam bounds are width 320–3840, height 180–2160, 5–60 fps, and 100–20,000 kb/s; defaults are 1280 × 720, 30 fps, and 1700 kb/s.
- Custom screen-share bounds are width 640–3840, height 360–2160, 1–60 fps, and 200–30,000 kb/s; defaults are 1920 × 1080, 15 fps, and 2500 kb/s.
- Custom screen-share audio bitrate is 16–320 kb/s; defaults to 96 kb/s.
- Bitrates are stored/displayed in kb/s and converted to bits/s only when resolving LiveKit publication options.
- Settings use `vocal.voice-settings.v1`; invalid persisted custom values fall back independently to defaults.
- Changes never restart an active stream and apply on its next activation.
- Advanced mode hides custom controls without deleting values or silently replacing a selected Custom quality.
- Keep the existing screen-share audio capture/publish fallback behavior unchanged.
- Run Vitest, TypeScript, build, and browser checks sequentially because concurrent runs have caused unrelated timer/time-out flakes in this repository.
- After each task: run its focused verification, request a fresh review, commit only that task, and push the branch.

## File Structure

- Modify `web/src/voice/quality.ts`: quality-selection types, custom defaults/limits, and pure LiveKit profile resolvers.
- Modify `web/src/voice/quality.test.ts`: exact resolver behavior and preset regressions.
- Create `web/src/voice/settings.ts`: `VoiceSettings`, defaults, stored-data validation, and loading.
- Create `web/src/voice/settings.test.ts`: old/malformed/custom local-storage parsing coverage.
- Create `web/src/voice/CustomNumberField.tsx`: local numeric draft and accessible validation/blur normalization.
- Create `web/src/voice/CustomNumberField.test.tsx`: draft, commit, clamp, and reset behavior.
- Modify `web/src/voice/VoiceView.tsx`: settings/UI integration and resolver use at every activation point.
- Modify `web/src/voice/VoiceView.test.tsx`: visibility, persistence, deferred application, and mocked LiveKit integration.
- Modify `web/src/index.css`: compact responsive layout for custom controls.
- Modify `ROADMAP.md`: move stage 2 from Next steps to Delivered lots only after verification.

---

### Task 1: Pure custom LiveKit profile resolution

**Files:**
- Modify: `web/src/voice/quality.ts`
- Test: `web/src/voice/quality.test.ts`

**Interfaces:**
- Produces: `CustomMediaQuality`, `CustomScreenQuality`, `CustomAudioSettings`, `CustomVideoSettings`.
- Produces: `customQualityDefaults` and `customQualityLimits` with the exact global-constraint values.
- Produces: `resolveAudioProfile(quality, custom, source)`, `resolveCameraProfile(quality, custom)`, and `resolveScreenProfile(quality, custom)`.
- `source` is exactly `"microphone" | "screenShare"` so custom microphone uses the standard mono voice base and custom screen audio uses the high stereo base.

- [ ] **Step 1: Add failing resolver tests**

Append imports and tests with these exact expectations:

```ts
import {
  audioProfiles,
  cameraProfiles,
  customQualityDefaults,
  resolveAudioProfile,
  resolveCameraProfile,
  resolveScreenProfile,
  screenProfiles,
} from "./quality";

it("returns existing preset objects unchanged", () => {
  expect(resolveAudioProfile("low", { bitrateKbps: 64 }, "microphone")).toBe(audioProfiles.low);
  expect(resolveCameraProfile("high", customQualityDefaults.camera)).toBe(cameraProfiles.high);
  expect(resolveScreenProfile("game", customQualityDefaults.screen)).toBe(screenProfiles.game);
});

it("builds distinct custom microphone and screen-audio profiles", () => {
  expect(resolveAudioProfile("custom", { bitrateKbps: 80 }, "microphone")).toMatchObject({
    capture: { channelCount: 1 },
    publish: { audioPreset: { maxBitrate: 80_000 }, dtx: true, red: true, forceStereo: false },
  });
  expect(resolveAudioProfile("custom", { bitrateKbps: 160 }, "screenShare")).toMatchObject({
    publish: { audioPreset: { maxBitrate: 160_000 }, dtx: false, red: true, forceStereo: true },
  });
});

it("builds a custom simulcast webcam profile", () => {
  expect(resolveCameraProfile("custom", { width: 2560, height: 1440, frameRate: 50, bitrateKbps: 9000 })).toEqual({
    label: "Custom",
    detail: "2560×1440 · 50 fps · 9000 kb/s",
    capture: { resolution: { width: 2560, height: 1440, frameRate: 50 } },
    publish: { videoEncoding: { maxBitrate: 9_000_000, maxFramerate: 50 }, simulcast: true },
  });
});

it("changes custom screen-share strategy at 30 fps", () => {
  expect(resolveScreenProfile("custom", { width: 1600, height: 900, frameRate: 29, bitrateKbps: 4000 })).toMatchObject({
    capture: { audio: true, resolution: { width: 1600, height: 900, frameRate: 29 }, contentHint: "detail" },
    publish: { screenShareEncoding: { maxBitrate: 4_000_000, maxFramerate: 29 }, degradationPreference: "maintain-resolution" },
  });
  expect(resolveScreenProfile("custom", { width: 1920, height: 1080, frameRate: 30, bitrateKbps: 6000 })).toMatchObject({
    capture: { contentHint: "motion" },
    publish: { degradationPreference: "maintain-framerate" },
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm --prefix web test -- src/voice/quality.test.ts`

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement the types, constants, and resolvers**

Add these public shapes in `quality.ts`:

```ts
export type CustomMediaQuality = MediaQuality | "custom";
export type CustomScreenQuality = ScreenQuality | "custom";
export type CustomAudioSettings = { bitrateKbps: number };
export type CustomVideoSettings = { width: number; height: number; frameRate: number; bitrateKbps: number };

export const customQualityDefaults = {
  audio: { bitrateKbps: 48 },
  camera: { width: 1280, height: 720, frameRate: 30, bitrateKbps: 1700 },
  screen: { width: 1920, height: 1080, frameRate: 15, bitrateKbps: 2500 },
  screenAudio: { bitrateKbps: 96 },
} as const;

export const customQualityLimits = {
  audio: { bitrateKbps: { min: 16, max: 320, step: 8 } },
  camera: {
    width: { min: 320, max: 3840, step: 1 }, height: { min: 180, max: 2160, step: 1 },
    frameRate: { min: 5, max: 60, step: 1 }, bitrateKbps: { min: 100, max: 20_000, step: 100 },
  },
  screen: {
    width: { min: 640, max: 3840, step: 1 }, height: { min: 360, max: 2160, step: 1 },
    frameRate: { min: 1, max: 60, step: 1 }, bitrateKbps: { min: 200, max: 30_000, step: 100 },
  },
  screenAudio: { bitrateKbps: { min: 16, max: 320, step: 8 } },
} as const;
```

Implement the resolver signatures exactly:

```ts
export function resolveAudioProfile(
  quality: CustomMediaQuality,
  custom: CustomAudioSettings,
  source: "microphone" | "screenShare",
): QualityProfile<AudioCaptureOptions>;

export function resolveCameraProfile(
  quality: CustomMediaQuality,
  custom: CustomVideoSettings,
): QualityProfile<VideoCaptureOptions>;

export function resolveScreenProfile(
  quality: CustomScreenQuality,
  custom: CustomVideoSettings,
): QualityProfile<ScreenShareCaptureOptions>;
```

For preset inputs, return the table entry by identity. For Custom, clone the documented standard/high base options, override only the specified fields, and generate the exact detail strings asserted above.

- [ ] **Step 4: Run quality tests and typecheck**

Run sequentially:

```bash
npm --prefix web test -- src/voice/quality.test.ts
npm --prefix web run typecheck
```

Expected: both PASS.

- [ ] **Step 5: Review, commit, and push Task 1**

After review approval:

```bash
git add web/src/voice/quality.ts web/src/voice/quality.test.ts
git commit -m "feat(voice): resolve custom media quality profiles"
git push origin HEAD
```

---

### Task 2: Persisted settings parsing and validation

**Files:**
- Create: `web/src/voice/settings.ts`
- Create: `web/src/voice/settings.test.ts`
- Modify: `web/src/voice/VoiceView.tsx`

**Interfaces:**
- Consumes the custom types, defaults, and limits from Task 1.
- Produces `DeviceSelections`, `SETTINGS_KEY`, `VoiceSettings`, `DEFAULT_VOICE_SETTINGS`, and `loadVoiceSettings(storage?: Pick<Storage, "getItem">): VoiceSettings`.
- `VoiceView` continues to own state updates/local-storage writes; this module owns only defaults and safe reads.

- [ ] **Step 1: Write failing settings tests**

Create `settings.test.ts` with a `storageFor(value)` helper returning `{ getItem: () => value }`, then assert:

```ts
it("loads old settings with custom defaults", () => {
  const settings = loadVoiceSettings(storageFor(JSON.stringify({ advancedMode: true })));
  expect(settings).toMatchObject({
    advancedMode: true,
    audioQuality: "standard",
    cameraQuality: "standard",
    screenQuality: "standard",
    screenAudioQuality: "high",
    customAudio: { bitrateKbps: 48 },
    customCamera: { width: 1280, height: 720, frameRate: 30, bitrateKbps: 1700 },
    customScreen: { width: 1920, height: 1080, frameRate: 15, bitrateKbps: 2500 },
    customScreenAudio: { bitrateKbps: 96 },
  });
});

it("accepts complete valid custom settings", () => {
  const settings = loadVoiceSettings(storageFor(JSON.stringify({
    audioQuality: "custom", cameraQuality: "custom", screenQuality: "custom", screenAudioQuality: "custom",
    customAudio: { bitrateKbps: 64 },
    customCamera: { width: 1920, height: 1080, frameRate: 60, bitrateKbps: 8000 },
    customScreen: { width: 2560, height: 1440, frameRate: 30, bitrateKbps: 12000 },
    customScreenAudio: { bitrateKbps: 192 },
  })));
  expect(settings.audioQuality).toBe("custom");
  expect(settings.customCamera).toEqual({ width: 1920, height: 1080, frameRate: 60, bitrateKbps: 8000 });
  expect(settings.customScreenAudio.bitrateKbps).toBe(192);
});

it("falls back each malformed field independently", () => {
  const settings = loadVoiceSettings(storageFor(JSON.stringify({
    audioQuality: "ultra", screenQuality: "cinema",
    customAudio: { bitrateKbps: 15 },
    customCamera: { width: 3841, height: 1080, frameRate: null, bitrateKbps: "fast" },
    customScreen: { width: 640, height: 360, frameRate: 60, bitrateKbps: 30000 },
  })));
  expect(settings.audioQuality).toBe("standard");
  expect(settings.screenQuality).toBe("standard");
  expect(settings.customAudio.bitrateKbps).toBe(48);
  expect(settings.customCamera).toEqual({ width: 1280, height: 1080, frameRate: 30, bitrateKbps: 1700 });
  expect(settings.customScreen).toEqual({ width: 640, height: 360, frameRate: 60, bitrateKbps: 30000 });
});

it("returns all defaults for invalid JSON", () => {
  expect(loadVoiceSettings(storageFor("{"))).toEqual(DEFAULT_VOICE_SETTINGS);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm --prefix web test -- src/voice/settings.test.ts`

Expected: FAIL because `settings.ts` does not exist.

- [ ] **Step 3: Implement validated settings loading**

Define `VoiceSettings` with existing fields plus:

```ts
export type DeviceSelections = Partial<Record<MediaDeviceKind, string>>;

audioQuality: CustomMediaQuality;
cameraQuality: CustomMediaQuality;
screenQuality: CustomScreenQuality;
screenAudioQuality: CustomMediaQuality;
customAudio: CustomAudioSettings;
customCamera: CustomVideoSettings;
customScreen: CustomVideoSettings;
customScreenAudio: CustomAudioSettings;
```

Use a private `numberWithin(value, fallback, { min, max })` that returns `value` only when `typeof value === "number"`, `Number.isFinite(value)`, and it is within the inclusive bounds. Validate each custom property independently. Preserve existing defaults for devices, threshold, push-to-talk, qualities, and Advanced mode.

In `VoiceView.tsx`, remove the local settings types/guards/loader, import this module, initialize from `loadVoiceSettings()`, and keep the existing per-channel preset override behavior unchanged.

- [ ] **Step 4: Run focused tests, VoiceView regressions, and typecheck**

Run sequentially:

```bash
npm --prefix web test -- src/voice/settings.test.ts
npm --prefix web test -- src/voice/VoiceView.test.tsx
npm --prefix web run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Review, commit, and push Task 2**

After review approval:

```bash
git add web/src/voice/settings.ts web/src/voice/settings.test.ts web/src/voice/VoiceView.tsx
git commit -m "refactor(voice): validate persisted quality settings"
git push origin HEAD
```

---

### Task 3: Accessible custom numeric draft field

**Files:**
- Create: `web/src/voice/CustomNumberField.tsx`
- Create: `web/src/voice/CustomNumberField.test.tsx`

**Interfaces:**
- Produces `CustomNumberField({ label, value, min, max, step, onCommit })`.
- `onCommit(number)` fires immediately for valid drafts and on blur with a clamped finite draft.
- Empty/non-numeric blur restores the last valid `value` without calling `onCommit`.

- [ ] **Step 1: Write failing interaction tests**

```tsx
it("commits a valid draft immediately", async () => {
  const onCommit = vi.fn();
  render(<CustomNumberField label="Webcam bitrate (kb/s)" value={1700} min={100} max={20000} step={100} onCommit={onCommit} />);
  const input = screen.getByRole("spinbutton", { name: "Webcam bitrate (kb/s)" });
  fireEvent.change(input, { target: { value: "2400" } });
  expect(onCommit).toHaveBeenCalledWith(2400);
  expect(input).not.toHaveAttribute("aria-invalid");
});

it("shows an accessible error without committing an invalid draft", () => {
  const onCommit = vi.fn();
  render(<CustomNumberField label="Frame rate (fps)" value={30} min={5} max={60} step={1} onCommit={onCommit} />);
  const input = screen.getByRole("spinbutton", { name: "Frame rate (fps)" });
  fireEvent.change(input, { target: { value: "90" } });
  expect(screen.getByText("Frame rate (fps) must be between 5 and 60.")).toBeInTheDocument();
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(onCommit).not.toHaveBeenCalled();
});

it("clamps a finite out-of-range draft on blur", () => {
  const onCommit = vi.fn();
  render(<CustomNumberField label="Frame rate (fps)" value={30} min={5} max={60} step={1} onCommit={onCommit} />);
  const input = screen.getByRole("spinbutton", { name: "Frame rate (fps)" });
  fireEvent.change(input, { target: { value: "90" } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith(60);
  expect(input).toHaveValue(60);
  expect(screen.queryByText(/must be between/)).not.toBeInTheDocument();
});

it("restores the last valid value when an empty draft blurs", () => {
  const onCommit = vi.fn();
  render(<CustomNumberField label="Width (px)" value={1280} min={320} max={3840} step={1} onCommit={onCommit} />);
  const input = screen.getByRole("spinbutton", { name: "Width (px)" });
  fireEvent.change(input, { target: { value: "" } });
  expect(input).toHaveAttribute("aria-invalid", "true");
  fireEvent.blur(input);
  expect(input).toHaveValue(1280);
  expect(onCommit).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm --prefix web test -- src/voice/CustomNumberField.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the field**

Use `TextField` from `../ui/form`, local `draft` and `error` state, and synchronize `draft` from external `value` with `useEffect`. Explicitly treat `draft.trim() === ""` as invalid before converting with `Number()`. The exact error is `` `${label} must be between ${min} and ${max}.` ``. Render:

```tsx
<TextField
  label={label}
  type="number"
  min={min}
  max={max}
  step={step}
  value={draft}
  error={error}
  onChange={handleChange}
  onBlur={handleBlur}
/>
```

- [ ] **Step 4: Run the focused test and typecheck**

Run sequentially:

```bash
npm --prefix web test -- src/voice/CustomNumberField.test.tsx
npm --prefix web run typecheck
```

Expected: both PASS.

- [ ] **Step 5: Review, commit, and push Task 3**

After review approval:

```bash
git add web/src/voice/CustomNumberField.tsx web/src/voice/CustomNumberField.test.tsx
git commit -m "feat(voice): add validated custom quality field"
git push origin HEAD
```

---

### Task 4: Voice settings UI and LiveKit integration

**Files:**
- Modify: `web/src/voice/VoiceView.tsx`
- Modify: `web/src/voice/VoiceView.test.tsx`
- Modify: `web/src/index.css`

**Interfaces:**
- Consumes all Task 1 resolvers/types/limits and Task 3 `CustomNumberField`.
- Extends `QualitySelect` with `allowCustom: boolean`; its `onChange` returns `TQuality | "custom"`.
- Adds a local `updateCustomQuality(update)` helper that immutably saves exactly one custom field and emits the existing deferred-application toast when the matching stream is active.

Use this exact discriminated input type:

```ts
type CustomQualityUpdate =
  | { kind: "audio" | "screenAudio"; key: "bitrateKbps"; value: number }
  | { kind: "camera" | "screen"; key: keyof CustomVideoSettings; value: number };
```

- [ ] **Step 1: Write failing UI and persistence tests**

Add tests that open Settings without joining where media is irrelevant:

```tsx
it("offers and preserves Custom only through Advanced mode", async () => {
  await renderView({}, { join: false });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.queryByRole("option", { name: "Custom" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
  expect(screen.getAllByRole("option", { name: "Custom" })).toHaveLength(4);
  await user.selectOptions(screen.getByLabelText("Webcam"), "custom");
  expect(screen.getByRole("spinbutton", { name: "Webcam width (px)" })).toHaveValue(1280);
  await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
  expect(screen.queryByRole("spinbutton", { name: "Webcam width (px)" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Webcam")).toHaveValue("custom");
  expect(screen.getAllByRole("option", { name: "Custom" })).toHaveLength(1);
});

it("persists valid custom webcam values", async () => {
  await renderView({}, { join: false });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
  await user.selectOptions(screen.getByLabelText("Webcam"), "custom");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Webcam bitrate (kb/s)" }), { target: { value: "4200" } });
  expect(JSON.parse(localStorage.getItem("vocal.voice-settings.v1") ?? "{}").customCamera.bitrateKbps).toBe(4200);
});
```

Also add one visibility assertion for every stream's exact field labels:

- `Microphone bitrate (kb/s)`
- `Webcam width (px)`, `Webcam height (px)`, `Webcam frame rate (fps)`, `Webcam bitrate (kb/s)`
- `Screen width (px)`, `Screen height (px)`, `Screen frame rate (fps)`, `Screen bitrate (kb/s)`
- `Screen audio bitrate (kb/s)`

- [ ] **Step 2: Write failing LiveKit integration tests**

Render without joining, open Settings, enable Advanced mode, select Custom for all four streams, and enter microphone 72 kb/s, webcam 1920 × 1080 / 48 fps / 7500 kb/s, screen 2560 × 1440 / 30 fps / 12000 kb/s, and screen audio 160 kb/s. Close Settings, click Join, then enable camera and screen sharing. Assert exact options:

```ts
expect(setMicrophoneEnabled).toHaveBeenCalledWith(
  true,
  expect.objectContaining({ channelCount: 1 }),
  expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 72_000 }) }),
);
expect(setCameraEnabled).toHaveBeenCalledWith(
  true,
  expect.objectContaining({ resolution: { width: 1920, height: 1080, frameRate: 48 } }),
  expect.objectContaining({ videoEncoding: { maxBitrate: 7_500_000, maxFramerate: 48 }, simulcast: true }),
);
expect(createScreenTracks).toHaveBeenCalledWith(expect.objectContaining({
  audio: true,
  resolution: { width: 2560, height: 1440, frameRate: 30 },
  contentHint: "motion",
}));
expect(publishTrack).toHaveBeenCalledWith(
  expect.objectContaining({ kind: "video" }),
  expect.objectContaining({ screenShareEncoding: { maxBitrate: 12_000_000, maxFramerate: 30 } }),
);
expect(publishTrack).toHaveBeenCalledWith(
  expect.objectContaining({ kind: "audio" }),
  expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 160_000 }), forceStereo: true }),
);
```

This UI-first setup deliberately happens before Join: it respects the existing behavior that applies the channel's preset defaults when the view initializes, while proving that a user's subsequent Custom selection drives every activation path. Add a push-to-talk regression: edit custom microphone bitrate while connected, enable push-to-talk, press Space, and assert the next `setMicrophoneEnabled(true, …)` uses the edited bitrate.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm --prefix web test -- src/voice/VoiceView.test.tsx`

Expected: FAIL because Custom is absent and activation still indexes preset tables directly.

- [ ] **Step 4: Implement selector and custom-field UI**

Import `TextField` only through `CustomNumberField`; wrap each selector and its conditional custom controls in `.quality-setting`. Pass `allowCustom={settings.advancedMode}`. Render Custom when `allowCustom || value === "custom"`:

```tsx
{allowCustom || value === "custom" ? <option value="custom">Custom</option> : null}
```

Render custom controls only when both Advanced mode is on and that selector equals `"custom"`. For each field, read limits from `customQualityLimits`, pass the stored value, and commit through `updateCustomQuality`.

Add layout rules:

```css
.quality-setting { min-width: 0; display: grid; align-content: start; gap: 10px; }
.custom-quality-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.custom-quality-fields > .form-field:only-child { grid-column: 1 / -1; }
```

Inside the existing `@media (max-width: 760px)` block, set `.custom-quality-fields { grid-template-columns: 1fr; }`.

- [ ] **Step 5: Route every media activation through resolvers**

Replace every `audioProfiles[settings.audioQuality]` access used for join, microphone toggle, push-to-talk toggle, push-to-talk key activation, and voice gate re-enable with:

```ts
resolveAudioProfile(settings.audioQuality, settings.customAudio, "microphone")
```

Replace camera and screen profile lookup with:

```ts
resolveCameraProfile(settings.cameraQuality, settings.customCamera)
resolveScreenProfile(settings.screenQuality, settings.customScreen)
```

Resolve screen-share audio with:

```ts
resolveAudioProfile(settings.screenAudioQuality, settings.customScreenAudio, "screenShare").publish
```

Add `settings.customAudio` to the push-to-talk effect dependencies so the next press uses an edited custom bitrate. Do not change the retry-without-audio branch; it must keep spreading the resolved screen profile capture options and forcing `audio: false`.

`updateCustomQuality(update: CustomQualityUpdate)` must use `saveSettings`, map `audio`/`camera`/`screen`/`screenAudio` to `customAudio`/`customCamera`/`customScreen`/`customScreenAudio`, update only that nested object, and use the same active/label mapping as `selectQuality` to show `The new … quality will apply the next time it's turned on.`.

- [ ] **Step 6: Run focused tests, typecheck, and build**

Run sequentially:

```bash
npm --prefix web test -- src/voice/quality.test.ts src/voice/settings.test.ts src/voice/CustomNumberField.test.tsx src/voice/VoiceView.test.tsx
npm --prefix web run typecheck
npm --prefix web run build
```

Expected: all PASS.

- [ ] **Step 7: Review, commit, and push Task 4**

After review approval:

```bash
git add web/src/voice/VoiceView.tsx web/src/voice/VoiceView.test.tsx web/src/index.css
git commit -m "feat(voice): expose custom stream quality controls"
git push origin HEAD
```

---

### Task 5: Whole-feature verification and roadmap completion

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes the completed feature; produces no runtime API.

- [ ] **Step 1: Run complete automated verification sequentially**

```bash
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run build
```

Expected: the entire web suite passes, TypeScript exits 0, and Vite produces `web/dist` without errors.

- [ ] **Step 2: Perform Chromium UI verification**

At desktop width and 390 px width, verify:

- Advanced mode reveals four Custom choices.
- Each selected Custom section is aligned, readable, and free of horizontal overflow.
- Invalid values show inline accessible errors without breaking layout.
- Disabling Advanced mode hides fields and leaves the visible microphone/webcam/screen selector on Custom.
- Re-enabling Advanced mode restores the previous numeric values.
- Browser console has no new error or warning caused by the settings UI.

Record exact viewport sizes and observed results in `.superpowers/sdd/progress.md` in the execution worktree.

- [ ] **Step 3: Update the roadmap**

Add a concise Delivered-lot entry naming the four Custom configurations, validation/persistence behavior, resolver architecture, deferred activation behavior, and verification evidence. Remove Next step 1 entirely and renumber remaining items 2–5 to 1–4. Do not alter the meaning of the remaining roadmap items.

- [ ] **Step 4: Run documentation and worktree checks**

```bash
git diff --check
rg -n "Advanced screen-share/stream quality mode, stage 2" ROADMAP.md
git status --short
```

Expected: no whitespace errors; the stage-2 phrase appears only in Delivered lots, not Next steps; status contains only intended Task 5 changes plus the two pre-existing root temp files if operating in the root worktree.

- [ ] **Step 5: Final review, commit, and push Task 5**

After whole-feature review approval:

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): complete custom stream quality controls"
git push origin HEAD
```

- [ ] **Step 6: Integrate the execution branch**

Use `superpowers:finishing-a-development-branch`. Fast-forward local `main` only after every task is reviewed and all final verification is green, rerun the focused `VoiceView` test after integration, then push `main`.
