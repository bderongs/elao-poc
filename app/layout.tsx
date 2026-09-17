import { GlobalDebugPanel } from "@/components/GlobalDebugPanel";

export const metadata = {
  title: "ELAO Speaking",
  description: "Évaluation CEFR par conversation avec avatar 3D",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500&family=IBM+Plex+Mono:wght@400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, fontFamily: "'DM Sans', system-ui, sans-serif", background: "#F7F5F0", color: "#141D33" }}>
        {children}
        <GlobalDebugPanel />
      </body>
    </html>
  );
}
