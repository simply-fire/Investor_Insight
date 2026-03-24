// TODO: implement in Module 1
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-center text-3xl font-semibold text-slate-900">
          Stock Intelligence
        </h1>
        <label
          htmlFor="ticker"
          className="mb-2 block text-sm font-medium text-slate-700"
        >
          Enter ticker
        </label>
        <input
          id="ticker"
          name="ticker"
          type="text"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none ring-slate-200 transition focus:ring-2"
          placeholder="AAPL"
        />
      </section>
    </main>
  );
}
