"""Single-host transactional watcher store. Each aggregate is committed with its history."""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from zoneinfo import ZoneInfo

from .rules import (
    CLOCK,
    REQUEST,
    Config,
    archive_message,
    draft,
    empty_states,
    evaluate,
    iso,
    next_check,
    parse,
    read,
    safe_excerpt,
)
from .text_assistance import word_alert


@contextmanager
def connection(write=False):
    path = Path(os.environ.get("HAWK_DB", ".hawk/workspace.sqlite3"))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15, isolation_level=None)
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def now(db) -> str:
    if os.environ.get("HAWK_CLOCK") == "wall":
        return iso(datetime.now(UTC))
    return db.execute("select instant from clock").fetchone()[0]


def save(db, w: dict):
    db.execute(
        "insert into watchers values (?,?) on conflict(id) do update set body=excluded.body",
        (w["id"], json.dumps(w)),
    )


def load(db, wid: str) -> dict:
    row = db.execute("select body from watchers where id=?", (wid,)).fetchone()
    if not row:
        raise KeyError(wid)
    return json.loads(row[0])


def new(wid, request, instant):
    conf = draft(request)
    if not conf.expires_on or os.environ.get("HAWK_CLOCK") == "wall":
        conf.expires_on = iso(parse(instant) + timedelta(days=14))
    return {
        "id": wid,
        "request": request,
        "created": instant,
        "status": "draft",
        "version": 0,
        "config": None,
        "pending": {"number": 1, "revision": 1, "status": "draft", "config": conf.model_dump()},
        "versions": [],
        "states": empty_states(conf.items),
        "alerts": [],
        "history": [],
        "archive": {},
        "runs": [],
        "checkpoints": {},
        "incidents": {},
        "next_due": None,
        "stopped_reason": None,
        "checked": None,
        "last_change": None,
    }


def alert(w, event, instant, message, evidence=None):
    if event in w["config"]["alert_on"]:
        w["alerts"].append(
            {
                "kind": event,
                "at": instant,
                "message": message,
                "evidence": evidence,
                "version": w["version"],
            }
        )


def activate(w, user, instant):
    paused = w["status"] == "paused"
    pending = w["pending"]
    c = Config(**pending["config"])
    w["versions"].append(
        {
            "number": pending["number"],
            "config": c.model_dump(),
            "approved_by": user,
            "approved_at": instant,
        }
    )
    w.update(
        version=pending["number"],
        config=c.model_dump(),
        pending=None,
        status="paused" if paused else "live",
        states=empty_states(c.items),
        stopped_reason=None,
        next_due=None if paused else instant,
        incidents={s: t for s, t in w["incidents"].items() if s in c.sources},
        last_change=None,
        checked=None,
    )
    # Reconsider only messages already observed, under their new rules.
    w["checkpoints"] = {s: t for s, t in w["checkpoints"].items() if s in c.sources}
    archived = w["archive"]
    replay = [
        message
        for message in archived.values()
        if message["thread"] in c.sources and not message.get("redacted")
    ]
    for source in c.sources:
        redacted_ids = {
            message["id"]
            for message in archived.values()
            if message["thread"] == source and message.get("redacted")
        }
        if not redacted_ids:
            continue
        if paused:
            w["checkpoints"].pop(source, None)
            continue
        try:
            replay.extend(
                message for message in read(source, c, instant, "") if message["id"] in redacted_ids
            )
        except OSError:
            # Retry on the next successful check. The archive cannot reverify redacted credentials.
            w["checkpoints"].pop(source, None)
    for message in sorted(replay, key=lambda m: (m["at"], m["id"])):
        for record in evaluate(c, w["states"], message, w["version"]):
            w["history"].append(record)
            if record["event"] == "item_changed":
                w["last_change"] = record["at"]
    if not paused:
        finish_if_done(w, instant)


def finish_if_done(w, instant):
    if w["states"] and all(state["value"] == "confirmed" for state in w["states"].values()):
        w.update(status="stopped", stopped_reason="completed", next_due=None)
        alert(w, "done", instant, word_alert("done"))


