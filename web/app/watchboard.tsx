"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Header, MissedCheck } from "./chrome";
import {
  type Board,
  type Card,
  type Detail,
  values,
  people,
  roles,
  stamp,
  formatAlert,
  proofUrl,
  post,
} from "@/lib/data";

const groups = ["Needs attention", "Watching", "Stopped"];
function WatchCard({ w }: { w: Card }) {
  const otherReasons = w.reasons.filter((reason) => reason !== "Scheduled check missed");
  const proof =
    w.latest?.evidence ||
    Object.values(w.states)
      .map((s) => s.proof)
      .filter((p) => p != null)
      .sort((a, b) => b.at.localeCompare(a.at))[0];
  return (
    <article
      className="watch-card"
      data-attention={w.group === "Needs attention"}
    >
      <header className="watch-card-header">
        <div className="line">
          <span className="mono">
            {w.id} / v{w.version}
          </span>
          <span
            className={"badge " + (w.group === "Needs attention" ? "amber" : "")}
          >
            {w.stopped_reason || w.status}
          </span>
        </div>
        <h3>
          <Link data-focus-key={w.id + "-title"} href={"/watchers/" + w.id}>
            {w.request}
          </Link>
        </h3>
      </header>
      {w.late && <MissedCheck scheduled={w.next_due} />}
      {otherReasons.length > 0 && (
        <section className="watch-attention">
          <h4>Needs attention</h4>
          <ul>
            {otherReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="watch-progress">
        <h4>Progress</h4>
        <dl>
          {Object.entries(w.states).map(([item, state]) => (
            <div key={item}>
              <dt>{item}</dt>
              <dd className={state.value === "confirmed" ? "green" : ""}>
                {values[state.value] || state.value}
              </dd>
            </div>
          ))}
        </dl>
        <small>
          Last progress · {stamp(w.last_change)}
          {w.quiet_hours != null ? ` (${w.quiet_hours}h ago)` : ""}
        </small>
      </section>
      {(w.latest || proof) && (
        <section className="watch-evidence">
          <h4>Activity and evidence</h4>
          {w.latest && <p className="change">{formatAlert(w.latest.message)}</p>}
          {proof && (
            <figure>
              <blockquote>“{proof.quote}”</blockquote>
              <figcaption>
                <Link
                  data-focus-key={w.id + "-proof"}
                  href={proofUrl(w.id, proof.message_id)}
                >
                  {people[proof.author] || proof.author} ·{" "}
                  {stamp(proof.at)} ↗
                </Link>
              </figcaption>
            </figure>
          )}
        </section>
      )}
      <footer className="watch-card-footer">
        <section className="meta watch-check">
          <h4>Check history</h4>
          <span>Last successful check · {stamp(w.checked)}</span>
        </section>
        <Link
          data-focus-key={w.id + "-open"}
          className="action-link"
          aria-label={"Open watcher " + w.id}
          href={"/watchers/" + w.id}
        >
          Open watcher <span aria-hidden="true">↗</span>
        </Link>
      </footer>
    </article>
  );
}
export default function BoardView({
  initial,
  loadedAt,
}: {
  initial: Board;
  loadedAt: string;
}) {
  const router = useRouter();
  const [board, setBoard] = useState(initial),
    [failure, setFailure] = useState(""),
    [loaded, setLoaded] = useState(loadedAt),
    [msg, setMsg] = useState(""),
    [toastTone, setToastTone] = useState("info"),
    [busy, setBusy] = useState(false),
    [request, setRequest] = useState("");
  const focusKey = useRef("");
  const sequence = useRef(0);
  useLayoutEffect(() => {
    if (focusKey.current && document.activeElement === document.body) {
      const target = document.querySelector<HTMLElement>(
        `[data-focus-key="${CSS.escape(focusKey.current)}"]`,
      );
      const disclosure = target?.closest("details");
      if (disclosure && target?.tagName !== "SUMMARY") disclosure.open = true;
      target?.focus({ preventScroll: true });
    }
    focusKey.current = "";
  }, [board]);
  const refresh = useCallback(async () => {
    const requestId = ++sequence.current;
    try {
      const r = await fetch("/api/dashboard", { cache: "no-store" });
      if (!r.ok) throw Error();
      const next: Board = await r.json();
      if (requestId !== sequence.current) return;
      focusKey.current =
        (document.activeElement as HTMLElement | null)?.dataset.focusKey || "";
      setBoard(next);
      setLoaded(new Date().toISOString());
      setFailure("");
    } catch {
      if (requestId !== sequence.current) return;
      setFailure("Dashboard refresh failed. Showing the last loaded evidence.");
    }
  }, []);
  const [discardToast, setDiscardToast] = useState("");
  useEffect(() => {
    const message = sessionStorage.getItem("hawk-watchboard-toast");
    if (!message) return;
    const show = window.setTimeout(() => {
      sessionStorage.removeItem("hawk-watchboard-toast");
      setDiscardToast(message);
    }, 0);
    const hide = window.setTimeout(() => setDiscardToast(""), 3000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    if (!msg) return;
    const hide = window.setTimeout(() => setMsg(""), 3000);
    return () => window.clearTimeout(hide);
  }, [msg]);
  async function step(action: string) {
    setBusy(true);
    try {
      await post("demo", { action });
      await refresh();
      setToastTone("info");
      setMsg(
        action === "miss"
          ? "Worker held. The scheduled check can now be inspected."
          : "Demo clock updated.",
      );
    } catch (e) {
      setToastTone("failure");
      setMsg(
        e instanceof Error ? e.message : "Could not update the demo clock.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const w = await post<Detail>("watchers", { request });
      router.push("/watchers/" + w.id);
    } catch (err) {
      setToastTone("failure");
      setMsg(
        err instanceof Error ? err.message : "Could not create the draft.",
      );
      setBusy(false);
    }
  }
  const activity = board.cards
    .flatMap((c) => c.recent.map((a) => ({ w: c.id, a })))
    .sort((x, y) => y.a.at.localeCompare(x.a.at));
  function renderActivity(events: typeof activity) {
    return events.map(({ w, a }, index) => (
      <li key={w + a.at + index}>
        <small>
          {stamp(a.at)} · {w}
        </small>
        <Link
          href={
            a.evidence ? proofUrl(w, a.evidence.message_id) : "/watchers/" + w
          }
        >
          {formatAlert(a.message)}
        </Link>
      </li>
    ));
  }
  return (
    <>
      <Header person={board.person} />
      <div
        role="status"
        className={
          discardToast || msg
            ? `notice discard-toast toast-${discardToast ? "success" : toastTone}`
            : undefined
        }
      >
        {discardToast || msg}
      </div>
      <main id="main" className="page watchboard">
        <div className="heading">
          <div>
            <h1>Watchboard</h1>
          </div>
          <div className="date">
            {stamp(board.instant)}
            <small>
              {board.clock_mode === "demo" ? "Demo clock" : "Workspace clock"}
            </small>
          </div>
        </div>
        <div role="status" className={failure ? "notice" : ""}>
          {failure} {failure && "Last refresh: " + stamp(loaded)}
        </div>
        <div className="metrics">
          {groups.map((g, i) => (
            <a key={g} href={"#group" + i}>
              <span>
                <i className={"dot d" + i} />
                {g}
              </span>
              <strong>
                {String(
                  board.cards.filter((w) => w.group === g).length,
                ).padStart(2, "0")}
              </strong>
            </a>
          ))}
        </div>
        <div className="columns">
          <div>
            {groups.map((g, i) => (
              <section id={"group" + i} className="group" key={g}>
                <h2>{g} </h2>
                {board.cards
                  .filter((w) => w.group === g)
                  .map((w) => (
                    <WatchCard key={w.id} w={w} />
                  ))}
                {!board.cards.some((w) => w.group === g) && (
                  <div className="empty">
                    {
                      [
                        "No watchers need attention.",
                        "No watchers in this list.",
                        "No stopped watchers.",
                      ][i]
                    }
                  </div>
                )}
              </section>
            ))}
          </div>
          <aside>
            <section
              className="side worker-health"
              aria-labelledby="hawk-health-title"
            >
              <div className="watcher-side-heading">
                <h2 id="hawk-health-title">Hawk health</h2>
                <span
                  className={`badge ${board.worker_status === "online" ? "" : "amber"}`}
                >
                  {board.worker_status === "online"
                    ? "Hawk online"
                    : board.worker_status === "paused"
                      ? "Hawk paused"
                      : "Hawk hasn’t reported in"}
                </span>
              </div>
              <small>
                {board.worker_reported_at ? (
                  <>
                    Last heartbeat ·{" "}
                    <time dateTime={board.worker_reported_at}>
                      {stamp(board.worker_reported_at)}
                    </time>
                  </>
                ) : (
                  "No heartbeat recorded yet."
                )}
              </small>
            </section>
            <section className="side">
              <h2>Recent updates</h2>
              {activity.length === 0 ? (
                <p>No recorded changes.</p>
              ) : (
                <>
                  <ol className="timeline">
                    {renderActivity(activity.slice(0, 3))}
                  </ol>
                  {activity.length > 3 && (
                    <details className="watch-activity-more">
                      <summary>Earlier activity</summary>
                      <ol className="timeline" start={4}>
                        {renderActivity(activity.slice(3))}
                      </ol>
                    </details>
                  )}
                </>
              )}
            </section>
            {board.cards.some((w) => w.has_pending) && (
              <section className="side">
                <h2>Pending setup</h2>
                {board.cards
                  .filter((w) => w.has_pending)
                  .map((w) => (
                    <p key={w.id}>
                      <Link href={"/watchers/" + w.id}>
                        {w.id} · Review draft ↗
                      </Link>
                    </p>
                  ))}
              </section>
            )}
            {board.person === "mgr" && (
              <section className="side">
                <h2>New request</h2>
                <form onSubmit={create}>
                  <label htmlFor="request">What should Hawk watch?</label>
                  <textarea
                    id="request"
                    required
                    maxLength={1000}
                    value={request}
                    onChange={(e) => setRequest(e.target.value)}
                    placeholder="Tell me when…"
                  />
                  <button disabled={busy}>Create draft</button>
                </form>
              </section>
            )}
            {["mgr", "coord"].includes(board.person) &&
              board.clock_mode === "demo" && (
                <details className="side">
                  <summary>Demo controls</summary>
                  <p>
                    Advance fictional source updates or hold the worker to
                    demonstrate a missed check.
                  </p>
                  <div className="buttons">
                    {(board.held ? ["resume"] : ["advance", "miss"]).map(
                      (a) => (
                        <button
                          key={a}
                          className="secondary"
                          disabled={busy}
                          onClick={() => step(a)}
                        >
                          {
                            {
                              advance: "Advance clock",
                              miss: "Simulate missed check",
                              resume: "Resume worker",
                            }[a]
                          }
                        </button>
                      ),
                    )}
                  </div>
                </details>
              )}
          </aside>
        </div>
        <footer>
          Hawk <span>{roles[board.person]} workspace</span>
        </footer>
      </main>
    </>
  );
}
