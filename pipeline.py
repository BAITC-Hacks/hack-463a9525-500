#!/usr/bin/env python3
"""Reproducible, explainable analysis of the supplied transfer network."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

ROLES = {"consolidator", "transit", "distributor", "terminal", "coordinator", "peripheral"}
ROLE_LABELS = {
    "consolidator": "Консолидация",
    "transit": "Транзит",
    "distributor": "Распределение",
    "terminal": "Конечный получатель",
    "coordinator": "Координация",
    "peripheral": "Периферия",
}


def load_and_validate(data_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    nodes = pd.read_parquet(data_dir / "nodes.parquet")
    edges = pd.read_parquet(data_dir / "edges.parquet")
    transactions = pd.read_parquet(data_dir / "transactions.parquet")
    for table, columns in (
        (nodes, {"gid", "depth", "is_seed"}),
        (edges, {"src", "dst", "sum_kzt", "n_tx", "depth"}),
        (transactions, {"src", "dst", "date", "sum_kzt"}),
    ):
        if not columns.issubset(table.columns):
            raise ValueError(f"Missing columns: {sorted(columns - set(table.columns))}")
    if nodes.gid.duplicated().any() or edges.duplicated(["src", "dst"]).any():
        raise ValueError("Duplicate node or edge identifiers")
    if not (set(edges.src) | set(edges.dst)).issubset(set(nodes.gid)):
        raise ValueError("An edge references a missing node")
    if (edges.sum_kzt < 0).any() or (transactions.sum_kzt < 0).any():
        raise ValueError("Negative transfers are not supported")
    grouped = transactions.groupby(["src", "dst"]).sum_kzt.agg(["sum", "size"])
    check = edges.set_index(["src", "dst"])[["sum_kzt", "n_tx"]].join(grouped, how="outer")
    if check.isna().any().any() or not np.allclose(check.sum_kzt, check["sum"], atol=0.02) or not (check.n_tx == check["size"]).all():
        raise ValueError("Transaction totals do not match aggregated edges")
    transactions["date"] = pd.to_datetime(transactions.date)
    return nodes, edges, transactions


def graph_features(nodes: pd.DataFrame, edges: pd.DataFrame, tx: pd.DataFrame) -> tuple[pd.DataFrame, nx.DiGraph]:
    graph = nx.DiGraph()
    graph.add_nodes_from(int(gid) for gid in nodes.gid)
    for row in edges.itertuples(index=False):
        graph.add_edge(int(row.src), int(row.dst), sum_kzt=float(row.sum_kzt), n_tx=int(row.n_tx))

    frame = nodes[["gid", "depth", "is_seed"]].copy()
    for column, values, dtype in (
        ("in_deg", graph.in_degree(), int),
        ("out_deg", graph.out_degree(), int),
        ("in_kzt", graph.in_degree(weight="sum_kzt"), float),
        ("out_kzt", graph.out_degree(weight="sum_kzt"), float),
        ("in_tx", graph.in_degree(weight="n_tx"), int),
        ("out_tx", graph.out_degree(weight="n_tx"), int),
    ):
        frame[column] = frame.gid.map(dict(values)).fillna(0).astype(dtype)
    frame["pagerank"] = frame.gid.map(nx.pagerank(graph, weight="sum_kzt"))
    frame["pass_through"] = np.where(frame.in_kzt > 0, frame.out_kzt / frame.in_kzt.replace(0, np.nan), np.nan)
    frame["truncated_by_depth"] = (frame.depth == 4) & (frame.out_deg == 0)

    # Count distinct known seeds reaching each node in up to four directed hops.
    seed_reach = Counter()
    for seed in frame.loc[frame.is_seed, "gid"]:
        distances = nx.single_source_shortest_path_length(graph, int(seed), cutoff=4)
        seed_reach.update(gid for gid, distance in distances.items() if distance > 0)
    frame["seed_reach"] = frame.gid.map(seed_reach).fillna(0).astype(int)

    # Temporal corroboration: share of incoming transfers followed by any outgoing
    # transfer from the same account within two calendar days. This is a signal,
    # not proof that a specific incoming payment was forwarded.
    out_dates: dict[int, list[pd.Timestamp]] = defaultdict(list)
    for row in tx.itertuples(index=False):
        out_dates[int(row.src)].append(row.date)
    for dates in out_dates.values():
        dates.sort()
    rapid: Counter[int] = Counter()
    incoming: Counter[int] = Counter()
    from bisect import bisect_left

    for row in tx.itertuples(index=False):
        gid = int(row.dst)
        incoming[gid] += 1
        dates = out_dates.get(gid, [])
        index = bisect_left(dates, row.date)
        if index < len(dates) and (dates[index] - row.date).days <= 2:
            rapid[gid] += 1
    frame["rapid_share"] = frame.gid.map(lambda gid: rapid[int(gid)] / incoming[int(gid)] if incoming[int(gid)] else 0.0)
    return frame, graph


def assign_clusters(frame: pd.DataFrame, graph: nx.DiGraph) -> pd.DataFrame:
    undirected = nx.Graph()
    undirected.add_nodes_from(graph.nodes)
    for src, dst, data in graph.edges(data=True):
        if undirected.has_edge(src, dst):
            undirected[src][dst]["weight"] += data["sum_kzt"]
        else:
            undirected.add_edge(src, dst, weight=data["sum_kzt"])
    groups = nx.community.louvain_communities(undirected, weight="weight", resolution=1, seed=42)
    groups.sort(key=lambda group: (-len(group), min(group)))
    labels = {gid: cluster_id for cluster_id, group in enumerate(groups) for gid in group}
    frame["cluster_id"] = frame.gid.map(labels).astype(int)
    return frame


def normalized_log(series: pd.Series) -> pd.Series:
    values = np.log1p(series.clip(lower=0).astype(float))
    ceiling = float(values.quantile(0.99))
    return (values / ceiling).clip(0, 1) if ceiling else values * 0


def classify(frame: pd.DataFrame) -> pd.DataFrame:
    # Rules are intentionally discrete and auditable. Priority is independent
    # of guilt: it ranks hypotheses for human review, never makes a decision.
    role: list[str] = []
    confidence: list[float] = []
    evidence: list[str] = []
    for row in frame.itertuples(index=False):
        ratio = float(row.pass_through) if pd.notna(row.pass_through) else None
        if row.in_deg >= 3 and row.out_deg >= 3 and row.seed_reach >= 2 and row.in_kzt >= 100_000:
            current = "coordinator"
            score = min(0.95, 0.62 + 0.035 * row.seed_reach + 0.012 * min(row.in_deg + row.out_deg, 12))
            why = f"Признаки координации: {row.seed_reach} seed в путях, {row.in_deg} входящих и {row.out_deg} исходящих связей."
        elif row.out_deg >= 8 and row.out_deg >= 1.5 * max(1, row.in_deg):
            current = "distributor"
            score = min(0.97, 0.64 + 0.012 * row.out_deg)
            why = f"Признаки распределения: {row.out_deg} получателей, исходящий поток {row.out_kzt:,.0f} ₸."
        elif row.in_deg >= 4 and row.in_deg >= 1.5 * max(1, row.out_deg):
            current = "consolidator"
            score = min(0.97, 0.64 + 0.022 * row.in_deg)
            why = f"Признаки консолидации: {row.in_deg} плательщиков, входящий поток {row.in_kzt:,.0f} ₸."
        elif not row.is_seed and row.in_deg > 0 and row.out_deg > 0 and ratio is not None and 0.8 <= ratio <= 1.2:
            current = "transit"
            score = min(0.93, 0.68 + 0.12 * row.rapid_share + 0.03 * min(row.in_deg, row.out_deg))
            why = f"Признаки транзита: отдал {ratio:.0%} входящего; быстрый выход после {row.rapid_share:.0%} входящих операций."
        elif not row.is_seed and row.in_deg > 0 and row.out_deg == 0 and row.depth < 4:
            current = "terminal"
            score = min(0.94, 0.70 + 0.025 * row.in_deg)
            why = f"Вероятный конечный получатель: {row.in_deg} плательщиков, исходящих связей 0, глубина {row.depth}/4."
        else:
            current = "peripheral"
            score = 0.50 if row.truncated_by_depth else 0.60
            if row.truncated_by_depth:
                why = f"Граница наблюдения: глубина 4/4, входящих связей {row.in_deg}; дальнейшие переводы не видны."
            elif row.is_seed and row.in_deg == 0 and row.out_deg == 0:
                why = "Seed без наблюдаемых переводов в выгрузке; роль по сети не определяется."
            elif row.is_seed:
                why = f"Seed: {row.in_deg} входящих, {row.out_deg} исходящих связей; входящий поток неполон."
            else:
                why = f"Недостаточно признаков роли: {row.in_deg} входящих и {row.out_deg} исходящих связей."
        role.append(current)
        confidence.append(round(score, 3))
        evidence.append(why[:200])
    frame["role"] = role
    frame["role_score"] = confidence
    frame["evidence"] = evidence

    flow = normalized_log(frame.in_kzt + frame.out_kzt)
    connectivity = normalized_log(frame.in_deg + frame.out_deg)
    influence = normalized_log(frame.pagerank * 1_000_000)
    reach = normalized_log(frame.seed_reach)
    role_weight = frame.role.map({"coordinator": 1, "consolidator": .85, "distributor": .82, "transit": .72, "terminal": .50, "peripheral": .15})
    frame["priority_score"] = (0.24 * flow + 0.25 * connectivity + 0.20 * influence + 0.17 * reach + 0.14 * role_weight).clip(0, 1).round(4)
    return frame


def cluster_summary(frame: pd.DataFrame, edges: pd.DataFrame) -> pd.DataFrame:
    labels = frame.set_index("gid").cluster_id.to_dict()
    internal: Counter[int] = Counter()
    for row in edges.itertuples(index=False):
        if labels[int(row.src)] == labels[int(row.dst)]:
            internal[labels[int(row.src)]] += float(row.sum_kzt)
    records = []
    for cluster_id, group in frame.groupby("cluster_id", sort=True):
        role_counts = group.role.value_counts()
        dominant = role_counts.index[0]
        if len(group) == 1:
            hypothesis = "Изолированный узел; структура по наблюдаемым переводам не определяется."
        else:
            hypothesis = f"Гипотеза: группа переводов с преобладанием роли «{ROLE_LABELS[dominant].lower()}» ({int(role_counts.iloc[0])}/{len(group)} узлов)."
        top = group.nlargest(5, "priority_score")
        records.append({"cluster_id": int(cluster_id), "n_nodes": len(group), "n_seed": int(group.is_seed.sum()),
                        "sum_kzt_internal": round(internal[int(cluster_id)], 2),
                        "top_gids": ";".join(str(gid) for gid in top.gid), "hypothesis": hypothesis})
    return pd.DataFrame(records)


def export(frame: pd.DataFrame, edges: pd.DataFrame, tx: pd.DataFrame, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    fields = ["gid", "role", "role_score", "cluster_id", "priority_score", "evidence", "in_deg", "out_deg", "in_kzt", "out_kzt", "pagerank", "pass_through", "depth", "is_seed", "truncated_by_depth", "in_tx", "out_tx", "seed_reach", "rapid_share"]
    frame[fields].to_csv(out_dir / "nodes_roles.csv", index=False)
    clusters = cluster_summary(frame, edges)
    clusters.to_csv(out_dir / "clusters.csv", index=False)
    leaders = frame.sort_values(["priority_score", "gid"], ascending=[False, True]).head(50)
    leaders.assign(rank=range(1, len(leaders) + 1), why=leaders.evidence)[["rank", "gid", "role", "priority_score", "why"]].to_csv(out_dir / "top_nodes.csv", index=False)

    # JavaScript cannot represent 18-digit gid values exactly. Every id is a string.
    node_records = []
    for row in frame.itertuples(index=False):
        node_records.append({"gid": str(row.gid), "depth": int(row.depth), "is_seed": bool(row.is_seed),
                             "role": row.role, "role_score": float(row.role_score), "cluster_id": int(row.cluster_id),
                             "priority_score": float(row.priority_score), "evidence": row.evidence,
                             "in_deg": int(row.in_deg), "out_deg": int(row.out_deg), "in_kzt": round(float(row.in_kzt), 2),
                             "out_kzt": round(float(row.out_kzt), 2), "in_tx": int(row.in_tx), "out_tx": int(row.out_tx),
                             "seed_reach": int(row.seed_reach), "rapid_share": round(float(row.rapid_share), 3),
                             "pass_through": round(float(row.pass_through), 3) if pd.notna(row.pass_through) else None,
                             "truncated_by_depth": bool(row.truncated_by_depth)})
    edge_records = [{"src": str(row.src), "dst": str(row.dst), "sum_kzt": round(float(row.sum_kzt), 2), "n_tx": int(row.n_tx)} for row in edges.itertuples(index=False)]
    daily = tx.groupby("date").agg(amount=("sum_kzt", "sum"), count=("sum_kzt", "size")).reset_index()
    daily_records = [{"date": row.date.strftime("%Y-%m-%d"), "amount": round(float(row.amount), 2), "count": int(row.count)} for row in daily.itertuples(index=False)]
    summary = {"nodes": len(frame), "edges": len(edges), "transactions": len(tx), "seeds": int(frame.is_seed.sum()),
               "turnover_kzt": round(float(edges.sum_kzt.sum()), 2), "clusters": len(clusters),
               "period_start": tx.date.min().strftime("%Y-%m-%d"), "period_end": tx.date.max().strftime("%Y-%m-%d"),
               "role_counts": {role: int((frame.role == role).sum()) for role in sorted(ROLES)}}
    payload = {"summary": summary, "nodes": node_records, "edges": edge_records, "clusters": clusters.to_dict("records"), "daily": daily_records}
    (out_dir / "dashboard.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Готово: {len(frame)} узлов, {len(edges)} связей, {len(clusters)} кластеров → {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--out", type=Path, default=Path("out"))
    args = parser.parse_args()
    nodes, edges, tx = load_and_validate(args.data)
    frame, graph = graph_features(nodes, edges, tx)
    frame = assign_clusters(frame, graph)
    frame = classify(frame)
    export(frame, edges, tx, args.out)


if __name__ == "__main__":
    main()
