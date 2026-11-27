"use client";
import Link from "next/link";
import { MissedCheck } from "../../chrome";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type Detail,
  type Config,
  type Preview,
  appUsers,
  people,
  roles,
  sources,
  stamp,
  SYDNEY_TIME_ZONE,
  proofUrl,
  values,
  post,
  HawkRequestError,
} from "@/lib/data";

const alertLabels: Record<string, string> = {
  item_changed: "A tracked item changes status",
  claim: "Someone claims completion without proof",
  blocked: "A source becomes unreadable",
  late: "A scheduled check is missed",
  done: "The watcher reaches its completion condition",
};

const choiceHelp = {
  sources: "Choose 1 to 3 threads for Hawk to read.",
  people_who_count:
    "Choose whose messages can count as proof. This does not grant access to the Watchboard.",
  visible_to:
    "Choose who can see this watcher and its alerts. The manager and coordinator are always included.",
  alert_on: "Choose the events that should appear in the alert feed.",
};

const fields: Record<string, string> = {
  goal: "Outcome",
  sources: "Source threads",
  people_who_count: "Eligible authors",
  visible_to: "Audience",
  not_counted: "Excluded phrases",
  item_rules: "Tracked items",
  done_when: "Done when",
  stop_when: "Stop when",
  check_times: "Weekday checks",
  expires_on: "Expiry",
  alert_on: "Alert triggers",
};
const sydneyDateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: SYDNEY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function formatExpiry(instant: Date) {
  return sydneyDateTime.format(instant).replace(" ", "T");
}

function parseExpiry(value: string) {
  if (!value) return "";
  const local = value.length === 16 ? value + ":00" : value;
  const wallTime = Date.parse(local + "Z");
  const offsetAt = (instant: number) =>
    Date.parse(formatExpiry(new Date(instant)) + "Z") - instant;
  const offsets = [offsetAt(wallTime), offsetAt(wallTime - 86_400_000)];
  for (const offset of offsets.sort((a, b) => b - a)) {
    const candidate = new Date(wallTime - offset);
    if (formatExpiry(candidate) === local) return candidate.toISOString();
  }
  return "";
}

function ItemRules({ rules }: { rules: Config["item_rules"] }) {
  if (!rules || !Object.keys(rules).length) return "No tracked items";
  return (
    <ul className="block-items">
      {Object.entries(rules).map(([name, states]) => (
        <li key={name}>
          <strong>{name}</strong>
          <ProofRules states={states} />
        </li>
      ))}
    </ul>
  );
}

