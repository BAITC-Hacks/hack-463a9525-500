"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Bug, ChevronDown, CircleGauge, EllipsisVertical, Monitor, ShieldCheck, ShieldX, Wallet } from "lucide-react";
import type { GraphData, GraphNode, Role } from "@/lib/data";

const format = new Intl.NumberFormat("ru-RU");
const short = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const roleNames: Record<Role, string> = { coordinator: "Координация", consolidator: "Консолидация", distributor: "Распределение", transit: "Транзит", terminal: "Получатель", peripheral: "Периферия" };

function smoothPath(values: number[], width: number, height: number, pad = 4) {
  const min = Math.min(...values), max = Math.max(...values);
  const points = values.map((value, index) => ({ x: pad + (index * (width - pad * 2)) / (values.length - 1), y: height - pad - ((value - min) / (max - min || 1)) * (height - pad * 2) }));
  const path = points.reduce((d, point, index) => {
    if (!index) return `M${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    const previous = points[index - 1];
    const mid = (previous.x + point.x) / 2;
    return `${d} C${mid.toFixed(1)},${previous.y.toFixed(1)} ${mid.toFixed(1)},${point.y.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }, "");
  return { path, points };
}

function movingAverage(values: number[], radius: number) {
  return values.map((_, index) => {
    const start = Math.max(0, index - radius), end = Math.min(values.length, index + radius + 1);
    return values.slice(start, end).reduce((sum, value) => sum + value, 0) / (end - start);
  });
}

function BreakdownChart({ data, period }: { data: GraphData; period: "month" | "week" }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = period === "week" ? data.daily.slice(-7) : data.daily;
  const amounts = days.map(day => day.amount);
  const counts = days.map(day => day.count);
  const smoothedAmounts = movingAverage(amounts, period === "month" ? 2 : 1);
  const orange = smoothPath(smoothedAmounts, 600, 180, 20);
  const violet = smoothPath(movingAverage(counts, period === "month" ? 2 : 1), 600, 180, 30);
  const peak = smoothedAmounts.indexOf(Math.max(...smoothedAmounts));
  const active = hover === null ? peak : Math.min(hover, days.length - 1);
  return <div className="breakdown-chart"><svg viewBox="0 0 600 260" role="img" aria-label="Дневной оборот и количество переводов по дням июля 2026">
    <defs><linearGradient id="breakdownArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--orange)" stopOpacity=".28"/><stop offset="100%" stopColor="var(--orange)" stopOpacity="0"/></linearGradient></defs>
    <line x1="8" y1="248" x2="592" y2="248" stroke="var(--grid-line)" strokeDasharray="3 4"/>
    <line x1="8" y1="25" x2="8" y2="248" stroke="var(--grid-line)" strokeDasharray="3 4"/>
    <line x1="400" y1="25" x2="400" y2="248" stroke="var(--grid-line)" strokeDasharray="3 4"/>
    {amounts.map((amount, index) => <line key={index} x1={10 + index * 580 / (amounts.length - 1)} x2={10 + index * 580 / (amounts.length - 1)} y1={248} y2={192 - (amount / Math.max(...amounts)) * 95} stroke="var(--orange)" strokeOpacity=".55" strokeWidth="1.4"/>)}
    <path d={`${orange.path} L596 248 L4 248 Z`} fill="url(#breakdownArea)" transform="translate(0 38)"/>
    <path d={orange.path} fill="none" stroke="var(--orange)" strokeWidth="2.2" transform="translate(0 38)"/>
    <path d={violet.path} fill="none" stroke="var(--violet)" strokeWidth="2.2" transform="translate(0 45)"/>
    <circle cx={orange.points[active].x} cy={orange.points[active].y + 38} r="7" fill="var(--orange)" stroke="white" strokeWidth="3"/>
    {days.map((day, index) => <rect key={day.date} x={index * 600 / days.length} y="0" width={600 / days.length} height="260" fill="transparent" onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} tabIndex={0} aria-label={`${day.date}: ${format.format(day.amount)} тенге, ${day.count} операций`}/>)}
  </svg><div className="chart-tooltip" role="status"><strong>{days[active].date}</strong><span>{short.format(days[active].amount)} ₸ · {days[active].count} операций</span></div></div>;
}

