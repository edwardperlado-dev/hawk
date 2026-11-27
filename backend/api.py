from __future__ import annotations

import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from . import store
from .rules import CLOCK, PEOPLE, THREADS, Config, access_checks, iso, lint, parse, preview, safe_excerpt
from .text_assistance import review_draft


class Evidence(BaseModel):
    item: str
    value: str
    reason: str
    quote: str
    at: str
    source: str
    author: str
    message_id: str
    version: int
    event: str


class State(BaseModel):
    value: str
    proof: Evidence | None
    claim: bool


class Alert(BaseModel):
    kind: str
    at: str
    message: str
    evidence: Evidence | None
    version: int


class Card(BaseModel):
    id: str
    request: str
    group: str
    status: str
    version: int
    checked: str | None
    next_due: str | None
    last_change: str | None
    quiet_hours: int | None
    stopped_reason: str | None
    reasons: list[str]
    late: bool
    timezone: str
    has_pending: bool
    latest: Alert | None
    recent: list[Alert]
    states: dict[str, State]
    checkpoints: dict[str, str]
    incidents: dict[str, str]


class Pending(BaseModel):
    number: int
    revision: int
    status: str
    config: Config


class Version(BaseModel):
    number: int
    config: Config
    approved_by: str
    approved_at: str


class Run(BaseModel):
    at: str
    scheduled: str
    sources: dict[str, str]
    version: int


class Detail(Card):
    pending: Pending | None
    config: Config | None
    versions: list[Version]
    history: list[Evidence]
    runs: list[Run]
    alerts: list[Alert]


class Dashboard(BaseModel):
    person: str
    instant: str
    held: bool
    clock_mode: str
    worker_status: Literal["online", "paused", "overdue"]
    worker_reported_at: str | None
    cards: list[Card]


class Login(BaseModel):
    person: Literal["mgr", "coord", "lead", "dev"]


class NewRequest(BaseModel):
    request: str = Field(min_length=1, max_length=1000)


class Review(BaseModel):
    number: int
    revision: int


class Edit(Review):
    config: Config


class Demo(BaseModel):
    action: Literal["advance", "miss", "resume"]


@asynccontextmanager
async def lifespan(app):
    store.initialize()
    yield


app = FastAPI(title="Hawk watcher API", version="1.0", lifespan=lifespan)


