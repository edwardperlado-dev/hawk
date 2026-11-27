"use client";

export default function WorkspaceError() {
  return (
    <main id="main" className="page narrow">
      <section className="panel">
        <h1>Hawk couldn’t load this page</h1>
        <p>Check that Hawk’s local API is running, then try again.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Retry
        </button>
      </section>
    </main>
  );
}
