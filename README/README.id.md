# BuzzAgent — Bahasa Indonesia (README.id.md)

🌐 Situs web proyek: **https://b4zz.com/agent**

Workbench visual open-source untuk agen koding AI. Inti agen-nya adalah
[OpenCode](https://github.com/anomalyco/opencode) (MIT); BuzzAgent adalah
klien GUI di sekelilingnya — bukan runtime agen lain.

> **Lihat semua yang dikerjakan agen. Kendalikan model, alat, browser, MCP,
> dan reasoning — secara lokal, tanpa telemetri.**

## Kenapa ini ada

Pasar terbelah dua:

**Visual tapi lemah.** Cline, Kilo Code, Roo Code — UI yang layak pakai,
tapi terkunci di VS Code, dengan telemetri dan loop agen yang lebih lemah.

**Kuat tapi buta.** OpenCode, Claude Code, Codex CLI, Oh My Pi — agen yang
kuat, tapi hanya terminal. Tidak ada diff visual, tidak ada browser di
dalam aplikasi, tidak ada orkestrasi workspace.

Celahnya adalah produk yang mempertahankan kekuatan agen terminal **dan**
memberi kontrol visual, tanpa telemetri dan tanpa vendor lock-in.

BuzzAgent adalah produk itu. Ia **tidak menulis ulang agen**. OpenCode sudah
merupakan server HTTP headless (`opencode serve`) dengan spesifikasi
OpenAPI, stream peristiwa SSE, dan JS SDK bertipe. TUI mereka adalah satu
klien dari server itu; plugin IDE mereka klien lain. BuzzAgent adalah klien
ketiga: GUI desktop yang berdiri sendiri.

CLI Kilo Code adalah **fork** OpenCode, lalu dibungkus jadi ekstensi VS Code
(garis Cline) dengan akun dan telemetri. Kami tidak meniru itu. Fork mewarisi
beban pemeliharaan mereka dan memutus kami dari upstream. Klien menjaga
inti tetap mutakhir setiap OpenCode merilis — dan itu terus-menerus.

### OpenCode kini merilis GUI-nya sendiri

Sejak 1.18, repo OpenCode menerbitkan build `opencode-desktop-*` (Electron +
SolidJS, ~120–150 MB) dan mode browser (`opencode web`). Jadi "klien visual
untuk OpenCode" **bukan lagi pembeda dengan sendirinya** — pembuat intinya
punya satu.

Yang tetap jadi milik kami:

- **Nol telemetri sebagai fakta yang bisa diverifikasi.** Desktop mereka
  menyuntik `@sentry/solid` dan menginisialisasinya saat `VITE_SENTRY_DSN`
  disetel saat build (`packages/desktop/src/renderer/index.tsx`), ditambah
  `sentryVitePlugin` di build. Proses kami tidak punya crash reporter dan
  tidak punya dependensi analytics sama sekali.
- **Browser di dalam loop agen** — tulis kode, buka hasilnya, tangkapan
  layar kembali sebagai hasil alat, lalu perbaiki. Bukan hanya headless:
  bisa juga menempel ke Chrome yang sedang jalan lewat CDP, agar agen
  bekerja pada profil tempat pengguna sudah login (digerbangi izin, seperti
  `shell_exec`).
- **Orkestrasi worktree** — beberapa agen paralel di branch terpisah, dengan
  monitor visual.
- **Tanpa akun, tanpa gateway bawaan.** Tanpa jalur bawaan Zen/Go.

Konsekuensinya: GUI kami akan dibandingkan langsung dengan punya mereka. Itu
menaikkan standar, dan itulah sebabnya Milestone 1 adalah irisan yang sempit
dan andal, bukan sapuan fitur yang lebar.

Preseden berguna dari desktop mereka: `packages/desktop/src/main/sidecar.ts`
menjalankan server dengan `OPENCODE_SERVER_PASSWORD`, port acak, CORS
dibatasi ke origin mereka sendiri, loopback dipaksa masuk `NO_PROXY`, dan
sertifikat CA sistem dimuat. Kami mengadopsi pengerasan yang sama.

## Arsitektur

```
┌─────────────────────────────────────────────────────────┐
│  BuzzAgent (Tauri + React)                              │
│                                                         │
│  Lapisan visual  ──HTTP + SSE──►  opencode serve         │
│  chat · diff · file ·            (biner sidecar,         │
│  penyedia · izin ·                versi terkunci)        │
│  worktree                                                │
│                                                         │
│  Lapisan Rust                                            │
│  · mengawasi proses inti                                 │
│  · browser tersemat (CDP) ──terdaftar sebagai alat inti──│
│  · orkestrasi git worktree                               │
└─────────────────────────────────────────────────────────┘
```

- **Inti = OpenCode.** Loop alat, function calling native, streaming, sesi
  dan lanjut, compaction, izin, LSP, MCP, grep/glob/symbols, AGENTS.md,
  skill, slash command, 75+ penyedia, OAuth. Kami tidak menulis ulang satu
  pun dari itu.
- **GUI = BuzzAgent.** Chat dengan kartu tool-call, diff visual, pohon file,
  kotak masuk izin, kontrol model/effort per peran, monitor worktree.
- **Ekstra native yang tidak dimiliki inti.** Browser tersemat di dalam loop
  agen; agen paralel di git worktree terpisah.

Frontend berbicara dengan inti **langsung** lewat HTTP dan SSE, memakai
`@opencode-ai/sdk` yang dibuat dari spesifikasi OpenAPI versi **terkunci**
(`GET /doc`). Rust tidak mem-proxy lalu lintas agen. Rust hanya:

1. Menjalankan dan mengawasi `opencode serve` (port acak, kata sandi,
   pemeriksaan kesehatan).
2. Menyediakan alat native yang tak bisa dilakukan inti sendiri (browser,
   worktree).

Itu pemisahan yang sama yang dipakai OpenCode secara internal: TUI adalah
klien, server adalah runtime.

## Kenapa Tauri (dan apa harganya)

Jalur panas — token streaming, kartu alat, diff — berjalan langsung dari
webview ke inti lokal lewat HTTP/SSE. **Tidak** lewat IPC Tauri, jadi
throughput IPC shell tidak berada di jalur kritis. Itu menjadikan shell
desktop keputusan pengemasan dan kemampuan native, bukan performa.

Tauri, karena:

- Kami memang butuh lapisan native untuk pengawasan proses, kontrol browser
  lewat CDP, dan git worktree; kode itu ada dan tesnya lulus.
- Pindah ke Electron berarti menempati stack yang persis sama dengan desktop
  milik OpenCode (Electron + SolidJS + sidecar), tempat pembuat inti lebih
  dulu berangkat dan kami tidak akan punya pembeda apa pun.
- Template Electron mereka membawa integrasi Sentry. Janji "tanpa telemetri"
  kami lebih mudah dijaga tetap benar di stack yang kami kendalikan.
- Ukuran bundle adalah argumen lemah di sini: biner inti saja ~57 MB, jadi
  selisih shell 5 MB vs 120 MB tidak menentukan.

Harga sebenarnya, diungkap apa adanya:

- **Tiga webview berbeda.** WebView2 (Chromium, memperbarui diri) di
  Windows, WKWebView di macOS, `webkit2gtk` di Linux. Menurut tabel Tauri
  sendiri, `webkit2gtk` 2.36 ≈ Safari 16, dan distro lama jauh di belakang.
  Linux adalah target terlemah dan tempat bug rendering pertama muncul.
  Mitigasi: CSS konservatif, tanpa API web mutakhir, uji di `webkit2gtk`
  sungguhan.
- **Banyak webview dalam satu jendela ada di balik flag `unstable` Tauri.**
  Penting untuk panel browser: lebih baik CDP + tangkapan layar/stream ke UI
  daripada menyematkan webview hidup kedua, atau terima jendela terpisah.
- Waktu build Rust dan ekosistem plugin yang lebih kecil dari Electron.

### Alternatif yang dipertimbangkan

| Opsi | Putusan |
|---|---|
| **Electron** | UX paling dapat diprediksi: satu Chromium di mana-mana, ekosistem terbaik, devtools termudah. Ditolak sebagai bawaan karena persis stack desktop OpenCode, dan kami tetap perlu kode native via addon node. Fallback jujur jika bug `webkit2gtk` tak terkendali. |
| **Go + Wails** | Model webview sistem yang sama dengan Tauri, jadi mewarisi masalah `webkit2gtk` identik sambil melepas kode Rust yang sudah ada. Go tidak membeli apa pun di sini: inti bukan Go, dan pekerjaan native kami (CDP, worktree, pengawasan) tidak lebih mudah di Go. |
| **GUI Rust murni** (egui, Iced, GPUI, Dioxus native, Slint) | Menghapus seluruh kelas bug webview dan memberi performa native sungguhan. Tapi kami harus menbangun sendiri chat, markdown, penyorotan sintaks, tampilan diff, dan pohon file — tepat permukaan tempat GUI agen kode dinilai. Jalan memutar bertahun-tahun, dan panel browser jadi sangat sulit. Tak layak untuk v1. |
| **UI web saja** (menyajikan frontend di browser) | Termurah, dan target sekunder yang sungguh berguna — tapi OpenCode sudah merilis `opencode web`, dan tab browser tak bisa punya menu native, worktree, atau browser tersemat. Baik sebagai mode tambahan nanti, bukan produk. |
| **Flutter / .NET / Qt** | Widget bermutu native, tapi tanpa pemanfaatan ulang React, dan ekosistem "render markdown + diff + kode" lebih lemah dari web. Penulisan ulang besar tanpa keuntungan strategis. |
| **Ekstensi VS Code** | Langsung akrab dan murah, tapi itulah kotak Cline/Kilo yang kami lawan secara eksplisit, dan membunuh kisah aplikasi mandiri/tanpa-telemetri. |

Keputusan: **Tauri + React sekarang**, dengan Electron sebagai fallback yang
didokumentasikan bila cacat webview di Linux terbukti tak terkendali. Menjaga
UI sebagai klien HTTP/SSE sederhana dari inti itulah yang membuat fallback
itu murah — shell bisa diganti karena tidak ada logika agen yang hidup di
dalamnya.

### Kenapa bukan Oh My Pi sebagai inti

[oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT, ~30 ribu bintang)
adalah agen yang kuat — di beberapa titik lebih dalam dari OpenCode: LSP di
dalam loop, DAP, penyuntingan hashline, lapisan Rust native besar, skema URI
`pr://`/`issue://`/`agent://`, rantai fallback model. Tetap saja itu inti
yang salah *untuk produk ini*:

- **Tidak ada server HTTP.** Empat permukaannya: TUI, prompt sekali-jalan,
  Node SDK in-process, dan `--mode rpc` / `acp` lewat **stdio**. Browser
  tidak bisa bicara stdio, jadi Rust harus mem-proxy setiap pesan — lapisan
  yang sengaja kami hapus — dan RPC mereka menuntut pemecahan frame manual
  1 MiB serta negosiasi protokol. Tanpa spesifikasi OpenAPI, tidak ada
  klien hasil generate.
- **Telemetri yang tak bisa dimatikan.** UUID instalasi permanen
  (`~/.omp/install-id`, didokumentasikan di `docs/install-id.md` mereka)
  selamat dari penghapusan status agen dan memberi makan, antara lain,
  laporan pemakaian auth-broker yang juga mengirim hostname, plus push
  auto-QA. Menghapusnya berarti fork runtime mereka, yang menggugurkan
  maksud memakai inti orang lain.
- **Ceruknya sudah diambil:** `gooey-pi`, `pi-desktop`, `ohmypi-craft`,
  `ompweb` sudah jadi GUI untuk OMP.

Suatu saat jika kami menambah inti kedua, itu lewat **ACP** — protokol
bersama — di belakang antarmuka adaptor, dan hanya setelah irisan OpenCode
kokoh.

## Kualitas antarmuka adalah produknya

Semua di atas itu instalasi pipa. Alasan memakai BuzzAgent adalah
antarmukanya, maka ia diukur dengan standar, bukan dengan "jalan": tidak ada
yang terblokir jaringan, 60 fps saat streaming, tanpa pergeseran tata letak,
keyboard-first, diff berdampingan sungguhan dengan penyorotan sintaks,
sesi panjang tervirtualisasi, keadaan kosong/error/offline yang dirancang,
tema gelap **dan** terang, serta aksesibilitas nyata (fokus, kontras,
dukungan pembaca layar untuk aliran pesan).

Standar lengkap, stack frontend yang dipilih (React 19, Tailwind 4, Radix,
Shiki, CodeMirror 6, TanStack Virtual, cmdk), dan aturan menambah
dependensi ada di [PLAN.md](./PLAN.md#ui-quality-bar).

## Bagaimana sebuah pengaturan sampai ke inti

UI tidak pernah menyimpan salinan kedua status inti. Contoh — pengguna
menempel API key:

1. Panel Models memanggil `GET /provider/auth`. Formulir dirender dari
   skema yang dikembalikan inti (API key, OAuth, device flow, …).
2. Saat menyimpan, UI memanggil `PUT /auth/:id`. Inti menulis
   `~/.local/share/opencode/auth.json`. Kunci tidak tinggal di store kami
   dan tidak di `localStorage`.
3. Base URL, daftar putih model, `share: "disabled"` lewat `PATCH /config`.
4. Pemilih model adalah `GET /config/providers` / `GET /provider`.
5. Model untuk satu giliran adalah field pada `POST /session/:id/message`
   (`model`, `agent`). "Router per peran" hanyalah UI kami memilih field itu
   — bukan klien HTTP kedua di depan 75 penyedia.

Penyedia OAuth (Claude Pro, Copilot, GitLab Duo, DigitalOcean) memakai
`POST /provider/{id}/oauth/authorize` → browser sistem →
`POST /provider/{id}/oauth/callback`. Tidak ada kode khusus penyedia di
pihak kami.

Andai dua store kembali berbeda, agen tidak akan mau mulai. Inti adalah
pemilik tunggal konfigurasi, sesi, diff, dan izin.

## Yang kami kirim dan yang tidak

**Kami tidak menulis:** penyedia, OAuth, loop alat, streaming, sesi,
compaction, mesin izin, LSP, MCP, grep/glob/symbols, AGENTS.md, slash
command, skill, todo.

**Kami menulis:** seluruh lapisan visual; browser tersemat sebagai alat
inti; orkestrasi worktree; kotak masuk izin; router model/effort visual;
pengawasan proses; pengemasan.

**Kami tidak melakukan fork OpenCode** kecuali sebuah irisan vertikal
membuktikan kami harus mengubah semantik inti (system prompt, perilaku alat,
penyiapan diff). Keputusan itu diambil berdasar bukti, setelah Milestone 1,
bukan lebih dulu.

## Positioning

```
BuzzAgent = inti OpenCode
          + kontrol visual setara Cline
          + orkestrasi worktree setara Orca
          + browser di dalam loop agen
          + nol telemetri
```

| | BuzzAgent | Cline / Kilo | Cursor | Claude Code | OpenCode |
|---|---|---|---|---|---|
| Open source | ya | ya | tidak | tidak | ya |
| Nol telemetri | ya (diaudit — lihat bawah) | tidak | tidak | tidak | hampir (share/Zen opsional) |
| GUI visual | desktop mandiri | VS Code | ya | tidak | TUI / web |
| Browser bawaan di dalam loop | ya | tidak | tidak | tidak | tidak |
| Orkestrasi worktree | ya | tidak | tidak | tidak | hanya sesi |
| Sub-agen, LSP, MCP, izin | lewat inti | sebagian | sebagian | ya | ya |
| Agnostik agen nanti | antarmuka adaptor, OpenCode dulu | tidak | tidak | tidak | tidak relevan |

Kilo Code membuktikan inti OpenCode sanggup menopang produk, dan MIT
mengizinkannya. Mereka lalu menguasai ceruk IDE + telemetri + penagihan.
Ceruk yang mereka sisakan persis ini: desktop mandiri, tanpa akun, tanpa
telemetri, browser + worktree.

## Nol telemetri — terverifikasi

Audit (Milestone 0) telah selesai dan diverifikasi secara empiris. Langkah
reproduksi lengkap ada di
[docs/telemetry-audit.md](./docs/telemetry-audit.md).

- **Nol telemetri pihak ketiga.** Tidak ada Sentry, PostHog, Segment,
  Mixpanel, Datadog atau SDK analytics apa pun di biner inti.
- **Panggilan jaringan keluar dipaksa mati.** Pembagian percakapan
  (`"share": "disabled"`), pembaruan mandiri (`"autoupdate": false`), dan
  model kecil Zen dimatikan lewat konfigurasi paksa di disk.
- **Lingkungan terisolasi.** Semua status, cache, database, dan log berada
  terisolasi di dalam direktori data aplikasi (`XDG_CONFIG_HOME`,
  `XDG_STATE_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`).
- **Keamanan.** Autentikasi HTTP Basic dengan kata sandi acak 64 karakter,
  mengikat hanya ke `127.0.0.1`.

## Status saat ini

BuzzAgent telah dibangun ulang dan berfungsi penuh:
- **Pengawas Inti (Rust)**: manajemen proses otomatis, alokasi port acak,
  pembuatan kata sandi, health check, isolasi lingkungan, bypass `NO_PROXY`
  untuk loopback, teardown bersih saat keluar.
- **Klien HTTP + SSE langsung**: koneksi langsung ke API inti OpenCode,
  penguraian stream peristiwa yang tahan terhadap batas frame, manajemen
  sesi, pesan multi-giliran, gating izin.
- **UI Workbench Visual**: chat streaming waktu nyata dengan markdown tanpa
  kedip, blok kode tersorot sintaks (Shiki), kartu alat yang bisa
  diperiksa dengan status/durasi/kesalahan, dialog izin.
- **Panel Diff Visual**: penampil perubahan git waktu nyata dengan tanda
  level kata (`+`/`−`) dan pembatalan file satu klik.
- **Panel Browser Tersemat**: otomasi Chrome headless dan lampiran CDP
  langsung (`http://127.0.0.1:9222`), streaming tangkapan viewport
  langsung, interaksi selektor (klik, ketik), dan penampil log konsol CDP
  waktu nyata.
- **Orkestrasi Worktree**: membuat dan mengelola git worktree terpisah per
  branch, mengganti proyek aktif dengan cepat.
- **Palet Perintah (`⌘K`)**: navigasi cepat berbasis keyboard antar panel,
  sesi, dan tema (Gelap, Terang, Sistem).

## Mulai cepat

### 1. Prasyarat dan penyiapan

```bash
npm install
npm run setup:core   # Mengunduh biner OpenCode terkunci ke src-tauri/bin
```

### 2. Jalankan aplikasi desktop

```bash
npm run dev          # Menjalankan aplikasi desktop Tauri + mengawasi inti otomatis
```

Atau pratinjau web:
```bash
npm run web          # Hanya Vite — http://localhost:1420
```

### 3. Membangun installer (Windows / macOS / Linux)

```bash
npm run dist         # Mengunduh inti terkunci, lalu membangun installer rilis
```

Artefak mendarat di `src-tauri/target/release/bundle/`:

| OS | Berkas |
|---|---|
| Windows | `.msi`, `.exe` NSIS |
| macOS | `.app`, `.dmg` (per arsitektur dengan `--target aarch64-apple-darwin` / `x86_64-apple-darwin`) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Inti OpenCode terkunci ikut **di dalam** setiap installer
(`bundle.externalBin`), sehingga pengguna akhir memasang satu berkas dan tak
pernah menyentuh terminal.

Iterasi cepat tanpa pengemasan rilis: `npm run dist:debug`.

### 4. Merilis ke pengguna (satu perintah untuk ketiga OS)

Installer untuk setiap OS dibangun CI saat tag versi di-push:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

GitHub Actions (`.github/workflows/release.yml`) membangun `.msi`/`.exe`
Windows, `.dmg` macOS (Apple Silicon + Intel), dan `.deb`/`.rpm`/`.AppImage`
Linux, lalu melampirkan semuanya ke GitHub Release. Itu padanan terdekat
`npm install -g` untuk aplikasi desktop: pengguna mengklik satu tautan di
halaman Releases.

> Catatan: `npm install -g` untuk alat CLI. BuzzAgent adalah aplikasi GUI
> desktop; distribusinya lewat installer; tidak ada jalur instalasi global.

### 5. Verifikasi dan pengujian

```bash
npm run typecheck    # Pemeriksaan ketat TypeScript
npm run lint         # ESLint 9
npm test             # Rangkaian unit test Vitest (markdown, diff, client, store, UI)
cd src-tauri && cargo test   # Tes Rust pengawas, git, browser
npm run test:integration     # Ujung-ke-ujung melawan OpenCode hidup + penyedia mock
```

## Lisensi

[MIT](./LICENSE) © Kontributor BuzzAgent.

OpenCode juga MIT
([anomalyco/opencode](https://github.com/anomalyco/opencode)). Biner sidecar
adalah dependensi, bukan fork.
