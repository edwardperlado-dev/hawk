"""Tool-free, deterministic stand-ins for AI review and alert wording."""

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .rules import Config


def review_draft(config: "Config") -> str:
    notes = []
    if not config.goal.strip():
        notes.append("Describe one observable outcome.")
    elif re.search(r"\b(?:and then|or alternatively)\b", config.goal, re.IGNORECASE):
        notes.append("Check whether the goal combines separate outcomes.")
    if config.confirmation_rule == "exact_statement":
        for item, statement in config.proof_statements.items():
            if re.fullmatch(r"(?:done|ready|confirmed)[.!]?", statement.strip(), re.IGNORECASE):
                notes.append(f"{item}: ask for wording that identifies what was completed.")
    if not config.not_counted:
        notes.append("Consider listing lookalikes such as a draft submitted for review.")
    else:
        notes.append("Check that these lookalikes cannot pass: " + ", ".join(config.not_counted) + ".")
    return " ".join(notes)


def word_alert(event: str, detail: str = "", reason: str = "") -> str:
    templates = {
        "item_changed": "{detail} · {reason}",
        "claim": "{detail} · {reason}",
        "blocked": "{detail} thread could not be read.",
        "late": "Missed scheduled check at {detail}.",
        "done": "All tracked items confirmed.",
    }
    return templates[event].format(detail=detail, reason=reason)
