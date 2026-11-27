import Link from "next/link";
import { Header } from "../../../../chrome";
import { serverGet } from "@/lib/server";
import { type Board, stamp } from "@/lib/data";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; mid: string }>;
}) {
  const { id, mid } = await params;
  const [b, m] = await Promise.all([
    serverGet<Board>("dashboard"),
    serverGet<{
      quote: string;
      author: string;
      source: string;
      at: string;
      message_id: string;
    }>(
      "watchers/" +
        encodeURIComponent(id) +
        "/messages/" +
        encodeURIComponent(mid),
    ),
  ]);
  return (
    <>
      <Header person={b.person} />
      <main id="main" className="page narrow">
        <Link href={"/watchers/" + id}>← Watcher {id}</Link>
        <p className="eyebrow">Source message / {mid}</p>
        <h1>{m.source}</h1>
        <section className="panel">
          <strong>{m.author}</strong>
          <small>{stamp(m.at)}</small>
          <blockquote>“{m.quote}”</blockquote>
          <p className="muted">
            Verified excerpt from the fictional source thread.
          </p>
        </section>
      </main>
    </>
  );
}
