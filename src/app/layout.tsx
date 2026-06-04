import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Acapella to MIDI - AI Voice to MIDI Converter",
  description: "Transform acapella recordings into MIDI files using AI-powered pitch detection. Built with Spotify Basic Pitch and TensorFlow.js.",
  keywords: ["acapella", "MIDI", "pitch detection", "Basic Pitch", "audio conversion", "AI music"],
  authors: [{ name: "Acapella to MIDI" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Acapella to MIDI",
    description: "Transform acapella recordings into MIDI files using AI-powered pitch detection",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Acapella to MIDI",
    description: "Transform acapella recordings into MIDI files using AI-powered pitch detection",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-foreground`}
        style={{ backgroundColor: '#0a0a0a' }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
