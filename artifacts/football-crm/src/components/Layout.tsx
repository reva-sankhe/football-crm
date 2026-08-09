import { Link, useLocation } from "wouter";
import { ChevronDown, ChevronsLeft, ChevronsRight, Sun, Moon, ClipboardCheck, Users, BarChart2, ClipboardList } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";

const COLLAPSE_KEY = "bg-crm-sidebar-collapsed";

// Dashboard is hidden for now — it still lives at /dashboard
const navItems = [
  { href: "/players",  label: "Players",      icon: Users           },
  { href: "/sessions", label: "Sessions",     icon: ClipboardList   },
  { href: "/attendance", label: "Attendance", icon: ClipboardCheck  },
  { href: "/analytics",label: "Analytics",    icon: BarChart2       },
];

const logoSrc = `${import.meta.env.BASE_URL}bg-logo.png`.replace(/\/\//g, "/");

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  // Falls back to Analytics — the landing page, and the only route not in the nav
  const currentLabel = navItems.find(
    (item) => location === item.href || (item.href !== "/" && location.startsWith(item.href))
  )?.label ?? (location === "/dashboard" ? "Dashboard" : "Analytics");

  useEffect(() => {
    if (!mobileOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mobileOpen]);

  const NavLink = ({
    href,
    label,
    icon: Icon,
    onClick,
    compact = false,
  }: {
    href: string;
    label: string;
    icon?: React.ComponentType<{ size?: number; className?: string }>;
    onClick?: () => void;
    /** Icon-only rendering for the collapsed sidebar. */
    compact?: boolean;
  }) => {
    const active = location === href || (href !== "/" && location.startsWith(href));
    return (
      <Link
        href={href}
        onClick={onClick}
        title={compact ? label : undefined}
        aria-label={compact ? label : undefined}
        data-testid={`nav-${label.toLowerCase().replace(/\s/g, "-")}`}
        className={cn(
          "flex items-center rounded-lg text-sm font-medium transition-all duration-150 border",
          compact ? "justify-center h-10 w-10 mx-auto" : "gap-2.5 px-3 py-2",
          active
            ? isDark
              ? "bg-indigo-600/20 text-indigo-300 nav-glow border-indigo-500/20"
              : "bg-indigo-50 text-indigo-700 border-indigo-200"
            : isDark
              ? "text-slate-400 hover:bg-white/5 hover:text-slate-100 border-transparent"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 border-transparent"
        )}
      >
        {Icon && <Icon size={compact ? 17 : 14} className="shrink-0" />}
        {!compact && label}
      </Link>
    );
  };

  // One shape for every sidebar action, so theme and collapse read as a pair.
  // No fill — the 8×8 box is hit area only, the icon carries the control.
  const actionCls = cn(
    "w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0",
    isDark
      ? "text-slate-500 hover:text-slate-200"
      : "text-slate-400 hover:text-slate-700"
  );

  const themeLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

  const ThemeToggle = () => (
    <button
      onClick={toggleTheme}
      data-testid="theme-toggle"
      className={actionCls}
      title={themeLabel}
      aria-label={themeLabel}
    >
      {isDark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );

  const SidebarContent = ({ onNav, compact = false }: { onNav?: () => void; compact?: boolean }) => (
    <div className="flex flex-col h-full">
      {/* Brand — the mark alone; the title lives in the page header. The source
          PNG carries a wide transparent margin, so it needs a larger box than
          its pixel size suggests to read at the same weight as the nav. */}
      <div className={cn("pt-4 pb-3 flex", compact ? "px-2 justify-center" : "px-4")}>
        <img
          src={logoSrc}
          alt="Bombay Gymkhana · Women's Football"
          title="Bombay Gymkhana · Women's Football"
          className={cn(
            "object-contain shrink-0",
            compact ? "w-9 h-9" : "w-12 h-12",
            !isDark && "brightness-75",
          )}
        />
      </div>

      <div className={cn("mb-4 h-px", compact ? "mx-3" : "mx-5", isDark ? "bg-white/6" : "bg-slate-200")} />

      {/* Nav */}
      <nav className={cn("flex-1 space-y-0.5", compact ? "px-2" : "px-3")}>

        {navItems.map((item) => (
          <NavLink key={item.href} {...item} onClick={onNav} compact={compact} />
        ))}
      </nav>

      {/* Footer — the sidebar's two controls, matched in shape and size */}
      <div className={cn("py-4", compact ? "px-3" : "px-5")}>
        <div className={cn("h-px mb-3", isDark ? "bg-white/6" : "bg-slate-200")} />
        <div className={cn("flex gap-1", compact ? "flex-col items-center" : "items-center justify-end")}>
          <ThemeToggle />
          <button
            onClick={() => setCollapsed((c) => !c)}
            data-testid="sidebar-collapse-toggle"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={actionCls}
          >
            {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className={cn(
        "hidden lg:flex flex-col flex-shrink-0 border-r sticky top-0 h-screen bg-sidebar z-40",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-48",
        isDark ? "border-white/[0.06]" : "border-slate-200"
      )}>
        <SidebarContent compact={collapsed} />
      </aside>

      <div className={cn(
        "lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-12 border-b bg-sidebar",
        isDark ? "border-white/[0.06]" : "border-slate-200"
      )}>
        <div className="relative" ref={dropdownRef}>
          <button
            data-testid="mobile-menu-toggle"
            onClick={() => setMobileOpen(!mobileOpen)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-semibold transition-colors",
              isDark ? "text-white hover:bg-white/8" : "text-slate-900 hover:bg-slate-100"
            )}
          >
            {currentLabel}
            <ChevronDown size={14} className={cn("transition-transform", mobileOpen && "rotate-180")} />
          </button>

          {mobileOpen && (
            <div className={cn(
              "absolute left-0 top-full mt-1 w-48 rounded-lg border shadow-lg py-1 z-50",
              isDark ? "bg-slate-900 border-white/10" : "bg-white border-slate-200"
            )}>
              {navItems.map((item) => (
                <NavLink key={item.href} {...item} onClick={() => setMobileOpen(false)} />
              ))}
            </div>
          )}
        </div>

        <ThemeToggle />
      </div>

      <main className="flex-1 min-w-0 lg:pt-0 pt-12">
        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 py-7">
          {children}
        </div>
      </main>
    </div>
  );
}
