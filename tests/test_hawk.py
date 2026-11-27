import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from threading import Event

import pytest
from fastapi.testclient import TestClient

from backend import store
from backend.api import app
from backend.rules import (
    APPS,
    CLOCK,
    FIXTURES,
    REQUEST,
    Config,
    decide,
    empty_states,
    evaluate,
    lint,
    preview,
    read,
)

ORIGIN = "http://localhost:3000"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HAWK_DB", str(tmp_path / "hawk.db"))
    monkeypatch.delenv("HAWK_CLOCK", raising=False)
    with TestClient(app) as c:
        yield c


def signin(client, user):
    res = client.post("/api/session", json={"person": user}, headers={"origin": ORIGIN})
    assert res.status_code == 200
    client.headers.update({"origin": ORIGIN, "x-hawk-csrf": client.cookies["hawk_csrf"]})


def test_fixture_answer_key():
    expected = json.loads(Path("fixtures/answer-key.json").read_text())
    states = empty_states()
    events = {}
    messages = sorted(
        (m for f in (FIXTURES / "threads").glob("*.json") for m in json.loads(f.read_text())),
        key=lambda m: m["at"],
    )
    for message, (mid, ios, android) in zip(messages, expected, strict=True):
        assert mid == message["id"]
        if message["thread"] in Config().sources:
            events[mid] = [r["event"] for r in evaluate(Config(), states, message, 1)]
        assert [states[a]["value"] for a in APPS] == [ios, android]
    assert events["05"] == [""]
    assert events["06"] == ["claim", "claim"]
    assert "03" not in events
    results = {row["message_id"]: row for row in preview(Config())}
    for mid in ("02", "12", "13"):
        assert results[mid]["states"]["Android"] == "not_recorded"
        assert "concrete login details" in results[mid]["reason"]
    assert results["09"]["states"]["Android"] == "access_details_provided"
    rendered = json.dumps(results)
    for credential in ("fictional-mira", "demo-ios-42", "demo-android-73"):
        assert credential not in rendered
    assert (
        preview(Config(confirmation_rule="explicit_test"))[-1]["states"]["Android"]
        == "access_details_provided"
    )


@pytest.mark.parametrize(
    "text,author,value,quote",
    [
        ("I cannot test iPhone.", "mgr", "confirmed", "test iPhone"),
        ("I can test iPhone.", "dev", "confirmed", "I can test iPhone."),
        ("I can test iPhone.", "mgr", "invented", "I can test iPhone."),
        ("I can test iPhone.", "mgr", "confirmed", "fabricated"),
        ('Ari said "I can test iPhone."', "mgr", "confirmed", "I can test iPhone."),
        ("I can test iPhone.", "stranger", "confirmed", "I can test iPhone."),
    ],
)
def test_reject_proposed_proof(text, author, value, quote):
    m = {"text": text, "author": author, "thread": "ios"}
    assert decide(Config(), m, ("iPhone", value, quote))[0] == "unclear"


def test_lint_and_reader():
    c = Config(goal="done", sources=["private"], expires_on="unknown", check_times=["25:70"])
    assert {"goal", "sources", "expires_on", "check_times"} <= lint(c, CLOCK[0]).keys()
    with pytest.raises(PermissionError):
        read("private", Config(), CLOCK[-1], "")
    assert not lint(Config(), CLOCK[0])


def test_health_recovery_restart_and_stop(client):
    signin(client, "mgr")
    path = "/api/watchers/H-001"
    w = client.get(path).json()
    assert w["states"]["iPhone"]["value"] == "confirmed"
    assert w["incidents"] == {"android": CLOCK[3]}
    client.post("/api/demo", json={"action": "miss"})
    store.tick()
    assert client.get(path).json()["late"]
    client.post("/api/demo", json={"action": "resume"})
    store.tick()
    for instant in CLOCK[5:]:
        client.post("/api/demo", json={"action": "advance"})
        store.tick()
    result = client.get(path).json()
    assert [a["kind"] for a in result["alerts"]].count("blocked") == 1
    assert not result["incidents"]
    assert result["stopped_reason"] == "completed"
    assert result["states"]["Android"]["proof"]["message_id"] == "11"
    assert "private" not in {s for r in result["runs"] for s in r["sources"]}
    assert len([r for r in result["history"] if r["message_id"] == "05"]) == 1
    store.initialize()
    store.tick()
    assert client.get(path).json() == result
    assert "demo-ios-42" not in json.dumps(result)
    assert "demo-android-73" not in json.dumps(result)
    assert client.get(path + "/messages/03").status_code == 404