function VolumeChart({ data }: { data: GraphData }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = Array.from({ length: 10 }, (_, bucket) => data.daily.slice(bucket * 3, bucket === 9 ? 31 : bucket * 3 + 3).reduce((sum, day) => sum + day.count, 0));
  const max = Math.max(...totals);
  return <div className="volume-chart"><svg viewBox="0 0 520 265" role="img" aria-label="Количество переводов по десяти группам дней июля">
    <defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="4" stroke="var(--hatch)" strokeWidth="2"/></pattern></defs>
    <text x="2" y="220" fill="var(--muted)" fontSize="15">01 июл</text><text x="231" y="220" fill="var(--muted)" fontSize="15">15 июл</text><text x="455" y="220" fill="var(--muted)" fontSize="15">31 июл</text>
    <line x1="20" y1="238" x2="500" y2="238" stroke="var(--grid-line)" strokeWidth="9" strokeLinecap="round"/>
    {totals.map((value, index) => {
      const barHeight = 38 + value / max * 135;
      const x = 34 + index * 48;
      return <g key={index} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} tabIndex={0} aria-label={`${index * 3 + 1}–${Math.min(31, index * 3 + 3)} июля: ${value} операций`}><rect x={x} y={205 - barHeight} width="27" height={barHeight + 18} rx="7" fill="url(#hatch)"/><rect x={x} y={205 - barHeight * .72} width="27" height={barHeight * .72 + 18} rx="7" fill={hover === index ? "var(--ink)" : "var(--orange)"}/><rect x={x + 5} y={211 - barHeight * .72} width="17" height="3" rx="2" fill="white"/></g>;
    })}
    <circle cx="20" cy="238" r="5" fill="var(--orange)" stroke="white" strokeWidth="2"/><circle cx="260" cy="238" r="5" fill="var(--orange)" stroke="white" strokeWidth="2"/><circle cx="500" cy="238" r="5" fill="var(--orange)" stroke="white" strokeWidth="2"/>
  </svg><div className="chart-tooltip" role="status"><strong>{hover === null ? "Июль 2026" : `${hover * 3 + 1}–${Math.min(31, hover * 3 + 3)} июля`}</strong><span>{hover === null ? "Наведите на столбец" : `${format.format(totals[hover])} операций`}</span></div></div>;
}

function CoverageGauge({ data }: { data: GraphData }) {
  const [open, setOpen] = useState(false);
  const identified = data.summary.nodes - data.summary.role_counts.peripheral;
  const percentage = Math.round(identified / data.summary.nodes * 100);
  const angle = Math.PI + Math.PI * percentage / 100;
  const fixed = (value: number) => value.toFixed(2);
  const markerX = fixed(200 + Math.cos(angle) * 150), markerY = fixed(225 + Math.sin(angle) * 150);
  return <div className="gauge-chart" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} tabIndex={0}><svg viewBox="0 0 400 265" role="img" aria-label={`У ${percentage}% узлов выявлены признаки специальной роли`}>
    <defs><linearGradient id="gauge" x1="0" x2="1" y1="1" y2="0"><stop offset="0" stopColor="var(--orange-dark)"/><stop offset="1" stopColor="var(--orange)"/></linearGradient></defs>
    <path d="M42 225 A158 158 0 0 1 358 225" fill="none" stroke="var(--surface-high)" strokeWidth="73"/>
    <path d="M42 225 A158 158 0 0 1 358 225" fill="none" stroke="url(#gauge)" strokeWidth="73" strokeDasharray={`${Math.PI * 158 * percentage / 100} 500`} opacity=".9"/>
    <path d="M105 225 A95 95 0 0 1 295 225" fill="none" stroke="var(--shell)" strokeWidth="32"/>
    {Array.from({ length: 21 }, (_, index) => {
      const a = Math.PI + Math.PI * index / 20;
      const x1 = 200 + Math.cos(a) * 115, y1 = 225 + Math.sin(a) * 115;
      const x2 = 200 + Math.cos(a) * (index % 5 === 0 ? 129 : 123), y2 = 225 + Math.sin(a) * (index % 5 === 0 ? 129 : 123);
      return <line key={index} x1={fixed(x1)} y1={fixed(y1)} x2={fixed(x2)} y2={fixed(y2)} stroke="white" strokeOpacity={index % 5 === 0 ? .9 : .35} strokeWidth={index % 5 === 0 ? 2 : 1}/>;
    })}
    <path d="M110 225 A90 90 0 0 1 290 225" fill="none" stroke="var(--orange-dark)" strokeWidth="2" opacity=".75"/>
    <circle cx={markerX} cy={markerY} r="5" fill="var(--orange)" stroke="white" strokeWidth="2"/>
    <text x="200" y="218" textAnchor="middle" fill="white" fontSize="30" fontWeight="700">{percentage}%</text>
    <text x="200" y="241" textAnchor="middle" fill="var(--muted)" fontSize="12">с определённой ролью</text>
    <text x="25" y="228" fill="white" fontSize="13" transform="rotate(-90 25 228)">0%</text><text x="365" y="228" fill="white" fontSize="13" transform="rotate(90 365 228)">100%</text>
  </svg><div className="chart-tooltip" role="status"><strong>{format.format(identified)} узлов из {format.format(data.summary.nodes)}</strong><span>{open ? `Координация ${data.summary.role_counts.coordinator} · транзит ${data.summary.role_counts.transit}` : "Наведите для состава ролей"}</span></div></div>;
}

