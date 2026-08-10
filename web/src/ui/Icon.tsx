import {
  Camera,
  ChevronDown,
  Hash,
  Headphones,
  LogOut,
  Mic,
  MonitorUp,
  PhoneOff,
  Plus,
  Send,
  Settings,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";

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
  | "volume"
  | "close";

const icons: Record<IconName, LucideIcon> = {
  camera: Camera,
  chevron: ChevronDown,
  hash: Hash,
  headphones: Headphones,
  logout: LogOut,
  microphone: Mic,
  monitor: MonitorUp,
  phone: PhoneOff,
  plus: Plus,
  send: Send,
  settings: Settings,
  volume: Volume2,
  close: X,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component className="icon" size={size} strokeWidth={2.1} aria-hidden="true" />;
}
