"""Mobile-access block, fixture reader and tool-free mock. No external source writes."""

import json
import re
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, computed_field

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
SCENARIO = json.loads((FIXTURES / "scenario.json").read_text())
PEOPLE = SCENARIO["people"]
THREADS = SCENARIO["threads"]
CLOCK = SCENARIO["clock"]
APPS = ("iPhone", "Android")
REQUEST = "Tell me when I can test both of our mobile apps."
GOAL = "The manager can test both iPhone and Android applications."
EVENTS = ["item_changed", "claim", "blocked", "late", "done"]
STATES = ["not_recorded", "access_details_provided", "confirmed"]


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value)


def iso(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


ACCESS_PROOF = "An eligible author provides a build link and login details for the manager."


class AccessEvidence(BaseModel):
    build_host: str = "build.invalid"
    manager_account: str = "fictional-mira"


def interpret_access_proof(text: str) -> AccessEvidence | None:
    """Interpret the supported proof wording without silently dropping conditions."""
    match = re.fullmatch(
        r"(?:an eligible author (?:provides|posts|supplies) |require )?"
        r"(?:an? )?(?:https )?build link(?: (?:on|from) (?P<host>[a-z0-9-]+(?:\.[a-z0-9-]+)+))?"
        r" and (?:the )?login details(?: (?:for|intended for) the manager)?[.]?",
        " ".join(text.split()),
        re.IGNORECASE,
    )
    if not match:
        return None
    return AccessEvidence(build_host=match["host"] or "", manager_account="")


def access_checks(config: "Config") -> dict[str, str]:
    checks = {}
    for item, text in config.access_proof.items():
        interpreted = interpret_access_proof(text)
        if interpreted:
            host = f" on {interpreted.build_host}" if interpreted.build_host else ""
            checks[item] = (
                f"An eligible author’s message must contain an HTTPS build link{host} and login details."
            )
    return checks


class Config(BaseModel):
    goal: str = GOAL
    sources: list[str] = Field(default_factory=lambda: ["ios", "android"])
    people_who_count: list[str] = Field(default_factory=lambda: ["mgr", "lead", "dev"])
    visible_to: list[str] = Field(default_factory=lambda: ["mgr", "coord"])
    not_counted: list[str] = Field(default_factory=lambda: ["submitted for review"])
    # One supported family of rules. The strict option requires explicit test wording.
    confirmation_rule: str = "personal_access"
    check_times: list[str] = Field(default_factory=lambda: ["09:00", "13:00", "17:00"])
    timezone: str = "UTC"
    expires_on: str = "2026-12-04T17:00:00Z"
    alert_on: list[str] = Field(default_factory=lambda: EVENTS.copy())
    items: dict[str, list[str]] = Field(default_factory=lambda: {app: STATES.copy() for app in APPS})
    proof_statements: dict[str, str] = Field(default_factory=dict)
    access_proof: dict[str, str] = Field(default_factory=dict)
    access_evidence: dict[str, AccessEvidence] = Field(default_factory=dict)
    mobile_proof_statements: dict[str, list[str]] = Field(default_factory=dict)
    done_when: str = "iPhone.confirmed AND Android.confirmed"
    stop_when: list[str] = Field(default_factory=lambda: ["done", "expiry"])

    def mobile_statements(self, item: str) -> list[str]:
        if item in self.mobile_proof_statements:
            return self.mobile_proof_statements[item]
        statements = [f"I can test {item}."]
        if self.confirmation_rule == "personal_access":
            statements.append(f"I'm in the {item} app.")
        return statements

    @computed_field
    @property
    def item_rules(self) -> dict[str, dict[str, str]]:
        """Block representation of each allowed value and its evidence rule."""
        result = {}
        interpreted_access = access_checks(self)
        for item, values in self.items.items():
            rules = {"not_recorded": "Starting value. No proof required."}
            if self.confirmation_rule == "exact_statement":
                statement = self.proof_statements.get(item)
                rules["confirmed"] = (
                    f"An eligible author posts this exact statement: {statement}"
                    if statement
                    else "Proof statement required."
                )
            else:
                required = self.access_evidence.get(item, AccessEvidence())
                rules["access_details_provided"] = (
                    interpreted_access.get(item, "Proof wording needs review.")
                    if item in self.access_proof
                    else (
                        f"An eligible author posts an HTTPS build link on {required.build_host} "
                        f"and supplies login details for {required.manager_account}."
                    )
                )
                rules["confirmed"] = "The manager posts one of these exact statements: " + " / ".join(
                    self.mobile_statements(item)
                )
            result[item] = {value: rules[value] for value in values if value in rules}
        return result


def draft(request: str) -> Config:
    if request.strip() == REQUEST:
        config = Config()
        config.access_proof = dict.fromkeys(APPS, ACCESS_PROOF)
        config.mobile_proof_statements = {item: config.mobile_statements(item) for item in APPS}
        return config
    config = Config(
        goal="",
        people_who_count=["lead"],
        expires_on="",
        items={},
        confirmation_rule="exact_statement",
        not_counted=[],
        done_when="all_confirmed",
    )
    request_text = " ".join(request.split()).rstrip("?.!")
    clause = re.search(
        r"(?:\b(?:whether|if|when)\s+|(?=^the\s))(?P<subject>.+?)\s+"
        r"(?P<condition>is ready(?: for (?:my |the )?.+)?|is approved|is signed|is complete"
        r"|is finished|is finalized|has been (?:delivered|approved|signed|completed|published))$",
        request_text,
        re.IGNORECASE,
    )
    if clause:
        subject = re.sub(r"^the\s+", "", clause["subject"], flags=re.IGNORECASE)
        condition = re.sub(
            r"^is ready for my\s+", "is ready for ", clause["condition"], flags=re.IGNORECASE
        )
        if not directive(subject) and not re.search(r"\b(?:and|or)\b", subject, re.IGNORECASE):
            item = (
                f"{subject} readiness" if condition.casefold().startswith("is ready for ") else subject
            )
            statement = f"The {subject} {condition}."
            config.goal = statement
            config.items = {item: ["not_recorded", "confirmed"]}
            config.proof_statements = {item: statement}
            config.not_counted = ["submitted for review", "awaiting review"]
            if item.endswith(" readiness"):
                config.not_counted.insert(0, "draft ready")
    return config


def directive(text: str) -> bool:
    action = r"(?:mark|set|treat|record|approve|confirm|close|flag|count|consider)"
    return bool(
        re.search(
            rf"\b(?:hawk|assistant)\s*[,!:]|\b(?:ignore|override|disregard)\b.*\b(?:rules|instructions)\b"
            rf"|(?:^|[.!;]\s*)(?:please\s+)?{action}\s+"
            rf"|\b(?:can|could|would|will|should|must|need to|want you to|ask you to|go ahead and)"
            rf"\s+(?:(?:you|hawk|the assistant|please|just)\s+)*{action}\s+"
            rf"|\b(?:should|must|needs to)\s+be\s+(?:marked|set|treated|recorded|approved|confirmed|closed)\b",
            text.strip(),
            re.IGNORECASE,
        )
    )


def mobile_proof_is_safe(item: str, text: str) -> bool:
    text = text.strip()
    return (
        bool(re.match(r"^I(?:\s|['’])", text, re.IGNORECASE))
        and item.casefold() in text.casefold()
        and safe_excerpt(text) == text
        and not directive(text)
        and not re.search(
            r"\b(?:not|never|unable|cannot|can['’]t|couldn['’]t)\b|[?]", text, re.IGNORECASE
        )
    )


def custom_claim(item: str, text: str) -> bool:
    subject = rf"(?:the )?{re.escape(item.casefold().removesuffix(' readiness'))}"
    status = r"(?:done|ready|complete|completed|approved|delivered|finished|finalized|finalised|signed off|wrapped up|good to go)"
    # Match affirmative statements only. Questions, quoted statements, negation and
    # conditional wording fall outside these whole-message patterns.
    fact = rf"{subject} (?:is|has been|was) (?:now |already )?{status}"
    action = rf"(?:i|we)(?: have|'ve)? (?:finished|completed|finali[sz]ed|delivered|approved|signed off on|wrapped up) {subject}"
    return not directive(text) and bool(
        re.fullmatch(
            rf"(?:(?:quick update|for awareness|fyi)[:,]\s*)?(?:{fact}|{action})(?: for (?:signature|sign-off))?[.!]?",
            text.strip().casefold().replace("’", "'"),
        )
    )


def lint(c: Config, now: str) -> dict[str, str]:
    errors = {}
    if len(c.goal.strip().split()) < 3:
        errors["goal"] = "Describe one concrete outcome that can be verified."
    if not 1 <= len(set(c.sources)) == len(c.sources) <= 3 or set(c.sources) - {"ios", "android"}:
        errors["sources"] = "Select available, distinct release threads."
    if not c.people_who_count or set(c.people_who_count) - PEOPLE.keys():
        errors["people_who_count"] = "Select at least one known author who can provide proof."
    elif c.confirmation_rule != "exact_statement" and "mgr" not in c.people_who_count:
        errors["people_who_count"] = "Include the manager for mobile access confirmation."
    if not {"mgr", "coord"} <= set(c.visible_to) or set(c.visible_to) - PEOPLE.keys():
        errors["visible_to"] = "Include the manager and coordinator and only known identities."
    if any(not x.strip() for x in c.not_counted):
        errors["not_counted"] = "Include a specific lookalike to exclude."
    if c.confirmation_rule not in ("personal_access", "explicit_test", "exact_statement"):
        errors["confirmation_rule"] = "Choose a supported confirmation rule."
    if not c.check_times or any(
        not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", t) for t in c.check_times
    ):
        errors["check_times"] = "Enter weekday checks as HH:MM."
    try:
        ZoneInfo(c.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        errors["timezone"] = "Enter a valid IANA timezone."
    try:
        if parse(c.expires_on) <= parse(now):
            raise ValueError
    except (TypeError, ValueError):
        errors["expires_on"] = "Choose a future expiry with a time and timezone."
    if set(c.alert_on) - set(EVENTS):
        errors["alert_on"] = "Choose known alert types."
    if c.confirmation_rule == "exact_statement":
        proofs = [text.strip().casefold() for text in c.proof_statements.values()]
        if (
            not c.items
            or set(c.items) != set(c.proof_statements)
            or any(not name.strip() for name in c.items)
            or any(values != ["not_recorded", "confirmed"] for values in c.items.values())
            or any(
                len(text.split()) < 3 or directive(text) or safe_excerpt(text) != text for text in proofs
            )
            or len(set(proofs)) != len(proofs)
        ):
            errors["items"] = (
                "Add at least one named item with a distinct, specific proof statement that contains no commands or credentials."
            )
        if c.done_when != "all_confirmed":
            errors["items"] = "Completion requires confirmation of every tracked item."
    elif c.items != Config().items or c.done_when != Config().done_when:
        errors["items"] = "The mobile access preset requires both platforms."
    if (
        c.confirmation_rule != "exact_statement"
        and c.mobile_proof_statements
        and (
            set(c.mobile_proof_statements) != set(c.items)
            or any(
                not statements or any(not mobile_proof_is_safe(item, text) for text in statements)
                for item, statements in c.mobile_proof_statements.items()
            )
        )
    ):
        errors["items"] = "Provide an affirmative first-person proof statement naming each app."
    if set(c.access_evidence) - set(c.items) or any(
        not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", requirement.build_host, re.IGNORECASE)
        or not re.fullmatch(r"[\w.@+-]+", requirement.manager_account)
        for requirement in c.access_evidence.values()
    ):
        errors["access_evidence"] = "Enter a build hostname and a manager account name for each app."
    if set(c.access_proof) - set(c.items) or any(
        interpret_access_proof(rule) is None for rule in c.access_proof.values()
    ):
        errors["access_proof"] = (
            "Hawk can verify a build link and login details, with an optional hostname. "
            "Use wording like: Require a build link on qa.example and login details for the manager."
        )
    if sorted(c.stop_when) != ["done", "expiry"]:
        errors["stop_when"] = "Watchers stop on completion or expiry."
    return errors


def next_check(c: Config, now: str) -> str:
    local = parse(now).astimezone(ZoneInfo(c.timezone))
    for offset in range(8):
        day = local.date() + timedelta(days=offset)
        if day.weekday() < 5:
            for slot in sorted(c.check_times):
                candidate = datetime.combine(day, time.fromisoformat(slot), local.tzinfo)
                if candidate > local:
                    return iso(candidate)
    raise ValueError("Invalid schedule")


def read(source: str, config: Config, now: str, after: str) -> list[dict]:
    if source not in config.sources or source not in ("ios", "android"):
        raise PermissionError("Source outside approved scope")
    if any(o["source"] == source and o["start"] <= now < o["end"] for o in SCENARIO["outages"]):
        raise OSError("Release thread is temporarily unreadable")
    messages = json.loads((FIXTURES / "threads" / f"{source}.json").read_text())
    return [m for m in messages if m["thread"] == source and after < m["at"] <= now]


def safe_excerpt(text: str) -> str:
    # Exact prefix from the source. Access packets keep secrets after the first sentence.
    return re.split(r"\s+(?:Build:|Login:)|https?://", text, maxsplit=1, flags=re.IGNORECASE)[0].strip()


def extract(text: str, c: Config) -> list[tuple[str, str, str]]:
    """Disclosed deterministic stand-in for the tool-free text extractor."""
    if c.confirmation_rule == "exact_statement":
        candidates = []
        for item, proof in c.proof_statements.items():
            if text.strip().casefold() == proof.strip().casefold():
                candidates.append((item, "confirmed", safe_excerpt(text)))
            elif custom_claim(item, text):
                candidates.append((item, "claimed", safe_excerpt(text)))
        return candidates
    matched = [
        (item, "confirmed", safe_excerpt(text))
        for item, statements in c.mobile_proof_statements.items()
        if any(text.strip().casefold() == statement.strip().casefold() for statement in statements)
    ]
    if matched:
        return matched
    apps = [a for a in c.items if a.lower() in text.lower() or "both apps" in text.lower()]
    value = "unclear"
    if "both apps are done" in text.lower():
        value = "claimed"
    elif "login:" in text.lower():
        value = "access_details_provided"
    elif re.search(r"I can test|I.m in|confirmed", text, re.IGNORECASE):
        value = "confirmed"
    return [(a, value, safe_excerpt(text)) for a in apps]


def decide(c: Config, m: dict, candidate: tuple[str, str, str]) -> tuple[str, str, str]:
    app, value, quote = candidate
    text = m["text"]
    if app not in c.items or m["thread"] not in c.sources or m["author"] not in c.people_who_count:
        return "unclear", "Source or author is outside the approved rules.", ""
    if value not in c.items[app] and value != "claimed":
        return "unclear", "The proposed value is outside the allowed list.", ""
    if not quote or quote not in text or quote not in safe_excerpt(text):
        return "unclear", "The proposed excerpt could not be verified.", ""
    if any(s.lower() in text.lower() for s in c.not_counted):
        return "unclear", "Excluded by the approved lookalike rule.", ""
    if c.confirmation_rule == "exact_statement" and (len(text.split()) < 3 or directive(text)):
        return "unclear", "Instructions in source text cannot establish proof.", ""
    if value == "claimed" and c.confirmation_rule == "exact_statement" and custom_claim(app, text):
        return "claimed", "Completion claimed without the approved proof statement.", "claim"
    if value == "claimed" and re.fullmatch(r"Both apps are done[.!]?", text.strip(), re.IGNORECASE):
        return "claimed", "Completion claimed without manager confirmation.", "claim"
    if value == "confirmed" and c.confirmation_rule == "exact_statement":
        if (
            quote == text.strip()
            and quote.casefold() == c.proof_statements.get(app, "").strip().casefold()
        ):
            return value, "An eligible author posted the approved proof statement.", "manager-proof"
        return "unclear", "Requires the approved proof statement from an eligible author.", ""
    if value == "confirmed" and c.mobile_proof_statements:
        if (
            m["author"] == "mgr"
            and quote == text.strip()
            and mobile_proof_is_safe(app, text)
            and any(
                quote.casefold() == statement.strip().casefold()
                for statement in c.mobile_statements(app)
            )
        ):
            return value, "Manager personally confirmed access.", "manager-access"
        return "unclear", "Requires an approved statement from the manager for this app.", ""
    if value == "confirmed":
        patterns = [rf"I can test (?:the )?{app}(?: app)?[.!]?"]
        if c.confirmation_rule == "personal_access":
            patterns.append(rf"I(?:'|’)m in (?:the )?{app}(?: app)?[.!]?")
        if (
            m["author"] == "mgr"
            and quote == text.strip()
            and any(re.fullmatch(p, text.strip(), re.IGNORECASE) for p in patterns)
        ):
            return value, "Manager personally confirmed access.", "manager-access"
        return "unclear", "Requires the manager’s own affirmative statement for this app.", ""
    if value == "access_details_provided":
        if app in c.access_proof:
            required = interpret_access_proof(c.access_proof[app])
            if required is None:
                return "unclear", "The approved access proof wording needs review.", ""
        else:
            required = c.access_evidence.get(app, AccessEvidence())
        host = re.escape(required.build_host) if required.build_host else r"[a-z0-9-]+(?:\.[a-z0-9-]+)+"
        account = re.escape(required.manager_account) if required.manager_account else r"[\w.@+-]+"
        packet = re.fullmatch(
            rf"{app} (?:access details supplied|test account is ready)\. Build: (https://{host}/[\w/-]+) Login: {account} / [\w-]+",
            text,
            re.IGNORECASE,
        )
        if packet:
            return value, "Build and manager login details supplied.", packet[1]
    return "unclear", "This update does not meet an approved proof rule.", ""


def empty_states(items=APPS) -> dict:
    return {a: {"value": "not_recorded", "proof": None, "claim": False} for a in items}


def evaluate(c: Config, states: dict, message: dict, version: int) -> list[dict]:
    records = []
    for candidate in extract(message["text"], c):
        app, _, quote = candidate
        value, reason, key = decide(c, message, candidate)
        if app not in states:
            continue
        state = states[app]
        event = ""
        if value == "claimed" and state["value"] != "confirmed" and not state["claim"]:
            state["claim"] = True
            event = "claim"
        if value in STATES and STATES.index(value) > STATES.index(state["value"]):
            state["value"] = value
            event = "item_changed"
            if value == "confirmed":
                state["claim"] = False
        if (
            not event
            and state["proof"]
            and value == state["value"]
            and key == state["proof"]["proof_key"]
        ):
            reason = "Repeat of the same item, value, and evidence. No new alert."
        record = {
            "message_id": message["id"],
            "source": message["thread"],
            "author": message["author"],
            "at": message["at"],
            "item": app,
            "value": value,
            "reason": reason,
            "quote": quote if quote in safe_excerpt(message["text"]) else "",
            "proof_key": key,
            "version": version,
            "event": event,
        }
        if event == "item_changed":
            state["proof"] = record.copy()
        records.append(record)
    return records


def preview(c: Config) -> list[dict]:
    states = empty_states(c.items)
    output = []
    samples = [m for src in c.sources for m in read(src, c, CLOCK[-1], "")]
    for message in sorted(samples, key=lambda m: (m["at"], m["id"])):
        if message["thread"] in c.sources:
            records = evaluate(c, states, message, 0)
            output.append(
                {
                    "message_id": message["id"],
                    "author": message["author"],
                    "at": message["at"],
                    "quote": safe_excerpt(message["text"]),
                    "reason": records[0]["reason"] if records else "No tracked item.",
                    "states": {a: states[a]["value"] for a in c.items},
                }
            )
    return output
