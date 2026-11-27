import Link from "next/link";
import { people, roles } from "@/lib/data";
export function Brand() {
  return (
    <span className="brand">
      <span className="wing" aria-hidden="true" />
      <span>hawk</span>
    </span>
  );
}
export function Header({ person }: { person: string }) {
  return (
    <header>
      <div className="bar">
        <Link href="/" aria-label="Hawk watchboard">
          <Brand />
        </Link>
        <Link href="/session" className="identity">
          <span className="avatar">
            {people[person]
              .split(" ")
              .map((x) => x[0])
              .join("")}
          </span>
          <span>
            {people[person]}
            <small>{roles[person]}</small>
          </span>
          <span aria-hidden="true">⌄</span>
        </Link>
      </div>
    </header>
  );
}
