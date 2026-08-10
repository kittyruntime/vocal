export const CAPABILITIES = ["manage_channels", "manage_server", "moderate", "publish_voice"] as const;
export type Capability = (typeof CAPABILITIES)[number];