def require_origin(req: Request):
    allowed = os.environ.get("HAWK_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if req.headers.get("origin") not in allowed:
        raise HTTPException(403, "Untrusted request origin.")


def identity(req: Request) -> str:
    with store.connection() as db:
        session = db.execute(
            "select * from sessions where token=? and expires>?",
            (req.cookies.get("hawk_session", ""), int(time.time())),
        ).fetchone()
    if not session:
        raise HTTPException(401, "Choose a demo identity.")
    if req.method != "GET":
        require_origin(req)
        if not secrets.compare_digest(req.headers.get("x-hawk-csrf", ""), session["csrf"]):
            raise HTTPException(403, "Session verification failed. Sign in again.")
    return session["person"]


def require(person, *roles):
    if person not in roles:
        raise HTTPException(403, "Your role cannot perform this action.")


def visible(w, person):
    return person in (w["config"] or Config().model_dump())["visible_to"]


def get(db, wid, user):
    try:
        w = store.load(db, wid)
    except KeyError:
        raise HTTPException(404, "Watcher unavailable.")
    if not visible(w, user):
        raise HTTPException(404, "Watcher unavailable.")
    return w


def snapshot(db, w):
    store.save(db, w)
    return store.view(w, store.now(db), True)


def check_revision(w, edit):
    p = w["pending"]
    if not p or (p["number"], p["revision"]) != (edit.number, edit.revision):
        raise HTTPException(409, "This draft changed. Reload and review the current version.")


@app.middleware("http")
async def headers(request, call_next):
    res = await call_next(request)
    res.headers["Cache-Control"] = "no-store"
    res.headers["X-Content-Type-Options"] = "nosniff"
    return res


@app.post("/api/session")
def login(body: Login, req: Request, res: Response):
    require_origin(req)
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    with store.connection(True) as db:
        db.execute(
            "delete from sessions where token=? or expires<=?",
            (req.cookies.get("hawk_session", ""), int(time.time())),
        )
        db.execute(
            "insert into sessions values(?,?,?,?)", (token, body.person, csrf, int(time.time()) + 28800)
        )
    for name, secret, http_only in [("hawk_session", token, True), ("hawk_csrf", csrf, False)]:
        res.set_cookie(
            name,
            secret,
            httponly=http_only,
            samesite="strict",
            max_age=28800,
            secure=os.environ.get("HAWK_HTTPS") == "1",
        )
    return {"person": body.person}


@app.get("/api/dashboard", response_model=Dashboard)
def dashboard(user: str = Depends(identity)):
    with store.connection() as db:
        instant = store.now(db)
        cards = [
            store.view(w, instant)
            for row in db.execute("select body from watchers order by id")
            if visible(w := json.loads(row[0]), user)
        ]
        held = bool(db.execute("select held from clock").fetchone()[0])
        worker_status, worker_reported_at = store.worker_health(db, held)
        return {
            "person": user,
            "instant": instant,
            "cards": cards,
            "held": held,
            "worker_status": worker_status,
            "worker_reported_at": worker_reported_at,
            "clock_mode": os.environ.get("HAWK_CLOCK", "demo"),
        }


@app.post("/api/watchers", response_model=Detail)
def create(body: NewRequest, user: str = Depends(identity)):
    require(user, "mgr")
    with store.connection(True) as db:
        number = store.next_watcher_number(db)
        return snapshot(db, store.new(f"H-{number:03}", body.request, store.now(db)))


@app.get("/api/watchers/{wid}", response_model=Detail)
def detail(wid: str, user: str = Depends(identity)):
    with store.connection() as db:
        return store.view(get(db, wid, user), store.now(db), True)


@app.post("/api/watchers/{wid}/revision", response_model=Detail)
def revision(wid: str, user: str = Depends(identity)):
    require(user, "coord")
    with store.connection(True) as db:
        w = get(db, wid, user)
        if w["status"] == "stopped" or w["pending"]:
            raise HTTPException(409, "A new revision cannot be opened in this state.")
        w["pending"] = {
            "number": w["version"] + 1,
            "revision": w.get("next_draft_revision", 1),
            "status": "draft",
            "config": w["config"].copy(),
        }
        return snapshot(db, w)


@app.post("/api/watchers/{wid}/draft", response_model=Detail)
def edit_draft(wid: str, body: Edit, user: str = Depends(identity)):
    with store.connection(True) as db:
        w = get(db, wid, user)
        require(user, "coord" if w["version"] else "mgr")
        if w["status"] == "stopped":
            raise HTTPException(409, "Watcher has stopped.")
        check_revision(w, body)
        w["pending"].update(config=body.config.model_dump(), revision=body.revision + 1, status="draft")
        if not w["version"]:
            w["status"] = "draft"
        return snapshot(db, w)


@app.post("/api/watchers/{wid}/discard", response_model=Detail | None)
def discard_draft(wid: str, body: Review, user: str = Depends(identity)):
    with store.connection(True) as db:
        w = get(db, wid, user)
        require(user, "coord" if w["version"] else "mgr")
        check_revision(w, body)
        if not w["version"]:
            db.execute("delete from watchers where id=?", (wid,))
            return None
        w["next_draft_revision"] = body.revision + 1
        w["pending"] = None
        return snapshot(db, w)


class PreviewRow(BaseModel):
    message_id: str
    author: str
    at: str
    quote: str
    reason: str
    states: dict[str, str]


class Preview(BaseModel):
    errors: dict[str, str]
    rows: list[PreviewRow]
    review: str
    access_checks: dict[str, str]


@app.post("/api/watchers/{wid}/preview", response_model=Preview)
def dry_run(wid: str, body: Config, user: str = Depends(identity)):
    require(user, "mgr", "coord")
    with store.connection() as db:
        get(db, wid, user)
        errors = lint(body, store.now(db))
    return {
        "errors": errors,
        "rows": [] if errors else preview(body),
        "review": review_draft(body),
        "access_checks": access_checks(body),
    }


@app.post("/api/watchers/{wid}/{action}", response_model=Detail)
def transition(
    wid: str,
    action: Literal["submit", "approve", "pause", "resume"],
    body: Review,
    user: str = Depends(identity),
):
    require(user, "mgr" if action == "approve" else "coord")
    with store.connection(True) as db:
        w = get(db, wid, user)
        instant = store.now(db)
        if action in ("pause", "resume"):
            if w["status"] != ("live" if action == "pause" else "paused") or body.number != w["version"]:
                raise HTTPException(409, "The watcher state changed.")
            w.update(
                status="paused" if action == "pause" else "live",
                next_due=None if action == "pause" else instant,
            )
        else:
            check_revision(w, body)
            if w["status"] == "stopped":
                raise HTTPException(409, "Watcher has stopped.")
            if action == "submit" and not w["version"]:
                raise HTTPException(403, "The manager approves Hawk’s first draft directly.")
            config = Config(**w["pending"]["config"])
            errors = lint(config, instant)
            if errors:
                raise HTTPException(422, errors)
            if action == "submit":
                preview(config)
                w["pending"]["status"] = "in review"
                if not w["version"]:
                    w["status"] = "in review"
            else:
                if w["version"] and w["pending"]["status"] != "in review":
                    raise HTTPException(409, "Coordinator must submit this revision first.")
                if not w["version"]:
                    preview(config)
                store.activate(w, user, instant)
        return snapshot(db, w)


@app.get("/api/watchers/{wid}/messages/{mid}")
def evidence(wid: str, mid: str, user: str = Depends(identity)):
    with store.connection() as db:
        w = get(db, wid, user)
        record = next((r for r in reversed(w["history"]) if r["message_id"] == mid), None)
        if not record:
            raise HTTPException(404, "Evidence unavailable for this watcher.")
        m = w["archive"][mid]
        return {
            "quote": safe_excerpt(m["text"]),
            "author": PEOPLE[m["author"]]["name"],
            "source": THREADS[m["thread"]],
            "at": m["at"],
            "message_id": mid,
        }


@app.post("/api/demo")
def clock(body: Demo, user: str = Depends(identity)):
    require(user, "mgr", "coord")
    if os.environ.get("HAWK_CLOCK") == "wall":
        raise HTTPException(409, "Wall clock is active.")
    with store.connection(True) as db:
        instant = store.now(db)
        future = next((t for t in CLOCK if t > instant), None)
        if body.action != "resume" and not future:
            raise HTTPException(409, "End of the fixture timeline.")
        updated = instant if body.action == "resume" else future
        if body.action == "miss" and updated:
            updated = iso(parse(updated) + timedelta(minutes=6))
        db.execute("update clock set instant=?, held=?", (updated, int(body.action == "miss")))
    return {"clock": "updated"}
