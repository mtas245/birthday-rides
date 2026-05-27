export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-6 text-black">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center space-y-4">
        <h1 className="text-3xl font-bold">Geburtstagsfahrten</h1>

        <a href="/gast" className="block w-full bg-black text-white p-3 rounded-xl">
          Ich bin Gast
        </a>

        <a href="/fahrer" className="block w-full bg-blue-600 text-white p-3 rounded-xl">
          Fahrer / Admin
        </a>
      </div>
    </main>
  );
}