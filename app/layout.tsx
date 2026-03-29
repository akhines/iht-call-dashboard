import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Impact Home Team - Call Dashboard",
  description: "Inbound call tracking & lead management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