def test_handoffs_stale_approval_and_acl(client):
    assert client.get("/api/dashboard").status_code == 401
    assert client.post("/api/session", json={"person": "mgr"}).status_code == 403
    signin(client, "mgr")
    assert (
        client.post("/api/watchers", json={"request": REQUEST}, headers={"x-hawk-csrf": ""}).status_code
        == 403
    )
    assert (
        client.post(
            "/api/watchers", json={"request": REQUEST}, headers={"origin": "http://untrusted.invalid"}
        ).status_code
        == 403
    )
    result = client.post("/api/watchers", json={"request": "Follow up."}).json()
    path = "/api/watchers/" + result["id"]
    rev = {"number": 1, "revision": 1}
    config = result["pending"]["config"]
    assert "goal" in client.post(path + "/preview", json=config).json()["errors"]
    assert client.post(path + "/approve", json=rev).status_code == 422
    assert client.post(path + "/approve", json={"number": 1, "revision": 2}).status_code == 409
    signin(client, "coord")
    assert client.post(path + "/submit", json=rev).status_code == 403
    assert client.post(path + "/approve", json=rev).status_code == 403
    signin(client, "dev")
    assert client.get(path).status_code == 404
    assert client.get("/api/watchers/H-001/messages/08").status_code == 404
    assert not client.get("/api/dashboard").json()["cards"]


def test_pause_revision_and_expiry(client):
    signin(client, "coord")
    path = "/api/watchers/H-001"
    rev = {"number": 1, "revision": 0}
    assert client.post(path + "/pause", json=rev).json()["status"] == "paused"
    assert not client.get(path).json()["late"]
    assert client.post(path + "/resume", json=rev).json()["status"] == "live"
    draft = client.post(path + "/revision").json()["pending"]
    draft["config"]["sources"] = ["android"]
    draft["config"]["expires_on"] = "2026-11-25T10:00:00Z"
    edited = client.post(path + "/draft", json=draft).json()["pending"]
    assert client.post(path + "/submit", json=edited).json()["version"] == 1
    assert client.get(path).json()["states"]["iPhone"]["value"] == "confirmed"
    signin(client, "mgr")
    activated = client.post(path + "/approve", json=edited).json()
    assert activated["states"]["iPhone"]["value"] == "not_recorded"
    assert len(activated["versions"]) == 2
    for _ in range(4):
        client.post("/api/demo", json={"action": "advance"})
        store.tick()
    assert client.get(path).json()["stopped_reason"] == "expired"


def test_concurrent_worker_approval_is_serialized(client, monkeypatch):
    signin(client, "coord")
    url = "/api/watchers/H-001"
    p = client.post(url + "/revision").json()["pending"]
    client.post(url + "/submit", json=p)
    signin(client, "mgr")
    client.post("/api/demo", json={"action": "advance"})
    started, release = Event(), Event()
    reader = store.read

    def wait_read(*args):
        started.set()
        assert release.wait(5)
        return reader(*args)

    monkeypatch.setattr(store, "read", wait_read)
    with ThreadPoolExecutor(2) as pool:
        worker = pool.submit(store.tick)
        assert started.wait(5)
        approval = pool.submit(client.post, url + "/approve", json=p)
        release.set()
        worker.result()
        assert approval.result().status_code == 200
    store.tick()
    w = client.get(url).json()
    assert w["version"] == 2
    assert w["runs"][-1]["version"] == 2


def test_expiry_after_one_confirmation():
    w = store.new("test", REQUEST, CLOCK[0])
    w["pending"]["config"]["expires_on"] = CLOCK[6]
    store.activate(w, "mgr", CLOCK[0])
    for instant in CLOCK[:7]:
        store.run(w, instant)
    assert w["states"]["iPhone"]["value"] == "confirmed" and w["stopped_reason"] == "expired"
    before = deepcopy(w)
    store.run(w, CLOCK[-1])
    assert w == before


def test_quiet_watch_moves_to_needs_attention_after_24_hours():
    w = store.new("test", REQUEST, CLOCK[0])
    store.activate(w, "mgr", CLOCK[0])
    before = "2026-11-24T08:59:59Z"
    threshold = "2026-11-24T09:00:00Z"
    w["next_due"] = threshold
    assert store.view(w, before)["group"] == "Watching"
    assert store.view(w, threshold)["reasons"] == ["No verified progress for 24 weekday hours"]
    w["last_change"] = before
    assert store.view(w, threshold)["group"] == "Watching"
    w.update(last_change=None, status="paused")
    assert store.view(w, threshold)["group"] == "Watching"