function OperationsChart({ data }: { data: GraphData }) {
  const [hover, setHover] = useState<number | null>(null);
  let running = 0;
  const values = data.daily.map(day => (running += day.amount));
  const chart = smoothPath(values, 540, 210, 8);
  const highlighted = hover ?? chart.points.length - 1;
  const peak = chart.points[highlighted];
  return <div className="operations-chart"><svg viewBox="0 0 540 270" preserveAspectRatio="none" role="img" aria-label="Оборот переводов по дням июля">
    <defs><linearGradient id="operations-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--orange)" stopOpacity=".23"/><stop offset="1" stopColor="var(--orange)" stopOpacity="0"/></linearGradient></defs>
    {values.map((value, index) => <line key={index} x1={8 + index * 17.45} x2={8 + index * 17.45} y1={267} y2={193 - (value / Math.max(...values)) * 90} stroke="var(--orange)" strokeOpacity=".22" strokeWidth="1"/>)}
    <path d={`${chart.path} L532 265 L8 265 Z`} fill="url(#operations-fill)" transform="translate(0 42)"/>
    <path d={chart.path} fill="none" stroke="var(--ink)" strokeOpacity=".75" strokeWidth="1.7" transform="translate(0 42)"/>
    <line x1={peak.x} y1={peak.y + 42} x2={peak.x} y2="260" stroke="var(--ink)" strokeOpacity=".25"/>
    <circle cx={peak.x} cy={peak.y + 42} r="4" fill="var(--ink)"/>
    {data.daily.map((day, index) => <rect key={day.date} x={index * 540 / data.daily.length} y="0" width={540 / data.daily.length} height="270" fill="transparent" onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} tabIndex={0} aria-label={`${day.date}: накопленный оборот ${format.format(values[index])} тенге`}/>)}
  </svg><div className="chart-tooltip" role="status"><strong>{data.daily[highlighted].date}</strong><span>{short.format(values[highlighted])} ₸ накоплено</span></div></div>;
}

function risk(node: GraphNode) {
  if (node.priority_score >= .90) return { label: "В начале", className: "risk-critical" };
  if (node.priority_score >= .82) return { label: "Высокий", className: "risk-high" };
  return { label: "Проверить", className: "risk-medium" };
}

