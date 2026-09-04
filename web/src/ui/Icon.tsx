import {
  Bell,
  BellOff,
  BellRing,
  Camera,
  CameraOff,
  File,
  ChevronDown,
  Hash,
  Headphones,
  HeadphoneOff,
  LogOut,
  Maximize2,
  Menu,
  MessageCircle,
  MessageSquareReply,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MonitorOff,
  Paperclip,
  PhoneOff,
  Plus,
  Pencil,
  Send,
  Search,
  Settings,
  Smile,
  Trash2,
  Volume2,
  Upload,
  UserPlus,
  UserMinus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

type IconName =
  | "bell"
  | "bellOff"
  | "bellRing"
  | "camera"
  | "cameraOff"
  | "file"
  | "chevron"
  | "hash"
  | "headphones"
  | "headphonesOff"
  | "logout"
  | "maximize"
  | "menu"
  | "message"
  | "reply"
  | "microphone"
  | "microphoneOff"
  | "minimize"
  | "monitor"
  | "monitorOff"
  | "phone"
  | "plus"
  | "attach"
  | "edit"
  | "send"
  | "search"
  | "settings"
  | "smile"
  | "trash"
  | "volume"
  | "upload"
  | "userPlus"
  | "userMinus"
  | "users"
  | "close";

const icons: Record<IconName, LucideIcon> = {
  bell: Bell,
  bellOff: BellOff,
  bellRing: BellRing,
  camera: Camera,
  cameraOff: CameraOff,
  file: File,
  chevron: ChevronDown,
  hash: Hash,
  headphones: Headphones,
  headphonesOff: HeadphoneOff,
  logout: LogOut,
  maximize: Maximize2,
  menu: Menu,
  message: MessageCircle,
  reply: MessageSquareReply,
  microphone: Mic,
  microphoneOff: MicOff,
  minimize: Minimize2,
  monitor: MonitorUp,
  monitorOff: MonitorOff,
  phone: PhoneOff,
  plus: Plus,
  attach: Paperclip,
  edit: Pencil,
  send: Send,
  search: Search,
  settings: Settings,
  smile: Smile,
  trash: Trash2,
  volume: Volume2,
  upload: Upload,
  userPlus: UserPlus,
  userMinus: UserMinus,
  users: Users,
  close: X,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component className="icon" size={size} strokeWidth={2.1} aria-hidden="true" />;
}
