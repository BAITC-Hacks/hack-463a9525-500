#!/usr/bin/env python3
"""Reproducible, explainable analysis of the supplied transfer network."""

from __future__ import annotations

import argparse
import json
import time
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
    "terminal": "Возможная точка остановки",
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
        if table[list(columns)].isna().any().any():
            raise ValueError("Required source fields contain missing values")
    if nodes.gid.duplicated().any() or edges.duplicated(["src", "dst"]).any():
        raise ValueError("Duplicate node or edge identifiers")
    if not (set(edges.src) | set(edges.dst)).issubset(set(nodes.gid)):
        raise ValueError("An edge references a missing node")
    if not (set(transactions.src) | set(transactions.dst)).issubset(set(nodes.gid)):
        raise ValueError("A transaction references a missing node")
    if (edges.sum_kzt < 0).any() or (transactions.sum_kzt < 0).any():
        raise ValueError("Negative transfers are not supported")
    if (edges.n_tx <= 0).any() or not np.isfinite(edges.sum_kzt).all() or not np.isfinite(transactions.sum_kzt).all():
        raise ValueError("Transfer amounts and counts must be finite and positive")
    if not nodes.depth.between(0, 4).all():
        raise ValueError("Node depth must be between 0 and 4")
    grouped = transactions.groupby(["src", "dst"]).sum_kzt.agg(["sum", "size"])
    check = edges.set_index(["src", "dst"])[["sum_kzt", "n_tx"]].join(grouped, how="outer")
    if check.isna().any().any() or not np.allclose(check.sum_kzt, check["sum"], atol=0.02, rtol=0) or not (check.n_tx == check["size"]).all():
        raise ValueError("Transaction totals do not match aggregated edges")
    transactions["date"] = pd.to_datetime(transactions.date, errors="raise")
    if transactions.date.isna().any():
        raise ValueError("Transaction date is missing")
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


def percentile(series: pd.Series) -> pd.Series:
    """A rank in [0, 1], with zero-valued evidence receiving zero."""
    values = series.fillna(0).clip(lower=0)
    return values.rank(pct=True, method="average").where(values > 0, 0.0)