export default function Dashboard({ data }: { data: GraphData }) {
  const [period, setPeriod] = useState<"month" | "week">("month");
  const top = useMemo(() => [...data.nodes].sort((a, b) => b.priority_score - a.priority_score).slice(0, 5), [data.nodes]);
  const cards = [
    { label: "Узлы сети", value: format.format(data.summary.nodes), tag: `${data.summary.seeds} seed`, Icon: ShieldCheck, href: "/network" },
    { label: "Направленные связи", value: format.format(data.summary.edges), tag: "4 колена", Icon: Bug, href: "/network" },
    { label: "Операции", value: format.format(data.summary.transactions), tag: "июль", Icon: CircleGauge, href: "/network" },
    { label: "Кластеры", value: format.format(data.summary.clusters), tag: "Группы", Icon: Monitor, href: "/clusters" },
    { label: "Оборот в графе", value: `${short.format(data.summary.turnover_kzt)} ₸`, tag: "KZT", Icon: Wallet, href: "/methodology" }
  ];
  return <main className="dashboard-content"><section className="hero-row"><div><h1>Обзор, <span>MoneyGraph</span></h1><p>Что происходит в видимой сети переводов · июль 2026</p></div><Link href="/network" className="alert-button">Исследовать сеть <ArrowUpRight size={16}/></Link></section>
    <section className="metric-row" aria-label="Показатели сети">{cards.map(({ label, value, tag, Icon, href }) => <Link className="stat-card" key={label} href={href} aria-label={`${label}: ${value}. Открыть подробности`}><div className="stat-label"><span className="stat-icon"><Icon size={18}/></span><span>{label}</span></div><div className="stat-bottom"><strong>{value}</strong><span>{tag}</span></div></Link>)}</section>
    <div className="triple-grid">
      <section className="dash-panel breakdown-panel"><div className="panel-title"><h2>Поток переводов</h2><button type="button" className="panel-menu" onClick={() => setPeriod(period === "month" ? "week" : "month")}>{period === "month" ? "Месяц" : "Неделя"}<ChevronDown size={16}/></button></div><p className="panel-subtitle">Наведите на день: сумма и число операций</p><BreakdownChart data={data} period={period}/></section>
      <section className="dash-panel volume-panel"><div className="panel-title"><h2>Объём переводов</h2><Link href="/network" className="square-menu" aria-label="Открыть граф сети"><EllipsisVertical size={18}/></Link></div><p className="panel-subtitle">Операции по группам дней</p><VolumeChart data={data}/></section>
      <section className="dash-panel gauge-panel"><div className="panel-title"><h2>Структура сети</h2><Link href="/network" className="square-menu" aria-label="Открыть роли в графе"><EllipsisVertical size={18}/></Link></div><p className="panel-subtitle">{format.format(data.summary.nodes)} узлов в анализе</p><CoverageGauge data={data}/></section>
    </div>
    <div className="bottom-grid">
      <section className="dash-panel queue-panel" id="priorities"><div className="panel-title"><div><h2>Очередь проверки</h2><p className="panel-subtitle">Кого проверить первым и почему</p></div><Link href="/priorities" className="panel-menu">Вся очередь <ArrowUpRight size={16}/></Link></div><div className="queue-scroll"><table><thead><tr><th>№</th><th>GID</th><th>Роль</th><th>Приоритет</th><th>Статус</th></tr></thead><tbody>{top.map((node, index) => {
        const status = risk(node);
        return <tr key={node.gid}><td>{String(index + 1).padStart(2, "0")}</td><td><Link href={`/network?gid=${node.gid}`} className="gid-link">{node.gid}</Link></td><td>{roleNames[node.role]}</td><td><span className="risk-bars" aria-label={`${Math.round(node.priority_score * 100)} процентов`}>{Array.from({ length: 15 }, (_, bar) => <i key={bar} style={{ background: bar / 15 < node.priority_score ? (bar % 6 === 5 ? "var(--violet)" : "var(--orange)") : "var(--grid-line)" }}/>)}</span></td><td><span className={`risk-pill ${status.className}`}>• {status.label}</span></td></tr>;
      })}</tbody></table></div></section>
      <section className="dash-panel operations-panel"><div className="panel-title"><h2>Накопленный оборот</h2><Link href="/methodology" className="square-menu" aria-label="Объяснение показателя"><EllipsisVertical size={18}/></Link></div><p className="panel-subtitle">Наведите на день для точной суммы</p><OperationsChart data={data}/></section>
    </div>
    <p className="screen-note" id="method"><ShieldX size={15}/>Роли отражают признаки для проверки. Отсутствие исходящих переводов на 4-м колене не доказывает, что средства остались на счёте. <Link href="/network">Изучить граф</Link></p>
  </main>;
}
