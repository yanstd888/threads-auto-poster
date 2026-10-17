'use client';

import { useEffect, useState, Suspense } from 'react';
import { Shield, Save, Eye, EyeOff, Link2, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

interface Credential {
  id: string;
  service: string;
  expires_at: number | null;
  updated_at: number;
}

export default function CredentialsPage() {
  return (
    <Suspense fallback={<div className="p-6">Memuat...</div>}>
      <CredentialsInner />
    </Suspense>
  );
}

function CredentialsInner() {
  const searchParams = useSearchParams();
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState('');
  const [threadsUsername, setThreadsUsername] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ connected: boolean; username?: string; error?: string; expiresAt?: number; requiresReconnect?: boolean } | null>(null);
  const [checking, setChecking] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchCredentials = async () => {
    const res = await fetch('/api/credentials');
    const data = await res.json();
    setCredentials(data.credentials || []);
    setThreadsUsername(data.settings?.threads_username || '');
  };

  const handleSaveToken = async () => {
    setSaving(true);
    const expires = expiresAt ? new Date(expiresAt).getTime() : undefined;
    await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'threads',
        token,
        expiresAt: expires,
        username: threadsUsername,
      }),
    });
    setSaving(false);
    setShowToken(false);
    setToken('');
    fetchCredentials();
    fetchStatus();
    setBanner({ type: 'success', message: 'Token berhasil disimpan.' });
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/threads/status');
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
    fetchStatus();

    if (searchParams.get('oauth_success') === '1') {
      setBanner({ type: 'success', message: 'Threads berhasil terhubung. Token tersimpan otomatis.' });
      fetchStatus();
      fetchCredentials();
    }
    const oauthError = searchParams.get('oauth_error');
    if (oauthError) {
      setBanner({ type: 'error', message: `Gagal menghubungkan Threads: ${oauthError}` });
    }
  }, [searchParams]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Credentials</h1>

      {banner && (
        <div className={`flex items-start gap-3 p-4 mb-6 rounded-lg border ${
          banner.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {banner.type === 'success'
            ? <CheckCircle className="w-5 h-5 mt-0.5 shrink-0" />
            : <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />}
          <p className="text-sm">{banner.message}</p>
        </div>
      )}

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold text-lg mb-4">Koneksi Threads</h2>

        {checking ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Memeriksa status...
          </div>
        ) : status?.connected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="font-medium text-green-700">Terhubung sebagai @{status.username}</p>
                <p className="text-xs text-gray-500">
                  {status.requiresReconnect
                    ? 'Token lama perlu dihubungkan ulang sekali agar refresh otomatis aktif.'
                    : status.expiresAt
                      ? `Token kedaluwarsa: ${new Date(status.expiresAt).toLocaleString('id-ID')}`
                      : 'Token tidak kedaluwarsa'}
                </p>
                <p className="text-xs text-amber-700">Untuk Analytics, hubungkan ulang sekali agar izin insights ikut diberikan.</p>
              </div>
            </div>
            <a
              href="/api/auth/threads/connect"
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
            >
              Hubungkan Ulang
            </a>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                <Link2 className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="font-medium text-gray-700">Belum terhubung ke Threads</p>
                <p className="text-xs text-gray-500">
                  Klik tombol untuk login ke akun Threads yang ingin digunakan dan izinkan akses posting
                </p>
              </div>
            </div>
            <a
              href="/api/auth/threads/connect"
              className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 text-sm"
            >
              <Link2 className="w-4 h-4" />
              Hubungkan Threads
            </a>
          </div>
        )}

        {status?.error && !status.connected && (
          <p className="mt-3 text-xs text-red-600">Token tersimpan bermasalah: {status.error}. Hubungkan ulang.</p>
        )}
      </div>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold text-lg mb-4">Threads API Token Manual</h2>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Threads username</label>
          <input
            type="text"
            value={threadsUsername}
            onChange={(e) => setThreadsUsername(e.target.value)}
            className="w-full px-3 py-2 border rounded-md"
            placeholder="@yourusername"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Access Token</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full px-3 py-2 border rounded-md pr-10"
              placeholder="Enter Threads access token"
            />
            <button
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Expires at (optional)</label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>

        <button
          onClick={handleSaveToken}
          disabled={!token || saving}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          Save Token
        </button>

        <p className="text-xs text-gray-500 mt-4">
          Token disimpan terenkripsi di database lokal. Ikuti panduan di PRD untuk 
          mendapatkan token dari Meta Developer Dashboard.
        </p>
      </div>

      <div className="bg-white rounded-lg border p-6">
        <h2 className="font-semibold text-lg mb-4">Saved Credentials</h2>
        {credentials.length === 0 ? (
          <p className="text-gray-500 text-sm">No credentials saved</p>
        ) : (
          <div className="space-y-3">
            {credentials.map((cred) => (
              <div key={cred.id} className="border-b pb-2">
                <div className="flex justify-between">
                  <span className="font-medium">{cred.service}</span>
                  <span className="text-xs text-gray-500">
                    {cred.expires_at ? `Expires: ${new Date(cred.expires_at).toLocaleString()}` : 'No expiry'}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Last updated: {new Date(cred.updated_at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