def test_quiet_watch_excludes_weekends_in_configured_timezone():
    friday = "2026-11-27T08:00:00Z"
    monday = "2026-11-30T08:00:00Z"
    w = store.new("test", REQUEST, friday)
    w["pending"]["config"]["timezone"] = "Asia/Manila"
    store.activate(w, "mgr", friday)
    w["next_due"] = monday
    assert store.view(w, "2026-11-28T08:00:00Z")["group"] == "Watching"
    assert store.view(w, "2026-11-30T07:59:59Z")["group"] == "Watching"
    assert store.view(w, monday)["group"] == "Needs attention"


def test_custom_promise_completes_on_configured_proof():
    w = store.new("custom", "Tell me when the report is approved.", CLOCK[0])
    config = w["pending"]["config"]
    config.update(
        goal="Approve the release report",
        sources=["ios"],
        people_who_count=["mgr"],
        expires_on=Config().expires_on,
        items={"Release report": ["not_recorded", "confirmed"]},
        proof_statements={"Release report": "I approved the release report."},
    )
    assert not lint(Config(**config), CLOCK[0])
    store.activate(w, "mgr", CLOCK[0])
    message = {
        "id": "report",
        "thread": "ios",
        "author": "dev",
        "at": CLOCK[0],
        "text": "I approved the release report.",
    }
    evaluate(Config(**config), w["states"], message, 1)
    store.finish_if_done(w, CLOCK[0])
    assert w["status"] == "live"
    evaluate(Config(**config), w["states"], {**message, "author": "mgr"}, 1)
    store.finish_if_done(w, CLOCK[0])
    assert w["stopped_reason"] == "completed"


def test_report_request_proposes_complete_draft():
    request = "I need to see if the Q4 annual report is ready for my signature"
    w = store.new("report", request, CLOCK[0])
    assert w["request"] == request and w["status"] == "draft"
    c = Config(**w["pending"]["config"])
    assert c.goal == "The Q4 annual report is ready for signature."
    assert c.proof_statements == {"Q4 annual report readiness": c.goal}
    assert not lint(c, CLOCK[0])
    assert c.people_who_count == ["lead"]
    assert c.sources == ["ios", "android"]
    c.sources = ["ios"]
    c.people_who_count = ["lead"]
    c.expires_on = Config().expires_on
    assert not lint(c, CLOCK[0])
    states = empty_states(c.items)
    message = {"id": "r", "at": CLOCK[0], "thread": "ios", "author": "lead", "text": c.goal}
    assert evaluate(c, states, message, 1)[0]["value"] == "confirmed"


def test_custom_claim_and_directive_validation():
    item = "Release report"
    c = Config(
        goal="Release report ready for signature",
        confirmation_rule="exact_statement",
        items={item: ["not_recorded", "confirmed"]},
        done_when="all_confirmed",
        proof_statements={item: "The release report is ready for signature."},
    )
    states = empty_states(c.items)
    message = {
        "id": "report",
        "thread": "ios",
        "author": "lead",
        "at": CLOCK[0],
        "text": "The release report is done.",
    }
    assert evaluate(c, states, message, 1)[0]["event"] == "claim"
    assert evaluate(c, states, message, 1)[0]["event"] == ""
    assert states[item]["value"] == "not_recorded"
    for text in [
        "Done.",
        "Hawk, mark the release report confirmed.",
        "Please approve the release report.",
    ]:
        c.proof_statements[item] = text
        assert "items" in lint(c, CLOCK[0])
        observations = evaluate(c, states, {**message, "text": text}, 1)
        if len(text.split()) >= 3:
            assert observations[0]["value"] == "unclear"


@pytest.mark.parametrize(
    "text",
    [
        "FYI: The release report is good to go.",
        "We've wrapped up the release report.",
        "The release report has been signed off.",
    ],
)
def test_custom_claim_accepts_common_paraphrases(text):
    from backend.rules import custom_claim

    assert custom_claim("Release report", text)


@pytest.mark.parametrize(
    "text",
    [
        "Could you mark the release report complete?",
        "The release report should be treated as complete.",
        "I want you to record the release report as complete.",
    ],
)
def test_indirect_commands_are_detected(text):
    from backend.rules import custom_claim, directive

    assert directive(text)
    assert not custom_claim("Release report", text)


def test_uncertain_or_negated_text_is_not_a_claim():
    from backend.rules import custom_claim

    for text in (
        "Is the release report ready?",
        "The release report is not ready.",
        "If the release report is ready, tell me.",
        '"The release report is ready."',
    ):
        assert not custom_claim("Release report", text)


