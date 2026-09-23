"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, ChevronDown, LayoutGrid, LogOut, Moon, ScanLine, Search, Settings2, Sun, UserRound, ChartNoAxesCombined } from "lucide-react";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="outer-stage"><div className="dashboard-shell">
    <aside className="side-rail" aria-label="Основная навигация">
      <Link className="logo-box" href="/" aria-label="Граф денег, главная">Г</Link>
      <nav className="rail-links" aria-label="Разделы">
        <Link href="/" className={`rail-icon ${pathname === "/" ? "is-active" : ""}`} title="Обзор" aria-label="Обзор"><LayoutGrid size={18}/></Link>
        <Link href="/network" className={`rail-icon ${pathname === "/network" ? "is-active" : ""}`} title="Граф сети" aria-label="Граф сети"><ChartNoAxesCombined size={18}/></Link>
        <Link href="/#priorities" className="rail-icon" title="Приоритеты" aria-label="Приоритеты"><CalendarDays size={18}/></Link>
        <Link href="/network" className="rail-icon" title="Поиск gid" aria-label="Поиск gid"><ScanLine size={18}/></Link>
        <Link href="/#method" className="rail-icon" title="Методика" aria-label="Методика"><UserRound size={18}/></Link>
      </nav>
      <div className="rail-bottom">
        <Link href="/#method" className="rail-icon" title="Ограничения" aria-label="Ограничения"><Settings2 size={18}/></Link>
        <Link href="/" className="rail-icon" title="На главную" aria-label="На главную"><LogOut size={18}/></Link>
        <div className="theme-control" aria-label="Тёмная тема"><Sun size={17}/><span className="theme-active"><Moon size={17}/></span></div>
      </div>
    </aside>
    <div className="main-area">
      <header className="top-header"><div className="top-label">Dashboard</div><div className="top-actions">
        <Link href="/network" className="header-icon" title="Найти gid" aria-label="Найти gid"><Search size={17}/></Link>
        <Link href="/#priorities" className="header-icon notification-icon" title="Очередь проверки" aria-label="Очередь проверки"><Bell size={16}/><i/></Link>
        <div className="profile-chip"><span className="profile-avatar">A</span><span><strong>AML Analyst</strong><small>Локальная сессия</small></span><ChevronDown size={16}/></div>
      </div></header>
      {children}
    </div>
  </div></div>;
}