def enrich_features(frame: pd.DataFrame, graph: nx.DiGraph, tx: pd.DataFrame) -> pd.DataFrame:
    """Observed structural and temporal metrics; none imply complete account history."""
    frame = frame.copy()
    frame["in_degree"] = frame.in_deg
    frame["out_degree"] = frame.out_deg
    frame["unique_senders"] = frame.in_deg
    frame["unique_receivers"] = frame.out_deg
    frame["incoming_amount"] = frame.in_kzt
    frame["outgoing_amount"] = frame.out_kzt
    frame["incoming_tx_count"] = frame.in_tx
    frame["outgoing_tx_count"] = frame.out_tx
    frame["weighted_pagerank"] = frame.pagerank
    frame["pagerank"] = frame.gid.map(nx.pagerank(graph, weight=None)).fillna(0.0)
    # Sampling makes betweenness reproducible and practical on a laptop.
    frame["betweenness_centrality"] = frame.gid.map(
        nx.betweenness_centrality(graph, k=min(160, len(graph)), normalized=True, seed=42)
    ).fillna(0.0)
    components = sorted(nx.weakly_connected_components(graph), key=lambda group: (-len(group), min(group)))
    component_id = {gid: index for index, group in enumerate(components) for gid in group}
    component_size = {gid: len(group) for group in components for gid in group}
    frame["weak_component_id"] = frame.gid.map(component_id).astype(int)
    frame["weak_component_size"] = frame.gid.map(component_size).astype(int)

    for direction, key in (("incoming", "dst"), ("outgoing", "src")):
        stats = tx.groupby(key).sum_kzt.agg(["mean", "median", "max"])
        for stat, name in (("mean", "average"), ("median", "median"), ("max", "max")):
            frame[f"{name}_{direction}_transaction"] = frame.gid.map(stats[stat]).fillna(0.0)

    all_tx = pd.concat([
        tx[["src", "date", "sum_kzt"]].rename(columns={"src": "gid"}),
        tx[["dst", "date", "sum_kzt"]].rename(columns={"dst": "gid"}),
    ], ignore_index=True)
    all_tx["day"] = all_tx.date.dt.normalize()
    activity = all_tx.groupby("gid").agg(active_days=("day", "nunique"),
                                          first_transaction_date=("date", "min"),
                                          last_transaction_date=("date", "max"))
    frame["active_days"] = frame.gid.map(activity.active_days).fillna(0).astype(int)
    for key in ("first_transaction_date", "last_transaction_date"):
        frame[key] = frame.gid.map(activity[key]).dt.strftime("%Y-%m-%d").fillna("")
    daily = all_tx.groupby(["gid", "day"]).agg(count=("sum_kzt", "size"), volume=("sum_kzt", "sum"))
    daily_stats = daily.groupby(level=0).agg(daily_volume_std=("volume", "std"),
                                             daily_transaction_count_std=("count", "std"),
                                             max_daily_count=("count", "max"),
                                             mean_daily_count=("count", "mean"))
    for column in daily_stats:
        frame[column] = frame.gid.map(daily_stats[column]).fillna(0.0)
    frame["transaction_frequency"] = (frame.in_tx + frame.out_tx) / frame.active_days.replace(0, np.nan)
    frame["transaction_frequency"] = frame.transaction_frequency.fillna(0.0)
    frame["burstiness"] = ((frame.max_daily_count - frame.mean_daily_count) /
                           frame.max_daily_count.replace(0, np.nan)).fillna(0.0).clip(0, 1)

    labels = frame.set_index("gid").cluster_id.to_dict()
    adjacent_clusters: dict[int, set[int]] = defaultdict(set)
    sender_share: dict[int, float] = defaultdict(float)
    receiver_share: dict[int, float] = defaultdict(float)
    for gid in graph:
        inbound = [data["sum_kzt"] for _, _, data in graph.in_edges(int(gid), data=True)]
        outbound = [data["sum_kzt"] for _, _, data in graph.out_edges(int(gid), data=True)]
        sender_share[gid] = max(inbound, default=0) / sum(inbound) if inbound else 0.0
        receiver_share[gid] = max(outbound, default=0) / sum(outbound) if outbound else 0.0
        adjacent_clusters[gid] = {labels[other] for other in set(graph.predecessors(gid)) | set(graph.successors(gid))
                                  if labels[other] != labels[gid]}
    frame["largest_sender_share"] = frame.gid.map(sender_share).fillna(0.0)
    frame["largest_receiver_share"] = frame.gid.map(receiver_share).fillna(0.0)
    frame["sender_concentration"] = frame.largest_sender_share
    frame["receiver_concentration"] = frame.largest_receiver_share
    frame["number_of_connected_clusters"] = frame.gid.map(lambda gid: len(adjacent_clusters[int(gid)]))
    frame["cluster_bridge_score"] = percentile(frame.number_of_connected_clusters)
    frame["flow_imbalance"] = ((frame.out_kzt - frame.in_kzt) /
                               (frame.out_kzt + frame.in_kzt).replace(0, np.nan)).fillna(0.0)
    seed_ids = set(frame.loc[frame.is_seed, "gid"])
    frame["seed_neighbors_count"] = frame.gid.map(
        lambda gid: len((set(graph.predecessors(int(gid))) | set(graph.successors(int(gid)))) & seed_ids)
    )
    # Use transform to retain the original index on all supported pandas versions.
    total_volume = frame.in_kzt + frame.out_kzt
    frame["relative_volume_percentile"] = total_volume.groupby(frame.depth).transform(percentile)
    frame["relative_degree_percentile"] = (frame.in_deg + frame.out_deg).groupby(frame.depth).transform(percentile)
    frame["relative_pagerank_percentile"] = frame.weighted_pagerank.groupby(frame.depth).transform(percentile)

    # Similar-amount onward transfers within two days are possible patterns,
    # never proof that a particular incoming payment was forwarded.
    from bisect import bisect_left
    outgoing: dict[int, list[tuple[pd.Timestamp, float]]] = defaultdict(list)
    for row in tx.itertuples(index=False):
        outgoing[int(row.src)].append((row.date, float(row.sum_kzt)))
    for transfers in outgoing.values():
        transfers.sort()
    matching: Counter[int] = Counter()
    same_day: Counter[int] = Counter()
    incoming: Counter[int] = Counter()
    for row in tx.itertuples(index=False):
        gid = int(row.dst)
        incoming[gid] += 1
        transfers = outgoing.get(gid, [])
        start = bisect_left(transfers, (row.date, -1.0))
        for date, amount in transfers[start:]:
            delta = (date - row.date).days
            if delta > 2:
                break
            if 0.75 <= amount / float(row.sum_kzt) <= 1.25:
                matching[gid] += 1
                if delta == 0:
                    same_day[gid] += 1
                break
    frame["short_delay_flow_patterns"] = frame.gid.map(matching).fillna(0).astype(int)
    frame["same_day_in_out_patterns"] = frame.gid.map(same_day).fillna(0).astype(int)
    frame["similar_amount_rapid_share"] = frame.gid.map(
        lambda gid: matching[int(gid)] / incoming[int(gid)] if incoming[int(gid)] else 0.0
    )
    frame["pass_through_ratio"] = frame.pass_through.clip(upper=2.0)
    return frame


