import type { AppLocale } from './i18n';

type Vars = Record<string, string | number>;

type Dictionary = Record<string, string>;

const id: Dictionary = {
  dashboard: 'Dashboard', content: 'Konten', schedule: 'Jadwal', sources: 'Sumber', settings: 'Pengaturan', 'Loading...': 'Memuat...', 'No data': 'Tidak ada data', Analytics: 'Analitik', Credentials: 'Kredensial',
  'Scheduled Today': 'Terjadwal Hari Ini', 'Total Posts': 'Total Post', Posted: 'Sudah Tayang', 'Kill Switch': 'Kill Switch', 'Total Views': 'Total Tayangan', 'Quick Settings': 'Pengaturan Cepat', 'Posts per day': 'Post per hari', 'Active hours': 'Jam aktif', Timezone: 'Zona waktu', 'Edit settings →': 'Edit pengaturan →', 'Upcoming Schedule': 'Jadwal Mendatang', 'No upcoming slots': 'Tidak ada jadwal mendatang', 'Recent Posts': 'Post Terbaru', 'No posts yet': 'Belum ada post', 'View all posts →': 'Lihat semua post →',
  'Current Schedule Settings': 'Pengaturan Jadwal Saat Ini', 'Active hours start': 'Mulai jam aktif', 'Active hours end': 'Selesai jam aktif', 'Active days': 'Hari aktif', "Today's Schedule": 'Jadwal Hari Ini', 'No slots scheduled for today': 'Tidak ada slot untuk hari ini', Schedule: 'Jadwal', 'Kill Switch ON': 'Kill Switch AKTIF', 'Kill Switch OFF': 'Kill Switch NONAKTIF', 'Content Agent': 'Content Agent', Working: 'Bekerja', 'Active / Waiting': 'Aktif / Menunggu', Inactive: 'Nonaktif', Ready: 'Siap', Queue: 'Antrean', 'Set Active': 'Aktifkan', 'Set Inactive': 'Nonaktifkan', 'Processing...': 'Memproses...',
  'Content Agent and publishing are disabled by the kill switch.': 'Content Agent dan publikasi dimatikan oleh kill switch.', 'Content Agent is inactive.': 'Content Agent tidak aktif.', 'Content Agent is blocked by the kill switch.': 'Content Agent tertahan oleh kill switch.', 'Waiting in the agent queue.': 'Menunggu antrean agent.', 'Agent is preparing content.': 'Agent sedang mengambil source dan membuat konten.', 'Active, processing the queue serially.': 'Aktif, mengerjakan antrean secara serial.', 'Active, all content is ready.': 'Aktif, seluruh konten sudah siap.', 'Inactive: the agent does not start new content.': 'Nonaktif: agent tidak memulai konten baru.',
  Posts: 'Post', 'Showing {shown} of {total} posts': 'Menampilkan {shown} dari {total} post', Previous: 'Sebelumnya', Next: 'Berikutnya', 'Page {page} of {total}': 'Halaman {page} dari {total}', 'View content': 'Lihat konten', 'Quality gate failed': 'Quality gate gagal', Post: 'Tayangkan', 'Retry upload': 'Coba upload ulang', 'View on Threads': 'Lihat di Threads', Delete: 'Hapus',
  Pending: 'Menunggu', Failed: 'Gagal', Engagement: 'Engagement', 'Posts by Pillar': 'Post berdasarkan Pilar', 'Status Distribution': 'Distribusi Status', 'Hook → conversations': 'Hook → percakapan', 'Format → redistribution': 'Format → distribusi', 'Recent Engagement': 'Engagement Terbaru', Date: 'Tanggal', Pillar: 'Pilar', Views: 'Tayangan', Likes: 'Like', Replies: 'Balasan', Reposts: 'Repost', Quotes: 'Quote', Shares: 'Bagikan', 'No metrics available yet. Metrics will appear after posts get engagement.': 'Belum ada metrik. Metrik muncul setelah post mendapat engagement.', 'Not enough evidence yet: {sample}/{minimum} 24-hour snapshots.': 'Belum cukup bukti: {sample}/{minimum} snapshot 24 jam.', 'No groups have enough samples yet.': 'Belum ada grup dengan sampel yang cukup.',
  'Threads Connection': 'Koneksi Threads', 'Checking status...': 'Memeriksa status...', 'Connected as @{username}': 'Terhubung sebagai @{username}', 'Token expired: {date}': 'Token kedaluwarsa: {date}', 'Token never expires': 'Token tidak kedaluwarsa', Reconnect: 'Hubungkan Ulang', 'Not connected to Threads': 'Belum terhubung ke Threads', 'Connect Threads': 'Hubungkan Threads', 'Threads API Token Manual': 'Token API Threads Manual', 'Threads username': 'Username Threads', 'Access Token': 'Access Token', 'Expires at (optional)': 'Kedaluwarsa pada (opsional)', 'Save Token': 'Simpan Token', 'Saved Credentials': 'Kredensial Tersimpan', 'No credentials saved': 'Belum ada kredensial tersimpan', 'Last updated: {date}': 'Terakhir diperbarui: {date}',
  'Source Registry': 'Registri Source', 'Export JSON': 'Ekspor JSON', 'Export CSV': 'Ekspor CSV', 'Import JSON': 'Impor JSON', 'Add Source': 'Tambah Source', 'Search name or URL': 'Cari nama atau URL', 'All health': 'Semua status', Filter: 'Filter', 'Add New Source': 'Tambah Source Baru', Name: 'Nama', URL: 'URL', Manual: 'Manual', API: 'API', Webpage: 'Halaman Web', Add: 'Tambah', Cancel: 'Batal', Approved: 'Disetujui', Health: 'Kesehatan', 'Last Checked': 'Terakhir Dicek', Never: 'Belum pernah', 'No sources yet': 'Belum ada source', Unknown: 'Tidak diketahui', Live: 'Aktif', Redirect: 'Redirect', Transient: 'Sementara', Dead: 'Mati',
  Settings: 'Pengaturan', English: 'English', 'Bahasa Indonesia': 'Bahasa Indonesia', 'Atur pillar aktif, bobot distribusi, urutan, kebijakan source, dan izin promo tanpa mengubah kode.': 'Atur pilar aktif, bobot distribusi, urutan, kebijakan source, dan izin promo tanpa mengubah kode.', 'Setiap composition mengatur hook, struktur, CTA, panjang, mode standalone/thread, hashtag, dan source-link.': 'Setiap komposisi mengatur hook, struktur, CTA, panjang, mode standalone/thread, hashtag, dan source-link.', 'Export settings dan source tanpa token, password hash, history, atau database runtime.': 'Ekspor pengaturan dan source tanpa token, hash password, riwayat, atau database runtime.', 'Content Pillars': 'Pilar Konten', 'Content Compositions': 'Komposisi Konten', 'Configuration portability': 'Portabilitas Konfigurasi', System: 'Sistem', 'UI language': 'Bahasa UI', 'Content language': 'Bahasa konten', 'Posting mode': 'Mode posting', 'Draft (approval required)': 'Draft (perlu persetujuan)', 'Auto-post': 'Auto-post', 'Hermes model': 'Model Hermes', 'Hermes profile': 'Profil Hermes', 'Configuration exported successfully': 'Konfigurasi berhasil diekspor', 'Export failed': 'Ekspor gagal', 'Import failed': 'Impor gagal', 'Import succeeded': 'Impor berhasil', 'Source policy': 'Kebijakan source', 'Any HTTPS': 'HTTPS apa pun', 'GitHub repo': 'Repo GitHub', Language: 'Bahasa', Source: 'Source', Type: 'Tipe', Length: 'Panjang', Mode: 'Mode', Active: 'Aktif', Promo: 'Promo', Weight: 'Bobot',
  'Health check failed': 'Health check gagal', 'Delete failed': 'Penghapusan gagal', 'Failed to add source': 'Gagal menambah source', 'Please fill all fields': 'Isi semua field', 'Import format is invalid': 'Format impor tidak valid', 'File JSON is invalid': 'File JSON tidak valid', 'Dashboard navigation': 'Navigasi dashboard', 'CONTENT CONTROL': 'KONTROL KONTEN',
};

