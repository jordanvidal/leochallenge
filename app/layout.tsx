import type { Metadata, Viewport } from "next";
import { Anton, Space_Grotesk } from "next/font/google";
import "./globals.css";
import ServiceWorker from "@/components/ServiceWorker";

// Space Grotesk porte l'UI, Anton les gros chiffres (compte à rebours, série).
const space = Space_Grotesk({
  variable: "--font-space",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "100 · 100 · 100",
  description:
    "Challenge sportif entre potes : 100 pompes, 100 abdos, 100 squats par jour jusqu'au 31 août.",
  appleWebApp: {
    capable: true, // plein écran sans barre d'URL sur iOS
    statusBarStyle: "black-translucent",
    title: "100·100·100",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#131313",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // pas de zoom accidentel en tapant les cartes
  viewportFit: "cover", // safe areas de l'encoche
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Les variables de fonts vont sur <html> : les tokens @theme (globals.css)
    // sont résolus au scope :root, elles doivent y être définies.
    <html lang="fr" className={`${space.variable} ${anton.variable}`}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