def classify(frame: pd.DataFrame) -> pd.DataFrame:
    """Continuous, depth-aware structural scores; strongest eligible role wins."""
    frame = frame.copy()
    p_in = percentile(frame.in_deg)
    p_out = percentile(frame.out_deg)
    p_in_amount = percentile(frame.in_kzt)
    p_out_amount = percentile(frame.out_kzt)
    p_weighted_pr = percentile(frame.weighted_pagerank)
    p_between = percentile(frame.betweenness_centrality)
    p_seed = percentile(frame.seed_reach)
    p_bridge = frame.cluster_bridge_score
    p_volume = frame.relative_volume_percentile
    p_burst = percentile(frame.burstiness * (frame.in_tx + frame.out_tx))
    balance = (1 - (frame.pass_through_ratio.fillna(0) - 1).abs()).clip(0, 1)
    sender_diversity = (1 - frame.largest_sender_share).clip(0, 1)
    receiver_diversity = (1 - frame.largest_receiver_share).clip(0, 1)
    # Eligibility prevents an isolated or censored node acquiring a misleading label.
    scores = pd.DataFrame(index=frame.index)
    scores["consolidator"] = (0.35*p_in + 0.30*p_in_amount + 0.20*sender_diversity +
                               0.15*(frame.in_deg / (frame.in_deg + frame.out_deg).replace(0, np.nan)).fillna(0))
    scores["distributor"] = (0.35*p_out + 0.30*p_out_amount + 0.20*receiver_diversity +
                              0.15*(frame.out_deg / (frame.in_deg + frame.out_deg).replace(0, np.nan)).fillna(0))
    scores["transit"] = (0.32*balance + 0.28*frame.similar_amount_rapid_share +
                          0.20*frame.rapid_share + 0.20*np.minimum(p_in_amount, p_out_amount))
    scores["terminal"] = (0.40*p_in_amount + 0.25*p_in + 0.35*(1 - frame.out_deg.clip(0, 1)))
    scores["coordinator"] = (0.25*p_between + 0.23*p_weighted_pr + 0.20*p_bridge +
                              0.18*p_seed + 0.14*p_volume)
    eligible = {
        "consolidator": (frame.in_deg >= 3) & (frame.in_deg >= frame.out_deg),
        "distributor": (frame.out_deg >= 3) & (frame.out_deg >= frame.in_deg),
        "transit": (~frame.is_seed) & (frame.in_deg > 0) & (frame.out_deg > 0) &
                   frame.pass_through_ratio.between(0.55, 1.6) & (frame.similar_amount_rapid_share > 0),
        "terminal": (~frame.is_seed) & (frame.depth < 4) & (frame.in_deg > 0) & (frame.out_deg == 0),
        "coordinator": (frame.in_deg >= 2) & (frame.out_deg >= 2) &
                       ((frame.seed_reach >= 2) | (frame.number_of_connected_clusters > 0)),
    }
    for role, mask in eligible.items():
        scores[role] = scores[role].where(mask, 0.0).clip(0, 1)
        frame[f"score_{role}"] = scores[role].round(4)
    winner = scores.idxmax(axis=1)
    winning_score = scores.max(axis=1)
    frame["role"] = winner.where(winning_score >= 0.55, "peripheral")
    frame["role_score"] = winning_score.where(winning_score >= 0.55, (1 - winning_score).clip(0.5, 0.8)).round(4)
    frame["anomaly_score"] = (0.35*p_burst + 0.25*frame.relative_degree_percentile +
                              0.25*p_volume + 0.15*frame.similar_amount_rapid_share).clip(0, 1).round(4)
    role_weight = frame.role.map({"coordinator": 1.0, "consolidator": .85, "distributor": .82,
                                  "transit": .75, "terminal": .5, "peripheral": .15})
    frame["priority_score"] = (0.18*role_weight*frame.role_score + 0.14*p_weighted_pr +
                               0.16*p_between + 0.14*p_volume + 0.10*p_seed + 0.10*p_bridge +
                               0.08*frame.similar_amount_rapid_share + 0.10*frame.anomaly_score).clip(0, 1).round(4)

    evidence = []
    for row in frame.itertuples(index=False):
        if row.truncated_by_depth and row.role == "peripheral":
            reason = f"Граница наблюдения: глубина 4/4, {row.in_deg} входящих связей; дальнейшие переводы не видны."
        elif row.role == "consolidator":
            reason = f"Признаки консолидации: {row.in_deg} плательщиков, входящий поток {row.in_kzt:,.0f} ₸; доля крупнейшего {row.largest_sender_share:.0%}."
        elif row.role == "distributor":
            reason = f"Веерное распределение: {row.out_deg} получателей, исходящий поток {row.out_kzt:,.0f} ₸."
        elif row.role == "transit":
            reason = f"Возможный транзит: наблюдаемый выход/вход {row.pass_through_ratio:.0%}; похожие суммы за ≤2 дня у {row.similar_amount_rapid_share:.0%} входящих."
        elif row.role == "terminal":
            reason = f"Возможная точка остановки видимого потока: {row.in_deg} плательщиков, исходящих 0, глубина {row.depth}/4."
        elif row.role == "coordinator":
            reason = f"Кандидат на координирующий узел: {row.in_deg}+{row.out_deg} связей, {row.seed_reach} seed в путях, {row.number_of_connected_clusters} соседних кластеров."
        elif row.is_seed:
            reason = f"Seed: {row.out_deg} исходящих связей; входящие за пределами сети могут отсутствовать."
        else:
            reason = f"Недостаточно признаков роли: {row.in_deg} входящих, {row.out_deg} исходящих связей, глубина {row.depth}/4."
        evidence.append(reason[:200])
    frame["evidence"] = evidence
    return frame


