# ⚽ Halı Saha Ligi

Puan durumu, fikstür, maç kadroları, gol ve asist krallığı, MVP'ler. Herkes izler, kaptanlar kendi maçlarını girer, sen onaylarsın.
**Tamamen ücretsiz:** site GitHub Pages'te, veriler Supabase'te durur.

## Kim ne yapar?

| | İzleyici (herkes) | Kaptan | Yönetici (sen) |
|---|---|---|---|
| Tablo, fikstür, krallar, maç detayı | ✅ | ✅ | ✅ |
| Kendi takımına oyuncu ekleme | | ✅ | ✅ |
| Kendi maçının kadrosu ve golleri | | ✅ (onaylanana kadar) | ✅ |
| Takım, logo, maç ekleme | | | ✅ |
| MVP seçme, sonucu onaylama | | | ✅ |
| Kaptan atama | | | ✅ |

**Skor elle girilmez.** Her kaptan kendi takımının gollerini girer, skor otomatik çıkar. Sen **"Sonucu onayla"** dediğin anda puan tablosu ve krallıklar güncellenir. Onaylanmış maçı kaptanlar artık değiştiremez.

---

## Kurulum (yaklaşık 15 dakika, tek seferlik)

### 1) Supabase (veritabanı)
1. https://supabase.com adresine git, GitHub hesabınla giriş yap.
2. **New project** → isim ver (örn. `hali-saha`), bir veritabanı şifresi belirle, bölge olarak **Central EU (Frankfurt)** seç.
3. Proje açılınca sol menüden **SQL Editor** → **New query** → `schema.sql` dosyasının **tamamını** yapıştır → **Run**. "Success" görmelisin.
4. **Project Settings → API** (veya üstteki **Connect** butonu) sayfasından şu ikisini kopyala:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon / public key** (veya "publishable key")
5. `config.js` dosyasını aç, bu iki değeri yapıştır. Lig adını da buradan değiştirebilirsin.

> Anon key'in sitede görünmesi normal ve güvenli. Kimin neyi değiştirebileceğini veritabanı kuralları belirliyor.

### 2) GitHub Pages (site)
1. GitHub'da **New repository** → isim ver (örn. `hali-saha-ligi`) → **Public** → Create.
2. **Add file → Upload files** → bu klasördeki tüm dosyaları sürükle (`index.html`, `app.js`, `style.css`, `config.js`, …) → **Commit**.
3. Repo'da **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main**, klasör **/(root)** → Save.
4. 1-2 dakika sonra siten şu adreste açılır: `https://KULLANICIADIN.github.io/hali-saha-ligi/`

### 3) Supabase'e site adresini tanıt
Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://KULLANICIADIN.github.io/hali-saha-ligi/`
- **Redirect URLs:** aynı adresi ekle.

(Böylece kayıt onay e-postalarındaki link seni siteye geri getirir.)

### 4) Kendini yönetici yap
1. Sitede **Giriş → Kayıt ol** ile hesap aç, e-postandaki onay linkine tıkla.
2. Supabase → **SQL Editor**'de şunu çalıştır (kendi e-postanı yaz):
   ```sql
   update public.profiles set role = 'admin' where email = 'senin@mailin.com';
   ```
3. Siteyi yenile. **Panel** sekmesinde yönetici ekranını göreceksin.

### 5) Ligi doldur
1. **Panel → Takımlar:** takımları ekle, **Logo** butonuyla logolarını yükle.
2. **Panel → Oyuncular:** takım seçip oyuncuları ekle (kaptanlar da kendileri ekleyebilir).
3. **Panel → Maç ekle:** hafta, tarih, saha, ev sahibi ve deplasman takımını gir.
4. Kaptanlara site linkini at, **kayıt olsunlar**. Onlar **Panel → Kullanıcılar**'da görünür. Rolü **Kaptan** yap, takımını seç, **Kaydet**.

---

## Her hafta nasıl işler?

1. Maçtan önce kaptan maça girip **kadroyu** işaretler.
2. Maçtan sonra **golleri** girer (golcü, asist, istersen dakika). Bitince **"Bilgileri tamamladım"** kutusunu işaretler.
3. Panelinde **"Onay bekleyen maçlar"** listesi çıkar. Maça girip kontrol edersin, **MVP**'yi seçersin, **Sonucu onayla** dersin.
4. Tablo ve krallıklar otomatik güncellenir. Herhangi bir sayfada **📸 Görsel olarak paylaş** butonuyla WhatsApp veya Instagram'a resim olarak atabilirsin.

**Kendi kalesine gol:** Golü yazılan takımın kaptanı girer. Golcü listesinde "Kendi kalesine (rakip oyuncu)" bölümünden seçer.

---

## Bilmen gerekenler
- **Ücretsiz limitler:** Supabase'in ücretsiz planı bir halı saha ligi için fazlasıyla yeter. Tek şart: proje **7 gün boyunca hiç kullanılmazsa uykuya geçer**. Lig arasında bu olursa Supabase panelinden **Restore** demen yeterli, veriler silinmez.
- **E-posta limiti:** Supabase'in kendi e-posta servisi saatte birkaç onay maili gönderir. Kaptanları aynı anda değil, birkaç dakika arayla kaydettir. İstersen **Authentication → Providers → Email → Confirm email** ayarını kapatıp onay mailini tamamen kaldırabilirsin.
- **Değişiklik yapmak:** GitHub'da dosyayı açıp ✏️ ile düzenle ve commit et, site 1 dakikada güncellenir.
- **Puanlama** (3/1/0) `config.js` içinde. Tabloda sıralama: puan → averaj → atılan gol.
- **Kendi alan adın** (örn. `ligim.com`) istersen GitHub Pages ayarlarından bağlanabilir. Bu kısım ücretli ama şart değil.
