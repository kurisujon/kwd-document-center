import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "KWD Document Center", description: "Kiblawan Water District's internal document center." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
