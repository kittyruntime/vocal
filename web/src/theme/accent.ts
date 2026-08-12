import { getAppearance, getMyAccent, type AccentPreset, type AppearanceSettings } from "../api/client";

export const ACCENT_PRESET_LABELS: Record<AccentPreset, string> = {
  amber: "Ambre",
  "ember-red": "Braise",
  magenta: "Magenta",
  glacier: "Glacier",
  emerald: "Émeraude",
};

// Same five hex values as the CSS --brand values (Step 3 above). Shared here
// rather than duplicated in ProfileModal/AdminPanel: CSS custom properties
// can't be read into an inline `style` background without a live DOM lookup,
// so this is a real second place the color values must live in code.
export const ACCENT_SWATCH_COLORS: Record<AccentPreset, string> = {
  amber: "#ffb92e", "ember-red": "#ff5a36", magenta: "#ff2f7e", glacier: "#35d1e0", emerald: "#4ee08a",
};

export async function applyServerDefaultAccent(): Promise<AppearanceSettings> {
  const appearance = await getAppearance();
  document.documentElement.dataset.accent = appearance.defaultPreset;
  return appearance;
}

export function resolveAccent(accentPreset: AccentPreset | null, enabledPresets: AccentPreset[], defaultPreset: AccentPreset): AccentPreset {
  return accentPreset && enabledPresets.includes(accentPreset) ? accentPreset : defaultPreset;
}

export function applyUserAccent(accentPreset: AccentPreset | null, enabledPresets: AccentPreset[], defaultPreset: AccentPreset): void {
  document.documentElement.dataset.accent = resolveAccent(accentPreset, enabledPresets, defaultPreset);
}

export async function applyAuthenticatedAccent(): Promise<void> {
  const [appearance, mine] = await Promise.all([getAppearance(), getMyAccent()]);
  applyUserAccent(mine.accentPreset, appearance.enabledPresets, appearance.defaultPreset);
}