def run(w, instant):
    if w["status"] not in ("paused", "live"):
        return False
    c = Config(**w["config"])
    if parse(instant) >= parse(c.expires_on):
        w.update(status="stopped", stopped_reason="expired", next_due=None)
        return True
    if w["status"] != "live" or instant < w["next_due"]:
        return False
    finish_if_done(w, instant)
    if w["status"] == "stopped":
        return True
    scheduled = w["next_due"]
    if parse(instant) - parse(scheduled) > timedelta(minutes=5):
        alert(w, "late", instant, word_alert("late", scheduled))
    messages = []
    results = {}
    for source in c.sources:
        try:
            messages.extend(read(source, c, instant, w["checkpoints"].get(source, "")))
        except OSError:
            results[source] = "blocked"
            if source not in w["incidents"]:
                w["incidents"][source] = instant
                alert(w, "blocked", instant, word_alert("blocked", source))
        else:
            w["incidents"].pop(source, None)
            w["checkpoints"][source] = instant
            results[source] = "read"
    processed = {r["message_id"] for r in w["history"] if r["version"] == w["version"]}
    for message in sorted(messages, key=lambda m: (m["at"], m["id"])):
        if message["id"] in processed:
            continue
        w["archive"][message["id"]] = archive_message(message)
        for record in evaluate(c, w["states"], message, w["version"]):
            w["history"].append(record)
            if record["event"]:
                if record["event"] == "item_changed":
                    w["last_change"] = max(w["last_change"] or "", record["at"])
                alert(
                    w,
                    record["event"],
                    instant,
                    word_alert(record["event"], record["item"], record["reason"]),
                    record,
                )
        finish_if_done(w, instant)
        if w["status"] == "stopped":
            break
    if all(result == "read" for result in results.values()):
        w["checked"] = instant
    w["runs"].append(
        {"at": instant, "scheduled": scheduled, "sources": results, "version": w["version"]}
    )
    if w["status"] == "live":
        w["next_due"] = next_check(c, instant)
    return True


def next_watcher_number(db) -> int:
    return db.execute("update watcher_sequence set last_id=last_id+1 returning last_id").fetchone()[0]


def initialize(*, reset_demo: bool = False):
    with connection(True) as db:
        db.execute("create table if not exists watchers(id text primary key, body text not null)")
        db.execute(
            "create table if not exists sessions(token text primary key, person text, csrf text, expires integer)"
        )
        db.execute("create table if not exists clock(instant text not null, held integer not null)")
        db.execute(
            "create table if not exists worker_heartbeat(id integer primary key, reported_at text not null)"
        )
        db.execute("create table if not exists watcher_sequence(last_id integer not null)")
        db.execute("""
            insert into watcher_sequence
            select coalesce(max(cast(substr(id, 3) as integer)), 1)
            from watchers
            where not exists (select 1 from watcher_sequence)
            having not exists (select 1 from watcher_sequence)
        """)
        db.execute("delete from watchers where json_extract(body, '$.status') = 'discarded'")
        if reset_demo:
            db.execute("update watcher_sequence set last_id=1")
            db.execute("delete from watchers")
            db.execute("delete from sessions")
            db.execute("delete from clock")
        for row in db.execute("select body from watchers").fetchall():
            watcher = json.loads(row[0])
            archive = watcher.get("archive", {})
            redacted = {mid: archive_message(message) for mid, message in archive.items()}
            changed = redacted != archive
            if changed:
                watcher["archive"] = redacted
            observations = [
                *watcher.get("history", []),
                *(state.get("proof") for state in watcher.get("states", {}).values()),
                *(alert.get("evidence") for alert in watcher.get("alerts", [])),
            ]
            for observation in observations:
                if not observation:
                    continue
                quote = observation.get("quote", "")
                excerpt = safe_excerpt(quote)
                if excerpt != quote:
                    observation["quote"] = excerpt
                    changed = True
                if (key := observation.get("proof_key", "")).startswith("https://"):
                    observation["proof_key"] = sha256(key.encode()).hexdigest()
                    changed = True
            if changed:
                save(db, watcher)
        if db.execute("select count(*) from clock").fetchone()[0]:
            return
        db.execute("insert into clock values (?,0)", (CLOCK[3],))
        w = new("H-001", REQUEST, CLOCK[0])
        activate(w, "mgr", CLOCK[0])
        for instant in CLOCK[:4]:
            run(w, instant)
        save(db, w)