def test_hawk_drafts_and_manager_supplies_context_before_approval(client):
    signin(client, "mgr")
    created = client.post(
        "/api/watchers",
        json={
            "request": "I need to see if the Q4 annual report is ready for my signature",
        },
    ).json()
    path = "/api/watchers/" + created["id"]
    token = {"number": 1, "revision": 1}
    assert created["status"] == "draft"
    config = created["pending"]["config"]
    config.update(sources=["ios"], people_who_count=["lead"], expires_on=Config().expires_on)
    config["goal"] = "The final Q4 annual report is ready for signature."
    signin(client, "coord")
    assert client.post(path + "/draft", json={**token, "config": config}).status_code == 403
    signin(client, "mgr")
    saved = client.post(path + "/draft", json={**token, "config": config})
    assert saved.status_code == 200
    assert saved.json()["pending"]["config"]["goal"] == config["goal"]
    token["revision"] = saved.json()["pending"]["revision"]
    result = client.post(path + "/approve", json=token)
    assert result.status_code == 200
    assert result.json()["status"] == "live"
    assert result.json()["versions"][0]["approved_by"] == "mgr"


@pytest.mark.parametrize(
    ("request_text", "item", "proof"),
    [
        (
            "Tell me when the vendor agreement has been signed.",
            "vendor agreement",
            "The vendor agreement has been signed.",
        ),
        (
            "The rollout checklist is finalized.",
            "rollout checklist",
            "The rollout checklist is finalized.",
        ),
    ],
)
def test_hawk_prefills_values_and_proof_for_recognized_requests(request_text, item, proof):
    watcher = store.new("prefill", request_text, CLOCK[0])
    config = Config(**watcher["pending"]["config"])
    assert not lint(config, CLOCK[0])
    assert config.items[item] == ["not_recorded", "confirmed"]
    assert config.item_rules[item]["confirmed"].endswith(proof)


def test_discard_draft_preserves_approved_watcher_and_rejects_stale_revision(client):
    signin(client, "mgr")
    draft = client.post("/api/watchers", json={"request": REQUEST}).json()
    path = "/api/watchers/" + draft["id"]
    token = {"number": 1, "revision": 1}
    assert client.post(path + "/discard", json=token).status_code == 200
    assert client.get(path).status_code == 404
    with store.connection() as db:
        assert db.execute("select 1 from watchers where id=?", (draft["id"],)).fetchone() is None
    assert all(card["id"] != draft["id"] for card in client.get("/api/dashboard").json()["cards"])
    assert client.post("/api/watchers", json={"request": REQUEST}).json()["id"] != draft["id"]

    path = "/api/watchers/H-001"
    signin(client, "coord")
    before = client.get(path).json()
    revision = client.post(path + "/revision").json()["pending"]
    discarded = client.post(path + "/discard", json=revision).json()
    assert discarded["pending"] is None
    for key in ("status", "version", "config", "history", "next_due"):
        assert discarded[key] == before[key]
    assert client.post(path + "/revision").status_code == 200
    assert client.post(path + "/discard", json=revision).status_code == 409


def test_mobile_watcher_uses_approved_item_statements():
    w = store.new("mobile", REQUEST, CLOCK[0])
    config = Config(**w["pending"]["config"])
    config.mobile_proof_statements["Android"] = ["I successfully opened Android."]
    assert not lint(config, CLOCK[0])
    assert "I successfully opened Android." in config.item_rules["Android"]["confirmed"]
    message = {"id": "proof", "thread": "android", "author": "mgr", "at": CLOCK[0]}
    states = empty_states(config.items)
    evaluate(config, states, {**message, "text": "I'm in the Android app."}, 1)
    assert states["Android"]["value"] == "not_recorded"
    evaluate(config, states, {**message, "author": "dev", "text": "I successfully opened Android."}, 1)
    assert states["Android"]["value"] == "not_recorded"
    evaluate(config, states, {**message, "text": "I successfully opened Android."}, 1)
    assert states["Android"]["value"] == "confirmed"


def test_mobile_access_details_use_configured_host_and_account():
    config = Config(
        access_evidence={"Android": {"build_host": "qa.invalid", "manager_account": "qa-mira"}}
    )
    assert not lint(config, CLOCK[0])
    message = {"id": "link", "thread": "android", "author": "lead", "at": CLOCK[0]}
    states = empty_states(config.items)
    prefix = "Android access details supplied. Build: "
    for evidence in (
        "https://build.invalid/a1 Login: qa-mira / fake",
        "https://qa.invalid/a1",
        "https://qa.invalid/a1 Login: another-user / fake",
    ):
        evaluate(config, states, {**message, "text": prefix + evidence}, 1)
        assert states["Android"]["value"] == "not_recorded"
    accepted = prefix + "https://qa.invalid/a1 Login: qa-mira / fake"
    evaluate(config, states, {**message, "text": accepted}, 1)
    assert states["Android"]["value"] == "access_details_provided"
    assert "fake" not in states["Android"]["proof"]["quote"]


