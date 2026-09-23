"""Read-only investigation API over reproducible pipeline outputs."""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path

import networkx as nx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = Path(os.environ.get("MONEYGRAPH_OUTPUT_DIR", ROOT / "outputs"))
ROLES = {"coordinator", "consolidator", "distributor", "transit", "terminal", "peripheral"}


class AnalystRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)


class Store:
    def __init__(self, output_dir: Path):
        path = output_dir / "dashboard.json"
        if not path.exists():
            raise FileNotFoundError(f"Pipeline output missing: {path}. Run python pipeline.py first.")
        self.data = json.loads(path.read_text(encoding="utf-8"))
        self.nodes = {node["gid"]: node for node in self.data["nodes"]}
        self.clusters = {cluster["cluster_id"]: cluster for cluster in self.data["clusters"]}
        self.graph = nx.DiGraph()
        self.graph.add_nodes_from(self.nodes)
        self.graph.add_weighted_edges_from(
            (edge["src"], edge["dst"], edge["sum_kzt"]) for edge in self.data["edges"]
        )
        self.in_edges: dict[str, list[dict]] = {gid: [] for gid in self.nodes}
        self.out_edges: dict[str, list[dict]] = {gid: [] for gid in self.nodes}
        for edge in self.data["edges"]:
            self.in_edges[edge["dst"]].append(edge)
            self.out_edges[edge["src"]].append(edge)
        self.priorities = sorted(self.data["nodes"], key=lambda node: (-node["priority_score"], node["gid"]))

    def node(self, gid: str) -> dict:
        node = self.nodes.get(gid)
        if node is None:
            raise HTTPException(status_code=404, detail="GID не найден в наблюдаемой сети")
        metrics = {key: value for key, value in node.items() if key not in {
            "gid", "role", "role_score", "cluster_id", "priority_score", "depth", "is_seed", "evidence"
        }}
        limitations = ["Наблюдаются только исходящие пути от seed и переводы от 5 000 ₸; полный баланс неизвестен."]
        if node["truncated_by_depth"]:
            limitations.append("Ограниченная видимость: глубина 4/4, переводы за границей графа не показаны.")
        if node["is_seed"]:
            limitations.append("Входящий поток seed может быть неполным.")
        neighbors_in = sorted(self.in_edges[gid], key=lambda edge: -edge["sum_kzt"])
        neighbors_out = sorted(self.out_edges[gid], key=lambda edge: -edge["sum_kzt"])
        return {
            **node, "metrics": metrics, "limitations": limitations,
            "incoming_neighbors": [self.nodes[edge["src"]] for edge in neighbors_in[:20]],
            "outgoing_neighbors": [self.nodes[edge["dst"]] for edge in neighbors_out[:20]],
            "important_edges": (neighbors_in + neighbors_out)[:20],
            "temporal_features": {key: node.get(key) for key in (
                "active_days", "first_transaction_date", "last_transaction_date", "transaction_frequency",
                "same_day_in_out_patterns", "short_delay_flow_patterns", "burstiness", "daily_volume_std",
                "daily_transaction_count_std", "similar_amount_rapid_share"
            )},
        }

    def cluster(self, cluster_id: int) -> dict:
        cluster = self.clusters.get(cluster_id)
        if cluster is None:
            raise HTTPException(status_code=404, detail="Кластер не найден")
        members = sorted(
            (node for node in self.nodes.values() if node["cluster_id"] == cluster_id),
            key=lambda node: -node["priority_score"],
        )
        return {**cluster, "nodes": members, "top_priority_nodes": members[:10]}


@lru_cache(maxsize=1)
def get_store() -> Store:
    return Store(OUTPUT_DIR)


app = FastAPI(title="MoneyGraph API", version="1.0.0", description="Explainable AML graph investigation")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health():
    try:
        store = get_store()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": "ok", "nodes": len(store.nodes)}


@app.get("/api/dashboard")
def dashboard():
    return get_store().data