def tick():
    with connection(True) as db:
        if not db.execute("select held from clock").fetchone()[0]:
            instant = now(db)
            for row in db.execute("select body from watchers").fetchall():
                w = json.loads(row[0])
                if run(w, instant):
                    save(db, w)
        db.execute(
            "insert into worker_heartbeat values (1, ?) "
            "on conflict(id) do update set reported_at=excluded.reported_at",
            (iso(datetime.now(UTC)),),
        )


def worker_health(db, held: bool) -> tuple[str, str | None]:
    row = db.execute("select reported_at from worker_heartbeat where id=1").fetchone()
    reported_at = row[0] if row else None
    if not reported_at or datetime.now(UTC) - parse(reported_at) >= timedelta(seconds=20):
        return "overdue", reported_at
    return ("paused" if held else "online"), reported_at


def weekday_elapsed(start: datetime, end: datetime, zone: ZoneInfo) -> timedelta:
    elapsed = timedelta()
    while start < end:
        local = start.astimezone(zone)
        midnight = datetime.combine(local.date() + timedelta(days=1), datetime.min.time(), zone)
        boundary = min(end, midnight.astimezone(UTC))
        if local.weekday() < 5:
            elapsed += boundary - start
        start = boundary
    return elapsed


def view(w, instant, detail=False):
    # Paused watches stop accruing missed checks. Workflow drafts have their own inbox.
    active = w["status"] == "live"
    late = bool(active and parse(instant) - parse(w["next_due"]) > timedelta(minutes=5))
    claims = [a for a in w["states"] if w["states"][a]["claim"]]
    reasons = []
    if active:
        activity_at = w["last_change"] or w["versions"][-1]["approved_at"]
        if weekday_elapsed(
            parse(activity_at), parse(instant), ZoneInfo(w["config"]["timezone"])
        ) >= timedelta(hours=24):
            reasons.append("No verified progress for 24 weekday hours")
        if late:
            reasons.append("Scheduled check missed")
        reasons.extend(f"{s} thread is blocked" for s in w["incidents"])
        reasons.extend(f"{a} confirmation needed" for a in claims)
    group = (
        "Stopped"
        if w["status"] == "stopped"
        else "Setup"
        if not w["version"]
        else "Needs attention"
        if reasons
        else "Watching"
    )
    c = Config(**(w["config"] or w["pending"]["config"]))
    try:
        zone = ZoneInfo(c.timezone)
    except (KeyError, ValueError):
        zone = UTC  # type: ignore[assignment]
    day = parse(instant).astimezone(zone).date() - timedelta(days=1)
    recent = [a for a in w["alerts"] if parse(a["at"]).astimezone(zone).date() >= day]
    result = {
        key: w[key]
        for key in (
            "id",
            "request",
            "status",
            "version",
            "states",
            "checked",
            "last_change",
            "next_due",
            "stopped_reason",
            "incidents",
            "checkpoints",
        )
    }
    result.update(
        group=group,
        reasons=reasons,
        late=late,
        latest=w["alerts"][-1] if w["alerts"] else None,
        recent=recent,
        timezone=str(zone),
        has_pending=bool(w["pending"]) and w["status"] != "stopped",
        quiet_hours=int((parse(instant) - parse(w["last_change"])).total_seconds() // 3600)
        if w["last_change"]
        else None,
    )
    if detail:
        result.update(
            {key: w[key] for key in ("history", "runs", "versions", "config", "pending", "alerts")}
        )
    return result
