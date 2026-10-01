# BuzzAgent — Türkçe (README.tr.md)

🌐 Proje web sitesi: **https://b4zz.com/agent**

⬇️ **İndir:** [https://b4zz.com/agent/#download](https://b4zz.com/agent/#download)

AI kodlama ajanları için açık kaynaklı görsel çalışma tezgahı. Ajan çekirdeği
[OpenCode](https://github.com/anomalyco/opencode) (MIT); BuzzAgent ise onun
etrafındaki GUI istemcisi — bir başka ajan çalışma ortamı değil.

> **Ajanın yaptığı her şeyi görün. Modelleri, araçları, tarayıcıyı, MCP'yi ve
> akıl yürütmeyi yerel olarak, sıfır telemetriyle yönetin.**

## Bu neden var

Pazar ikiye bölünmüş durumda:

**Görsel ama zayıf.** Cline, Kilo Code, Roo Code — kullanılabilir bir arayüz,
ama VS Code'a hapsedilmiş, telemetrili ve daha zayıf bir ajan döngüsüyle.

**Güçlü ama kör.** OpenCode, Claude Code, Codex CLI, Oh My Pi — güçlü bir
ajan, ama bir terminal. Görsel diff yok, gömülü tarayıcı yok, çalışma alanı
orkestrasyonu yok.

Boşluk, terminal ajanının gücünü koruyan **ve** görsel kontrol sunan,
telemetrisiz ve tedarikçi kilitsiz bir üründür.

BuzzAgent o üründür. Ajanı **yeniden yazmaz**. OpenCode zaten başsız bir HTTP
sunucusudur (`opencode serve`) — OpenAPI şartnamesi, SSE olay akışı ve
tipli bir JS SDK ile. Onların TUI'si o sunucunun bir istemcisidir; IDE
eklentileri de öyle. BuzzAgent üçüncü istemcidir: bağımsız bir masaüstü GUI'si.

Kilo Code'un CLI'si OpenCode'un bir **çatalıdır** (fork), sonra hesaplar ve
telemetriyle VS Code uzantısına sarılmıştır (Cline soyu). Bunu kopyalamıyoruz.
Çatal, bakım maliyetlerini devralır ve bizi yukarı akıştan koparır. İstemci
ise, OpenCode sürekli sürüm yayınladıkça çekirdeği güncel tutar.

### OpenCode artık kendi GUI'sini de dağıtıyor

1.18'den itibaren OpenCode deposu `opencode-desktop-*` derlemelerini
(Electron + SolidJS, ~120–150 MB) ve tarayıcı modunu (`opencode web`)
yayınlıyor. "OpenCode için görsel bir istemci" bu yüzden **tek başına artık
bir farklılaşma değil** — çekirdek yazarlarının kendilerinininki var.

Hâlâ bizim olan:

- **Sıfır telemetri, doğrulanabilir bir gerçek olarak.** Onların masaüstü
  `@sentry/solid` ekliyor ve derleme anında `VITE_SENTRY_DSN` ayarlıysa
  başlatıyor (`packages/desktop/src/renderer/index.tsx`), ayrıca derlemeye
  `sentryVitePlugin` giriyor. Sürecimizde ne bir çökme raporlayıcısı ne de
  tek bir analitik bağımlılık var.
- **Ajan döngüsünün içinde bir tarayıcı** — kod yazar, sonucu açar, ekran
  görüntüsü araç sonucu olarak geri gelir, düzeltir. Yalnızca headless değil:
  CDP üzerinden çalışan bir Chrome'a da bağlanabilir; böylece ajan, kullanıcının
  zaten oturum açtığı profilde çalışır (`shell_exec` gibi izin kapısından geçerek).
- **Worktree orkestrasyonu** — birkaç ajan, izole dallarda paralel; görsel
  izleyiciyle.
- **Hesap yok, gömülü ağ geçidi yok.** Zen/Go varsayılan yolu yok.

Sonuç: GUI'miz doğrudan onlarınkiyle karşılaştırılacak. Bu çıtayı yükseltir
ve Kilometre Taşı 1'in geniş bir özellik taraması değil, dar ve güvenilir bir
dilim olmasının nedenidir.

Onların masaüstünden faydalı bir emsal: `packages/desktop/src/main/sidecar.ts`
sunucuyu `OPENCODE_SERVER_PASSWORD` ile, rastgele bağlantı noktasıyla, CORS'u
kendi kaynağına kısıtlayarak, loopback'i `NO_PROXY`'ye zorla ekleyerek ve
sistem CA sertifikalarını yükleyerek başlatıyor. Aynı sertleştirmeyi
benimsiyoruz.

## Mimari

```
┌─────────────────────────────────────────────────────────┐
│  BuzzAgent (Tauri + React)                              │
│                                                         │
│  Görsel katman  ──HTTP + SSE──►  opencode serve          │
│  sohbet · diff · dosyalar ·      (sidecar ikilisi,       │
│  sağlayıcılar · izinler ·         sabitlenmiş sürüm)      │
│  worktree'ler                                            │
│                                                         │
│  Rust katmanı                                            │
│  · çekirdek süreci denetler                              │
│  · gömülü tarayıcı (CDP) ──çekirdek aracı olarak kayıtlı──│
│  · git worktree orkestrasyonu                            │
└─────────────────────────────────────────────────────────┘
```

- **Çekirdek = OpenCode.** Araç döngüsü, native function calling, akış,
  oturumlar ve devam, sıkıştırma, izinler, LSP, MCP, grep/glob/symbols,
  AGENTS.md, beceriler, eğik çizgi komutları, 75+ sağlayıcı, OAuth. Bunların
  hiçbirini yeniden yazmıyoruz.
- **GUI = BuzzAgent.** Araç çağrısı kartlarıyla sohbet, görsel diff'ler,
  dosya ağacı, izin gelen kutusu, role göre model/efor kontrolleri, worktree
  izleyicisi.
- **Çekirdekte olmayan yerel ekstralar.** Ajan döngüsünde gömülü tarayıcı;
  izole git worktree'lerinde paralel ajanlar.

Önyüz, çekirdekle **doğrudan** HTTP ve SSE üzerinden konuşur; sabitlenmiş
sürümün OpenAPI şartnamesinden (`GET /doc`) üretilen `@opencode-ai/sdk`'yi
kullanır. Rust, ajan trafiğini vekillemez. Rust yalnızca:

1. `opencode serve`'i başlatır ve denetler (rastgele port, parola, sağlık
   kontrolü).
2. Çekirdeğin kendi başına yapamadığı yerel araçları sunar (tarayıcı,
   worktree).

Bu, OpenCode'un içeride kullandığı aynı bölünmedir: TUI istemcidir, sunucu
çalışma ortamıdır.

## Neden Tauri (ve bedeli nedir)

Sıcak yol — akan token'lar, araç kartları, diff'ler — webview'den yerel
çekirdeğe HTTP/SSE üzerinden doğrudan gider. Tauri IPC'sinden **geçmez**;
böylece kabuğun IPC hacmi kritik yol üzerinde değildir. Bu, masaüstü kabuğunu
bir performans değil, paketleme ve yerel yetenek kararı yapar.

Tauri, çünkü:

- Zaten süreç denetimi, CDP ile tarayıcı kontrolü ve git worktree'leri için
  yerel bir katmana ihtiyacımız var; o kod mevcut ve testleri geçiyor.
- Electron'a geçmek, bizi OpenCode'un kendi masaüstünün (Electron + SolidJS +
  sidecar) tam olarak aynı yığınına koyar; çekirdek yazarlarının orada önde
  başlangıcı var ve hiçbir şeyde farklılaşamayız.
- Onların Electron şablonu Sentry entegrasyonuyla gelir. "Telemetri yok"
  sözümüzü doğru tutmak, kontrol ettiğimiz bir yığında daha kolaydır.
- Paket boyutu burada zayıf bir savunmadır: yalnızca çekirdek ikilisi ~57 MB;
  5 MB'a karşı 120 MB'lık kabuk farkı belirleyici değildir.

Gerçek bedel, açık açık:

- **Üç farklı webview.** Windows'ta WebView2 (Chromium, kendini güncelleyen),
  macOS'ta WKWebView, Linux'ta `webkit2gtk`. Tauri'nin kendi tablosuna göre
  `webkit2gtk` 2.36 ≈ Safari 16; eski dağıtımlar daha da geride. Linux en
  zayıf hedeftir ve render hatalarını ilk orada görürüz. Önlem: tutucu CSS,
  uçsuz bucaksız Web API'leri yok, gerçek `webkit2gtk` üzerinde test.
- **Tek pencerede birden çok webview, Tauri'nin `unstable` bayrağının
  ardındadır.** Tarayıcı paneli için önemli: canlı ikinci bir webview gömmek
  yerine CDP + ekran görüntüsü/akışı arayüze taşımak, ya da ayrı bir pencereyi
  kabullenmek tercih edilir.
- Rust derleme süreleri ve Electron'dan daha küçük eklenti ekosistemi.

### Değerlendirilen alternatifler

| Seçenek | Karar |
|---|---|
| **Electron** | En öngörülebilir UX: her yerde tek Chromium, en iyi ekosistem, en kolay devtools. Varsayılan olarak reddedildi — çünkü OpenCode masaüstünün birebir yığını ve yerel kod yine node eklentileriyle yazılacaktı. `webkit2gtk` hataları yönetilemez hale gelirse dürüst yedek yol. |
| **Go + Wails** | Tauri ile aynı sistem-webview modeli; aynı `webkit2gtk` sorunu, üstüne elimizdeki Rust kodundan vazgeçmek. Go burada hiçbir şey almıyor: çekirdek Go değil, yerel işimiz (CDP, worktree, denetim) Go'da kolaylaşmıyor. |
| **Saf Rust GUI'sü** (egui, Iced, GPUI, Dioxus native, Slint) | Webview hata sınıfını tümüyle ortadan kaldırır ve gerçek yerel performans verir. Ama sohbeti, markdown'ı, sözdizimi vurgulamayı, diff görünümlerini ve dosya ağacını elle yazmak gerekir — kod ajanı GUI'sinin ölçüldüğü tam o yüzey. Yıllara yayılan bir sapma ve tarayıcı paneli neredeyse imkânsız. v1 için uygulanamaz. |
| **Yalnızca web arayüzü** (kendi ön yüzümüzü tarayıcıda sunmak) | En ucuzu ve gerçekten yararlı bir ikincil hedef — ama OpenCode zaten `opencode web` dağıtıyor ve bir tarayıcı sekmesi yerel menü, worktree veya gömülü tarayıcı sahibi olamaz. Sonradan ek bir mod olarak iyi, ürün olarak değil. |
| **Flutter / .NET / Qt** | Yerel kalitede bileşenler, ama React yeniden kullanımı yok ve "markdown + diff + kod render" ekosistemi web'den zayıf. Stratejik kazanç olmayan büyük yeniden yazım. |
| **VS Code uzantısı** | Tanıdık ve ucuz, ama açıkça konumlandığımız Cline/Kilo kutusudur ve bağımsız/telemetrisiz uygulama hikâyesini öldürür. |

Karar: **şimdi Tauri + React**; Electron, Linux webview kusurları
yönetilemez çıkarsa belgelenmiş yedek yol. Arayüzü çekirdeğin sade bir
HTTP/SSE istemcisi tutmak, işte o yedeği ucuz yapan şeydir — kabuk
değiştirilebilirdir, çünkü ajan mantığı onda yaşamaz.

### Neden Oh My Pi çekirdek değil

[oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT, ~30 bin yıldız) güçlü
bir ajandır — yer yer OpenCode'dan daha derin: döngü içinde LSP, DAP, hashline
düzenlemeleri, büyük yerel Rust katmanı, `pr://`/`issue://`/`agent://` URI
şemaları, model yedek zincirleri. Yine de *bu ürün için* yanlış çekirdektir:

- **HTTP sunucusu yok.** Dört yüzeyi var: TUI, tek atımlık istem, süreç içi
  Node SDK ve **stdio** üzerinden `--mode rpc` / `acp`. Tarayıcı stdio
  konuşamaz; Rust her mesajın vekili olmak zorunda — bilinçli olarak kaldırdığımız
  o katman — ve onların RPC'si elle 1 MiB çerçeve bölme ve protokol pazarlığı
  ister. OpenAPI şartnamesi yoksa üretilmiş istemci de yok.
- **Kapatılamayan telemetri.** Kalıcı bir kurulum UUID'si
  (`~/.omp/install-id`, onların `docs/install-id.md`'sinde belgeli) ajan
  durumu silinse de hayatta kalır ve diğerlerinin yanında, ana makine adını da
  gönderen bir auth-aracısı kullanım raporunu ve otomatik-QA gönderilerini
  besler. Onu kaldırmak, onların çalışma ortamını çatallamak demektir — başkasının
  çekirdeğini kullanmanın anlamını yok eder.
- **Boşluk zaten dolu:** `gooey-pi`, `pi-desktop`, `ohmypi-craft`, `ompweb`
  halihazırda OMP GUI'leri.

Bir gün ikinci bir arka uç eklersek, **ACP** üzerinden olur — paylaşımlı bir
protokol — bir bağdaştırıcı arayüzünün ardında ve yalnızca OpenCode dilimi
sağlamlaştıktan sonra.

## Arayüz kalitesi üründür

Yukarıdakilerin hepsi tesisat. BuzzAgent'i seçme sebebi arayüzdür; o yüzden
"çalışıyor" ölçüsüyle değil, bir standartla yargılanır: ağda hiçbir şey takılıp
kalmaz, akış sırasında 60 fps, düzen kayması yok, klavye önce, sözdizimi
vurgulu gerçek yan yana diff'ler, uzun oturumlar sanallaştırılmış, özenle
tasarlanmış boş/hata/çevrimdışı durumlar, koyu **ve** açık temalar ve gerçek
erişilebilirlik (odak, kontrast, mesaj akışı için ekran okuyucu desteği).

Tam çıta, seçilen ön yüz yığını (React 19, Tailwind 4, Radix, Shiki,
CodeMirror 6, TanStack Virtual, cmdk) ve bağımlılık ekleme kuralları
PLAN.md içinde.

## Bir ayar çekirdeğe nasıl ulaşır

Arayüz, çekirdek durumunun ikinci bir kopyasını asla tutmaz. Örnek — kullanıcı
API anahtarını yapıştırır:

1. Modeller paneli `GET /provider/auth` çağırır. Form, çekirdeğin döndürdüğü
   şemadan çizilir (API anahtarı, OAuth, cihaz akışı, …).
2. Kaydederken arayüz `PUT /auth/:id` çağırır. Çekirdek
   `~/.local/share/opencode/auth.json` dosyasını yazar. Anahtar ne bizim
   depomuzda ne `localStorage`'da durur.
3. Base URL, model beyaz listesi, `share: "disabled"` `PATCH /config`
   üzerinden gider.
4. Model seçici `GET /config/providers` / `GET /provider`'dır.
5. Bir turun modeli `POST /session/:id/message`'in bir alanıdır (`model`,
   `agent`). "Role göre yönlendirici" o alanları seçen bizim arayüzümüzdür —
   75 sağlayıcının önünde ikinci bir HTTP istemcisi değil.

OAuth sağlayıcıları (Claude Pro, Copilot, GitLab Duo, DigitalOcean) şu yolu
kullanır: `POST /provider/{id}/oauth/authorize` → sistem tarayıcısı →
`POST /provider/{id}/oauth/callback`. Bizim tarafta sağlayıcıya özgü kod yok.

İki depo bir daha ayrışırsa ajan başlamaz. Çekirdek, yapılandırmanın,
oturumların, diff'lerin ve izinlerin tek sahibidir.

## Neyi teslim ediyoruz, neyi etmiyoruz

**Yazmıyoruz:** sağlayıcılar, OAuth, araç döngüsü, akış, oturumlar, sıkıştırma,
izin motoru, LSP, MCP, grep/glob/symbols, AGENTS.md, eğik çizgi komutları,
beceriler, yapılacaklar.

**Yazıyoruz:** tüm görsel katman; çekirdek aracı olarak gömülü tarayıcı;
worktree orkestrasyonu; izin gelen kutusu; görsel model/efor yönlendiricisi;
süreç denetimi; paketleme.

**OpenCode'u çatallamıyoruz**, ta ki bir dikey dilim çekirdek semantiğini
değiştirmemiz gerektiğini kanıtlayana dek (sistem istemleri, araç davranışı,
diff sahneleme). Bu karar kanıta dayanır, Kilometre Taşı 1'den sonra — önceden değil.

## Konumlandırma

```
BuzzAgent = OpenCode çekirdeği
          + Cline seviyesi görsel kontrol
          + Orca seviyesi worktree orkestrasyonu
          + ajan döngüsünde gömülü bir tarayıcı
          + sıfır telemetri
```

| | BuzzAgent | Cline / Kilo | Cursor | Claude Code | OpenCode |
|---|---|---|---|---|---|
| Açık kaynak | evet | evet | hayır | hayır | evet |
| Sıfır telemetri | evet (denetlendi — aşağıda) | hayır | hayır | hayır | neredeyse (share/Zen isteğe bağlı) |
| Görsel GUI | bağımsız masaüstü | VS Code | evet | hayır | TUI / web |
| Döngüde yerleşik tarayıcı | evet | hayır | hayır | hayır | hayır |
| Worktree orkestrasyonu | evet | hayır | hayır | hayır | yalnızca oturumlar |
| Alt ajanlar, LSP, MCP, izinler | çekirdek üzerinden | kısmi | kısmi | evet | evet |
| Sonra ajan-bağımsızlığı | bağdaştırıcı arayüzü, önce OpenCode | hayır | hayır | hayır | yok |

Kilo Code, OpenCode çekirdeğinin bir ürün taşıyabildiğini kanıtladı ve MIT buna
izin verir. Sonra IDE + telemetri + faturalama boşluğunu işgal ettiler.
Açık bıraktıkları boşluk tam olarak bu: bağımsız masaüstü, hesap yok, telemetri
yok, tarayıcı + worktree.

## Sıfır telemetri — doğrulandı

Denetim (Kilometre Taşı 0) tamamlandı ve ampirik olarak doğrulandı. Tam
yeniden üretim adımları [docs/telemetry-audit.md](./docs/telemetry-audit.md)
içinde.

- **Üçüncü taraf telemetrisi sıfır.** Çekirdek ikilisinde Sentry, PostHog,
  Segment, Mixpanel, Datadog ya da herhangi bir analitik SDK yok.
- **Giden ağ çağrıları zorla kapalı.** Konuşma paylaşımı (`"share": "disabled"`),
  kendini güncelleme (`"autoupdate": false`) ve Zen küçük modeller, diske
  dayatılan yapılandırma ile kapatıldı.
- **İzole ortam.** Tüm durum, önbellek, veritabanı ve günlükler uygulama veri
  klasörünün içinde (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`,
  `XDG_CACHE_HOME`).
- **Güvenlik.** Rastgele üretilmiş 64 karakterlik parolalarla HTTP Basic
  kimlik doğrulaması, yalnızca `127.0.0.1`'e bağlanma.

## Mevcut durum

BuzzAgent yeniden inşa edildi ve tam işlevsel:
- **Çekirdek Denetçisi (Rust)**: otomatik süreç yönetimi, rastgele port ataması,
  parola üretimi, sağlık kontrolleri, ortam yalıtımı, loopback için `NO_PROXY`
  atlatması, çıkışta temiz kapanma.
- **Doğrudan HTTP + SSE istemcisi**: OpenCode çekirdek API'sine doğrudan
  bağlantı, çerçeve sınırlarına dayanıklı olay akışı ayrıştırma, oturum yönetimi,
  çok turlu mesajlaşma, izin kapısı.
- **Görsel Çalışma Tezgahı Arayüzü**: titremeyen markdown ile gerçek zamanlı
  akışlı sohbet, sözdizimi vurgulu kod blokları (Shiki), durumları/süreleri/
  hatalarıyla incelenebilir araç kartları, izin pencereleri.
- **Görsel Diff Paneli**: kelime düzeyi işaretlerle (`+`/`−`) gerçek zamanlı
  git değişiklik görüntüleyici ve tek tıkla dosya geri alma.
- **Uygulama İçi Tarayıcı Paneli**: headless Chrome otomasyonu ve canlı CDP
  bağlanması (`http://127.0.0.1:9222`), canlı görüntü alanı ekran görüntüsü
  akışı, seçici etkileşimi (tıklama, yazma) ve gerçek zamanlı CDP konsol
  günlüğü görüntüleyicisi.
- **Worktree Orkestrasyonu**: dal başına izole git worktree oluşturma ve
  yönetme, etkin projeyi anında değiştirme.
- **Komut Paleti (`⌘K`)**: paneller, oturumlar ve temalar (Koyu, Açık, Sistem)
  arasında hızlı klavyeyle gezinme.

## Hızlı başlangıç

### 1. Ön koşullar ve kurulum

```bash
npm install
npm run setup:core   # Sabitlenmiş OpenCode ikilisini src-tauri/bin'e indirir
```

### 2. Masaüstü uygulamasını çalıştır

```bash
npm run dev          # Tauri masaüstü uygulaması + çekirdeğin otomatik denetimi
```

Ya da web önizlemesi:
```bash
npm run web          # Yalnızca Vite — http://localhost:1420
```

### 3. Yükleyicileri derle (Windows / macOS / Linux)

```bash
npm run dist         # Sabitlenmiş çekirdeği indirir, sonra sürüm yükleyicilerini derler
```

Çıktılar `src-tauri/target/release/bundle/` altına düşer:

| OS | Dosyalar |
|---|---|
| Windows | `.msi`, NSIS `.exe` |
| macOS | `.app`, `.dmg` (mimari başına: `--target aarch64-apple-darwin` / `x86_64-apple-darwin`) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Sabitlenmiş OpenCode çekirdeği her yükleyicinin **içinde** seyahat eder
(`bundle.externalBin`): son kullanıcı tek bir dosya kurar ve bir terminali hiç
dokunmaz.

Sürüm paketleme olmadan hızlı yineleme: `npm run dist:debug`.

### 4. Kullanıcılara sürümleme (üç OS için tek komut)

Her OS'un yükleyicilerini, bir sürüm etiketi itildiğinde CI derler:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

GitHub Actions (`.github/workflows/release.yml`) Windows `.msi`/`.exe`,
macOS `.dmg` (Apple Silicon + Intel) ve Linux `.deb`/`.rpm`/`.AppImage`
derler ve hepsini GitHub Release'e ekler. Masaüstü bir uygulama için
`npm install -g`'nin en yakın karşılığı budur: kullanıcı Releases sayfasında
tek bir bağlantıya tıklar.

> Not: `npm install -g` CLI araçları içindir. BuzzAgent bir masaüstü GUI
> uygulamasıdır; dağıtım yükleyicilerle olur; global kurulum yolu yoktur.

### 5. Doğrulama ve testler

```bash
npm run typecheck    # Katı TypeScript denetimi
npm run lint         # ESLint 9
npm test             # Vitest birim test paketi (markdown, diff, client, store, UI)
cd src-tauri && cargo test   # Rust testleri: denetçi, git, tarayıcı
npm run test:integration     # Canlı OpenCode + mock sağlayıcıya karşı uçtan uca
```

## Lisans

[MIT](../LICENSE) © BuzzAgent Katkıda Bulunanlar.

OpenCode da MIT'dir
([anomalyco/opencode](https://github.com/anomalyco/opencode)). Sidecar ikilisi
bir bağımlılıktır, çatal değil.
