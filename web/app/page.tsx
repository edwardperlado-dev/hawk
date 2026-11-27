import { serverGet } from "@/lib/server";
import type { Board } from "@/lib/data";
import BoardView from "./watchboard";
export const dynamic = "force-dynamic";
export default async function Page() {
  return (
    <BoardView
      loadedAt={new Date().toISOString()}
      initial={await serverGet<Board>("dashboard")}
    />
  );
}
