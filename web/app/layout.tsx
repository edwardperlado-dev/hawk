import "./style.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Hawk · Watchboard",
  description: "Team promises, checked against their evidence.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