def cluster_summary(frame: pd.DataFrame, edges: pd.DataFrame) -> pd.DataFrame:
    labels = frame.set_index("gid").cluster_id.to_dict()
    internal: Counter[int] = Counter()
    incoming_external: Counter[int] = Counter()
    outgoing_external: Counter[int] = Counter()
    for row in edges.itertuples(index=False):
        src_cluster, dst_cluster = labels[int(row.src)], labels[int(row.dst)]
        if src_cluster == dst_cluster:
            internal[src_cluster] += float(row.sum_kzt)
        else:
            outgoing_external[src_cluster] += float(row.sum_kzt)
            incoming_external[dst_cluster] += float(row.sum_kzt)
    records = []
    for cluster_id, group in frame.groupby("cluster_id", sort=True):
        role_counts = group.role.value_counts()
        dominant = role_counts.index[0]
        if len(group) == 1:
            hypothesis = "Отдельное сообщество в разбиении; проверьте видимые связи этого счёта."
        elif group.is_seed.mean() > .25:
            hypothesis = "Группа с высокой долей исходных счетов; проверьте общие направления переводов."
        elif dominant == "distributor":
            hypothesis = "Преобладают признаки распределения; проверьте получателей и временную последовательность."
        elif dominant == "consolidator":
            hypothesis = "Преобладают признаки консолидации; проверьте источники поступлений."
        elif dominant == "terminal":
            hypothesis = "Много счетов без видимого исходящего потока до границы данных; проверьте дальнейшую активность."
        elif dominant == "peripheral":
            hypothesis = "У многих счетов нет выраженного структурного профиля; начните с узлов с высоким приоритетом."
        elif group.number_of_connected_clusters.max() >= 2:
            hypothesis = "Есть связи с несколькими сообществами; проверьте переходы между ними."
        else:
            hypothesis = f"Гипотеза: группа переводов с преобладанием роли «{ROLE_LABELS[dominant].lower()}» ({int(role_counts.iloc[0])}/{len(group)} узлов)."
        top = group.nlargest(5, "priority_score")
        records.append({"cluster_id": int(cluster_id), "n_nodes": len(group), "n_seed": int(group.is_seed.sum()),
                        "sum_kzt_internal": round(internal[int(cluster_id)], 2),
                        "incoming_external_volume": round(incoming_external[int(cluster_id)], 2),
                        "outgoing_external_volume": round(outgoing_external[int(cluster_id)], 2),
                        "top_gids": ";".join(str(gid) for gid in top.gid),
                        "top_priority_nodes": ";".join(str(gid) for gid in top.gid),
                        "role_distribution": json.dumps({role: int(count) for role, count in role_counts.items()}, ensure_ascii=False),
                        "hypothesis": hypothesis})
    return pd.DataFrame(records)


