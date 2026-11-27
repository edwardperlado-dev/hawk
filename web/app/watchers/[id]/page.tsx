import { Header } from "../../chrome";
import { serverGet } from "@/lib/server";
import type { Board, Detail } from "@/lib/data";
import Watcher from "./watcher";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [board, watcher] = await Promise.all([
    serverGet<Board>("dashboard"),
    serverGet<Detail>("watchers/" + encodeURIComponent(id)),
  ]);
  return (
    <>
      <Header person={board.person} />
      <Watcher
        initial={watcher}
        person={board.person}
        demo={board.clock_mode === "demo"}
      />
    </>
  );
}