function ProofRules({ states }: { states: Record<string, string> }) {
  return (
    <dl className="block-proof-rules">
      {Object.entries(states).map(([state, proof]) => (
        <div key={state}>
          <dt>
            <span className="badge">{values[state] || state}</span>
          </dt>
          <dd>{proof}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatExcludedPhrases(phrases: string[] = []) {
  return phrases.map((phrase) => JSON.stringify(phrase)).join(", ");
}

function parseExcludedPhrases(text: string): string[] | null {
  try {
    const phrases: unknown = JSON.parse(`[${text}]`);
    if (
      Array.isArray(phrases) &&
      phrases.every((phrase) => typeof phrase === "string" && phrase.trim())
    ) {
      return phrases.map((phrase) => phrase.trim());
    }
  } catch {
    // Keep the typed text in the field so the user can correct it.
  }
  return null;
}

function display(key: string, value: unknown) {
  if (key === "expires_on" && typeof value === "string") return stamp(value);
  if (key === "done_when") return "Every tracked item is confirmed.";
  if (key === "stop_when") return "When done or when the watcher expires.";
  if (key === "not_counted" && Array.isArray(value))
    return formatExcludedPhrases(value) || "None";
  if (Array.isArray(value))
    return value
      .map((x) => people[x] || sources[x] || alertLabels[x] || x)
      .join(", ");
  return String(value ?? "Not recorded");
}
export default function Watcher({
  initial,
  person,
}: {
  initial: Detail;
  person: string;
}) {
  const [trackedItems, setTrackedItems] = useState(
    Object.entries(initial.pending?.config.proof_statements || {}),
  );
  const [excludedText, setExcludedText] = useState(
    formatExcludedPhrases(initial.pending?.config.not_counted),
  );
  const [excludedError, setExcludedError] = useState(false);
  const [w, setW] = useState(initial),
    [form, setForm] = useState<Config | null>(initial.pending?.config || null),
    [draftConflict, setDraftConflict] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [msg, setMsg] = useState(""),
    [toastTone, setToastTone] = useState("success"),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!msg) return;
    const timeout = window.setTimeout(() => setMsg(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [msg]);
  const router = useRouter();
  const discardDialog = useRef<HTMLDialogElement>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const outcomeInput = useRef<HTMLInputElement>(null);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  const approvalDialog = useRef<HTMLDialogElement>(null);
  const coord = person === "coord",
    manager = person === "mgr",
    base = "watchers/" + w.id + "/",
    pending = w.pending,
    editable =
      (w.version > 0 ? coord : manager) && form && w.status !== "stopped";
  const needsOutcome = Boolean(
    editable && w.version === 0 && pending && !pending.config.goal.trim(),
  );
  useEffect(() => {
    if (needsOutcome) outcomeInput.current?.focus();
  }, [needsOutcome]);
  useEffect(() => {
    if (!editable) return;
    const draftUrl = window.location.href;
    // Keep the previous entry on this draft so Back can show the same dialog
    // before the app router leaves the editor.
    function armBrowserBack() {
      if (window.history.state?.hawkDraftGuard !== draftUrl) {
        window.history.pushState(
          { ...window.history.state, hawkDraftGuard: draftUrl },
          "",
          draftUrl,
        );
      }
    }
    function confirmBrowserBack(event: PopStateEvent) {
      if (
        window.location.href !== draftUrl ||
        event.state?.hawkDraftGuard === draftUrl
      )
        return;
      event.stopImmediatePropagation();
      armBrowserBack();
      if (!busy && !leaveDialog.current?.open) leaveDialog.current?.showModal();
    }
    armBrowserBack();
    function confirmNavigation(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.download || (link.target && link.target !== "_self"))
        return;
      const destination = new URL(link.href);
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      )
        return;
      event.preventDefault();
      if (busy || leaveDialog.current?.open) return;
      leaveDialog.current?.showModal();
    }
    function confirmUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    document.addEventListener("click", confirmNavigation, true);
    window.addEventListener("beforeunload", confirmUnload);
    window.addEventListener("popstate", confirmBrowserBack, true);
    return () => {
      document.removeEventListener("click", confirmNavigation, true);
      window.removeEventListener("beforeunload", confirmUnload);
      window.removeEventListener("popstate", confirmBrowserBack, true);
    };
  }, [editable, busy]);
  const editingRevision = Boolean(coord && w.version > 0 && editable);
  useEffect(() => {
    if (editingRevision) draftHeading.current?.focus();
  }, [editingRevision]);
  const pendingStatus =
    pending?.status === "in review"
      ? "Awaiting approval"
      : w.version
        ? "Revision draft"
        : "Hawk draft";
  const watcherStatus =
    w.stopped_reason || (w.status === "live" ? "Running" : w.status);
  const custom = form?.confirmation_rule === "exact_statement";
  const proposedConfig =
    editable && custom
      ? (() => {
          const rows = trackedItems.map(([name, proof]) => [
            name.trim(),
            proof.trim(),
          ]);
          const unique =
            new Set(rows.map(([name]) => name.toLowerCase())).size ===
            rows.length;
          return {
            ...form,
            done_when: "all_confirmed",
            items: unique
              ? Object.fromEntries(
                  rows.map(([name]) => [name, ["not_recorded", "confirmed"]]),
                )
              : {},
            proof_statements: Object.fromEntries(rows),
          };
        })()
      : form;
  async function loadLatestDraft() {
    setBusy(true);
    try {
      const response = await fetch("/api/watchers/" + encodeURIComponent(w.id), {
        cache: "no-store",
      });
      if (response.status === 404) {
        setDraftConflict("This watcher is no longer available. Download your edits to keep a copy.");
        return;
      }
      if (!response.ok) throw new Error("Could not load the latest draft.");
      const latest: Detail = await response.json();
      if (!latest.pending || latest.pending.number !== pending?.number || latest.status === "stopped") {
        setDraftConflict("This draft is no longer editable. Download your edits to keep a copy.");
        return;
      }
      setW(latest);
      setPreview(null);
      setDraftConflict("");
      setToastTone("info");
      setMsg("Latest draft loaded. Your edits are still unsaved.");
    } catch {
      setDraftConflict("Could not load the latest draft. Try again or download your edits.");
    } finally {
      setBusy(false);
    }
  }
  async function act(action: string) {
    setBusy(true);
    setMsg("");
    try {
      const phrases = editable ? parseExcludedPhrases(excludedText) : null;
      if (
        editable &&
        phrases === null &&
        ["draft", "save-exit", "preview", "submit", "approve"].includes(action)
      ) {
        setExcludedError(true);
        document.getElementById("not_counted")?.focus();
        return;
      }
      const draftConfig =
        proposedConfig && phrases
          ? {
              ...proposedConfig,
              access_proof:
                proposedConfig.confirmation_rule === "exact_statement"
                  ? {}
                  : Object.fromEntries(
                      Object.keys(proposedConfig.items || {}).map((item) => [
                        item,
                        proposedConfig.access_proof?.[item] ??
                          "An eligible author provides a build link and login details for the manager.",
                      ]),
                    ),
              mobile_proof_statements: Object.fromEntries(
                Object.entries(
                  proposedConfig.mobile_proof_statements || {},
                ).map(([item, statements]) => [
                  item,
                  statements
                    .map((statement) => statement.trim())
                    .filter(Boolean),
                ]),
              ),
              not_counted: phrases,
              visible_to: Object.keys(appUsers),
            }
          : proposedConfig;
      let result: Detail;
      if (action === "preview" && form) {
        setPreview(await post<Preview>(base + "preview", draftConfig));
        return;
      }
      const token = {
        number: pending?.number || w.version,
        revision: pending?.revision || 0,
      };
      if (action === "save-exit") {
        await post<Detail>(base + "draft", { ...token, config: draftConfig });
        sessionStorage.setItem(
          "hawk-watchboard-toast",
          `Watcher draft ${w.id} saved.`,
        );
        router.replace("/");
        router.refresh();
        return;
      }
      if (action === "discard" || action === "discard-exit") {
        const updated = await post<Detail | null>(base + "discard", token);
        if (updated && action === "discard") {
          setW(updated);
          setForm(null);
          setPreview(null);
          setToastTone("success");
          setMsg("Draft revision discarded.");
          window.scrollTo({ top: 0, behavior: "instant" });
          return;
        }
        sessionStorage.setItem(
          "hawk-watchboard-toast",
          updated
            ? `Draft revision for watcher ${w.id} discarded.`
            : `Watcher draft ${w.id} discarded.`,
        );
        router.replace("/");
        router.refresh();
        return;
      }
      if ((action === "submit" || (action === "approve" && editable)) && form) {
        const p = await post<Preview>(base + "preview", draftConfig);
        setPreview(p);
        if (Object.keys(p.errors).length) return;
        const saved = await post<Detail>(base + "draft", {
          ...token,
          config: draftConfig,
        });
        setW(saved);
        result = await post<Detail>(base + action, {
          number: saved.pending!.number,
          revision: saved.pending!.revision,
        });
      } else if (action === "draft")
        result = await post<Detail>(base + action, {
          ...token,
          config: draftConfig,
        });
      else
        result = await post<Detail>(
          base + action,
          ["pause", "resume"].includes(action)
            ? { number: w.version, revision: 0 }
            : token,
        );
      setW(result);
      setDraftConflict("");
      setForm(result.pending?.config || null);
      setExcludedText(
        formatExcludedPhrases(result.pending?.config.not_counted),
      );
      setExcludedError(false);
      setTrackedItems(
        Object.entries(result.pending?.config.proof_statements || {}),
      );
      setPreview(null);
      setToastTone(
        ["revision", "pause", "resume"].includes(action) ? "info" : "success",
      );
      const messages: Record<string, string> = {
        approve: "Version approved.",
        draft: "Draft saved.",
        submit: "Revision submitted for approval.",
        revision: "Revision opened for editing.",
        pause: "Watcher paused.",
        resume: "Watcher resumed.",
      };
      setMsg(messages[action] || "Watcher updated.");
    } catch (e) {
      if (
        editable &&
        ["draft", "save-exit", "submit", "approve"].includes(action) &&
        e instanceof HawkRequestError &&
        (e.status === 409 || e.status === 404)
      ) {
        setPreview(null);
        setDraftConflict("The saved draft changed. Your edits are still here.");
      } else {
        setToastTone("failure");
        setMsg(e instanceof Error ? e.message : "Action failed.");
      }
    } finally {
      setBusy(false);
    }
  }
  function change<K extends keyof Config>(key: K, value: Config[K]) {
    if (form) {
      setForm({ ...form, [key]: value });
      setPreview(null);
    }
  }
  function error(key: string) {
    return preview?.errors[key] ? (
      <small className="danger" id={"err-" + key}>
        {preview.errors[key]}
      </small>
    ) : null;
  }
  function input(key: "goal" | "expires_on" | "check_times") {
    const value = form?.[key];
    const showOutcomePrompt = key === "goal" && needsOutcome;
    const description = [
      showOutcomePrompt && "outcome-help",
      preview?.errors[key] && "err-" + key,
    ].filter(Boolean).join(" ");
    return (
      <div key={key}>
        {showOutcomePrompt && (
          <div className="notice outcome-callout" id="outcome-help">
            <strong>Hawk needs a specific outcome</strong>
            <p>
              What specific result should Hawk watch for? For example, “The
              revised intake checklist is approved and published.”
            </p>
          </div>
        )}
        <label htmlFor={key}>
          {fields[key]}
          {key === "check_times" ? " (HH:MM, comma-separated)" : ""}
        </label>
        <input
          ref={showOutcomePrompt ? outcomeInput : undefined}
          id={key}
          type={key === "expires_on" ? "datetime-local" : "text"}
          step={key === "expires_on" ? 1 : undefined}
          aria-invalid={!!preview?.errors[key]}
          aria-describedby={description || undefined}
          value={
            key === "expires_on" && typeof value === "string" && value
              ? formatExpiry(new Date(value))
              : Array.isArray(value)
                ? value.join(",")
                : value || ""
          }
          onChange={(e) =>
            change(
              key,
              key === "check_times"
                ? e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : key === "expires_on"
                  ? parseExpiry(e.target.value)
                  : e.target.value,
            )
          }
        />
        {key === "expires_on" && <small>Sydney time</small>}
        {key === "check_times" && form && <small>Schedule timezone · {form.timezone}</small>}
        {error(key)}
      </div>
    );
  }
  function options(
    key: "sources" | "people_who_count" | "visible_to" | "alert_on",
    choices: Record<string, string>,
  ) {
    const selected = form?.[key] || [];
    return (
      <fieldset
        className="watcher-choices"
        aria-describedby={
          preview?.errors[key] ? `${key}-help err-${key}` : `${key}-help`
        }
      >
        <legend>{fields[key]}</legend>
        <p id={`${key}-help`} className="muted">
          {choiceHelp[key]}{" "}
          {key === "sources" && (
            <span role="status">{selected.length} of 3 selected.</span>
          )}
        </p>
        {Object.entries(choices).map(([id, name]) => {
          const required =
            key === "visible_to" && (id === "mgr" || id === "coord");
          const checked = selected.includes(id);
          const atSourceLimit =
            key === "sources" && selected.length >= 3 && !checked;
          return (
            <div className="check" key={id}>
              <input
                id={key + id}
                type="checkbox"
                checked={required || checked}
                disabled={required || atSourceLimit}
                onChange={(e) =>
                  change(
                    key,
                    e.target.checked
                      ? [...selected, id]
                      : selected.filter((x) => x !== id),
                  )
                }
              />
              <label htmlFor={key + id}>
                {name}
                {roles[id] &&
                  (key === "people_who_count" || key === "visible_to") && (
                    <small>
                      {roles[id]}
                      {required ? " · Always included" : ""}
                    </small>
                  )}
              </label>
            </div>
          );
        })}
        {error(key)}
      </fieldset>
    );
  }
  const button = (action: string, label: string, secondary = false) => (
    <button
      type="button"
      disabled={busy}
      className={secondary ? "secondary" : ""}
      onClick={() => act(action)}
    >
      {label}
    </button>
  );
  return (
    <main id="main" className="page">
      <Link href="/">← Watchboard</Link>
      <div className="heading">
        <div>
          <div className="promise-heading-meta">
            <span className="badge promise-status">
              {w.version === 0 ? pendingStatus : watcherStatus}
            </span>
          </div>
          <h1 className="detail-title">{w.request}</h1>
        </div>
      </div>
      <div className="columns">
        <div>
          {w.config && (
            <section className="panel">
              <h2>Tracked items</h2>
              <div className="states">
                {Object.entries(w.states).map(([app, s]) => (
                  <div key={app}>
                    <small>{app}</small>
                    <strong>{values[s.value]}</strong>
                    {s.claim && (
                      <p className="reason">
                        Confirmation needed. A claim was recorded without proof.
                      </p>
                    )}
                    {s.proof && (
                      <Link href={proofUrl(w.id, s.proof.message_id)}>
                        “{s.proof.quote}” ↗
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
          {w.config && (
            <details className="panel watcher-block" open>
              <summary className="block-summary">
                <span>Approved block</span>{" "}
                <span className="block-version">
                  {w.id} / Version {w.version}
                </span>
              </summary>
              <dl className="block-fields">
                {Object.entries(fields).map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {key === "item_rules" ? (
                        <ItemRules rules={w.config?.item_rules} />
                      ) : (
                        display(key, w.config?.[key as keyof Config])
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {pending && form && (
            <section className="panel watcher-block">
              <div className="promise-heading-meta">
                <p className="eyebrow">
                  {w.id} / Version {pending.number}
                </p>
                {w.version > 0 && (
                  <span className="badge promise-status">{pendingStatus}</span>
                )}
              </div>
              <h2 id="draft-heading" ref={draftHeading} tabIndex={-1}>
                {editingRevision
                  ? "Edit watcher rules"
                  : coord
                    ? "Configure watcher"
                    : "Review watcher"}
              </h2>
              {!needsOutcome && (
                <p className="muted">
                  {pending.status === "in review"
                    ? "Awaiting manager approval."
                    : "Review the rules Hawk proposed. Edit any details before approving."}{" "}
                  {w.version > 0 && "The approved version remains in use."}
                </p>
              )}
              <div role="status">
                {draftConflict && <p className="notice">{draftConflict}</p>}
              </div>
              {draftConflict && (
                <div className="buttons">
                  <p className="muted">
                    Loading the latest draft keeps your edits in the editor.
                    Saving afterward replaces the saved draft with your edits.
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={loadLatestDraft}
                  >
                    Load latest draft and keep my edits
                  </button>
                  <a
                    download={w.id + "-unsaved-draft.json"}
                    href={
                      "data:application/json;charset=utf-8," +
                      encodeURIComponent(JSON.stringify({ form, trackedItems, excludedText }, null, 2))
                    }
                  >
                    Download my edits
                  </a>
                </div>
              )}
              {editable ? (
                <fieldset className="form-grid" disabled={busy} aria-labelledby="draft-heading">
                  {input("goal")}
                  {options("sources", sources)}
                  {options("people_who_count", people)}
                  {options("visible_to", appUsers)}
                  <div>
                    <label htmlFor="not_counted">{fields.not_counted}</label>
                    <input
                      id="not_counted"
                      value={excludedText}
                      aria-invalid={excludedError}
                      aria-describedby={
                        excludedError
                          ? "excluded-help excluded-error"
                          : "excluded-help"
                      }
                      onChange={(event) => {
                        setExcludedText(event.target.value);
                        setExcludedError(false);
                        setPreview(null);
                      }}
                    />
                    <small id="excluded-help">
                      Use double quotes and separate phrases with commas.
                    </small>
                    {excludedError && (
                      <small
                        id="excluded-error"
                        className="danger"
                        role="alert"
                      >
                        Enter phrases like{" "}
                        {formatExcludedPhrases([
                          "draft ready",
                          "awaiting review",
                        ])}
                        .
                      </small>
                    )}
                  </div>
                  {custom ? (
                    <fieldset
                      aria-describedby={
                        preview?.errors.items ? "err-items" : undefined
                      }
                    >
                      <legend>Tracked items and proof</legend>
                      {trackedItems.map(([name, proof], index) => (
                        <fieldset key={index}>
                          <legend>{name.trim() || `Item ${index + 1}`}</legend>
                          <label htmlFor={`item-name-${index}`}>
                            Item name
                          </label>
                          <input
                            id={`item-name-${index}`}
                            value={name}
                            onChange={(event) => {
                              setTrackedItems((items) =>
                                items.map((item, i) =>
                                  i === index
                                    ? [event.target.value, proof]
                                    : item,
                                ),
                              );
                              setPreview(null);
                            }}
                          />
                          <p>
                            <strong>Not recorded</strong> · No proof required.
                          </p>
                          <h3>Confirmed</h3>
                          <label htmlFor={`item-proof-${index}`}>
                            Exact proof statement from an eligible author
                          </label>
                          <input
                            id={`item-proof-${index}`}
                            value={proof}
                            onChange={(event) => {
                              setTrackedItems((items) =>
                                items.map((item, i) =>
                                  i === index
                                    ? [name, event.target.value]
                                    : item,
                                ),
                              );
                              setPreview(null);
                            }}
                          />
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setTrackedItems((items) =>
                                items.filter((_, i) => i !== index),
                              );
                              setPreview(null);
                            }}
                          >
                            Remove item
                          </button>
                        </fieldset>
                      ))}
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setTrackedItems((items) => [...items, ["", ""]]);
                          setPreview(null);
                        }}
                      >
                        Add tracked item
                      </button>
                      {error("items")}
                    </fieldset>
                  ) : (
                    <fieldset
                      className="watcher-choices"
                      aria-describedby={
                        preview?.errors.items
                          ? "mobile-proof-help err-items"
                          : "mobile-proof-help"
                      }
                    >
                      <legend>Tracked items and proof</legend>
                      <p id="mobile-proof-help" className="muted">
                        One confirmation statement per line.
                      </p>
                      {Object.keys(form.items || {}).map((item) => {
                        const statements = (name: string) =>
                          form.mobile_proof_statements?.[name] ?? [
                            `I can test ${name}.`,
                            ...(form.confirmation_rule === "personal_access"
                              ? [`I'm in the ${name} app.`]
                              : []),
                          ];
                        const id = `proof-${item}`;
                        return (
                          <fieldset key={item}>
                            <legend>{item}</legend>
                            <p>
                              <strong>Not recorded</strong> · No proof required.
                            </p>
                            <h3>Access details supplied</h3>
                            <label htmlFor={`${id}-access`}>
                              Proof requirement
                            </label>
                            <input
                              id={`${id}-access`}
                              value={
                                form.access_proof?.[item] ??
                                "An eligible author provides a build link and login details for the manager."
                              }
                              aria-invalid={!!preview?.errors.access_proof}
                              aria-describedby={
                                preview?.errors.access_proof
                                  ? "err-access_proof"
                                  : undefined
                              }
                              onChange={(event) =>
                                change("access_proof", {
                                  ...form.access_proof,
                                  [item]: event.target.value,
                                })
                              }
                            />
                            <h3>Confirmed</h3>
                            <label htmlFor={id}>
                              {item} confirmation statements
                            </label>
                            <textarea
                              id={id}
                              aria-describedby="mobile-proof-help"
                              value={statements(item).join("\n")}
                              onChange={(event) =>
                                change(
                                  "mobile_proof_statements",
                                  Object.fromEntries(
                                    Object.keys(form.items || {}).map(
                                      (name) => [
                                        name,
                                        name === item
                                          ? event.target.value.split("\n")
                                          : statements(name),
                                      ],
                                    ),
                                  ),
                                )
                              }
                            />
                          </fieldset>
                        );
                      })}
                      {error("access_proof")}
                      {error("items")}
                    </fieldset>
                  )}
                  {input("check_times")}
                  {input("expires_on")}
                  {options("alert_on", alertLabels)}
                </fieldset>
              ) : (
                <dl className="block-fields">
                  {Object.entries(fields).map(([k, label]) => {
                    const key = k as keyof Config;
                    const changed =
                      w.config &&
                      JSON.stringify(w.config[key]) !==
                        JSON.stringify(form[key]);
                    return (
                      <div key={k}>
                        <dt>{label}</dt>
                        <dd>
                          {changed && (
                            <>
                              <del>
                                {key === "item_rules" ? (
                                  <ItemRules rules={w.config?.item_rules} />
                                ) : (
                                  display(k, w.config?.[key])
                                )}
                              </del>{" "}
                              →{" "}
                            </>
                          )}
                          {key === "item_rules" ? (
                            <ItemRules rules={form.item_rules} />
                          ) : (
                            display(k, form[key])
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
              {editable && (
                <dl>
                  {!custom && (
                    <div>
                      <dt>Tracked items</dt>
                      <dd>
                        <ItemRules rules={form.item_rules} />
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Done when</dt>
                    <dd>{display("done_when", form.done_when)}</dd>
                  </div>
                  <div>
                    <dt>Stop when</dt>
                    <dd>{display("stop_when", form.stop_when)}</dd>
                  </div>
                </dl>
              )}
              <div className="buttons">
                {(coord || manager) && button("preview", "Preview rules", true)}
                {editable && button("draft", "Save draft", true)}
                {(w.version ? coord : manager) && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => discardDialog.current?.showModal()}
                  >
                    Discard draft
                  </button>
                )}
                {editable && coord && button("submit", "Submit for approval")}
                {manager &&
                  (pending.status === "in review" || w.version === 0) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => approvalDialog.current?.showModal()}
                    >
                      Review and approve version {pending.number}
                    </button>
                  )}
              </div>
              <dialog
                ref={leaveDialog}
                className="approval-dialog panel"
                aria-labelledby="leave-draft-title"
              >
                <h2 id="leave-draft-title">Leave this draft?</h2>
                <p>
                  Save the draft for later or discard it before returning to the
                  Watchboard.
                </p>
                <div className="buttons">
                  <form method="dialog">
                    <button className="secondary" autoFocus>
                      Stay here
                    </button>
                  </form>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      leaveDialog.current?.close();
                      void act("discard-exit");
                    }}
                  >
                    Discard and exit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      leaveDialog.current?.close();
                      void act("save-exit");
                    }}
                  >
                    Save draft and exit
                  </button>
                </div>
              </dialog>
              <dialog
                ref={discardDialog}
                className="approval-dialog panel"
                aria-labelledby="discard-title"
              >
                <h2 id="discard-title">Discard this draft?</h2>
                <p>
                  {w.version
                    ? "The approved watcher will keep its current rules."
                    : "This draft will be removed from the Watchboard."}
                </p>
                <div className="buttons">
                  <form method="dialog">
                    <button className="secondary" autoFocus>
                      Cancel
                    </button>
                  </form>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      discardDialog.current?.close();
                      void act("discard");
                    }}
                  >
                    Confirm discard
                  </button>
                </div>
              </dialog>
              <dialog
                ref={approvalDialog}
                className="approval-dialog panel"
                aria-labelledby="approval-title"
              >
                <h2 id="approval-title">Approve version {pending.number}?</h2>
                <p>Confirm that Hawk should start watching with these rules.</p>
                <div className="buttons">
                  <form method="dialog">
                    <button className="secondary" autoFocus>
                      Cancel
                    </button>
                  </form>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      approvalDialog.current?.close();
                      void act("approve");
                    }}
                  >
                    Confirm approval
                  </button>
                </div>
              </dialog>
              {preview && (
                <section className="preview" aria-labelledby="dry-run-title">
                  <div className="preview-heading">
                    <h3 id="dry-run-title">Dry-run results</h3>
                    <span
                      role="status"
                      className={`badge ${Object.keys(preview.errors).length ? "amber" : ""}`}
                    >
                      {Object.keys(preview.errors).length
                        ? "Changes needed"
                        : "Validation passed"}
                    </span>
                  </div>
                  <p>Evidence through {stamp(preview.cutoff)}</p>
                  {preview.blocked_sources.length > 0 && (
                    <p>Unreadable sources: {preview.blocked_sources.map((source) => sources[source] || source).join(", ")}.</p>
                  )}
                  {Object.keys(preview.errors).length > 0 && (
                    <ul className="preview-errors">
                      {Object.entries(preview.errors).map(([key, message]) => (
                        <li key={key}>
                          <strong>
                            {fields[key] ||
                              (key === "access_proof"
                                ? "Access proof"
                                : "Tracked items")}
                          </strong>{" "}
                          · {message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {preview.review && <p className="muted">{preview.review}</p>}
                  {Object.keys(preview.access_checks).length > 0 && (
                    <>
                      <h4>Access checks Hawk will run</h4>
                      <dl className="preview-checks">
                        {Object.entries(preview.access_checks).map(
                          ([item, check]) => (
                            <div key={item}>
                              <dt>{item}</dt>
                              <dd>{check}</dd>
                            </div>
                          ),
                        )}
                      </dl>
                    </>
                  )}
                  {!Object.keys(preview.errors).length && (
                    <>
                      <h4>
                        Sample messages{" "}
                        <span className="count">{preview.rows.length}</span>
                      </h4>
                      {preview.rows.length ? (
                        <ol className="preview-samples">
                          {preview.rows.map((r) => (
                            <li key={r.message_id}>
                              <h5>Message {r.message_id}</h5>
                              <small>
                                {people[r.author] || r.author} ·{" "}
                                <time dateTime={r.at}>{stamp(r.at)}</time>
                              </small>
                              {r.quote && <blockquote>“{r.quote}”</blockquote>}
                              <p>{r.reason}</p>
                              <dl
                                className="preview-states"
                                aria-label="Item status after this message"
                              >
                                {Object.entries(r.states).map(
                                  ([item, value]) => (
                                    <div key={item}>
                                      <dt>{item}</dt>
                                      <dd className="badge">
                                        {values[value] || value}
                                      </dd>
                                    </div>
                                  ),
                                )}
                              </dl>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="muted">
                          No sample messages for the selected sources.
                        </p>
                      )}
                    </>
                  )}
                </section>
              )}
            </section>
          )}
          <section className="panel evidence-history">
            <h2>Evidence history</h2>
            {!w.history.length ? (
              <p className="muted">No observations recorded.</p>
            ) : (
              <ol className="evidence-list">
                {[...w.history].reverse().map((entry, index) => (
                  <li key={w.history.length - 1 - index}>
                    <details>
                      <summary>
                        <span className="evidence-summary">
                          <span className="evidence-item">
                            <strong>{entry.item}</strong>
                            <span
                              className={`badge ${entry.value === "claimed" ? "amber" : ""}`}
                            >
                              {values[entry.value] || entry.value}
                            </span>
                          </span>
                          <small>
                            {people[entry.author] || entry.author} ·{" "}
                            <time dateTime={entry.at}>{stamp(entry.at)}</time>
                          </small>
                        </span>
                      </summary>
                      <div className="evidence-body">
                        {entry.quote && (
                          <figure className="evidence-quote">
                            <figcaption>Source quote</figcaption>
                            <blockquote>“{entry.quote}”</blockquote>
                          </figure>
                        )}
                        <div className="evidence-decision">
                          <strong>Why Hawk decided this</strong>
                          <p>{entry.reason}</p>
                        </div>
                        <div className="watcher-side-heading">
                          <small>
                            {sources[entry.source] || entry.source} · Version{" "}
                            {entry.version}
                          </small>
                          <Link href={proofUrl(w.id, entry.message_id)}>
                            Open message {entry.message_id} ↗
                          </Link>
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        <aside>
          <section className="side" aria-labelledby="watcher-health-title">
            <div className="watcher-side-heading">
              <h2 id="watcher-health-title">Watcher health</h2>
              {!w.late && (
                <span
                  className={`badge ${Object.keys(w.incidents).length ? "amber" : ""}`}
                >
                  {w.status !== "live"
                    ? watcherStatus
                    : Object.keys(w.incidents).length
                      ? "Source blocked"
                      : w.checked
                        ? "Checking"
                        : "Awaiting first check"}
                </span>
              )}
            </div>
            {w.late && <MissedCheck scheduled={w.next_due} />}
            <dl className="watcher-health-times">
              {[
                ["Last complete check", w.checked],
                ["Next scheduled check", w.next_due],
              ].filter(([label]) => !w.late || label !== "Next scheduled check").map(([label, instant]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    {instant ? (
                      <time dateTime={instant}>{stamp(instant)}</time>
                    ) : label === "Next scheduled check" ? (
                      "None scheduled"
                    ) : (
                      "Not recorded"
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="watcher-health-progress">
              <h3>Evidence freshness</h3>
              <small>
                Last evidence change ·{" "}
                {w.last_change ? (
                  <time dateTime={w.last_change}>
                    {stamp(w.last_change)}
                  </time>
                ) : (
                  "Not recorded"
                )}
              </small>
              {w.reasons
                .filter((reason) => reason.startsWith("No verified progress"))
                .map((reason) => (
                  <p className="reason" key={reason}>
                    {reason}
                  </p>
                ))}
            </div>
          </section>
          {!!w.config?.sources?.length && (
            <section className="side" aria-labelledby="watcher-sources-title">
              <h2 id="watcher-sources-title">Source threads</h2>
              <ul className="watcher-side-list watcher-source-list">
                {w.config.sources.map((source) => {
                  const blockedSince = w.incidents[source];
                  const lastRead = w.checkpoints[source];
                  return (
                    <li key={source} data-blocked={Boolean(blockedSince)}>
                      <div className="watcher-side-heading">
                        <strong>{sources[source] || source}</strong>
                        <span
                          className={`badge ${blockedSince ? "amber" : ""}`}
                        >
                          {blockedSince
                            ? "Blocked"
                            : lastRead
                              ? "Read"
                              : "Pending"}
                        </span>
                      </div>
                      {blockedSince && (
                        <small>
                          Blocked since{" "}
                          <time dateTime={blockedSince}>
                            {stamp(blockedSince)}
                          </time>
                        </small>
                      )}
                      {lastRead && (
                        <small>
                          Last successful read{" "}
                          <time dateTime={lastRead}>{stamp(lastRead)}</time>
                        </small>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {coord && w.version > 0 && w.status !== "stopped" && (
            <section className="side">
              <h2>Manage watcher</h2>
              <div className="buttons">
                {pending ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => draftHeading.current?.focus()}
                  >
                    {pending.status === "in review"
                      ? "View pending revision"
                      : "Continue editing"}
                  </button>
                ) : (
                  button("revision", "Edit rules")
                )}
                {w.status === "paused"
                  ? button("resume", "Resume watcher", true)
                  : button("pause", "Pause watcher", true)}
              </div>
            </section>
          )}
          <section className="side">
            <h2>Approvals</h2>
            {!w.versions.length ? (
              <p className="muted">Awaiting first approval.</p>
            ) : (
              <ol className="watcher-side-list">
                {[...w.versions].reverse().map((version) => (
                  <li key={version.number}>
                    <div className="watcher-side-heading">
                      <strong>Version {version.number}</strong>
                      {version.number === w.version && (
                        <span className="badge">Current version</span>
                      )}
                    </div>
                    <small>
                      Approved by{" "}
                      {people[version.approved_by] || version.approved_by}
                    </small>
                    <small>
                      <time dateTime={version.approved_at}>
                        {stamp(version.approved_at)}
                      </time>
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <details className="side">
            <summary>
              Check history <span className="count">{w.runs.length}</span>
            </summary>
            {!w.runs.length ? (
              <p className="muted">No checks recorded yet.</p>
            ) : (
              <ol className="watcher-side-list">
                {[...w.runs].reverse().map((run, index) => (
                  <li key={w.runs.length - 1 - index}>
                    <div className="watcher-side-heading">
                      <strong>
                        <time dateTime={run.at}>{stamp(run.at)}</time>
                      </strong>
                      <span className="badge">v{run.version}</span>
                    </div>
                    {run.scheduled !== run.at && (
                      <small>
                        Scheduled{" "}
                        <time dateTime={run.scheduled}>
                          {stamp(run.scheduled)}
                        </time>
                      </small>
                    )}
                    <dl className="watcher-run-sources">
                      {Object.entries(run.sources).map(([source, state]) => (
                        <div key={source}>
                          <dt>{sources[source] || source}</dt>
                          <dd
                            className={`badge ${state === "blocked" ? "amber" : ""}`}
                          >
                            {state}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ol>
            )}
          </details>
        </aside>
      </div>
      <p
        role="status"
        className={msg ? `notice discard-toast toast-${toastTone}` : ""}
      >
        {msg}
      </p>
    </main>
  );
}