def export(frame: pd.DataFrame, edges: pd.DataFrame, tx: pd.DataFrame, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    fields = ["gid", "role", "role_score", "cluster_id", "priority_score", "evidence"] + [
        column for column in frame if column not in {"gid", "role", "role_score", "cluster_id", "priority_score", "evidence"}
    ]
    frame[fields].to_csv(out_dir / "nodes_roles.csv", index=False)
    clusters = cluster_summary(frame, edges)
    clusters.to_csv(out_dir / "clusters.csv", index=False)
    leaders = frame.sort_values(["priority_score", "gid"], ascending=[False, True]).head(50)
    leaders.assign(rank=range(1, len(leaders) + 1), why=leaders.evidence)[["rank", "gid", "role", "priority_score", "why"]].to_csv(out_dir / "top_nodes.csv", index=False)

    # JavaScript cannot represent 18-digit gid values exactly. Every id is a string.
    node_json = frame.copy()
    node_json["gid"] = node_json.gid.astype(str)
    node_records = json.loads(node_json.to_json(orient="records", force_ascii=False))
    edge_records = [{"src": str(row.src), "dst": str(row.dst), "sum_kzt": round(float(row.sum_kzt), 2), "n_tx": int(row.n_tx)} for row in edges.itertuples(index=False)]
    daily = tx.groupby("date").agg(amount=("sum_kzt", "sum"), count=("sum_kzt", "size")).reset_index()
    daily_records = [{"date": row.date.strftime("%Y-%m-%d"), "amount": round(float(row.amount), 2), "count": int(row.count)} for row in daily.itertuples(index=False)]
    summary = {"nodes": len(frame), "edges": len(edges), "transactions": len(tx), "seeds": int(frame.is_seed.sum()),
               "turnover_kzt": round(float(edges.sum_kzt.sum()), 2), "clusters": len(clusters),
               "components": int(frame.weak_component_id.nunique()),
               "depth_distribution": {str(depth): int(count) for depth, count in frame.depth.value_counts().sort_index().items()},
               "period_start": tx.date.min().strftime("%Y-%m-%d"), "period_end": tx.date.max().strftime("%Y-%m-%d"),
               "role_counts": {role: int((frame.role == role).sum()) for role in sorted(ROLES)}}
    payload = {"summary": summary, "nodes": node_records, "edges": edge_records, "clusters": clusters.to_dict("records"), "daily": daily_records}
    (out_dir / "dashboard.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Готово: {len(frame)} узлов, {len(edges)} связей, {len(clusters)} кластеров → {out_dir}")


def main() -> None:
    started = time.perf_counter()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--out", type=Path, default=Path("outputs"))
    args = parser.parse_args()
    nodes, edges, tx = load_and_validate(args.data)
    frame, graph = graph_features(nodes, edges, tx)
    frame = assign_clusters(frame, graph)
    frame = enrich_features(frame, graph, tx)
    frame = classify(frame)
    export(frame, edges, tx, args.out)
    print(f"Pipeline completed in {time.perf_counter() - started:.2f} seconds")


if __name__ == "__main__":
    main()
