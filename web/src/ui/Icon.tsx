import {
  Camera,
  CameraOff,
  File,
  ChevronDown,
  Hash,
  Headphones,
  LogOut,
  Maximize2,
  Menu,
  Mic,
  Minimize2,
  MonitorUp,
  MonitorOff,
  PhoneOff,
  Plus,
  Send,
  Settings,
  Volume2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";

type IconName =
  | "camera"
  | "cameraOff"
  | "file"
  | "chevron"
  | "hash"
  | "headphones"
  | "logout"
  | "maximize"
  | "menu"
  | "microphone"
  | "minimize"
  | "monitor"
  | "monitorOff"
  | "phone"
  | "plus"
  | "send"
  | "settings"
  | "volume"
  | "upload"
  | "close";

const icons: Record<IconName, LucideIcon> = {
  camera: Camera,
  cameraOff: CameraOff,
  file: File,
  chevron: ChevronDown,
  hash: Hash,
  headphones: Headphones,
  logout: LogOut,
  maximize: Maximize2,
  menu: Menu,
  microphone: Mic,
  minimize: Minimize2,
  monitor: MonitorUp,
  monitorOff: MonitorOff,
  phone: PhoneOff,
  plus: Plus,
  send: Send,
  settings: Settings,
  volume: Volume2,
  upload: Upload,
  close: X,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component className="icon" size={size} strokeWidth={2.1} aria-hidden="true" />;
}
