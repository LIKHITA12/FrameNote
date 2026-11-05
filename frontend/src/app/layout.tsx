import type { Metadata } from "next";
import { Caveat, Inter, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";

import { ProcessingModal } from "@/components/ProcessingModal";
import { ProcessingProvider } from "@/components/ProcessingContext";
import { SidebarProvider } from "@/components/SidebarContext";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/components/ThemeContext";

// Brand typography for the FrameNote wordmark and marketing surfaces.
const manrope = Manrope({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-manrope" });
const caveat = Caveat({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-caveat" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "FrameNote",
  description: "AI video summaries with key points and exportable notes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${manrope.variable} ${caveat.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <SidebarProvider>
            <ProcessingProvider>
              {children}
              <ProcessingModal />
            </ProcessingProvider>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
