import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Civic Lens — Council intelligence for officers",
  description: "Evidence-first research across UK council decisions, reports and minutes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
