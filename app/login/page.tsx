'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
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

  return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg"><h1 className="text-2xl font-bold mb-2 text-center">Threads Auto-Poster</h1><p className="text-center text-sm text-gray-500 mb-6">Admin sign in</p><form onSubmit={handleSubmit} className="space-y-4"><div><label htmlFor="password" className="block text-sm font-medium mb-1">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border rounded-md" maxLength={1024} required /></div>{error && <p role="alert" aria-live="assertive" className="text-red-500 text-sm">{error}</p>}<button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">{loading && <Loader2 className="w-4 h-4 animate-spin" />}Sign in</button></form></div></div>;
}