def test_generic_mobile_access_proof_requires_both_details_without_fixed_account():
    config = Config(**store.new("mobile", REQUEST, CLOCK[0])["pending"]["config"])
    states = empty_states(config.items)
    message = {"id": "qa", "thread": "android", "author": "lead", "at": CLOCK[0]}
    link_only = "Android access details supplied. Build: https://qa.example/a1"
    evaluate(config, states, {**message, "text": link_only}, 1)
    assert states["Android"]["value"] == "not_recorded"
    evaluate(config, states, {**message, "text": link_only + " Login: qa-manager / fictional"}, 1)
    assert states["Android"]["value"] == "access_details_provided"


def test_preview_and_worker_agree_on_interpreted_access_proof(client):
    signin(client, "mgr")
    draft = client.post("/api/watchers", json={"request": REQUEST}).json()
    path = "/api/watchers/" + draft["id"]
    config = draft["pending"]["config"]
    config["access_proof"]["Android"] = (
        "Require a build link on qa.example and login details for the manager."
    )
    result = client.post(path + "/preview", json=config).json()
    assert not result["errors"]
    assert "HTTPS build link on qa.example" in result["access_checks"]["Android"]
    assert result["rows"][-2]["states"]["Android"] == "not_recorded"
    config["access_proof"]["Android"] += " The build must be the latest."
    saved = client.post(path + "/draft", json={"number": 1, "revision": 1, "config": config}).json()
    result = client.post(path + "/preview", json=config).json()
    assert "access_proof" in result["errors"]
    assert not result["rows"]
    assert client.post(path + "/approve", json=saved["pending"]).status_code == 422


def test_dashboard_reports_worker_heartbeat_independently_of_demo_clock(client):
    signin(client, "mgr")
    assert client.get("/api/dashboard").json()["worker_status"] == "overdue"
    store.tick()
    online = client.get("/api/dashboard").json()
    assert online["worker_status"] == "online"
    assert online["worker_reported_at"]
    with store.connection(True) as db:
        db.execute("update clock set held=1")
    store.tick()
    assert client.get("/api/dashboard").json()["worker_status"] == "paused"
    with store.connection(True) as db:
        db.execute("update worker_heartbeat set reported_at=?", (CLOCK[0],))
    assert client.get("/api/dashboard").json()["worker_status"] == "overdue"


def test_archive_and_mock_receive_safe_excerpts(client, monkeypatch):
    from backend import rules

    signer = "demo-ios-42"
    with store.connection() as db:
        w = store.load(db, "H-001")
        assert w["archive"]["04"]["redacted"]
        assert signer not in json.dumps(w)
        assert "https://build.invalid" not in json.dumps(w)
    extractor = rules.extract

    def check_excerpt(text, config, *, has_access_fields=False):
        assert signer not in text
        assert "fictional-mira" not in text
        assert "https://build.invalid" not in text
        return extractor(text, config, has_access_fields=has_access_fields)

    monkeypatch.setattr(rules, "extract", check_excerpt)
    rows = preview(Config())
    assert (
        next(r for r in rows if r["message_id"] == "04")["states"]["iPhone"] == "access_details_provided"
    )


def test_startup_redacts_legacy_quotes_in_all_observations(client):
    quote = "iPhone access supplied. Username: fictional-mira Password: legacy-demo-value"
    with store.connection(True) as db:
        watcher = store.load(db, "H-001")
        watcher["history"][0]["quote"] = quote
        watcher["states"]["iPhone"]["proof"]["quote"] = quote
        next(alert for alert in watcher["alerts"] if alert["evidence"])["evidence"]["quote"] = quote
        store.save(db, watcher)
    store.initialize()
    signin(client, "mgr")
    result = client.get("/api/watchers/H-001").json()
    assert result["history"][0]["quote"] == "iPhone access supplied."
    assert result["states"]["iPhone"]["proof"]["quote"] == "iPhone access supplied."
    assert (
        next(alert for alert in result["alerts"] if alert["evidence"])["evidence"]["quote"]
        == "iPhone access supplied."
    )
    assert "legacy-demo-value" not in json.dumps(result)
