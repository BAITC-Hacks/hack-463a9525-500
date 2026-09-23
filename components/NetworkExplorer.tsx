"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Info, Search } from "lucide-react";
import type { GraphData, GraphNode, Role } from "@/lib/data";
import GraphCanvas from "@/components/GraphCanvas";

const names: Record<Role, string> = { coordinator: "Координация", consolidator: "Консолидация", distributor: "Распределение", transit: "Транзит", terminal: "Получатель", peripheral: "Периферия" };
const colors: Record<Role, string> = { coordinator: "var(--orange)", consolidator: "var(--amber)", distributor: "var(--violet)", transit: "var(--cyan)", terminal: "var(--blue)", peripheral: "var(--muted)" };
const roleGuide: Record<Role, string> = {
  coordinator: "Узел связывает несколько потоков или сообществ. Проверьте его входящих и исходящих контрагентов.",
  consolidator: "На счёт поступают средства от нескольких плательщиков. Проверьте источники и дальнейшие переводы.",
  distributor: "Счёт переводит средства многим получателям. Проверьте назначения и время операций.",
  transit: "Видимый входящий поток сопоставим с исходящим и есть близкие по времени суммы.",
  terminal: "В наблюдаемой сети исходящих переводов нет. Это только возможная точка остановки.",
  peripheral: "Для уверенной структурной роли пока недостаточно наблюдаемых признаков."
};
const number = new Intl.NumberFormat("ru-RU");
const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

type Position = { node: GraphNode; x: number; y: number };
const WIDTH = 1500, HEIGHT = 900;

