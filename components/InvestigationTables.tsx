"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Download, Search } from "lucide-react";
import type { Cluster, GraphData, Role } from "@/lib/data";

const names: Record<Role, string> = {
  coordinator: "Координация", consolidator: "Консолидация", distributor: "Распределение",
  transit: "Возможный транзит", terminal: "Возможный конечный получатель", peripheral: "Периферия"
};
const description: Record<Role, string> = {
  coordinator: "связывает важные части сети", consolidator: "получает средства от нескольких плательщиков",
  distributor: "переводит средства многим получателям", transit: "показывает признаки быстрого прохождения средств",
  terminal: "может быть точкой остановки видимого потока", peripheral: "не имеет устойчивого специального профиля"
};
const number = new Intl.NumberFormat("ru-RU");
const short = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

function roleMix(cluster: Cluster) {
  let distribution: Record<string, number> = {};
  try { distribution = JSON.parse(cluster.role_distribution); } catch { /* Older export */ }
  return Object.entries(distribution).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([role, count]) => ({ role: names[role as Role] || role, count }));
}

export default function InvestigationTables({ data, section }: { data: GraphData; section: "priorities" | "clusters" }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [cluster, setCluster] = useState("all");
  const [threshold, setThreshold] = useState(0);
  const [visible, setVisible] = useState(20);
  const priorities = useMemo(() => [...data.nodes].sort((a, b) => b.priority_score - a.priority_score)
    .filter(node => (role === "all" || node.role === role) && (cluster === "all" || String(node.cluster_id) === cluster) &&
      node.priority_score * 100 >= threshold && (!query || node.gid.includes(query.trim()))), [data.nodes, query, role, cluster, threshold]);
  const communities = useMemo(() => [...data.clusters].sort((a, b) => b.n_nodes - a.n_nodes)
    .filter(item => !query || String(item.cluster_id).includes(query.trim()) || item.top_gids.includes(query.trim())), [data.clusters, query]);
  const isPriority = section === "priorities";
  const count = isPriority ? priorities.length : communities.length;
  return <main className="listing-page">
    <div className="network-heading"><div><h1>{isPriority ? "С чего начать проверку" : "Группы связанных счетов"}</h1><p>{isPriority ? "Самые важные узлы для ручной проверки. Оценка показывает порядок работы, а не вину." : "Кластеры — части сети с плотными связями. Откройте группу и проверьте ключевые счета."}</p></div><a className="listing-export" href={`/exports/${isPriority ? "top_nodes" : "clusters"}.csv`}><Download size={15}/> Скачать CSV</a></div>
    <div className="listing-explainer"><b>{isPriority ? "Как читать очередь" : "Как читать кластер"}</b><span>{isPriority ? "Роль объясняет поведение счёта в видимой сети. Приоритет помогает выбрать, что изучить первым. Нажмите «Посмотреть связи», чтобы увидеть переводы." : "Размер — число счетов, поток — сумма переводов внутри группы. Гипотеза помогает начать анализ, но не доказывает связь людей между собой."}</span></div>
    <section className="dash-panel listing-panel"><div className="listing-toolbar"><label className="network-search"><Search size={16}/><input value={query} onChange={event => { setQuery(event.target.value); setVisible(20); }} placeholder={isPriority ? "Найти точный GID" : "Номер кластера или GID"} aria-label="Поиск"/></label>
      {isPriority && <><select value={role} onChange={event => { setRole(event.target.value); setVisible(20); }} aria-label="Фильтр роли"><option value="all">Все роли</option>{Object.entries(names).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={cluster} onChange={event => { setCluster(event.target.value); setVisible(20); }} aria-label="Фильтр кластера"><option value="all">Все кластеры</option>{data.clusters.map(item => <option key={item.cluster_id} value={item.cluster_id}>Кластер {item.cluster_id}</option>)}</select><label className="threshold-control">От {threshold}%<input type="range" min="0" max="95" step="5" value={threshold} onChange={event => { setThreshold(Number(event.target.value)); setVisible(20); }}/></label></>}
      <span className="listing-count">Найдено: {number.format(count)}</span></div>
      {isPriority ? <div className="priority-cards">{priorities.slice(0, visible).map((node, index) => <article className="priority-card" key={node.gid}>
        <div className="priority-index">{String(index + 1).padStart(2, "0")}</div><div className="priority-main"><div className="priority-main-top"><span className="priority-role">{names[node.role]}</span><span className="priority-cluster">Кластер {node.cluster_id}</span></div><h2>{description[node.role]}</h2><p>{node.evidence}</p><div className="priority-identity">Счёт <code>{node.gid}</code> · глубина {node.depth}/4</div></div>
        <div className="priority-action"><span>Приоритет проверки</span><strong>{Math.round(node.priority_score * 100)}%</strong><div className="priority-track"><i style={{ width: `${node.priority_score * 100}%` }}/></div><small>Сила роли {Math.round(node.role_score * 100)}%</small><Link href={`/network?gid=${node.gid}`}>Посмотреть связи <ArrowUpRight size={14}/></Link></div>
      </article>)}{priorities.length > visible && <button className="listing-more" type="button" onClick={() => setVisible(value => value + 20)}>Показать ещё 20 из {number.format(priorities.length)}</button>}</div> : <div className="cluster-grid">{communities.slice(0, visible).map(item => {
        const mix = roleMix(item); const topGid = item.top_gids.split(";")[0];
        return <article className="cluster-card" key={item.cluster_id}><div className="cluster-card-head"><span>ГРУППА {item.cluster_id}</span><strong>{number.format(item.n_nodes)} счетов</strong></div><p className="cluster-plain">{item.hypothesis}</p><div className="cluster-facts"><div><small>Известных исходных счетов</small><strong>{item.n_seed}</strong></div><div><small>Переводы внутри группы</small><strong>{short.format(item.sum_kzt_internal)} ₸</strong></div></div><div className="cluster-mix"><small>Какие роли встречаются чаще</small>{mix.map(entry => <div key={entry.role}><span>{entry.role}</span><b>{entry.count}</b></div>)}</div><div className="cluster-actions"><Link href={`/network?cluster=${item.cluster_id}`}>Показать группу <ArrowUpRight size={13}/></Link>{topGid && <Link href={`/network?gid=${topGid}`}>Ключевой счёт</Link>}</div></article>;
      })}{communities.length > visible && <button className="listing-more cluster-more" type="button" onClick={() => setVisible(value => value + 20)}>Показать ещё группы</button>}</div>}
      {count === 0 && <p className="listing-empty">По выбранным условиям ничего не найдено. Попробуйте сбросить фильтр или другой GID.</p>}
    </section>
  </main>;
}
