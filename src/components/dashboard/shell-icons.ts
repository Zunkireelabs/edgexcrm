import {
  AddressBookIcon,
  AirplaneIcon,
  ArchiveIcon,
  BellIcon,
  BooksIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  CalendarDotsIcon,
  ChalkboardTeacherIcon,
  ChartBarIcon,
  ChatTextIcon,
  ChecksIcon,
  ClipboardTextIcon,
  EnvelopeSimpleIcon,
  FileTextIcon,
  FlowArrowIcon,
  FolderOpenIcon,
  FolderSimpleIcon,
  FunnelIcon,
  GaugeIcon,
  GearIcon,
  GraduationCapIcon,
  HandshakeIcon,
  HouseIcon,
  KanbanIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  MapPinIcon,
  PackageIcon,
  PaperPlaneTiltIcon,
  PulseIcon,
  RobotIcon,
  SignatureIcon,
  SparkleIcon,
  SquaresFourIcon,
  TargetIcon,
  TimerIcon,
  TrayIcon,
  TreeStructureIcon,
  UserCheckIcon,
  UserGearIcon,
  UsersIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";

/**
 * Phosphor icon registry for the app shell (EDGEX-86). Manifests reference icons by
 * their legacy string name (so they stay serializable across the Server → Client
 * boundary); this resolves that name to a Phosphor component. Pages use the same
 * Phosphor set (EDGEX-94).
 */
export const SHELL_ICONS_BY_NAME: Record<string, Icon> = {
  House: HouseIcon,
  Inbox: TrayIcon,
  MessageSquare: ChatTextIcon, // SMS / generic message; Inbox is keyed by href below
  Activity: PulseIcon,
  LayoutDashboard: SquaresFourIcon,
  LayoutGrid: SquaresFourIcon,
  Library: BooksIcon,
  Users: UsersIcon,
  UsersRound: UsersThreeIcon,
  Kanban: KanbanIcon,
  FolderKanban: FolderSimpleIcon,
  Layers: FunnelIcon,
  Contact: AddressBookIcon,
  GraduationCap: GraduationCapIcon,
  BookOpen: ChalkboardTeacherIcon,
  UserCheck: UserCheckIcon,
  FileText: FileTextIcon,
  FileSignature: SignatureIcon,
  Megaphone: MegaphoneIcon,
  Mail: EnvelopeSimpleIcon,
  Send: PaperPlaneTiltIcon,
  Network: TreeStructureIcon,
  CalendarClock: CalendarDotsIcon,
  CalendarCheck: CalendarCheckIcon,
  Archive: ArchiveIcon,
  Settings: GearIcon,
  Search: MagnifyingGlassIcon,
  Bell: BellIcon,
  Sparkles: SparkleIcon,
  Building2: BuildingsIcon,
  Handshake: HandshakeIcon,
  Package: PackageIcon,
  ListChecks: ListChecksIcon,
  ListTodo: ListChecksIcon,
  Clock: TimerIcon,
  Stamp: ChecksIcon,
  Gauge: GaugeIcon,
  Plane: AirplaneIcon,
  MapPin: MapPinIcon,
  ChartColumn: ChartBarIcon,
  FolderOpen: FolderOpenIcon,
  Bot: RobotIcon,
  Workflow: FlowArrowIcon,
  UserCog: UserGearIcon,
  Filter: FunnelIcon,
  Target: TargetIcon,
};

/**
 * Where the same name means two different things, the nav item (href) wins.
 * e.g. MessageSquare = Inbox on /inbox but SMS on /sms; FileText = a form on /forms
 * but a proposal on /proposals.
 */
export const SHELL_ICONS_BY_HREF: Record<string, Icon> = {
  "/inbox": TrayIcon,
  "/sms": ChatTextIcon,
  "/forms": ClipboardTextIcon,
  "/classes": ChalkboardTeacherIcon,
  "/knowledge-bases": BooksIcon,
  "/leave": CalendarDotsIcon,
  "/attendance": CalendarCheckIcon,
  "/team": TreeStructureIcon,
  "/pulse": PulseIcon,
  "/insights/dashboards": SquaresFourIcon,
  "/time-tracking": TimerIcon,
  "/approvals": ChecksIcon,
  "/tasks": ListChecksIcon,
  "/projects": FolderSimpleIcon,
  "/resourcing": UsersThreeIcon,
  "/resourcing/utilization": GaugeIcon,
  "/people": UserGearIcon,
  "/contacts": AddressBookIcon,
  "/pipeline": KanbanIcon,
};

export function shellIcon(name: string | undefined, href?: string): Icon {
  if (href && SHELL_ICONS_BY_HREF[href]) return SHELL_ICONS_BY_HREF[href];
  return (name && SHELL_ICONS_BY_NAME[name]) || FileTextIcon;
}

// Chrome icons used directly by the shell, header and menu.
export {
  ArchiveIcon,
  BellIcon,
  BookOpenTextIcon as KnowledgeBaseIcon,
  BuildingsIcon,
  CaretDownIcon,
  ChatTextIcon,
  ClockIcon,
  FileTextIcon,
  GearIcon,
  HouseIcon,
  ListIcon as MenuIcon,
  MagnifyingGlassIcon as SearchIcon,
  RobotIcon,
  SidebarSimpleIcon as SidebarToggleIcon,
  SignOutIcon,
  SparkleIcon,
  SquaresFourIcon as OpsIcon,
  UserGearIcon as ProfileIcon,
} from "@phosphor-icons/react/dist/ssr";
export type { Icon };
