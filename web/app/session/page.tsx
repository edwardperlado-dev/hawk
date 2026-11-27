"use client";
import { useState } from "react";
import { Brand } from "../chrome";
import { people, roles, post } from "@/lib/data";
export default function Session() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function enter(person: string) {
    setBusy(true);
    try {
      await post("session", {
        person,
      }); /* Full navigation clears the prior identity’s in-memory router cache. */
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }
  return (
    <main id="main" className="entry">
      <div className="entry-panel" aria-hidden="true" />
      <section className="entry-roles">
        <Brand />
        <h1>Choose a demo identity</h1>
        {Object.entries(people).map(([id, name]) => (
          <button
            className="person"
            disabled={busy}
            onClick={() => enter(id)}
            key={id}
          >
            <span className="avatar">
              {name
                .split(" ")
                .map((x) => x[0])
                .join("")}
            </span>
            <span>
              <strong>{name}</strong>
              <small>{roles[id]}</small>
            </span>
            <b aria-hidden="true">↗</b>
          </button>
        ))}
        <p role="alert">{error}</p>
      </section>
    </main>
  );
}
