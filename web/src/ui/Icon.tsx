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
  MessageSquareReply,
  Mic,
  Minimize2,
  MonitorUp,
  MonitorOff,
  PhoneOff,
  Plus,
  Pencil,
  Send,
  Settings,
  Smile,
  Trash2,
  Volume2,
  Upload,
  Users,
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
  | "reply"
  | "microphone"
  | "minimize"
  | "monitor"
  | "monitorOff"
  | "phone"
  | "plus"
  | "edit"
  | "send"
  | "settings"
  | "smile"
  | "trash"
  | "volume"
  | "upload"
  | "users"
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
  reply: MessageSquareReply,
  microphone: Mic,
  minimize: Minimize2,
  monitor: MonitorUp,
  monitorOff: MonitorOff,
  phone: PhoneOff,
  plus: Plus,
  edit: Pencil,
  send: Send,
  settings: Settings,
  smile: Smile,
  trash: Trash2,
  volume: Volume2,
  upload: Upload,
  users: Users,
  close: X,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component className="icon" size={size} strokeWidth={2.1} aria-hidden="true" />;
}