function hash(id: string) {
  let result = 2166136261;
  for (const character of id) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

export default function NetworkExplorer({ data, initialGid, initialCluster }: { data: GraphData; initialGid?: string; initialCluster?: string }) {
  const byId = useMemo(() => new Map(data.nodes.map(node => [node.gid, node])), [data.nodes]);
  const highest = useMemo(() => [...data.nodes].filter(node => !initialCluster || String(node.cluster_id) === initialCluster)
    .sort((a, b) => b.priority_score - a.priority_score)[0] || data.nodes[0], [data.nodes, initialCluster]);
  const [selected, setSelected] = useState<GraphNode>(byId.get(initialGid || "") || highest);
  const [hasSelection, setHasSelection] = useState(true);
  const [mode, setMode] = useState<"overview" | "focus">(initialCluster && !initialGid ? "overview" : "focus");
  const [query, setQuery] = useState("");
  const [cluster, setCluster] = useState(initialCluster && data.clusters.some(item => String(item.cluster_id) === initialCluster) ? initialCluster : "all");
  const [role, setRole] = useState("all");
  const [depth, setDepth] = useState("all");
  const [minPriority, setMinPriority] = useState(0);
  const [minVolume, setMinVolume] = useState(0);
  const [seedOnly, setSeedOnly] = useState(false);
  const [boundaryOnly, setBoundaryOnly] = useState(false);
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);
  const [error, setError] = useState(initialGid && !byId.has(initialGid) ? `GID ${initialGid} не найден в предоставленной выгрузке` : "");
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function handleSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); searchInput.current?.focus();
      }
    }
    window.addEventListener("keydown", handleSearch);
    return () => window.removeEventListener("keydown", handleSearch);
  }, []);

  const incoming = useMemo(() => data.edges.filter(edge => edge.dst === selected.gid).sort((a, b) => b.sum_kzt - a.sum_kzt), [data.edges, selected.gid]);
  const outgoing = useMemo(() => data.edges.filter(edge => edge.src === selected.gid).sort((a, b) => b.sum_kzt - a.sum_kzt), [data.edges, selected.gid]);
  const positions = useMemo(() => {
    if (mode === "focus") {
      const sourceIds = [...new Set(incoming.slice(0, 35).map(edge => edge.src))].filter(id => id !== selected.gid);
      const targetIds = [...new Set(outgoing.slice(0, 35).map(edge => edge.dst))].filter(id => id !== selected.gid && !sourceIds.includes(id));
      const result: Position[] = [{ node: selected, x: WIDTH / 2, y: HEIGHT * .32 }];
      sourceIds.forEach((id, index) => { const node = byId.get(id); if (node) result.push({ node, x: 270 + hash(id) % 80, y: 45 + (index + .5) * (HEIGHT - 90) / Math.max(sourceIds.length, 1) }); });
      targetIds.forEach((id, index) => { const node = byId.get(id); if (node) result.push({ node, x: 1130 - hash(id) % 80, y: 45 + (index + .5) * (HEIGHT - 90) / Math.max(targetIds.length, 1) }); });
      return result;
    }
    const nodes = data.nodes.filter(node => (cluster === "all" || String(node.cluster_id) === cluster) && (role === "all" || node.role === role) &&
      (depth === "all" || String(node.depth) === depth) && node.priority_score * 100 >= minPriority &&
      (node.in_kzt + node.out_kzt) >= minVolume && (!seedOnly || node.is_seed) &&
      (!boundaryOnly || node.truncated_by_depth) && (!anomaliesOnly || node.anomaly_score >= .75)).sort((a, b) => b.priority_score - a.priority_score);
    const columns: GraphNode[][] = [[], [], [], [], []];
    nodes.forEach(node => columns[Math.min(4, Math.max(0, node.depth))].push(node));
    const result: Position[] = [];
    columns.forEach((column, depth) => {
      column.sort((a, b) => a.cluster_id - b.cluster_id || b.priority_score - a.priority_score);
      column.forEach((node, index) => result.push({ node, x: 85 + depth * 325 + (hash(node.gid) % 190 - 95), y: 30 + (index + .5) * (HEIGHT - 60) / Math.max(column.length, 1) + (hash(node.gid) % 19 - 9) }));
    });
    return result;
  }, [mode, selected, incoming, outgoing, byId, data.nodes, cluster, role, depth, minPriority, minVolume, seedOnly, boundaryOnly, anomaliesOnly]);

  const points = useMemo(() => new Map(positions.map(position => [position.node.gid, position])), [positions]);
  const edges = useMemo(() => data.edges.filter(edge => points.has(edge.src) && points.has(edge.dst)), [data.edges, points]);
  const suggestions = query.trim().length >= 4 ? data.nodes.filter(node => node.gid.includes(query.trim())).slice(0, 6) : [];
  const clusters = useMemo(() => data.clusters.filter(item => item.n_nodes > 1).sort((a, b) => b.n_nodes - a.n_nodes).slice(0, 25), [data.clusters]);
  const leaders = useMemo(() => [...data.nodes].sort((a, b) => b.priority_score - a.priority_score).slice(0, 50), [data.nodes]);

  function choose(id: string, scroll = false) {
    const node = byId.get(id);
    if (!node) { setError("gid не найден в предоставленной выгрузке"); return; }
    setSelected(node); setHasSelection(true); setMode("focus"); setQuery(""); setError("");
    window.history.replaceState(null, "", `/network?gid=${node.gid}`);
    if (scroll) document.querySelector(".network-layout")?.scrollIntoView({ behavior: "auto", block: "start" });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    choose(byId.has(query.trim()) ? query.trim() : suggestions[0]?.gid || query.trim());
  }

  const neighborIds = [...new Set([...incoming.slice(0, 3).map(edge => edge.src), ...outgoing.slice(0, 3).map(edge => edge.dst)])];
  const coverage = Math.round((data.summary.nodes - data.summary.role_counts.peripheral) / data.summary.nodes * 100);
  return <main className="network-page"><div className="network-heading"><div><h1>Карта финансовой сети</h1><p>Начните с выбранного счёта. Слева — от кого пришли деньги, справа — кому ушли.</p></div><Link href="/"><ArrowLeft size={14}/> К панели</Link></div>
    <div className="network-guide"><span><b>1</b> Найдите GID или выберите узел</span><span><b>2</b> Проследите стрелки переводов</span><span><b>3</b> Сверьте вывод с цифрами справа</span></div>
    <div className="network-layout"><section className="dash-panel network-main-panel"><div className="panel-title"><div><h2>Направленные потоки</h2><p className="panel-subtitle">Плательщик → получатель · 4 колена</p></div><span className="panel-menu">{coverage}% структурных ролей</span></div>
      <div className="network-tools"><form className="network-search" onSubmit={submit}><Search size={16}/><input ref={searchInput} value={query} onChange={event => { setQuery(event.target.value); setError(""); }} placeholder="Найти GID · ⌘K" inputMode="numeric" aria-label="Поиск gid"/></form>
        <select value={cluster} onChange={event => { setCluster(event.target.value); setMode("overview"); }} aria-label="Кластер"><option value="all">Все кластеры</option>{clusters.map(item => <option key={item.cluster_id} value={item.cluster_id}>Кластер {item.cluster_id} · {item.n_nodes}</option>)}</select>
        <select value={role} onChange={event => { setRole(event.target.value); setMode("overview"); }} aria-label="Роль"><option value="all">Все роли</option>{Object.entries(names).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select value={depth} onChange={event => { setDepth(event.target.value); setMode("overview"); }} aria-label="Глубина"><option value="all">Все глубины</option>{[0, 1, 2, 3, 4].map(value => <option key={value} value={value}>Глубина {value}</option>)}</select>
        <button type="button" className={mode === "overview" ? "is-selected" : ""} onClick={() => setMode("overview")}>Вся сеть</button><button type="button" className={mode === "focus" ? "is-selected" : ""} onClick={() => { setHasSelection(true); setMode("focus"); }}>Соседи счёта</button>
      </div>
      <details className="filter-drawer"><summary>Дополнительные фильтры</summary><div className="network-extra-filters"><label>Приоритет от {minPriority}% <input type="range" min="0" max="95" step="5" value={minPriority} onChange={event => { setMinPriority(Number(event.target.value)); setMode("overview"); }}/></label><label>Поток от <select value={minVolume} onChange={event => { setMinVolume(Number(event.target.value)); setMode("overview"); }} aria-label="Минимальный наблюдаемый поток"><option value="0">0 ₸</option><option value="100000">100 тыс. ₸</option><option value="1000000">1 млн ₸</option><option value="10000000">10 млн ₸</option></select></label><label><input type="checkbox" checked={seedOnly} onChange={event => { setSeedOnly(event.target.checked); setMode("overview"); }}/> Только seed</label><label><input type="checkbox" checked={boundaryOnly} onChange={event => { setBoundaryOnly(event.target.checked); setMode("overview"); }}/> Граница данных</label><label><input type="checkbox" checked={anomaliesOnly} onChange={event => { setAnomaliesOnly(event.target.checked); setMode("overview"); }}/> Необычные</label><button type="button" onClick={() => { setCluster("all"); setRole("all"); setDepth("all"); setMinPriority(0); setMinVolume(0); setSeedOnly(false); setBoundaryOnly(false); setAnomaliesOnly(false); setMode("overview"); }}>Сбросить фильтры</button></div></details>
      {suggestions.length > 0 && <div className="search-hints" aria-label="Найденные gid">{suggestions.map(node => <button type="button" key={node.gid} onClick={() => choose(node.gid)}>{node.gid}<span>{names[node.role]}</span></button>)}</div>}
      {error && <p className="search-error" role="alert">{error}</p>}
      <GraphCanvas positions={positions} edges={edges} selectedGid={hasSelection ? selected.gid : ""} mode={mode} onSelect={gid => choose(gid)} onClear={() => { setHasSelection(false); setMode("overview"); }}/><div className="network-foot"><span>{number.format(positions.length)} узлов · {number.format(edges.length)} связей на схеме</span><span>Наведите на точку для подсказки · колесо для масштаба</span></div><div className="network-legend">{Object.entries(names).map(([key, label]) => <span key={key}><i style={{ "--legend-color": colors[key as Role] } as React.CSSProperties}/>{label}</span>)}</div>
    </section>
    <aside className="dash-panel inspector-panel"><div className="panel-title"><div><h2>Что видно по счёту</h2><p className="panel-subtitle">Гипотеза для проверки человеком</p></div></div>{hasSelection ? <div className="inspector-body"><div className="inspector-id">GID счёта<strong>{selected.gid}</strong></div><div className="node-tags"><span className="node-tag" style={{ "--tag-color": colors[selected.role], "--tag-bg": `color-mix(in oklch, ${colors[selected.role]} 17%, transparent)` } as React.CSSProperties}>{names[selected.role]}</span>{selected.is_seed && <span className="node-tag secondary">Исходный gid</span>}{selected.truncated_by_depth && <span className="node-tag secondary">Граница 4-го колена</span>}</div><p className="inspector-guide">{roleGuide[selected.role]}</p>
      <div className="inspector-score"><small>Приоритет для проверки</small><strong>{Math.round(selected.priority_score * 100)}%</strong><div className="score-track"><i style={{ "--score": `${selected.priority_score * 100}%` } as React.CSSProperties}/></div></div>
      <div className="inspector-stats"><div><small>Входящих связей</small><strong>{number.format(selected.in_deg)}</strong></div><div><small>Исходящих связей</small><strong>{number.format(selected.out_deg)}</strong></div><div><small>Получено в графе</small><strong>{compact.format(selected.in_kzt)} ₸</strong></div><div><small>Отправлено в графе</small><strong>{compact.format(selected.out_kzt)} ₸</strong></div><div><small>Входящих операций</small><strong>{number.format(selected.in_tx)}</strong></div><div><small>Исходящих операций</small><strong>{number.format(selected.out_tx)}</strong></div><div><small>Кластер / глубина</small><strong>{selected.cluster_id} / {selected.depth}</strong></div><div><small>Сила роли</small><strong>{Math.round(selected.role_score * 100)}%</strong></div><div><small>PageRank</small><strong>{selected.weighted_pagerank.toExponential(2)}</strong></div><div><small>Посредничество</small><strong>{selected.betweenness_centrality.toFixed(4)}</strong></div><div><small>Быстрые похожие суммы</small><strong>{Math.round(selected.similar_amount_rapid_share * 100)}%</strong></div><div><small>Seed в путях</small><strong>{selected.seed_reach}</strong></div></div>
      <p className="evidence-heading">Обоснование</p><p className="evidence-text">{selected.evidence}</p><div className="neighbor-list" aria-label="Связанные узлы">{neighborIds.map(id => <button type="button" key={id} onClick={() => choose(id)} title={`Открыть gid ${id}`}>{id.slice(-8)}</button>)}</div></div> : <div className="inspector-empty"><strong>Выберите счёт на графе</strong><p>Наведите на точку для подсказки, затем нажмите на неё. Можно также ввести GID в поиск выше.</p></div>}</aside></div>
    <div className="network-warning"><Info size={17}/><span><strong>Ограниченная видимость.</strong> У seed входящий поток неполон; на 4-м колене дальнейшие переводы не наблюдаются. Роль не является утверждением о виновности.</span></div>
    <section className="dash-panel network-priority-panel" aria-labelledby="network-priority-title"><div className="panel-title"><div><h2 id="network-priority-title">50 узлов для первоочередной проверки</h2><p className="panel-subtitle">Нажмите на gid, чтобы увидеть направленные связи и основание роли</p></div><div className="export-links"><a href="/exports/nodes_roles.csv"><Download size={14}/> Роли</a><a href="/exports/clusters.csv"><Download size={14}/> Кластеры</a><a href="/exports/top_nodes.csv"><Download size={14}/> Топ-50</a></div></div><div className="network-priority-scroll"><table><thead><tr><th>№</th><th>gid</th><th>Гипотеза о роли</th><th>Приоритет</th><th>Обоснование</th></tr></thead><tbody>{leaders.map((node, index) => <tr key={node.gid}><td>{String(index + 1).padStart(2, "0")}</td><td><button type="button" onClick={() => choose(node.gid, true)}>{node.gid}</button></td><td>{names[node.role]}</td><td>{Math.round(node.priority_score * 100)}%</td><td>{node.evidence}</td></tr>)}</tbody></table></div></section>
  </main>;
}
