# SETUP_GUIDE.md: Two Homes Preflight (aap ke liye)

Yeh guide sirf aap ke liye hai. Is mein woh saara kaam hai jo Claude Code ko implementation dene se **pehle** aap ne khud karna hai, taake Claude Code ke tokens installation aur account banane mein zaya na hon.

- Commands English mein hain, explanation Roman Urdu mein.
- Sab commands **Windows PowerShell** ke liye hain (VS Code ka built-in terminal bhi PowerShell hi hota hai: menu Terminal, phir New Terminal).
- **Zero-purchase:** is guide mein kahin bhi kuch khareedna nahi hai. Agar koi service card maange to ruk jayein aur mujhe batayein.
- **Secrets kabhi chat mein paste na karein** (na Claude.ai mein, na GitHub par). Sirf apni machine ki `.env.local` file mein.
- Andaza: poora setup 3 se 4 ghante. Sab se lamba kaam DNS verification aur PayPal sandbox hai, is liye unhein pehle shuru karein.

## Workflow: pehle poora setup, phir Claude Code

Haan, aap ka samajhna sahi hai. Tarteeb yeh hai:

| Stage | Kaun | Kya |
| --- | --- | --- |
| 1. Setup | **Aap** | Is guide ke saare steps: software, accounts, project banana, packages, Firebase/PayPal/Resend/Cloudinary/ngrok config, `.env.local`, skills, docs files project mein rakhna. Section M ka checklist poora |
| 2. Phase 0 | Claude Code | Sirf check karta hai ke setup sahi hai (kuch install nahi karta), npm scripts aur `README.md` banata hai, report deta hai |
| 3. Phase 1 se 4 | Claude Code | Har phase mein sirf us phase ki file (`docs/phases/...`) aur us ki listed spec files parhta hai, code + tests likhta hai, report deta hai |
| Har phase ke baad | **Aap** | App phone aur desktop par chala kar dekhein, report parhein, phir agla phase approve karein |

Kuch kaam setup ke baad beech mein bhi aayenge (Claude Code yaad dilayega): Phase 1 ke baad Render service banana aur Prod PayPal webhook lagana, Phase 0 ke baad agreement PDF export karna, Phase 4 mein plan id env mein daalna aur video record karna.

## Tarteeb (is order mein karein)

1. Section J: accounts ka faisla (5 min)
2. Section A: software install (30 min)
3. Section G: Resend domain add karein aur DNS records daal dein (DNS mein ghante lag sakte hain, is liye jaldi)
4. Section H: PayPal sandbox (45 min)
5. Section E: Firebase (30 min)
6. Section F: Cloudinary (10 min)
7. Section A/B: project banana, folders, packages (40 min)
8. Section C, D, S: APIMatic plugin, AG Grid check, Claude Code skills (20 min)
9. Section I: ngrok (15 min)
10. Section K: `.env.local` bharna (15 min)
11. Section M: final checklist, phir Claude Code ko handover

---

# A. Software aur project setup

## A.0 PowerShell ki ek dafa ki settings

VS Code mein terminal kholein (Terminal, phir New Terminal) aur yeh chalayein:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
git config --global core.autocrlf true
```

Pehli line ke baghair PowerShell `npx` aur `npm` scripts ko "running scripts is disabled" keh kar rok sakta hai. Doosri line Windows aur GitHub ke line endings ka masla rokti hai. (Agar Git abhi install nahi to doosri line A.1 ke baad chalayein.)

## A.1 Software install karein

| Software | Kyun | Kahan se | Check command |
| --- | --- | --- | --- |
| **Node.js 24 LTS** | Next.js chalane ke liye | nodejs.org/en/download par version **24** chun kar Windows Installer (.msi) | `node -v` (v24.x aana chahiye), `npm -v` |
| **Git** | Version control | `winget install --id Git.Git -e` (ya git-scm.com) | `git --version` |
| **VS Code** + **Claude Code extension** | Aap ka editor aur Claude Code | Pehle se hai | |
| **Java JDK 21** (Eclipse Temurin) | Sirf automated tests ke liye: tests local Firebase emulator par chalte hain aur emulator Java par chalta hai. Aap ko khud Java ya emulator kabhi use nahi karna (Section E.0) | `winget install --id EclipseAdoptium.Temurin.21.JDK -e` (ya adoptium.net se installer, "Set JAVA_HOME" tick karein) | `java -version` |
| **ngrok** | Local par PayPal webhooks receive karne ke liye | `winget install --id ngrok.ngrok -e` (Section I) | `ngrok version` |

Har install ke baad VS Code poori tarah band karke dobara kholein, warna naya program terminal ko nahi milta. Agar `node -v` purana version dikhaye (jaise 20 ya 22), to Node 24 install karein.

## A.2 Project banayein

Apne projects wale folder mein jayein (jaise `D:\projects`), phir:

```powershell
cd D:\projects
npx create-next-app@16.4.5 two-homes-preflight --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
cd two-homes-preflight
```

Agar yeh kuch aur poochay (Turbopack, React Compiler waghera), to default chunein, lekin **React Compiler: No**.

Ab exact versions pin karein (Next ka security patch 16.4.5 mein hai, aur TypeScript 6 hum ne safe choice ke taur par rakha hai):

```powershell
npm install -E next@16.4.5 react@19.3.1 react-dom@19.3.1
npm install -D -E typescript@6.0.3 @types/node@24.19.2 @types/react@19.3.0 @types/react-dom@19.3.0
```

`-E` ka matlab hai exact version (bina `^`). Is hafte surprise updates nahi chahiye.

## A.3 Packages install karein

Yeh aap khud install karein, taake Claude Code ko na karna pare. Project folder ke andar:

```powershell
npm install -E firebase@13.2.0 firebase-admin@14.5.0 zod@4.6.7 server-only@0.0.1 @google/genai@2.32.0 @paypal/paypal-server-sdk@2.5.0 @paypal/react-paypal-js@10.6.1 cloudinary@2.11.0 resend@6.37.0 ag-grid-community@36.3.0 ag-grid-react@36.3.0 unpdf@2.1.0 geist@1.9.2 next-themes@0.4.6 motion@14.10.1

