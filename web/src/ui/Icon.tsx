type IconName =
  | "camera"
  | "chevron"
  | "hash"
  | "headphones"
  | "logout"
  | "microphone"
  | "monitor"
  | "phone"
  | "plus"
  | "send"
  | "settings"
  | "volume";

const paths: Record<IconName, ReactNode> = {
  camera: <><path d="M15 10l4.55-2.6A1 1 0 0121 8.27v7.46a1 1 0 01-1.45.87L15 14"/><rect x="3" y="6" width="12" height="12" rx="2"/></>,
  chevron: <path d="M6 9l6 6 6-6"/>,
  hash: <><path d="M10 3L8 21M16 3l-2 18M4 9h17M3 15h17"/></>,
  headphones: <><path d="M4 14v-2a8 8 0 0116 0v2"/><path d="M18 19h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3v5a2 2 0 01-2 2zM6 19H5a2 2 0 01-2-2v-5h3a2 2 0 012 2v3a2 2 0 01-2 2z"/></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h4a3 3 0 013 3v12a3 3 0 01-3 3h-4"/></>,
  microphone: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 17v5M8 22h8"/></>,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  phone: <path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.8 19.8 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.69 2.78a2 2 0 01-.45 2.11L8.09 9.87a16 16 0 006 6l1.26-1.26a2 2 0 012.11-.45c.88.33 1.82.56 2.78.69A2 2 0 0122 16.92z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  send: <><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0015 19.4a1.7 1.7 0 00-1 .6 1.7 1.7 0 00-.4 1.1V21h-4v-.09A1.7 1.7 0 008.6 19.4a1.7 1.7 0 00-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-.6-1 1.7 1.7 0 00-1.1-.4H3v-4h.09A1.7 1.7 0 004.6 8.6a1.7 1.7 0 00-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 009 4.6a1.7 1.7 0 001-.6 1.7 1.7 0 00.4-1.1V3h4v.09A1.7 1.7 0 0015.4 4.6a1.7 1.7 0 001.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0019.4 9c.15.38.36.72.6 1 .3.3.68.45 1.1.45H21v4h-.09A1.7 1.7 0 0019.4 15z"/></>,
  volume: <><path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
import type { ReactNode } from "react";
