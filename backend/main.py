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
from typing import Literal
from openai import AuthenticationError, OpenAI, RateLimitError

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = Path(os.environ.get("MONEYGRAPH_OUTPUT_DIR", ROOT / "outputs"))
ROLES = {"coordinator", "consolidator", "distributor", "transit", "terminal", "peripheral"}
ROLE_NAMES = {"coordinator": "координация", "consolidator": "консолидация", "distributor": "распределение",
              "transit": "возможный транзит", "terminal": "возможная точка остановки", "peripheral": "периферия"}


class AnalystTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class AnalystRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    history: list[AnalystTurn] = Field(default_factory=list, max_length=8)


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


@app.get("/api/resilience")
def resilience(remove_top: int = Query(default=5, ge=1, le=50)):
    store = get_store()
    before = sorted((len(group) for group in nx.weakly_connected_components(store.graph)), reverse=True)
    removed = [node["gid"] for node in store.priorities[:remove_top]]
    reduced = store.graph.copy()
    reduced.remove_nodes_from(removed)
    after = sorted((len(group) for group in nx.weakly_connected_components(reduced)), reverse=True)
    return {"removed_gids": removed, "number_of_components_before": len(before),
            "number_of_components_after": len(after), "largest_component_before": before[0],
            "largest_component_after": after[0],
            "largest_component_change_pct": round(100 * (before[0] - after[0]) / before[0], 2),
            "limitation": "Структурный эксперимент на неполном графе; не утверждает контроль над средствами."}


def _analyst_node(store: Store, gid: str, include_edges: bool) -> dict:
    node = store.nodes[gid]
    result = {key: node.get(key) for key in (
        "gid", "role", "role_score", "priority_score", "cluster_id", "depth", "is_seed",
        "in_deg", "out_deg", "in_kzt", "out_kzt", "in_tx", "out_tx", "seed_reach",
        "rapid_share", "pass_through", "cluster_bridge_score", "truncated_by_depth"
    )}
    if include_edges:
        result["incoming_edges"] = sorted(store.in_edges[gid], key=lambda edge: -edge["sum_kzt"])[:8]
        result["outgoing_edges"] = sorted(store.out_edges[gid], key=lambda edge: -edge["sum_kzt"])[:8]
    return result


def _analyst_context(store: Store, request: AnalystRequest) -> tuple[dict, set[str]]:
    question = request.question.strip()
    lower = question.lower()
    requested = list(dict.fromkeys(re.findall(r"(?<!\d)\d{15,20}(?!\d)", question)))[:3]
    if not requested and any(word in lower for word in ("этот", "этого", "его", "счёт", "счет")):
        for turn in reversed(request.history):
            found = re.findall(r"(?<!\d)\d{15,20}(?!\d)", turn.content)
            if found:
                requested = found[:1]
                break
    known = [gid for gid in requested if gid in store.nodes]
    context = {
        "summary": store.data["summary"],
        "role_labels": ROLE_NAMES,
        "role_threshold": 0.55,
        "priority_weights_pct": {"role": 18, "weighted_pagerank": 14, "betweenness": 16,
                                 "depth_relative_volume": 14, "seed_reach": 10, "cluster_bridge": 10,
                                 "rapid_similar_amounts": 8, "anomaly": 10},
        "data_limits": [
            "Исходящий обход от 81 seed до глубины 4.",
            "В выгрузке нет переводов менее 5000 KZT и внешних входящих операций.",
            "На глубине 4 отсутствие исходящих не означает завершение потока.",
            "Нет идентичностей владельцев и размеченных случаев нарушения.",
            "Сходство суммы и времени не доказывает движение конкретных денег."
        ],
        "unknown_gids": [gid for gid in requested if gid not in store.nodes],
    }
    source_gids: set[str] = set()
    if known:
        context["nodes"] = [_analyst_node(store, gid, True) for gid in known]
        source_gids.update(known)
        for node in context["nodes"]:
            source_gids.update(edge["src"] for edge in node["incoming_edges"])
            source_gids.update(edge["dst"] for edge in node["outgoing_edges"])
        if len(known) >= 2:
            left, right = known[:2]
            context["common_recipients"] = sorted(set(store.graph.successors(left)) & set(store.graph.successors(right)))[:20]
            context["common_senders"] = sorted(set(store.graph.predecessors(left)) & set(store.graph.predecessors(right)))[:20]
            source_gids.update(context["common_recipients"])
            source_gids.update(context["common_senders"])
            try:
                context["directed_shortest_path"] = nx.shortest_path(store.graph, left, right)
                source_gids.update(context["directed_shortest_path"])
            except nx.NetworkXNoPath:
                context["directed_shortest_path"] = None
    elif requested:
        context["nodes"] = []
    else:
        cluster_match = re.search(r"(?:кластер|групп|cluster)\s*[№#]?\s*(\d+)", lower)
        if cluster_match and int(cluster_match.group(1)) in store.clusters:
            item = store.clusters[int(cluster_match.group(1))]
            context["cluster"] = item
            selected = [node for node in store.priorities if node["cluster_id"] == item["cluster_id"]][:12]
        else:
            role = "consolidator" if "консолид" in lower else "distributor" if "распредел" in lower else "transit" if "транзит" in lower else "coordinator" if "координац" in lower else "terminal" if "конечн" in lower else None
            selected = [node for node in store.priorities if node["role"] == role][:12] if role else store.priorities[:12]
        context["nodes"] = [_analyst_node(store, node["gid"], False) for node in selected]
        source_gids.update(node["gid"] for node in selected)
    return context, source_gids


