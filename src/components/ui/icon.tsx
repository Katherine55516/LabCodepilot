// Unified icon re-exports + size constants for the project
export {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowElbowDownLeft,
  ArrowsClockwise,
  ArrowsCounterClockwise,
  ArrowSquareOut,
  At,
  Bell,
  Book,
  Brain,
  CaretDown,
  CaretUp,
  CaretRight,
  ChartBar,
  ChatCircle,
  ChatCircleText,
  ChatsCircle,
  ChatTeardrop,
  Check,
  CheckCircle,
  Circle,
  Clock,
  Code,
  Coins,
  Columns,
  Copy,
  Desktop,
  DotsThree,
  DotOutline,
  DownloadSimple,
  Eye,
  File,
  FileArrowDown,
  FileCode,
  FloppyDisk,
  FileZip,
  Folder,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Funnel,
  GameController,
  Gear,
  GitBranch,
  Globe,
  GlobeSimple,
  HardDrives,
  Heart,
  Image,
  Info,
  Lightning,
  List,
  ListChecks,
  ListMagnifyingGlass,
  Lock,
  LockOpen,
  MagnifyingGlass,
  Microphone,
  MicrophoneSlash,
  Minus,
  Moon,
  NotePencil,
  PaintBrush,
  PencilLine,
  PencilSimple,
  Play,
  Plug,
  Plus,
  Question,
  SidebarSimple,
  SlidersHorizontal,
  SortDescending,
  Sparkle,
  SpinnerGap,
  ShieldCheck,
  Star,
  Stethoscope,
  Stop,
  Storefront,
  Sun,
  TelegramLogo,
  Terminal,
  Translate,
  Trash,
  TreeStructure,
  UserCircle,
  SignOut,
  Warning,
  WarningCircle,
  WifiHigh,
  Wrench,
  X,
  XCircle,
  GitCommit,
  CloudArrowUp,
  ArrowsInLineVertical,
  PushPin,
} from "@phosphor-icons/react";

import type { IconProps } from "@phosphor-icons/react";
export type { Icon, IconProps } from "@phosphor-icons/react";

export const ICON_SIZE = { sm: 14, md: 16, lg: 20, xl: 24 } as const;

// 自定义图标：放大镜 + 对勾（测试 / 检查）。phosphor 无内置的「放大镜带对勾」字形，故按其
// 描边风格手绘一个，纳入统一图标出口，用法与 phosphor 图标一致（size / weight / color / className）。
// weight 仅用于在「fill / bold」时略加粗描边以呼应激活态，其余沿用 currentColor 描边。
export function MagnifyingGlassCheck({ size = 16, weight = "regular", color = "currentColor", className, style, ...rest }: IconProps) {
  const sw = weight === "bold" || weight === "fill" || weight === "duotone" ? 2.6 : 2;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      {...rest}
    >
      <circle cx="10" cy="10" r="6.5" />
      <path d="M20 20 L15 15" />
      <path d="M7.2 10 L9.3 12.1 L12.9 7.9" strokeWidth={Math.max(1.6, sw - 0.3)} />
    </svg>
  );
}
