"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Download, Info, Search } from "lucide-react";
import type { GraphData, GraphEdge, GraphNode, Role } from "@/lib/data";

const names: Record<Role, string> = { coordinator: "Координация", consolidator: "Консолидация", distributor: "Распределение", transit: "Транзит", terminal: "Получатель", peripheral: "Периферия" };
const colors: Record<Role, string> = { coordinator: "var(--orange)", consolidator: "var(--amber)", distributor: "var(--violet)", transit: "var(--cyan)", terminal: "var(--blue)", peripheral: "var(--muted)" };
const number = new Intl.NumberFormat("ru-RU");
const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

type Position = { node: GraphNode; x: number; y: number };
const WIDTH = 850, HEIGHT = 515;

function hash(id: string) {
  let result = 2166136261;
  for (const character of id) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

export default function NetworkExplorer({ data, initialGid }: { data: GraphData; initialGid?: string }) {
  const byId = useMemo(() => new Map(data.nodes.map(node => [node.gid, node])), [data.nodes]);
  const highest = useMemo(() => [...data.nodes].sort((a, b) => b.priority_score - a.priority_score)[0], [data.nodes]);
  const [selected, setSelected] = useState<GraphNode>(byId.get(initialGid || "") || highest);
  const [mode, setMode] = useState<"overview" | "focus">(initialGid && byId.has(initialGid) ? "focus" : "overview");
  const [query, setQuery] = useState("");
  const [cluster, setCluster] = useState("all");
  const [role, setRole] = useState("all");
  const [error, setError] = useState("");

  const incoming = useMemo(() => data.edges.filter(edge => edge.dst === selected.gid).sort((a, b) => b.sum_kzt - a.sum_kzt), [data.edges, selected.gid]);
  const outgoing = useMemo(() => data.edges.filter(edge => edge.src === selected.gid).sort((a, b) => b.sum_kzt - a.sum_kzt), [data.edges, selected.gid]);
  const positions = useMemo(() => {
    if (mode === "focus") {
      const sourceIds = [...new Set(incoming.slice(0, 35).map(edge => edge.src))].filter(id => id !== selected.gid);
      const targetIds = [...new Set(outgoing.slice(0, 35).map(edge => edge.dst))].filter(id => id !== selected.gid && !sourceIds.includes(id));
      const result: Position[] = [{ node: selected, x: WIDTH / 2, y: HEIGHT / 2 }];
      sourceIds.forEach((id, index) => { const node = byId.get(id); if (node) result.push({ node, x: 150 + hash(id) % 30, y: 35 + (index + .5) * (HEIGHT - 70) / Math.max(sourceIds.length, 1) }); });
      targetIds.forEach((id, index) => { const node = byId.get(id); if (node) result.push({ node, x: 680 - hash(id) % 30, y: 35 + (index + .5) * (HEIGHT - 70) / Math.max(targetIds.length, 1) }); });
      return result;
    }
    const nodes = data.nodes.filter(node => (cluster === "all" || String(node.cluster_id) === cluster) && (role === "all" || node.role === role)).sort((a, b) => b.priority_score - a.priority_score).slice(0, cluster === "all" ? 185 : 240);
    const columns: GraphNode[][] = [[], [], [], [], []];
    nodes.forEach(node => columns[Math.min(4, Math.max(0, node.depth))].push(node));
    const result: Position[] = [];
    columns.forEach((column, depth) => {
      column.sort((a, b) => a.cluster_id - b.cluster_id || b.priority_score - a.priority_score);
      column.forEach((node, index) => result.push({ node, x: 35 + depth * 195, y: 32 + (index + .5) * (HEIGHT - 66) / Math.max(column.length, 1) + (hash(node.gid) % 10 - 5) }));
    });
    return result;
  }, [mode, selected, incoming, outgoing, byId, data.nodes, cluster, role]);

  const points = useMemo(() => new Map(positions.map(position => [position.node.gid, position])), [positions]);
  const edges = useMemo(() => data.edges.filter(edge => points.has(edge.src) && points.has(edge.dst)), [data.edges, points]);
  const suggestions = query.trim().length >= 4 ? data.nodes.filter(node => node.gid.includes(query.trim())).slice(0, 6) : [];
  const clusters = useMemo(() => data.clusters.filter(item => item.n_nodes > 1).sort((a, b) => b.n_nodes - a.n_nodes).slice(0, 25), [data.clusters]);
  const leaders = useMemo(() => [...data.nodes].sort((a, b) => b.priority_score - a.priority_score).slice(0, 50), [data.nodes]);

  function choose(id: string, scroll = false) {
    const node = byId.get(id);
    if (!node) { setError("gid не найден в предоставленной выгрузке"); return; }
    setSelected(node); setMode("focus"); setQuery(""); setError("");
    window.history.replaceState(null, "", `/network?gid=${node.gid}`);
    if (scroll) document.querySelector(".network-layout")?.scrollIntoView({ behavior: "auto", block: "start" });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    choose(byId.has(query.trim()) ? query.trim() : suggestions[0]?.gid || query.trim());
  }

  const neighborIds = [...new Set([...incoming.slice(0, 3).map(edge => edge.src), ...outgoing.slice(0, 3).map(edge => edge.dst)])];
  const coverage = Math.round((data.summary.nodes - data.summary.role_counts.peripheral) / data.summary.nodes * 100);
  return <main className="network-page"><div className="network-heading"><div><h1>Карта финансовой сети</h1><p>Исследуйте связи, роли и причины приоритета каждого gid</p></div><Link href="/"><ArrowLeft size={14}/> К панели</Link></div>
    <div className="network-layout"><section className="dash-panel network-main-panel"><div className="panel-title"><div><h2>Направленные потоки</h2><p className="panel-subtitle">Плательщик → получатель · 4 колена</p></div><span className="panel-menu">{coverage}% с ролью</span></div>
      <div className="network-tools"><form className="network-search" onSubmit={submit}><Search size={16}/><input value={query} onChange={event => { setQuery(event.target.value); setError(""); }} placeholder="Найти gid" inputMode="numeric" aria-label="Поиск gid"/></form>
        <select value={cluster} onChange={event => { setCluster(event.target.value); setMode("overview"); }} aria-label="Кластер"><option value="all">Все кластеры</option>{clusters.map(item => <option key={item.cluster_id} value={item.cluster_id}>Кластер {item.cluster_id} · {item.n_nodes}</option>)}</select>
        <select value={role} onChange={event => { setRole(event.target.value); setMode("overview"); }} aria-label="Роль"><option value="all">Все роли</option>{Object.entries(names).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <button type="button" className={mode === "overview" ? "is-selected" : ""} onClick={() => setMode("overview")}>Обзор</button><button type="button" className={mode === "focus" ? "is-selected" : ""} onClick={() => setMode("focus")}>Связи узла</button>
      </div>
      {suggestions.length > 0 && <div className="search-hints" aria-label="Найденные gid">{suggestions.map(node => <button type="button" key={node.gid} onClick={() => choose(node.gid)}>{node.gid}<span>{names[node.role]}</span></button>)}</div>}
      {error && <p className="search-error" role="alert">{error}</p>}
      <div className="network-canvas-wrap"><svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Схема направленных связей. Узлы доступны для выбора мышью и клавиатурой.">
        <defs><marker id="arrow-muted" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--muted)"/></marker><marker id="arrow-orange" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--orange)"/></marker></defs>
        {mode === "overview" ? Array.from({ length: 5 }, (_, depth) => <g key={depth}><line x1={35 + depth * 195} y1="24" x2={35 + depth * 195} y2="490" stroke="var(--grid-line)" opacity=".35" strokeDasharray="3 5"/><text x={35 + depth * 195} y="16" textAnchor="middle" fill="var(--muted)" fontSize="10">{depth === 0 ? "SEED" : `${depth} КОЛЕНО`}</text></g>) : <><text x="95" y="22" fill="var(--muted)" fontSize="11">ОТ КОГО</text><text x="660" y="22" fill="var(--muted)" fontSize="11">КОМУ</text></>}
        {edges.map((edge: GraphEdge, index) => { const src = points.get(edge.src)!, dst = points.get(edge.dst)!; const active = edge.src === selected.gid || edge.dst === selected.gid; const length = Math.hypot(dst.x - src.x, dst.y - src.y) || 1; const endX = dst.x - (dst.x - src.x) / length * 7, endY = dst.y - (dst.y - src.y) / length * 7; return <line key={`${edge.src}-${edge.dst}-${index}`} x1={src.x} y1={src.y} x2={endX} y2={endY} stroke={active ? "var(--orange)" : "var(--muted)"} strokeWidth={active ? 1.4 : .8} opacity={active ? .75 : mode === "focus" ? .45 : .20} markerEnd={active ? "url(#arrow-orange)" : "url(#arrow-muted)"}/>; })}
        {positions.map(({ node, x, y }) => <g key={node.gid} role="button" tabIndex={0} aria-label={`gid ${node.gid}, ${names[node.role]}, приоритет ${Math.round(node.priority_score * 100)} процентов`} onClick={() => choose(node.gid)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(node.gid); } }} style={{ cursor: "pointer" }}><title>{`${node.gid} · ${names[node.role]}`}</title>{node.gid === selected.gid && <circle cx={x} cy={y} r="15" fill="var(--orange)" opacity=".16"/>}<circle cx={x} cy={y} r={node.gid === selected.gid ? 8 : 3 + node.priority_score * 3} fill={colors[node.role]} stroke={node.gid === selected.gid ? "white" : "none"} strokeWidth="2"/><circle cx={x} cy={y} r="12" fill="transparent"/></g>)}
      </svg></div><div className="network-foot"><span>{number.format(positions.length)} узлов · {number.format(edges.length)} связей на схеме</span><span>Стрелки показывают направление перевода</span></div><div className="network-legend">{Object.entries(names).map(([key, label]) => <span key={key}><i style={{ "--legend-color": colors[key as Role] } as React.CSSProperties}/>{label}</span>)}</div>
    </section>
    <aside className="dash-panel inspector-panel"><div className="panel-title"><div><h2>Карточка узла</h2><p className="panel-subtitle">Гипотеза для проверки</p></div></div><div className="inspector-body"><div className="inspector-id">Идентификатор gid<strong>{selected.gid}</strong></div><div className="node-tags"><span className="node-tag" style={{ "--tag-color": colors[selected.role], "--tag-bg": `color-mix(in oklch, ${colors[selected.role]} 17%, transparent)` } as React.CSSProperties}>{names[selected.role]}</span>{selected.is_seed && <span className="node-tag secondary">Исходный gid</span>}{selected.truncated_by_depth && <span className="node-tag secondary">Граница 4-го колена</span>}</div>
      <div className="inspector-score"><small>Приоритет для проверки</small><strong>{Math.round(selected.priority_score * 100)}%</strong><div className="score-track"><i style={{ "--score": `${selected.priority_score * 100}%` } as React.CSSProperties}/></div></div>
      <div className="inspector-stats"><div><small>Входящих связей</small><strong>{number.format(selected.in_deg)}</strong></div><div><small>Исходящих связей</small><strong>{number.format(selected.out_deg)}</strong></div><div><small>Получено в графе</small><strong>{compact.format(selected.in_kzt)} ₸</strong></div><div><small>Отправлено в графе</small><strong>{compact.format(selected.out_kzt)} ₸</strong></div><div><small>Достигают seed</small><strong>{selected.seed_reach}</strong></div><div><small>Уверенность в роли</small><strong>{Math.round(selected.role_score * 100)}%</strong></div></div>
      <p className="evidence-heading">Обоснование</p><p className="evidence-text">{selected.evidence}</p><div className="neighbor-list" aria-label="Связанные узлы">{neighborIds.map(id => <button type="button" key={id} onClick={() => choose(id)} title={`Открыть gid ${id}`}>{id.slice(-8)}</button>)}</div></div></aside></div>
    <div className="network-warning"><Info size={17}/><span><strong>Предел данных.</strong> У seed входящий поток неполон; на 4-м колене дальнейшие переводы не наблюдаются. Роль не является утверждением о виновности.</span></div>
    <section className="dash-panel network-priority-panel" aria-labelledby="network-priority-title"><div className="panel-title"><div><h2 id="network-priority-title">50 узлов для первоочередной проверки</h2><p className="panel-subtitle">Нажмите на gid, чтобы увидеть направленные связи и основание роли</p></div><div className="export-links"><a href="/exports/nodes_roles.csv"><Download size={14}/> Роли</a><a href="/exports/clusters.csv"><Download size={14}/> Кластеры</a><a href="/exports/top_nodes.csv"><Download size={14}/> Топ-50</a></div></div><div className="network-priority-scroll"><table><thead><tr><th>№</th><th>gid</th><th>Гипотеза о роли</th><th>Приоритет</th><th>Обоснование</th></tr></thead><tbody>{leaders.map((node, index) => <tr key={node.gid}><td>{String(index + 1).padStart(2, "0")}</td><td><button type="button" onClick={() => choose(node.gid, true)}>{node.gid}</button></td><td>{names[node.role]}</td><td>{Math.round(node.priority_score * 100)}%</td><td>{node.evidence}</td></tr>)}</tbody></table></div></section>
  </main>;
}
