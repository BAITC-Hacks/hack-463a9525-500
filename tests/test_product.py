"""Critical invariants for the data product and read-only API."""

import json
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

from backend.main import app

ROOT = Path(__file__).resolve().parents[1]
client = TestClient(app)


def test_required_outputs_and_depth_boundary():
    nodes = pd.read_csv(ROOT / "outputs" / "nodes_roles.csv", dtype={"gid": str})
    clusters = pd.read_csv(ROOT / "outputs" / "clusters.csv")
    top = pd.read_csv(ROOT / "outputs" / "top_nodes.csv", dtype={"gid": str})
    assert len(nodes) == 2248
    assert nodes.gid.is_unique
    assert {"gid", "role", "role_score", "cluster_id", "priority_score", "evidence"} <= set(nodes.columns)
    assert {"cluster_id", "n_nodes", "n_seed", "sum_kzt_internal", "top_gids", "hypothesis"} <= set(clusters.columns)
    assert {"rank", "gid", "role", "priority_score", "why"} <= set(top.columns)
    assert len(top) >= 20
    assert nodes.evidence.notna().all() and nodes.evidence.str.len().gt(0).all()
    assert nodes.role_score.between(0, 1).all() and nodes.priority_score.between(0, 1).all()
    assert not ((nodes.depth == 4) & (nodes.out_deg == 0) & (nodes.role == "terminal")).any()


def test_all_gids_remain_strings_in_json():
    data = json.loads((ROOT / "outputs" / "dashboard.json").read_text())
    assert all(isinstance(node["gid"], str) for node in data["nodes"])
    assert all(isinstance(edge["src"], str) and isinstance(edge["dst"], str) for edge in data["edges"])


def test_api_investigation():
    overview = client.get("/api/overview")
    assert overview.status_code == 200 and overview.json()["nodes"] == 2248
    top = client.get("/api/top-nodes", params={"limit": 5}).json()
    assert len(top) == 5 and top[0]["priority_score"] >= top[-1]["priority_score"]
    gid = top[0]["gid"]
    detail = client.get(f"/api/nodes/{gid}")
    assert detail.status_code == 200 and detail.json()["gid"] == gid
    assert detail.json()["metrics"] and detail.json()["limitations"]
    assert client.get("/api/search", params={"q": gid}).json()["results"][0]["gid"] == gid
    assert client.get("/api/nodes/000000000000000000").status_code == 404
    assert client.get("/api/search", params={"q": "000000000000000000"}).json()["count"] == 0
    assert client.get("/api/graph", params={"role": "not-a-role"}).status_code == 422


def test_analyst_requires_project_key(monkeypatch):
    monkeypatch.delenv("MONEYGRAPH_OPENAI_API_KEY", raising=False)
    gid = client.get("/api/top-nodes", params={"limit": 1}).json()[0]["gid"]
    response = client.post("/api/analyst", json={"question": f"Почему GID {gid} в топе?"})
    assert response.status_code == 503
    assert client.get("/api/analyst/status").json()["mode"] == "unconfigured"


def test_openai_receives_selected_graph_facts(monkeypatch):
    import backend.main as backend

    gid = client.get("/api/top-nodes", params={"limit": 1}).json()[0]["gid"]
    calls = []

    class FakeResponses:
        def create(self, **kwargs):
            calls.append(kwargs)
            return type("Response", (), {"output_text": f"По рассчитанным данным проверьте GID {gid}."})()

    class FakeOpenAI:
        def __init__(self, **kwargs):
            assert kwargs["api_key"] == "test-project-key"
            self.responses = FakeResponses()

    monkeypatch.setenv("MONEYGRAPH_OPENAI_API_KEY", "test-project-key")
    monkeypatch.setattr(backend, "OpenAI", FakeOpenAI)
    result = client.post("/api/analyst", json={"question": f"Почему GID {gid} в топе?"}).json()
    assert result["mode"] == "openai" and result["referenced_gids"] == [gid]
    assert calls[0]["store"] is False
    facts = json.loads(calls[0]["input"])["graph_facts"]
    assert facts["nodes"][0]["gid"] == gid
    assert len(facts["nodes"]) == 1
    assert "dashboard" not in calls[0]["input"]

    def fail(**kwargs):
        raise RuntimeError("network failure")

    monkeypatch.setattr(backend, "OpenAI", fail)
    failure = client.post("/api/analyst", json={"question": f"Почему GID {gid} в топе?"})
    assert failure.status_code == 502


def test_path_and_resilience():
    data = json.loads((ROOT / "outputs" / "dashboard.json").read_text())
    edge = data["edges"][0]
    result = client.get("/api/path", params={"source": edge["src"], "target": edge["dst"]})
    assert result.status_code == 200 and result.json()["hops"] == 1
    resilience = client.get("/api/resilience", params={"remove_top": 5})
    assert resilience.status_code == 200
    assert len(resilience.json()["removed_gids"]) == 5
    assert resilience.json()["number_of_components_after"] >= resilience.json()["number_of_components_before"]