@app.get("/api/analyst/status")
def analyst_status():
    return {"mode": "openai" if os.environ.get("MONEYGRAPH_OPENAI_API_KEY") else "unconfigured"}


@app.post("/api/analyst")
def analyst(request: AnalystRequest):
    """Use current graph evidence and a project-specific OpenAI key for real chat replies."""
    key = os.environ.get("MONEYGRAPH_OPENAI_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="OpenAI не подключён. Добавьте MONEYGRAPH_OPENAI_API_KEY в .env.local и перезапустите ./run.sh.")
    context, source_gids = _analyst_context(get_store(), request)
    try:
        response = OpenAI(api_key=key, timeout=30.0, max_retries=0).responses.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-6-luna"),
            reasoning={"effort": "none"},
            instructions=(
                "Ты аналитик обезличенной сети переводов. Отвечай по-русски на вопрос пользователя, "
                "используя только переданные факты графа. Числа, связи и GID должны точно соответствовать контексту. "
                "Если нужных фактов нет, назови недостающие данные. Различай наблюдаемую связь и гипотезу. "
                "Не утверждай виновность и не называй приоритет вероятностью нарушения. "
                "Пиши прямо, без общих вступлений и повторяющихся оговорок. Для конкретного счёта укажи GID. "
                "Используй обычный текст без Markdown-заголовков и звёздочек."
            ),
            input=json.dumps({
                "question": request.question.strip(),
                "recent_dialog": [turn.model_dump() for turn in request.history[-8:]],
                "graph_facts": context,
            }, ensure_ascii=False),
            max_output_tokens=900,
            store=False,
        )
    except AuthenticationError as exc:
        raise HTTPException(status_code=502, detail="Ключ OpenAI отклонён. Проверьте MONEYGRAPH_OPENAI_API_KEY.") from exc
    except RateLimitError as exc:
        raise HTTPException(status_code=502, detail="Лимит OpenAI исчерпан. Повторите запрос позже.") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="OpenAI сейчас не ответил. Повторите запрос позже.") from exc
    answer = response.output_text.strip()
    if not answer:
        raise HTTPException(status_code=502, detail="OpenAI вернул пустой ответ. Повторите запрос.")
    mentioned = list(dict.fromkeys(re.findall(r"(?<!\d)\d{15,20}(?!\d)", answer)))
    if any(gid not in source_gids and gid not in context["unknown_gids"] for gid in mentioned):
        raise HTTPException(status_code=502, detail="Ответ содержал неподтверждённый GID. Попробуйте уточнить вопрос.")
    referenced = [gid for gid in mentioned if gid in source_gids][:12]
    return {"answer": answer, "referenced_gids": referenced,
            "sources": [{"type": "node", "id": gid} for gid in referenced],
            "mode": "openai", "disclaimer": "Проверьте вывод по исходным операциям и контексту счёта."}
