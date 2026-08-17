export const metadata = {
  title: "Grammar Writer backend",
  description: "Grammar-check API used by the Grammar Writer Chrome extension",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
