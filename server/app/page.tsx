export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: 40 }}>
      <h1>Grammar Writer backend</h1>
      <p>This service exists to serve the Grammar Writer Chrome extension.</p>
      <p>
        Endpoint: <code>POST /api/check</code> with JSON body <code>{`{ "text": "..." }`}</code>
      </p>
    </main>
  );
}
