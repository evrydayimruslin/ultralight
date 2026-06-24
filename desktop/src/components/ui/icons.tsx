// Icons — single source of truth for icon imports in the premium UI port.
//
// Every icon used by the design mockups (handoff/mockups/icons.jsx) is
// re-exported here under the mockup's name. The right-hand side is the
// lucide-react export. If lucide renames an icon, only this file changes.
//
// Mockup name        →  lucide-react export
// ───────────────────────────────────────────
// IconCompass        →  Compass
// IconPackage        →  Package
// IconCirclePlus     →  CirclePlus
// IconWrench         →  Wrench
// IconStore          →  Store
// IconSettings       →  Settings
// IconArrowUp        →  ArrowUp
// IconPaperclip      →  Paperclip
// IconCheck          →  Check
// IconSearch         →  Search
// IconBolt           →  Zap            (lucide names lightning bolt "Zap")
// IconShare          →  Share2         (mockup matches the connected-nodes glyph)
// IconBeaker         →  FlaskConical
// IconWallet         →  Wallet
// IconUser           →  User
// IconCornerDownLeft →  CornerDownLeft
// IconChevronDown    →  ChevronDown
// IconChevronRight   →  ChevronRight
// IconPlus           →  Plus
// IconFolder         →  Folder
// IconSlash          →  SquareSlash
// IconConnector      →  Grid2x2        (four squares in a 2×2 grid)
// IconPlugin         →  Plug
// IconPencil         →  Pencil
// IconKey            →  Key
// IconSparkles       →  Sparkles
//
// Custom-drawn (not in lucide):
//   Spark (the Galactic brand glyph)  →  ./Spark
//
// Usage:
//   import { IconWrench, IconStore } from '@/components/ui/icons';
//   <IconWrench size={14} />

export {
  Compass as IconCompass,
  Package as IconPackage,
  CirclePlus as IconCirclePlus,
  Wrench as IconWrench,
  Store as IconStore,
  Settings as IconSettings,
  ArrowUp as IconArrowUp,
  Paperclip as IconPaperclip,
  Check as IconCheck,
  Search as IconSearch,
  Zap as IconBolt,
  Share2 as IconShare,
  FlaskConical as IconBeaker,
  Wallet as IconWallet,
  User as IconUser,
  CornerDownLeft as IconCornerDownLeft,
  ChevronDown as IconChevronDown,
  ChevronRight as IconChevronRight,
  Plus as IconPlus,
  Folder as IconFolder,
  SquareSlash as IconSlash,
  Grid2x2 as IconConnector,
  Plug as IconPlugin,
  Pencil as IconPencil,
  Key as IconKey,
  Sparkles as IconSparkles,
} from 'lucide-react';

export { default as Spark } from './Spark';