const en: Dictionary = {
  'Atur pillar aktif, bobot distribusi, urutan, kebijakan source, dan izin promo tanpa mengubah kode.': 'Configure active pillars, distribution weights, ordering, source policy, and promotion eligibility without changing code.',
  'Setiap composition mengatur hook, struktur, CTA, panjang, mode standalone/thread, hashtag, dan source-link.': 'Each composition controls the hook, structure, CTA, length, standalone/thread mode, hashtags, and source link.',
  'Export settings dan source tanpa token, password hash, history, atau database runtime.': 'Export settings and sources without tokens, password hashes, history, or the runtime database.',
};

function interpolate(value: string, vars?: Vars): string {
  return value.replace(/\{(\w+)\}/g, (_, key: string) => String(vars?.[key] ?? `{${key}}`));
}

export function translateUi(locale: AppLocale, key: string, vars?: Vars): string {
  const value = locale === 'id' ? id[key] || key : en[key] || (key === 'dashboard' ? 'Dashboard' : key);
  return interpolate(value, vars);
}

export function labelForStatus(locale: AppLocale, status: string): string {
  const labels: Record<string, string> = {
    draft: locale === 'id' ? 'Draft' : 'Draft',
    scheduled: locale === 'id' ? 'Terjadwal' : 'Scheduled',
    posted: locale === 'id' ? 'Sudah tayang' : 'Posted',
    posted_unverified: locale === 'id' ? 'Tayang, belum terverifikasi' : 'Posted, unverified',
    publishing: locale === 'id' ? 'Sedang tayang' : 'Publishing',
    publish_unknown: locale === 'id' ? 'Status tayang tidak pasti' : 'Publish status unknown',
    failed: locale === 'id' ? 'Gagal' : 'Failed',
    quality_failed: locale === 'id' ? 'Quality gate gagal' : 'Quality gate failed',
    pending: locale === 'id' ? 'Menunggu' : 'Pending',
    preparing: locale === 'id' ? 'Menyiapkan' : 'Preparing',
    processing: locale === 'id' ? 'Memproses' : 'Processing',
    retrying: locale === 'id' ? 'Mencoba ulang' : 'Retrying',
    completed: locale === 'id' ? 'Selesai' : 'Completed',
    blocked_agent: locale === 'id' ? 'Agent diblokir' : 'Agent blocked',
    blocked_quality: locale === 'id' ? 'Terblokir quality gate' : 'Blocked by quality gate',
    blocked_source: locale === 'id' ? 'Source diblokir' : 'Source blocked',
    skipped: locale === 'id' ? 'Dilewati' : 'Skipped',
  };
  return labels[status] || status;
}