@app.get("/api/overview")
def overview():
    summary = get_store().data["summary"]
    return {
        "nodes": summary["nodes"], "edges": summary["edges"],
        "transactions": summary["transactions"], "seed_nodes": summary["seeds"],
        "observed_volume_kzt": summary["turnover_kzt"], "components": summary["components"],
        "clusters": summary["clusters"], "roles_distribution": summary["role_counts"],
        "depth_distribution": summary["depth_distribution"],
        "period_start": summary["period_start"], "period_end": summary["period_end"],
        "limitations": ["Исходящий обход до глубины 4", "Переводы от 5 000 ₸", "Баланс и внешние входящие не полны"],
    }


@app.get("/api/graph")
def graph(
    role: str | None = None,
    cluster: int | None = None,
    depth: int | None = Query(default=None, ge=0, le=4),
    min_priority: float = Query(default=0.0, ge=0, le=1),
    limit: int = Query(default=2500, ge=1, le=2500),
):
    if role is not None and role not in ROLES:
        raise HTTPException(status_code=422, detail="Неизвестная роль")
    store = get_store()
    nodes = [node for node in store.priorities if
             (role is None or node["role"] == role) and
             (cluster is None or node["cluster_id"] == cluster) and
             (depth is None or node["depth"] == depth) and
             node["priority_score"] >= min_priority][:limit]
    selected = {node["gid"] for node in nodes}
    edges = [edge for edge in store.data["edges"] if edge["src"] in selected and edge["dst"] in selected]
    return {"nodes": nodes, "edges": edges, "total_nodes": len(nodes), "total_edges": len(edges)}


@app.get("/api/nodes/{gid}")
def node(gid: str):
    return get_store().node(gid)


@app.get("/api/top-nodes")
def top_nodes(
    limit: int = Query(default=50, ge=1, le=500), role: str | None = None,
    cluster: int | None = None, min_priority: float = Query(default=0.0, ge=0, le=1),
):
    if role is not None and role not in ROLES:
        raise HTTPException(status_code=422, detail="Неизвестная роль")
    nodes = [node for node in get_store().priorities if
             (role is None or node["role"] == role) and
             (cluster is None or node["cluster_id"] == cluster) and
             node["priority_score"] >= min_priority][:limit]
    return [{"rank": index, **node, "why": node["evidence"]} for index, node in enumerate(nodes, 1)]


@app.get("/api/clusters")
def clusters():
    return sorted(get_store().clusters.values(), key=lambda cluster: cluster["cluster_id"])


@app.get("/api/clusters/{cluster_id}")
def cluster(cluster_id: int):
    return get_store().cluster(cluster_id)


@app.get("/api/search")
def search(q: str = Query(min_length=1, max_length=50), limit: int = Query(default=20, ge=1, le=100)):
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="Введите GID")
    matches = [node for node in get_store().priorities if query in node["gid"]][:limit]
    return {"query": query, "results": matches, "count": len(matches)}


@app.get("/api/path")
def path(source: str, target: str):
    store = get_store()
    for gid in (source, target):
        if gid not in store.nodes:
            raise HTTPException(status_code=404, detail=f"GID {gid} не найден")
    try:
        gids = nx.shortest_path(store.graph, source, target)
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=404, detail="Направленный путь в наблюдаемой сети не найден")
    edges = [next(edge for edge in store.out_edges[gids[index]] if edge["dst"] == gids[index + 1])
             for index in range(len(gids) - 1)]
    return {"source": source, "target": target, "gids": gids, "edges": edges, "hops": len(edges),
            "limitation": "Путь описывает видимые связи, а не происхождение конкретных денег."}


