import type { Metadata } from "next";
import "@atlaskit/css-reset";
import "./globals.css";
import { AtlassianTheme } from "../components/atlassian-theme";

export const metadata: Metadata = {
  title: "Atlas — Council intelligence for officers",
  description: "Evidence-first research across UK council decisions, reports and minutes.",
  icons: { icon: "/atlaslogo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AtlassianTheme />{children}</body>
    </html>
  );
}
