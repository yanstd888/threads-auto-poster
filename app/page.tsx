export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">Threads Auto-Poster</h1>
        <p className="text-gray-600 mb-6">Auto-post ke Threads via Hermes agent</p>
        <a
          href="/login"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Login Admin
        </a>
      </div>
    </div>
  );
}