@app.post("/api/analyst")
def analyst(request: AnalystRequest):
    """Grounded, deterministic analyst assistant; works without any external key."""
    store = get_store()
    question = request.question.strip()
    lower = question.lower()
    gids = list(dict.fromkeys(re.findall(r"(?<!\d)\d{15,20}(?!\d)", question)))
    referenced: list[str] = []
    sources: list[dict] = []
    if "каких данных" in lower or "огранич" in lower or "не хватает" in lower:
        answer = ("Для проверки гипотезы нужны входящие переводы извне наблюдаемой сети, операции за пределами глубины 4, "
                  "переводы ниже 5 000 ₸ и контекст владельцев счетов. Наблюдаемые связи не доказывают происхождение средств.")
        sources = [{"type": "methodology", "id": "data-limitations"}]
    elif "общ" in lower and ("получ" in lower or "отправ" in lower) and len(gids) >= 2:
        known = [gid for gid in gids if gid in store.nodes]
        if not known:
            answer = "Указанные GID не найдены в наблюдаемой сети."
        else:
            direction = "получ" if "получ" in lower else "отправ"
            sets = [set(store.graph.successors(gid) if direction == "получ" else store.graph.predecessors(gid)) for gid in known]
            common = sorted(set.intersection(*sets)) if sets else []
            referenced = common[:20]
            answer = (f"Общие {'получатели' if direction == 'получ' else 'отправители'} для {len(known)} GID: " +
                      (", ".join(referenced) if referenced else "в наблюдаемой сети не найдены") + ".")
            sources = [{"type": "node", "id": gid} for gid in known]
    elif ("путь" in lower or "связ" in lower) and len(gids) >= 2:
        if all(gid in store.nodes for gid in gids[:2]):
            try:
                found = nx.shortest_path(store.graph, gids[0], gids[1])
                referenced = found
                answer = f"Наблюдаемый направленный путь ({len(found)-1} переходов): " + " → ".join(found) + ". Это не доказательство происхождения конкретных денег."
                sources = [{"type": "node", "id": gid} for gid in found]
            except nx.NetworkXNoPath:
                answer = "Направленный путь между указанными GID в наблюдаемой сети не найден."
        else:
            answer = "Один из указанных GID не найден в наблюдаемой сети."
    elif gids:
        gid = gids[0]
        if gid not in store.nodes:
            answer = f"GID {gid} не найден в наблюдаемой сети."
        else:
            node_data = store.nodes[gid]
            referenced = [gid]
            answer = (f"GID {gid}: {node_data['evidence']} Роль — {node_data['role']} "
                      f"({node_data['role_score']:.0%}); приоритет проверки {node_data['priority_score']:.0%}; "
                      f"кластер {node_data['cluster_id']}. Это гипотеза для аналитика.")
            sources = [{"type": "node", "id": gid}]
    elif "кластер" in lower or "cluster" in lower:
        match = re.search(r"(?:кластер|cluster)\s*[№#]?\s*(\d+)", lower)
        if match and int(match.group(1)) in store.clusters:
            item = store.clusters[int(match.group(1))]
            referenced = item["top_gids"].split(";")[:5]
            answer = (f"Кластер {item['cluster_id']}: {item['n_nodes']} узлов, {item['n_seed']} seed, "
                      f"внутренний наблюдаемый поток {item['sum_kzt_internal']:,.0f} ₸. {item['hypothesis']}")
            sources = [{"type": "cluster", "id": item["cluster_id"]}]
        else:
            answer = "Укажите номер кластера, например: «Что необычного в кластере 7?»"
    else:
        role = "consolidator" if "консолид" in lower else "distributor" if "распредел" in lower else "transit" if "транзит" in lower else None
        if role:
            selected = [node for node in store.priorities if node["role"] == role][:5]
        elif "мост" in lower or "связыва" in lower:
            selected = sorted(store.nodes.values(), key=lambda node: (-node["cluster_bridge_score"], -node["priority_score"]))[:5]
        else:
            selected = store.priorities[:5]
        referenced = [node["gid"] for node in selected]
        answer = "Приоритетные узлы: " + "; ".join(
            f"{node['gid']} — {node['role']}, приоритет {node['priority_score']:.0%}, {node['evidence']}" for node in selected
        )
        sources = [{"type": "node", "id": gid} for gid in referenced]
    return {"answer": answer, "referenced_gids": referenced, "sources": sources,
            "mode": "deterministic", "disclaimer": "Помощник использует рассчитанные признаки; выводы требуют проверки аналитиком."}
