import { APP_VERSION_LABEL } from '@/lib/app-version';

export default function Home() {
  return (
    <main className="brutal-landing flex items-center">
      <section className="brutal-landing__panel w-full p-6 sm:p-10">
        <span className="brutal-landing__sticker">THREADS CONTENT CONTROL</span>
        <span className="mt-3 block text-xs font-bold uppercase tracking-[0.2em]">Version {APP_VERSION_LABEL}</span>
        <h1 className="brutal-landing__title mt-8 max-w-3xl text-5xl sm:text-7xl">POST WITH A PLAN.</h1>
        <p className="mt-6 max-w-xl text-lg font-bold leading-snug">Plan, review content, and manage Threads sources from one place.</p>
        <a href="/login" className="brutal-primary mt-8 px-6 py-3">ADMIN LOGIN</a>
      </section>
    </main>
  );
}
