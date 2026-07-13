import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Project Pitwall",
  description: "A real-time open-wheel race strategy simulation prototype.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
