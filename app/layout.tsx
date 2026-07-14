import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rewind — reviewed workspace repair",
  description: "A controlled proof of recorded assumptions and reviewed recovery.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