npm install -D -E vitest@5.1.0 @vitest/coverage-v8@5.1.0 @playwright/test@1.65.0 msw@3.0.4 firebase-tools@15.35.0 tsx@4.23.15

npx playwright install chromium
```

Note: `@google/genai` ka 3.0.0 Nov 6 ko aaya hai, is liye jaan boojh kar 2.32.0 rakha hai. `motion` animations ke liye hai (Section S).

`firebase-tools` (Firebase CLI) yahan **dev dependency** ke taur par install ho raha hai, global install ki zaroorat nahi. Isay hamesha `npx firebase ...` se chalana hai (Section E.0).

## A.4 shadcn/ui setup

```powershell
npx shadcn@4.23.0 init
```
Sawal aayein to: style default, base color **Neutral**, CSS variables **Yes**. (Hamare colors Claude Code baad mein tokens ke zariye set karega.)

Phir base components ek hi baar mein:
```powershell
npx shadcn@4.23.0 add button input label textarea select checkbox radio-group dialog drawer sheet badge card tabs sonner dropdown-menu separator skeleton tooltip avatar progress alert
```
Is se `lucide-react`, `sonner`, `vaul` aur Radix packages khud install ho jayenge.

## A.5 Build check

```powershell
npm run build
```
Yeh pass hona chahiye. Agar TypeScript ki wajah se error aaye to mujhe error bhejein (secrets nahi).

## A.6 Git aur GitHub

`create-next-app` git pehle hi init kar deta hai. Ab:

1. GitHub par **private** repo banayein: `two-homes-preflight` (README/gitignore add na karein).
2. `.gitignore` kholein. Us mein `.env*` pehle se hoga. Neeche yeh lines add karein:
```gitignore
!.env.example
firebase-debug.log
firestore-debug.log
ui-debug.log
.firebase/
/test-results/
/playwright-report/
/coverage/
*.service-account.json
```
3. Phir:
```powershell
git add .
git commit -m "chore: scaffold Next.js 16 project with dependencies"
git branch -M main
git remote add origin https://github.com/huzaifazahid1/two-homes-preflight.git
git push -u origin main
```

---

# B. Folders aur files (aap kya banayein, Claude Code kya banaye)

## B.1 Folders jo aap banayein

Project root mein:
```powershell
New-Item -ItemType Directory -Force docs\spec, docs\phases, scripts, fixtures\agreement, fixtures\receipts, fixtures\ai, tests\unit, tests\integration, tests\api, tests\e2e, tests\helpers, .claude\skills, .github\workflows | Out-Null
```
`src/` ke andar ke folders (`lib`, `components` waghera) **mat banayein**. Claude Code unhein files ke saath banayega; khali folders se koi faida nahi.

## B.2 Files jo aap rakhein

`two-homes-preflight-docs.zip` ko project root (`D:\projects\two-homes-preflight`) mein extract karein (right-click, "Extract All"). Is se neeche wali files sahi folders mein aa jayengi. Agar Windows poochay ke `docs` folder already hai, to "merge" kar dein.

| File | Kya karna hai |
| --- | --- |
| `CLAUDE.md` | Main ne di hai (chhoti core file). Project root mein rakhein. Claude Code isay har session mein khud parhta hai |
| `docs/spec/*.md` (12 files) | Detail specs (data model, PayPal, UI design waghera). `docs\spec\` mein rakhein. Claude Code sirf zaroorat par parhta hai |
| `docs/phases/*.md` (5 files) | Har phase ki apni file. `docs\phases\` mein rakhein |
| `docs/demo-script.md` | Demo video ka script. `docs\` mein rakhein |
| `SETUP_GUIDE.md` | Yeh file. Root mein rakh sakte hain; Claude Code isay nahi parhta |
| `.env.example`, `.env.test` | Package mein ready hain. Root mein rakhein. Dono commit hongi (in mein koi secret nahi) |
| `.env.local` | Wahi structure, asli values ke saath (Section K). **Kabhi commit nahi** |
| `fixtures/agreement/demo-agreement.pdf` | Synthetic agreement (B.4) |
| `fixtures/receipts/` | 3 synthetic receipts (B.4) |

## B.3 Configuration jo aap tayyar karein

Firebase (`firebase.json`, `firestore.rules`, `firestore.indexes.json` Section E.5 se banenge), PayPal apps aur webhooks, Resend domain, Cloudinary keys, ngrok domain, Render account.

## B.4 Synthetic demo files (zaroori, AI isay nahi bana sakta)

- **Agreement PDF:** Claude Code Phase 0 mein `fixtures/agreement/demo-agreement.md` likh dega (6 pages, fake names Alex, Sara, Mia). Aap usay Google Docs ya Word mein paste karke **PDF download** kar ke `fixtures/agreement/demo-agreement.pdf` mein rakhein. Agar abhi karna ho to main bhi woh text likh sakta hoon.
- **Receipts:** 3 fake receipts: (1) "Riverside FC Soccer Camp" $350, (2) "Bright Smile Dental" $120, (3) wahi soccer receipt dobara (duplicate test ke liye). Google Docs mein simple receipt bana kar screenshot (JPG/PNG) le lein, ek PDF bhi export kar lein. Asli receipts ya asli naam kabhi use na karein.

## B.5 Claude Code ke liye chhorein

`src/` ka saara code, API routes, Firestore rules ka content, indexes, tests, scripts (`setup-paypal-plans.ts`, seed, reset, invariants), GitHub workflows, README aur `docs/*`.

---

# C. APIMatic (sirf PayPal Context Plugin)

Hum APIMatic ka dashboard, portal ya SDK generation **use nahi kar rahe**. Sirf Context Plugin, jo Claude Code ko PayPal Server SDK ki taaza documentation deta hai.

1. Project root mein terminal kholein:
```powershell
npx context-plugins install paypal
```
2. APIMatic ke mutabiq yeh plugin Claude Code, Cursor, VS Code aur Codex ke liye install hota hai. Agar login ya account maange to apne Gmail se free sign-up karein. **Agar card ya paid plan maange to chhor dein**: plugin zaroori nahi, Claude Code PayPal docs se bhi kaam kar lega.
3. VS Code mein Claude Code panel kholein aur type karein: `/mcp`. List mein PayPal context plugin "connected" dikhna chahiye. Na dikhe to VS Code window reload karein (Ctrl+Shift+P, "Reload Window").
4. Agar is ne project mein koi config file (jaise `.mcp.json`) banayi ho to usay commit kar dein, bas check kar lein ke us mein koi key na ho.
5. Ek screenshot rakh lein jis mein `/mcp` par plugin connected dikh raha ho (README aur Devpost ke liye).

Claude Code ko kuch alag dene ki zaroorat nahi: `CLAUDE.md` Section J mein likha hai ke kab isay use karna hai.

---

# D. AG Grid

- Edition: **Community** (MIT, free). Packages: `ag-grid-community` aur `ag-grid-react` 36.3.0. Yeh A.3 mein install ho chuke hain.
- `ag-grid-enterprise` **kabhi install na karein**. Check:
```powershell
npm ls ag-grid-enterprise
```
"empty" aana chahiye.
- Enterprise feature use hone ki nishani: browser console mein licence warning ya grid par watermark. Aisa dikhe to Claude Code ko batayein.
- Community mein milta hai: sorting, text/number/date filters, quick search, pagination, row selection, CSV export, custom cell renderers, column pinning/resizing, theming. Nahi milta: Excel export, row grouping, pivot, set filter, master-detail, charts.
- Configuration (module registration, theme) Claude Code karega; aap ko kuch configure nahi karna.

---

# E. Firebase aur Firestore

## E.0 Firebase: kya remote rahega, kya local (pehle yeh samjhein)

Aap pehle jaise kaam karte aaye hain, **woh hi rahega**: data, users, Auth settings sab **remote** Firebase project mein, aur Console se aap sab dekh sakte hain. Kuch bhi "local" shift nahi ho raha.

| Cheez | Kahan | Kaise |
| --- | --- | --- |
| App ka data (`npm run dev` ke waqt bhi) | **Remote** Firebase project | Bilkul pehle jaisa. Console mein data dikhega |
| Auth providers, authorized domains, users dekhna | **Remote**, Firebase Console | Aap Console se karenge (E.2) |
| Security rules aur indexes | Repo ki files (`firestore.rules`, `firestore.indexes.json`) mein likhe jayenge, phir **remote** par deploy | Claude Code `npm run firebase:deploy-rules` chalayega (aap se pooch kar). Console mein inhein haath se edit **na** karein, warna repo aur Console alag ho jayenge |
| Automated tests | **Local emulator** (aap ke computer par ek nakli Firestore/Auth) | Claude Code ke test scripts khud start aur band karte hain |

**Emulator kyun?** Claude Code saikron tests chalayega jo documents banate aur delete karte hain. Agar yeh real project par chalein to (1) aap ka asli data ganda ya delete ho sakta hai, (2) Spark free plan ki daily limit (20,000 writes, 50,000 reads) tests hi kha jayenge, aur (3) security rules deploy kiye baghair test nahi ho sakte. Emulator yeh sab aap ke computer par alag se karta hai. Aap ko isay kabhi khud chalana ya dekhna nahi, bas Java install hona chahiye.

**Firebase CLI kyun?** Do kaam: emulator chalana (tests ke liye) aur rules/indexes repo se deploy karna. Baqi sab Console mein hi hoga. CLI `firebase-tools` package hai jo A.3 mein install ho chuka hai; ek dafa `npx firebase login` karna hai (E.5).

**Yaad rakhein:** sirf **Authentication** aur **Cloud Firestore**. **Realtime Database aur Storage enable nahi karne.** Console kabhi "Get started with Storage" ya "Realtime Database" dikhaye to ignore karein. Project **Spark (free)** plan par hi rahe; "Upgrade to Blaze" kabhi na dabayein.

## E.1 Project banayein
1. console.firebase.google.com par apne Gmail se jayein.
2. "Create a project": naam `two-homes-preflight`. Google Analytics: **Off**.
3. Project Overview par **Web app** (`</>` icon) add karein: nickname `two-homes-web`. "Firebase Hosting" tick **na** karein.
4. Jo `firebaseConfig` dikhe, us se yeh values note karein: `apiKey`, `authDomain`, `projectId`, `appId`, `messagingSenderId`. Yeh `NEXT_PUBLIC_FIREBASE_*` mein jayengi (public hain, rules se protected).

## E.2 Authentication
1. Build, phir Authentication, phir Get started.
2. Sign-in method: **Email/Password** enable. **Google** enable (support email: aap ka Gmail).
3. Settings, phir User account linking: "**Link accounts that use the same email**" (ek email ka ek hi account).
4. Settings, phir Authorized domains: `localhost` pehle se hoga. Baad mein add karein: aap ka ngrok domain (Section I) aur Render domain (deploy ke baad).
5. Email link (passwordless) abhi enable na karein (yeh joined co-parent ke liye hai, baad mein agar waqt bacha).

## E.3 Cloud Firestore
1. Build, phir Firestore Database, phir Create database.
2. Edition puchay to **Standard**.
3. Location: **`nam5 (United States)`**. Users US ke hain aur PayPal sandbox bhi US hai. Yeh baad mein badal nahi sakti.
4. Rules: **Production mode** (sab band). Hamare asli rules Claude Code `firestore.rules` mein likhega aur deploy karega.

## E.4 Service account (server ke liye)
1. Project settings (gear), phir Service accounts, phir "Generate new private key". JSON download hogi.
2. Is file ko **project folder ke bahar** rakhein (jaise `D:\secrets\two-homes.service-account.json`). Kabhi commit na karein.
3. Is mein se `project_id`, `client_email`, `private_key` `.env.local` mein copy karein (Section K). `private_key` ko poora, double quotes ke andar, `\n` ke saath ek line mein rakhein.

## E.5 Firebase CLI: login aur init (ek dafa)
```powershell
npx firebase login
npx firebase init
```
Login browser mein aap ke Google account se hoga.
- Features: **Firestore** aur **Emulators** (space se select). Hosting, Storage, Realtime Database, Functions **select na karein**.
- "Use an existing project": `two-homes-preflight`.
- Firestore rules file: `firestore.rules` (default). Indexes file: `firestore.indexes.json` (default).
- Emulators: **Authentication** aur **Firestore** select karein. Ports default (Auth 9099, Firestore 8080). Emulator UI: Yes (port 4000). "Download emulators now": Yes.

Ek dafa check (sirf yeh dekhne ke liye ke Java aur emulator theek hain):
```powershell
npx firebase emulators:start
```
Browser mein `http://127.0.0.1:4000` khulna chahiye. Phir terminal mein Ctrl+C se band kar dein. Is ke baad emulator aap ko khud kabhi chalana nahi; tests chalate waqt Claude Code ke scripts khud chalayenge. (Java nahi hoga to yahan error aayega. Windows Firewall poochay to "Allow" kar dein.)

Check karein ke CLI sahi project dekh raha hai:
```powershell
npx firebase projects:list
```

**Snapshot listeners (real-time):** yeh remote Firestore par hi chalte hain, koi setup nahi chahiye. Inhein banana Claude Code ka kaam hai (Phase 3).

## E.6 Gemini API key (Google AI Studio)
1. aistudio.google.com par apne Gmail se jayein, "Get API key", phir "Create API key" (isi Firebase project ke Google Cloud project mein, ya naye mein; dono free).
2. Key `GEMINI_API_KEY` mein. Model list mein se current **Flash** model ka exact id `GEMINI_MODEL` mein likhein.
3. Free tier ka data Google apne products behtar karne ke liye use kar sakta hai, is liye **sirf synthetic data**. Asli agreement kabhi upload na karein.

---

# F. Cloudinary

1. cloudinary.com par free sign-up (agar "Sign up with Google" ho to apne Gmail se).
2. Dashboard par **Cloud name** dikhega. Settings, phir **API Keys**: **API Key** aur **API Secret** (secret sirf `.env.local` mein).
3. Settings, phir **Security**: "**Allow delivery of PDF and ZIP files**" ON karein. Free accounts par PDF delivery by default band hoti hai, aur hamari receipts PDF bhi ho sakti hain.
4. **Upload preset nahi banana.** Hum upload browser se nahi, apne server se karte hain (zyada secure).
5. Test (optional): Media Library mein ek synthetic receipt drag-drop kar ke dekh lein, phir delete kar dein. Asli upload flow ka test Claude Code Phase 3 mein karega.
6. Free limits: ~30 din ki rolling window mein credits (1 credit = 1 GB storage ya 1 GB bandwidth ya 1,000 transformations). Hamari receipts chhoti hain, masla nahi hoga.

Values: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER_PREFIX=two-homes/dev` (local) aur `two-homes/prod` (Render).

---

# G. Resend (email) with `huzaifalabs.site`

**Faisla:** subdomain **`mail.huzaifalabs.site`**. Root domain ko haath nahi lagega, is liye aap ki portfolio website aur us ki koi bhi email bilkul waisi hi rahegi. Naya domain khareedne ki zaroorat nahi.

**Kyun zaroori hai:** Resend ka default `resend.dev` sirf **aap ke apne** Resend account wale email par bhej sakta hai. Sara (co-parent) tak email nahi jayegi.

## G.1 Account aur domain
1. resend.com par sign-up (agar Google/GitHub sign-in option ho to woh, warna wahi Gmail).
2. **Domains**, phir **Add Domain**: `mail.huzaifalabs.site`. Region default.
3. Resend kuch DNS records dikhayega (aam taur par: ek **MX** aur ek **TXT (SPF)** record `send.mail` naam par, aur ek **TXT (DKIM)** record `resend._domainkey.mail` naam par). **Jo Resend dikhaye wahi exact copy karein**, meri list nahi.

## G.2 DNS records kahan daalne hain (Hostinger ya Cloudflare)
Aap ne domain Hostinger se liya aur Cloudflare se link kiya tha. Pehle check karein ke **nameservers** kis ke hain:

- Hostinger hPanel, phir Domains, phir `huzaifalabs.site`, phir **Nameservers**.
  - Agar nameservers `xxx.ns.cloudflare.com` hain: records **Cloudflare** mein daalne hain.
  - Agar Hostinger ke hain (`ns1.dns-parking.com` jaise): records **Hostinger ke DNS Zone** mein.
- Ya terminal se: `nslookup -type=ns huzaifalabs.site`

**Cloudflare mein:** dash.cloudflare.com, phir `huzaifalabs.site`, phir DNS, phir Records, phir Add record. Name field mein sirf subdomain hissa likhein (jaise `send.mail` ya `resend._domainkey.mail`); Cloudflare baqi khud jorr deta hai. TXT/MX records proxy nahi hote; agar koi CNAME ho to **Proxy status: DNS only** (grey cloud). Agar Resend "Cloudflare ke saath auto-configure" ka option dikhaye to woh bhi use kar sakte hain.

**Hostinger mein:** hPanel, phir Domains, phir DNS / Nameservers, phir DNS records, phir type chun kar Name aur Value daalein.

Optional (deliverability behtar): TXT record name `_dmarc.mail`, value `v=DMARC1; p=none;`

## G.3 Verify aur API key
1. Resend mein **Verify** dabayein. Kuch minute se kuch ghante lag sakte hain. Check: `nslookup -type=txt resend._domainkey.mail.huzaifalabs.site`
2. **API Keys**, phir Create: permission **Sending access**, domain `mail.huzaifalabs.site`. Key `RESEND_API_KEY` mein.
3. Sender: `Two Homes Preflight <notifications@mail.huzaifalabs.site>` (`EMAIL_FROM`). Is address ka inbox hona zaroori nahi; replies parent ke apne email par jayengi (Reply-To).
4. Test email Claude Code Phase 1 mein bhejega (aap ke doosre Gmail par).

## G.4 Free limits aur fallback
- 100 emails/din, 3,000/mahina, 3 domains, 10 requests/second.
- Agar DNS access ka masla ho aur verification na ho saki: app phir bhi chalegi, kyunke har invite/approval/payment link par "**Copy link**" hai. Sirf aap ke apne email par real emails jayengi. Mujhe bata dein, main plan adjust kar dunga. Koi naya domain nahi khareedna.

---

# H. PayPal Developer (sandbox)

**Hamara model (pehle se tay):** Parent A pays, phir hamari app (platform business account) mein paisa aata hai, phir Payouts se Parent B ko jata hai. Partner Referrals / seller onboarding **nahi**. Parents ke personal accounts hain, sirf platform business account hai.

**"Connect your PayPal account"** ka matlab: parent ek dafa **Log in with PayPal** se apna account connect karta hai (hum us ka PayPal ID aur email save karte hain), phir har payout usi par jata hai. Is ke liye app settings mein Log in with PayPal enable karna hai (H.4).

Sab kuch **Sandbox** mein. **Live tab ko kabhi haath na lagayein.** (Live mein Pakistan ke accounts par receiving aur Payouts approval ki pabandiyan hain; hackathon ke liye zaroorat nahi.)

## H.1 Login
developer.paypal.com par apne PayPal account se login (yahan Google sign-in nahi hota). Top par toggle **Sandbox**.

## H.2 Sandbox accounts (pehle accounts, phir apps)
Testing Tools, phir **Sandbox Accounts**, phir **Create account**. Teen accounts banayein, sab **United States**:

| Account | Type | Balance | Kaam |
| --- | --- | --- | --- |
| `platform` | **Business** | $10,000 | Hamari app ka account. Payments aata hai, payouts jata hai |
| `alex` | Personal | $2,000 | Parent A (owner) |
| `sara` | Personal | $2,000 | Parent B (co-parent) |

Har account ka email/password note karein (sandbox ke hain, asli nahi). Platform account mein balance zaroori hai, warna payouts fail honge.

## H.3 Do apps banayein
Apps & Credentials, phir **Create App**:
1. Naam `Two Homes Dev`, type **Merchant**, sandbox business account: **platform** wala. Client ID aur Secret note karein (local `.env.local` ke liye).
2. Naam `Two Homes Prod`, type Merchant, wahi **platform** account. Is ke Client ID/Secret Render ke liye.

Do apps is liye ke local (ngrok) aur production (Render) ke webhooks aur credentials alag rahein.

## H.4 App features (dono apps mein)
App kholein, phir Features / Sandbox app settings:
- **Accept payments**: on.
- **Payouts**: agar list mein option hai to on.
- **Subscriptions / Billing / Vault** jaisa koi option ho to on.
- **Log in with PayPal**: on, phir **Advanced settings**:
  - **Return URL**: Dev app mein `https://<aap-ka-ngrok-domain>.ngrok-free.app/connect/paypal/callback` (Section I ke baad). Prod app mein `https://<render-service>.onrender.com/connect/paypal/callback` (deploy ke baad).
  - Information requested: **Email**, **Account verification status**, **PayPal account ID (payer ID)**.
  - Save.

Agar "Log in with PayPal" option nahi milta ya save nahi hota: screenshot le kar mujhe batayein. Fallback (PayPal email do dafa type karna) `CLAUDE.md` mein pehle se hai.

## H.5 Webhooks
App mein, phir **Sandbox Webhooks**, phir Add Webhook:
- **Dev app:** URL `https://<aap-ka-ngrok-domain>.ngrok-free.app/api/webhooks/paypal`
- **Prod app:** URL `https://<render-service>.onrender.com/api/webhooks/paypal` (Phase 1 deploy ke baad)

Events select karein (exact naam):
- Payments: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `CHECKOUT.ORDER.APPROVED`
- Payouts: `PAYMENT.PAYOUTSBATCH.DENIED`, `PAYMENT.PAYOUTSBATCH.PROCESSING`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.BLOCKED`, `PAYMENT.PAYOUTS-ITEM.CANCELED`, `PAYMENT.PAYOUTS-ITEM.FAILED`, `PAYMENT.PAYOUTS-ITEM.HELD`, `PAYMENT.PAYOUTS-ITEM.REFUNDED`, `PAYMENT.PAYOUTS-ITEM.RETURNED`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`
- Subscriptions: `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED`
- Disputes: `CUSTOMER.DISPUTE.CREATED`

Save ke baad **Webhook ID** copy karein: dev wali `.env.local` mein, prod wali Render mein (`PAYPAL_WEBHOOK_ID`).

## H.6 Family plan
Plan PayPal par Claude Code ki script (`scripts/setup-paypal-plans.ts`) Phase 4 mein banayegi. Aap ka kaam: script ka output **plan id** `PAYPAL_FAMILY_PLAN_ID` mein daalna.

## H.7 Fee check (pricing ke liye zaroori)
Phase 4 ke pehle sandbox capture ke baad Claude Code fee record karega (`paypal_fee`). Usi se price aur covered volume final honge. Aap ne pehle $150 par ~$5.40 fee dekhi thi.

---

# I. ngrok (local webhooks)

1. ngrok.com par free sign-up (Google/GitHub sign-in available ho to woh).
2. Install: `winget install --id ngrok.ngrok -e` (agar A.1 mein nahi kiya). Phir VS Code band karke dobara kholein.
3. Dashboard se **authtoken** copy karein:
```powershell
ngrok config add-authtoken <AAP_KA_TOKEN>
```
4. Dashboard, phir **Domains**: free plan mein ek **static dev domain** milta hai (jaise `xyz-abc.ngrok-free.app`). Yeh restart ke baad bhi wahi rehta hai, is liye PayPal mein URL ek hi dafa daalna hai.
5. Chalane ka tareeqa (app `npm run dev` par port 3000 par chal rahi ho):
```powershell
ngrok http --url=xyz-abc.ngrok-free.app 3000
```
6. Yeh domain in jagahon par daalein: PayPal **Dev** app ka webhook URL aur Log in with PayPal Return URL (Section H), Firebase **Authorized domains** (Section E.2), aur jab ngrok se test karein to `.env.local` mein `APP_URL`, `NEXT_PUBLIC_APP_URL`, `PAYPAL_CONNECT_RETURN_URL`.
7. Free limits: 1 GB/mahina, 20,000 requests/mahina. Browser mein pehli dafa ek warning page aata hai, "Visit" dabayein (7 din yaad rehta hai). PayPal webhooks par is ka asar nahi.
8. **ngrok URL kabhi production config mein nahi.** Render ka apna URL hoga.

---

# J. Accounts aur email ka intezam

Ek hi Gmail sab jagah use karein. Jahan "Continue with Google/GitHub" ho, woh use karein. Naye email accounts banane ki zaroorat nahi. Passwords browser ke password manager (ya Bitwarden free) mein.

| Service | Kaise sign-in karein | Note |
| --- | --- | --- |
| Firebase / Google Cloud / AI Studio | Google account (wahi Gmail) | Ek hi Google account se teeno |
| GitHub | Aap ka maujooda account (`huzaifazahid1`) | |
| Render | **GitHub se sign-in** | Deploy ke liye repo connect karna asaan |
| Cloudinary | Google sign-in agar dikhe, warna wahi Gmail | |
| Resend | Google/GitHub agar dikhe, warna wahi Gmail | |
| ngrok | Google/GitHub agar dikhe | |
| APIMatic | Sirf agar plugin login maange | |
| PayPal Developer | **Sirf PayPal account** (Google sign-in nahi hota) | Aap ka maujooda PayPal account |
| PayPal sandbox accounts | Fake emails jo sandbox banata hai | Asli inbox nahi; inhein sirf PayPal sandbox login mein use karein |

**Email testing ke liye:** co-parent "Sara" ke liye app mein apna **doosra** email chahiye jahan OTP aur invite pahunchein. Agar alag Gmail nahi banana, to Gmail ka plus-trick use karein: `aapkagmail+sara@gmail.com` bhi aap ke hi inbox mein aata hai, aur app usay alag email samjhegi. Naya account nahi banana parega.

**Render setup** (free, Phase 1 mein deploy hoga, account abhi bana lein):
1. render.com par GitHub se sign-up.
2. Phase 1 ke waqt: New, phir **Web Service**, phir repo `two-homes-preflight`. Runtime Node. Build command `npm ci && npm run build`, start command `npm run start`. Instance type **Free**. Environment mein `NODE_VERSION=24` aur saare production env variables.
3. Free service 15 minute idle rehne par so jati hai; pehli request par ~1 minute lagta hai. Demo se pehle URL khol kar jaga dein.
4. Deploy ke baad Render URL ko PayPal Prod app (webhook + Return URL) aur Firebase Authorized domains mein add karein.

---

# K. Environment variables checklist

`.env.example` package se root mein rakh chuke hain (B.2). Ab:
```powershell
Copy-Item .env.example .env.local
```
Ab `.env.local` VS Code mein khol kar asli values bharein. **Emulator wale variables (`FIRESTORE_EMULATOR_HOST` waghera) `.env.local` mein kabhi na daalein**: yeh sirf tests ki `.env.test` file mein hote hain (Claude Code banayega). Agar `.env.local` mein aa gaye to app real Firebase ki jagah emulator se baat karne lagegi. Neeche har value ka source:

| Variable | Kahan se | Public / Secret | Kahan rakhni hai |
| --- | --- | --- | --- |
| `APP_URL`, `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` (ya ngrok URL) | Public | `.env.local`; Render mein Render URL |
| `DEV_SECRET`, `JOB_SECRET`, `LINK_SESSION_SECRET`, `OTP_PEPPER` | Khud generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (har ek ke liye alag) | Secret | `.env.local`; Render mein **naye** values; `JOB_SECRET` GitHub repo secret mein bhi |
| `NEXT_PUBLIC_FIREBASE_*` (5) | Firebase web app config (E.1) | Public | `.env.local`, Render |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Service account JSON (E.4) | Secret (email nahi, key haan) | `.env.local`, Render |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | AI Studio (E.6) | Key secret | `.env.local`, Render |
| `PAYPAL_CLIENT_ID`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Dev app (local), Prod app (Render) | Secret sirf client secret | Dono jagah alag values |
| `PAYPAL_WEBHOOK_ID` | Har app ka apna webhook (H.5) | Not secret, environment specific | Dono jagah alag |
| `PAYPAL_ENV=sandbox`, `PAYPAL_API_BASE=https://api-m.sandbox.paypal.com` | Fixed | Public | Dono |
| `PAYPAL_CONNECT_RETURN_URL` | Wahi jo PayPal app ke Return URL mein hai | Public | Dono (alag) |
| `PAYPAL_FAMILY_PLAN_ID` (+ `NEXT_PUBLIC_` copy) | Phase 4 script output | Public | Dono |
| `PLAN_COVERED_VOLUME_CENTS`, `FEE_PERCENT_BPS`, `FEE_FIXED_CENTS` | Placeholder defaults, baad mein confirm | Public | Dono |
| `RESEND_API_KEY` | Resend (G.3) | Secret | Dono |
| `EMAIL_FROM` | `Two Homes Preflight <notifications@mail.huzaifalabs.site>` | Public | Dono |
| `EMAIL_TRANSPORT` | Local `outbox` (real test ke waqt `resend`), Render `resend` | Public | Dono |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary (F) | Sirf secret secret hai | Dono |
| `CLOUDINARY_FOLDER_PREFIX` | `two-homes/dev` / `two-homes/prod` | Public | Dono |
| `DEMO_MODE` | Local `false`; demo deployment par `true` | Public | |

**Claude Code ke saath secrets kaise share hon:** Claude Code (VS Code extension) aap ki machine par chalta hai aur `.env.local` khud parh sakta hai. Bas itna kaafi hai. Secrets kabhi chat mein paste na karein, GitHub par push na karein, screenshots mein na aane dein. `CLAUDE.md` mein Claude Code ko hukm hai ke values kabhi print na kare.

---

# L. Kaam ki taqseem: aap vs Claude Code

## Aap khud karein (implementation se pehle)
- Software install: Node 24, Git, Java 21, ngrok, VS Code + Claude Code
- Saare accounts: Firebase/Google, AI Studio, PayPal Developer, Cloudinary, Resend, ngrok, Render, GitHub repo
- Project scaffold, version pinning, packages, shadcn init + components, build check
- Top-level folders, `CLAUDE.md`, `SETUP_GUIDE.md`, `.env.example`, `.env.local`
- Firebase project, Auth providers, Firestore (Standard, nam5, production mode), service account, `npx firebase login` + `init`, ek dafa emulator check
- Cloudinary keys + PDF delivery setting
- Resend domain + DNS + API key
- PayPal sandbox accounts (balance ke saath), do apps, Log in with PayPal settings, dev webhook + events
- ngrok static domain
- APIMatic Context Plugin + Claude Code skills (Section S)
- Synthetic receipts (aur Phase 0 ke baad agreement PDF export)

## Claude Code karega
- Saara application code: UI, design system, pages, API routes, business logic, validation
- Firestore rules, indexes, data access, listeners
- PayPal integration (orders, captures, payouts, subscriptions, connect, webhooks, reconcile), plan setup script
- Cloudinary upload flow, Gemini prompts/schemas, Resend templates
- Tests (unit, integration, API, E2E), invariant checker, seed/reset scripts
- GitHub Actions (CI, daily job), README aur `docs/*` har phase ke baad

## Baad mein aap ko karna hoga (Claude Code bataega)
- Phase 1 ke baad: Render service banana + env vars, Prod PayPal app ka webhook aur Return URL, Firebase authorized domain
- Phase 0 ke baad: agreement markdown ko PDF mein export
- Phase 4: plan id env mein daalna, platform sandbox balance check, video record karna, Devpost submit

---

# S. Claude Code Skills (frontend quality ke liye)

**Pehle ek correction:** pichli guide mein ek skill (frontend-design) thi, lekin poora plan nahi tha. Ab yeh section complete hai.

## S.1 Skills kya hain aur kya yeh faida dengi?

Skill ek folder hota hai jis mein `SKILL.md` instructions hoti hain. Claude Code har session mein sirf har skill ka **naam aur ek line description** parhta hai (bohat kam tokens). Poori skill tab load hoti hai jab kaam us se related ho. Is liye 3-4 achi skills rakhna sasta hai, lekin bohat saari random skills na daalein, warna Claude ghalat skill utha sakta hai.

Haan, frontend ke liye faida hai: yeh Claude Code ko generic "AI dashboard" look se bachati hain aur React/Next.js ke behtar patterns follow karwati hain. Lekin asal design decisions (colors, fonts, animations) pehle se `docs/spec/ui-design.md` mein likhe hain; skills unhein replace nahi karti, behtar implement karwati hain.

**Animations:** iske liye skill nahi, `motion` package (A.3 mein install) use hoga. Kaun si animations kahan hongi, woh `docs/spec/ui-design.md` mein likha hai (verdict badge, bottom sheets, list items, success check, dashboard totals count-up waghera).

## S.2 Recommended skills (sirf yeh 3)

| Skill | Kis ki | Kaam |
| --- | --- | --- |
| `frontend-design` | Anthropic (official) | Distinctive visual design, typography, layout; generic templates se bachata hai |
| `react-best-practices` | Vercel | React/Next.js performance aur patterns (Server Components, data fetching, bundle size) |
| `web-design-guidelines` | Vercel | UI review: accessibility, UX, interface guidelines. Har phase ke end par UI check ke liye |

Skip karein: `webapp-testing` (Python chahiye, hum Playwright Node mein use kar rahe hain), `react-view-transitions` (React ka experimental API, hackathon mein risk), aur random community "full-stack" skills (hamare CLAUDE.md se takra sakti hain).

## S.3 Install kaise karein (Windows, project-level)

Kab: Section B ke baad (project ban jaye), Claude Code ko handover se **pehle**.

```powershell
cd D:\projects
git clone --depth 1 https://github.com/anthropics/skills anthropic-skills
git clone --depth 1 https://github.com/vercel-labs/agent-skills vercel-skills

Copy-Item -Recurse anthropic-skills\skills\frontend-design two-homes-preflight\.claude\skills\
Copy-Item -Recurse vercel-skills\skills\react-best-practices two-homes-preflight\.claude\skills\
Copy-Item -Recurse vercel-skills\skills\web-design-guidelines two-homes-preflight\.claude\skills\
```

Check:
```powershell
Get-ChildItem two-homes-preflight\.claude\skills
```
Teen folders dikhne chahiye, har ek mein `SKILL.md`. Clone kiye gaye `anthropic-skills` aur `vercel-skills` folders baad mein delete kar sakte hain. `.claude\skills` ko git mein commit kar dein.

VS Code mein Claude Code panel kholein aur poochein: "Which skills are available in this project?" Teeno naam aane chahiyein. Na aayein to VS Code window reload karein (Ctrl+Shift+P, "Reload Window").

## S.4 Optional

- **shadcn MCP:** `npx shadcn@latest mcp init --client claude` (Claude Code ko shadcn components dhoondhne mein madad). Fail ho to chhor dein. shadcn.io ek alag paid product hai, woh nahi.
- PayPal Context Plugin (APIMatic) Section C mein hai.
- Zyada MCP servers na lagayein: skills ke ulat, MCP servers ka context har session mein load hota hai.

---

# Handover: Claude Code ko pehla message

Jab Section M ka checklist poora ho, Claude Code (VS Code) mein yeh bhejein:

> Read CLAUDE.md, then docs/phases/phase-0-verify-setup.md, and run Phase 0 only. Report what is ready and what is missing. Do not start Phase 1 until I confirm.

Agle phases ke liye message is tarah ka ho:

> Start Phase 1. Read docs/phases/phase-1-foundation.md and only the spec files it lists.

Har phase ke liye naya chat (Claude Code panel mein naya session) shuru karna behtar hai, taake purana context tokens na khaye. CLAUDE.md aur `docs/progress.md` se Claude Code ko pata hota hai ke kahan tak kaam hua.

Har phase ke baad Claude Code ki report parhein, phone aur desktop par app khud chala kar dekhein, phir agla phase approve karein.

---

# M. Final pre-implementation checklist

**Software**
- [ ] `node -v` = v24.x, `npm -v` chal raha hai
- [ ] PowerShell execution policy set (A.0)
- [ ] `git --version`, `java -version` (21), `ngrok version`
- [ ] VS Code mein Claude Code extension chal raha hai

**Project**
- [ ] `two-homes-preflight` bana, Next 16.4.5, React 19.3.1, TypeScript 6.0.3 pinned
- [ ] Section A.3 ke saare packages install, `npx playwright install chromium` done
- [ ] shadcn init + components added
- [ ] `npm run build` pass
- [ ] `.gitignore` update, private GitHub repo par push
- [ ] Top-level folders bane (B.1)
- [ ] `CLAUDE.md`, `.env.example` root mein; `docs\spec\` (12 files), `docs\phases\` (5 files), `docs\demo-script.md` jagah par
- [ ] `npm ls ag-grid-enterprise` empty

**Firebase**
- [ ] Project `two-homes-preflight` Spark plan par
- [ ] Web app registered, config values noted
- [ ] Email/Password + Google enabled, one account per email
- [ ] Firestore Standard, `nam5`, production mode
- [ ] Realtime Database aur Storage **enabled nahi**
- [ ] Service account JSON repo ke bahar, values `.env.local` mein
- [ ] `npx firebase login`, `npx firebase init` (Firestore + Emulators Auth/Firestore/UI), ek dafa `emulators:start` chala aur band kiya, `npx firebase projects:list` mein project dikh raha hai
- [ ] Gemini API key + model id

**Cloudinary**
- [ ] Cloud name, API key, API secret
- [ ] "Allow delivery of PDF and ZIP files" ON

**Resend**
- [ ] `mail.huzaifalabs.site` added, DNS records sahi jagah (Cloudflare ya Hostinger)
- [ ] Domain **Verified**
- [ ] API key (sending access)

**PayPal (sandbox)**
- [ ] Sandbox accounts: platform (business, $10,000), alex, sara (personal, US)
- [ ] `Two Homes Dev` aur `Two Homes Prod` apps, dono platform account se linked
- [ ] Features: accept payments, payouts (agar option), subscriptions/vault (agar option), Log in with PayPal (Return URL + email + verification status + payer ID)
- [ ] Dev app webhook (ngrok URL) + saare events + Webhook ID
- [ ] Credentials `.env.local` mein (Dev app)

**ngrok**
- [ ] Authtoken configured, static domain noted, `ngrok http --url=... 3000` chala

**Accounts**
- [ ] Render account (GitHub se)
- [ ] Testing ke liye doosra email (jaise `+sara` wala Gmail)

**Claude Code tools**
- [ ] APIMatic PayPal Context Plugin `/mcp` mein connected (ya skip ka faisla)
- [ ] Skills: `frontend-design`, `react-best-practices`, `web-design-guidelines` `.claude\skills\` mein (Section S)
- [ ] (Optional) shadcn MCP

**Demo files**
- [ ] 3 synthetic receipts `fixtures/receipts/` mein
- [ ] Agreement PDF (Phase 0 ke baad)

**Secrets**
- [ ] `.env.local` bhara hua, us mein koi emulator variable nahi, aur commit **nahi** hua (`git status` mein nahi dikhna chahiye)
- [ ] Koi secret chat ya GitHub par nahi

Sab tick ho jaye to Handover wala message bhej dein.
