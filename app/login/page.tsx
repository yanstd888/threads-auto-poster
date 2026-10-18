'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (res.ok) router.push('/dashboard');
    else { const data = await res.json(); setError(data.error || 'Login failed'); }
    setLoading(false);
  };

  return (
    <main className="brutal-login flex items-center justify-center">
      <section className="brutal-login__panel w-full max-w-md p-7 sm:p-9">
        <span className="brutal-landing__sticker">ADMIN ONLY</span>
        <h1 className="brutal-login__title mt-7 text-4xl">THREADS<br />CONTROL</h1>
        <p className="mt-4 text-sm font-bold">Enter the admin password to open the dashboard.</p>
        <form onSubmit={handleSubmit} className="mt-7 space-y-5">
          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-black uppercase tracking-wide">Password</label>
            <div className="brutal-password-field">
              <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-3 pr-12" maxLength={1024} required />
              <button type="button" className="brutal-password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          {error && <p role="alert" aria-live="assertive" className="border-2 border-black bg-red-200 p-3 text-sm font-bold text-red-900">{error}</p>}
          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 py-3">{loading && <Loader2 className="h-4 w-4 animate-spin" />}LOGIN</button>
        </form>
      </section>
    </main>
  );
}