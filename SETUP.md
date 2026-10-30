# Agent Reels 16 (lean) — setup and running

Agent Reels makes short, compliance-checked Instagram Reels for a life insurance agent selling final expense. The agent sets up once (who they help, how they sound, and their **topics**: each one a worry their clients have and the fact that answers it), ticks each topic's fact as true, then reviews, approves and posts, by hand or automatically to Instagram and Facebook. You run it from one server and help from the **Admin** tab.

```
/root/generator/
├── server.js        the site: logins, workspaces, the video line, Instagram, the portal
├── routes/          the site's routes, by area
├── admin.js         account tasks from the terminal
├── generate.js      make a video or test script from the terminal
├── pipeline.js      script → voice → footage → render → checks → review
├── mixer-core.js    the rules engine and the topics (portal and server share it)
├── templates.js     the eight starter final expense topics
├── niches/          what makes it about life insurance: the compliance floor and wording
├── comms-core.js    the communication playbook: DISC styles (portal and AI share it)
├── lib/             storage, logins, the queue, overnight jobs, setup, coach, alerts, Instagram
├── lib/prompts/     every prompt a video is written with, in one folder (section X)
├── stages/          each step of making a video
├── public/          the portal
├── test/            automatic checks (npm test)
├── update.sh        one-command update, with automatic rollback (section A)
├── setup-user.sh    run the app as its own user instead of root (section U)
├── data/            accounts, workspaces, settings, records (app.db)   ← backed up nightly
├── videos/          finished videos, one folder per workspace
├── backups/         nightly copies of data/
├── fonts/           caption fonts (downloaded automatically)
└── music/           optional royalty-free tracks
```

No npm packages are needed. It needs Node 22+, FFmpeg, pm2 and nginx.

---

## A. Install and update

### Update (the usual way)

The server runs the code from GitHub. To update:

```
cd /root/generator && bash update.sh
```

It backs up `data/`, pulls the newest version, runs all the checks, restarts, and makes sure the site answers. **If the checks fail or the site doesn't come back, the previous version is put back by itself.** Your data, videos, backups, `.env` and `.app-key` are never touched. If someone changed files by hand on the server, it stops and tells you which.

To go to one exact version: `bash update.sh <tag or commit>`.

### First install

```
cd /root/generator
cp .env.example .env        # then fill in PUBLIC_URL, OPENAI_API_KEY and PIXABAY_API_KEY
npm test
pm2 start server.js --name generator
pm2 save
pm2 startup                  # prints one command: copy and run it
node admin.js create-admin you@youremail.com
```

`create-admin` prints a password once. Log in at your site and change it under **Account**. You'll be asked to set up two-factor login: have an authenticator app ready and save the 10 backup codes. Save a copy of `.app-key` (created then) with your `.env`, in your password manager.

---

## B. nginx

nginx passes everything to port 3100. The site's `server { … }` block needs:

```
    client_max_body_size 200m;     # agents upload their own clips (Brand); everything else is small

    # A leader's lesson videos (Agent Reels → My people) are bigger: a few minutes from a phone.
    location /api/reels/lessons {
        client_max_body_size 500m;
        proxy_request_buffering off;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
```

Then `nginx -t && systemctl reload nginx`. Check it's up: `curl -s http://127.0.0.1:3100/api/health` answers `{"ok":true,"checks":{…}}` (section R).

Instagram downloads each video from your site while posting, so the site must stay reachable at its public **https** address.

## C. Adding the agent and a compliance reviewer

**The agent.** **Admin → Invite**: their email and a workspace name. Copy the link it shows and send it to them yourself (it works once, for 7 days). They set a password, then the guided setup takes about ten minutes: their name and city, who their clients are, how they sound, and then they **check their topics** (tick each fact that's true for what they sell). At least one checked topic is needed to finish; four or more keeps videos from repeating.

**A forgotten password.** **Admin → Reset link** next to their name, and send it to them. (There are no emails: every link is copied by hand.)

**A compliance reviewer** (optional). Some carriers want a compliance person to approve ads. The agent invites them in **Setup → Reviewer** and sends them the link. The reviewer only sees **Sign-off**. Once **Videos wait for sign-off** is on, approved videos don't post or download until the reviewer signs off, and they get a phone notification when one is waiting (if they turned notifications on in **Account**).

## E. Alerts on your phone

Everything that needs you shows in **Admin → Alerts**: a video that failed for good, a failed payment, a failed backup, low disk space, and an Instagram post that didn't go out. To also get them as phone notifications, the free **ntfy** app is the simplest:

1. Install **ntfy** on your phone and subscribe to a topic with a long, hard-to-guess name, like `agentreels-7f3k9q2m`. (Anyone who knows the name can read it.)
2. In `.env`:
   ```
   ALERT_WEBHOOK_URL=https://ntfy.sh/agentreels-7f3k9q2m
   ```
3. `pm2 restart generator --update-env`, then **Admin → Alerts → Send a test**.

A Slack or Discord webhook URL works too; the format is picked automatically. `LOW_DISK_GB` (default 3) sets when low disk space alerts you. The same alert isn't repeated within an hour.

## F. Instagram auto-posting

Agents connect their own Instagram once in **Brand → Instagram**. Then any approved video can **Post now** or be scheduled from **Review**, and a **posting plan** can post the oldest approved video on chosen days at a chosen time. Nothing is posted that the agent didn't approve. Their Instagram must be a **professional account** (Business or Creator; switching is free in Instagram's settings).

Instagram can't add a trending sound to automatic posts. Captions-only videos go out with a quiet audio track; voiceover videos post with their voice. The app tells agents this where it matters.

### 1. Create the Meta app

1. Go to **developers.facebook.com**, log in, and create a developer account if asked.
2. **My Apps → Create app**. Choose the use case **Manage messaging and content on Instagram**. Name it after your product (for example "Agent Reels").
3. In the app, open the Instagram use case's **API setup with Instagram login**.
4. Under **Set up Instagram business login** (business login settings), add the **OAuth redirect URI**. Copy it exactly from **Admin → Server → Instagram posting** once step 2 below is done; it is `https://yourdomain.com/api/instagram/callback`.
5. Copy the **Instagram app ID** and **Instagram app secret** shown on that page. (These are the Instagram ones, not the Facebook app ID at the top of the dashboard.)

Meta changes its dashboard wording now and then. If a menu name differs, look for "Instagram API with Instagram Login" and "business login settings".

### 2. Turn it on

In `.env`:

```
INSTAGRAM_APP_ID=…
INSTAGRAM_APP_SECRET=…
TOKEN_KEY=…            (run: openssl rand -hex 32, and paste the result)
```

`pm2 restart generator --update-env`. **Admin → Server** now shows **Instagram posting: OK** and the redirect URI. Each agent's Instagram key is stored encrypted with `TOKEN_KEY`, which isn't in `data/` or its backups. Don't change `TOKEN_KEY` later, or every agent has to reconnect.

### 3. Test with your own account

Until Meta reviews the app, only Instagram accounts with a role on it can connect.

1. In the app: **App roles → Roles → Add people → Instagram Tester**, and enter your Instagram username.
2. In Instagram on the web: **Settings → Apps and websites → Tester invites**, and accept.
3. In your own workspace: **Brand → Instagram → Connect Instagram**, approve, and you land back on Brand showing **Connected**.
4. Approve a video, then **Review → Post now**. It shows **Posting…** and, a minute or two later, moves to **Posted** with a link to the Reel.

### 4. Open it to your agents (App Review)

To let agents who aren't testers connect, the app needs **Advanced Access** to `instagram_business_basic` and `instagram_business_content_publish`, which means **App Review** and **Business Verification**:

- Complete **Business Verification** for your business in Meta Business settings.
- Add a **privacy policy URL** and an app icon in the app's basic settings.
- For **Data deletion**, choose *Data deletion instructions URL* and enter `https://yourdomain.com/data-deletion` (section M). Set `SUPPORT_EMAIL` first so the page shows where to write.
- Request Advanced Access for both permissions. For each, explain the use ("agents post Reels they approved in our app to their own Instagram account") and attach a short screen recording: connecting in Brand, approving a video, tapping Post now, and the Reel appearing on Instagram.
- When approved, switch the app to **Live**.

Review usually takes a few days and sometimes asks for changes. Until then, add each early agent as an Instagram Tester.

### Limits and troubleshooting

- Each account posts at most 10 videos a day through the app (Instagram's own limit is 50).
- Posting tokens are refreshed automatically before they expire (every 60 days). If an agent changes their Instagram password or removes the app, Brand shows **Reconnect** and you get an alert.
- A post that fails shows the reason on the video in **Review**, with **Post now** to try again, and alerts you.
- "Instagram posting needs PUBLIC_URL": set `PUBLIC_URL` to your https address and restart.

## AC. Facebook Page cross-posting

Works like Instagram auto-posting (section F), with Facebook's own login. Agents need a **Facebook Page** (not a personal profile) where they're an admin or editor.

**1. The Meta app.** You can use the same Meta app as Instagram. At **developers.facebook.com**, open the app:
1. Add the use case **Manage everything on your Page** (or add the product **Facebook Login for Business**).
2. Ask for the permissions `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`.
3. Under **Facebook Login → Settings**, add the **Valid OAuth redirect URI** exactly as **Admin → Server → Facebook posting** shows it: `https://yourdomain.com/api/facebook/callback`.
4. Copy the **App ID** and **App secret** from **App settings → Basic**. These are not the Instagram app ID and secret.

**2. Turn it on** in `.env`:

```
FACEBOOK_APP_ID=…
FACEBOOK_APP_SECRET=…
TOKEN_KEY=…            (the same one as for Instagram; set it once and never change it)
```

Then run `pm2 restart generator --update-env`. **Admin → Server** shows **Facebook posting: OK**. Agents see a **Facebook Page** panel in Brand.

**3. Test with your own Page** while the app is in development mode. Then send it for **App Review** with those three permissions before agents use it, the same way as Instagram (section F, step 4).

**How it posts.** Facebook downloads the video from the same signed, 3-hour link as Instagram. It's published as a Reel with the post text and, when the agent has a booking link, the video's tracking link. The app posts at most 10 Reels a day per Page; Facebook allows 30. If the agent changes their password or removes the app, posting pauses: you get an alert, and the agent sees **Reconnect** in Brand. A video sent back to review, or a Page that's disconnected, clears anything scheduled for it. If an agent manages several Pages, they pick one after logging in.

## G. Everyday use

- **Topics** (Setup → Topics): add a topic as a worry in the client's words plus the one fact that answers it. Open **More** to name the offer, a phrase it must always say (like "waiting period"), and who's in the footage. Videos only use topics whose fact is ticked as true. Changing a fact's words unticks it.
- **Create**: make videos now, pick the topic and format in **Studio**, or let a few be made overnight. The coach's weekly check-in is here too.
- **Review**: watch with sound, tick the checklist, approve or reject with a reason (it teaches the next scripts), fix one scene, mark posted, add views and messages a few days later.
- **Grow**: what's working, **Communicate** (how the clients like to be spoken to) and **Mindset**.

## H. Backups, disk and logs

- **Nightly backup** of `data/` (accounts, workspaces, settings, approval records) goes to `backups/`, 14 kept. Videos aren't in it; they're large and agents download what they post. A failed backup alerts you.
- **Off-site, encrypted copy** (section Q): set it up so a lost server doesn't mean lost data. Each nightly backup is encrypted and uploaded to cheap object storage, and once a week the newest copy is downloaded and checked.
- **Turn on Hetzner backups** too: Cloud Console → your server → **Backups** → Enable. It copies the whole server daily for about 20% of the server price.
- Now and then, download the newest file in `backups/` to your computer with SFTP, or run `node admin.js backup-now`.
- **Clean-up runs nightly**: rejected videos after 14 days, never-reviewed ones after 30, and video files 90 days after approval (the approval record stays). Change these in `.env` (`KEEP_…`).
- Keep logs from filling the disk: `pm2 install pm2-logrotate`
- Check free space any time in **Admin → Server**, or with `df -h /`.

## Q. Off-site encrypted backups

Nightly backups (section H) sit on the same server as the app. If the server is lost, so are they. With this set up, each nightly backup is also **encrypted and copied to object storage elsewhere**. A few cents a month covers it.

**What's in it.** The same as the nightly backup: `data/` (logins, workspaces, settings and their history, video records and approval records, the activity log, access requests). Video files aren't included. It's encrypted with AES-256-GCM before it leaves the server, so the storage company only ever sees scrambled bytes.

**1. Make a key** and save it in your password manager **before** anything else. Without it, nobody can read these backups, including you.
```
openssl rand -hex 32
```

**2. Make a bucket.** Any S3-compatible storage works. For example, Backblaze B2:
1. Create a **private** bucket (e.g. `agent-reels-backups`).
2. Under **Application Keys**, add a key limited to that bucket with read and write access.
3. Note the bucket's endpoint (e.g. `s3.us-west-004.backblazeb2.com`); the region is the middle part (`us-west-004`).

Cloudflare R2 (region `auto`), Wasabi, AWS S3 and DigitalOcean Spaces work the same way.

**3. Add to `.env`**, then `pm2 restart generator --update-env`:
```
BACKUP_KEY=<the 64 characters from step 1>
BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKUP_S3_BUCKET=agent-reels-backups
BACKUP_S3_REGION=us-west-004
BACKUP_S3_ACCESS_KEY=<keyID>
BACKUP_S3_SECRET_KEY=<applicationKey>
# BACKUP_S3_PREFIX=agent-reels/     (folder inside the bucket)
# BACKUP_S3_KEEP_DAYS=30            (older copies are removed; the newest 3 always stay)
```

**4. Test it now** instead of waiting for tonight:
```
cd /root/generator && node admin.js backup-now
```
It backs up, encrypts, uploads, then downloads the copy and checks it. You should see `uploaded agent-reels/data-….tar.gz.enc` and `restore test passed`. **Admin → Server → Off-site backup** shows the last upload and the last restore test.

**Every night** the new backup is uploaded and copies older than `BACKUP_S3_KEEP_DAYS` are removed. **Once a week** the newest copy is downloaded, decrypted and unpacked into a temporary folder (never over your live data). The check confirms the logins, workspaces, settings and video records all read correctly. If an upload or a restore test fails you get an alert, and the local backup is still in `backups/`.

**Restoring after a disaster** (new server, same steps as a first install in section A):
1. Install the app, then put your saved `.env` and `.app-key` back in `/root/generator/`. `.app-key` unlocks two-factor logins; without it, everyone's two-factor login has to be reset.
2. Download the newest `.tar.gz.enc` from your bucket (the provider's website works), and copy it to the server.
3. Restore it:
   ```
   cd /root/generator
   pm2 stop generator
   node admin.js restore-test data-2026-10-15.tar.gz.enc        # check it first
   node admin.js decrypt-backup data-2026-10-15.tar.gz.enc /root/restore.tar.gz
   mv data data-before-restore && mkdir data && tar -xzf /root/restore.tar.gz -C data
   pm2 start generator
   ```
4. Log in and check **Admin**. Videos made before the backup show as records; their files weren't in the backup.

(After section U, the folder is `/srv/generator`; `/root/generator` is a link to it.)

**Keep safe, off the server:** `.env` (it has `BACKUP_KEY`) and `.app-key`. A password manager is ideal.

Other commands: `node admin.js restore-test` checks the newest off-site copy, and `node admin.js restore-test backups/data-2026-10-15.tar.gz` checks a local one.

## I. If something goes wrong

- **Site shows 502 Bad Gateway**: it isn't running. `pm2 status`, then `pm2 restart generator`, then `pm2 logs generator`.
- **A video "didn't finish"**: the reason shows under **Create → Videos in progress**, and in **Admin → Alerts** once it has failed for good. Failed videos don't count toward the month.
- **"No draft passed the checks"**: the AI broke a rule twice. Usually a fact is too long for its scenes or the caption limit is tight. **Setup → Topics → Checks** flags most of these.
- **"Couldn't download the caption font"**: copy `Poppins-SemiBold.ttf` and `Poppins-SemiBoldItalic.ttf` into `/root/generator/fonts/`.
- **Someone forgot their password**: **Admin** → **Reset link** next to their name, and send it to them.
- **Too many login tries**: wait 15 minutes.
- **Instagram connect says the redirect URI doesn't match**: the URI in the Meta app must be exactly the one in **Admin → Server**, including `https://` and no trailing slash.
- **Instagram connect works for you but not an agent**: the app isn't reviewed yet; add them as an Instagram Tester (section F.3) or finish App Review (F.4).
- **No alerts on your phone**: **Admin → Alerts → Send a test**. If it errors, check `ALERT_WEBHOOK_URL` and that your phone is subscribed to the same ntfy topic.

## K. Terms of Service and Privacy Policy

The app doesn't write your terms; it makes sure every agent has accepted them. Have a lawyer review them first.

1. Publish both pages somewhere public (your website, or a page in a site builder). Each needs its own **https** link.
2. In `.env`:
   ```
   TERMS_URL=https://yourdomain.com/terms
   PRIVACY_URL=https://yourdomain.com/privacy
   TERMS_VERSION=2026-10
   ```
   `pm2 restart generator --update-env`. Both links must be set, or the feature stays off.
3. From then on:
   - The invite page has a box: *"I've read and accept the Terms of Service and Privacy Policy"*. The account can't be created without it.
   - Agents who were already using the app see an **Updated terms** page the next time they open it, and accept once to carry on. Setup has the same box.
   - Each account stores the version it accepted and when (`termsVersion`, `acceptedAt`). **Account** shows it to the agent; **Admin** shows *terms accepted* or *terms not accepted yet* next to each person.
4. **When you change the terms**, update the pages, then change `TERMS_VERSION` (for example to `2027-01`) and restart. Everyone is asked again. Only the newest acceptance is kept on the account, so keep old versions of your terms pages yourself.

Admins are never asked: you run the service. The login page links to both pages, and the privacy policy link is what Meta's App Review asks for (section F.4).

## M. Your agents' data: download and deletion

Agents can take a copy of their data, or ask for it to be deleted, without writing to you.

**Download.** **Account → Your data → Download my data** gives one JSON file: their settings and every saved version, their video list, approval records, coach notes, usage and who's in the workspace. Password hashes, sessions and the Instagram token are never in it. Video files aren't either (they're large); approved videos download from **Review** while they're kept. It works even if they haven't accepted new terms, so someone who won't accept can still take their data and go.

**Deletion.** **Account → Your data → Delete my workspace and data**: they tick a box and can add a note. Nothing is deleted yet:

1. You get an alert (**Admin → Alerts**, and on your phone if section E is set up).
2. Their card in **Admin** shows **Deletion requested** with **Delete everything** and **Decline**. They can also cancel it themselves from **Account** until you act.
3. **Delete everything**, then type the workspace name to confirm. It removes every login in the workspace (and logs them out), settings and their history, videos, covers and logo, approval records, coach notes, usage, the Instagram connection, videos waiting in line, and unused invite links. If a video is rendering for them right then, try again in a few minutes.

Workspaces that didn't ask are still deleted from the terminal: `node admin.js delete-workspace <id> --yes`.

What's kept: nightly backups in `backups/` hold a copy until they rotate out (`KEEP_BACKUPS`, 14 days by default) and Reels already posted stay on Instagram. Approval records are deleted with everything else, so if an agent may need them for a carrier or state audit, remind them to download their data (or the records in **Review**) first.

**The public page.** `https://yourdomain.com/data-deletion` needs no login. It tells people how to download and delete their data, how to remove Instagram access, what gets deleted and what's kept. The login page links to it. Set where people write when they can't log in:

```
SUPPORT_EMAIL=privacy@yourdomain.com
```

(If it's empty, it tells them to contact whoever set up their account, which isn't enough for Meta's review.) `pm2 restart generator --update-env`, then open the page to check it. The page says requests are handled once you confirm them; check the wording matches your privacy policy.

## N. AI spend guard (monthly cost cap)

Every call to OpenAI costs a little, and the app adds up an estimate per workspace (the **AI cost this month** figure in **Admin**). The spend guard stops one workspace from running up a large bill, for example through a bug, a stuck retry, or someone running test scripts all day.

- **The cap**: $20 per workspace per month by default. Change the default in `.env`, then `pm2 restart generator --update-env`:
  ```
  AI_COST_CAP_USD=20        (0 = no cap)
  ```
  For one workspace, tap **AI cap** on its card in **Admin** and enter an amount (blank = back to the default, 0 = no cap for that workspace). A done-for-you client you coach a lot may need more.
- **At 80%** you get an alert (**Admin → Alerts**, and on your phone if section E is set up). Once a month per workspace.
- **At 100%** you get another alert, and for that workspace the app stops starting anything that calls the AI: new videos (including overnight ones), scene fixes, test scripts, footage tests and the coach. Videos already waiting in line stop with the same reason. A video that's already rendering finishes. Setup still works, with the starter wording. Review, approving, downloading and Instagram posting keep working. The agent sees a note saying the month's AI budget is used up and that you can raise it; they never see dollar amounts.
- **It resumes** on the 1st of the month (UTC), or right away when you raise the cap.

For scale: a video is roughly 5 to 10 cents and a test script about a cent, so $20 is several times a normal month. The figures are estimates from a price table (`OPENAI_PRICES` in `.env`); check your real spend in the OpenAI dashboard, and set a monthly budget there too (**Settings → Limits**) as a backstop for the whole server.

## O. Security

What the app does to protect agents' accounts, their data and your work. Most of it needs nothing from you; the server checklist at the end does.

**Your prompts.** How scripts, hooks, critics and post text are prompted lives in `lib/prompts.js`, which only the server loads. The portal gets `mixer-core.js` (the rules and checks, so agents see problems before saving) but none of the prompt text. Agents see the *ingredients* of a video in **Settings → What goes into a video**; admins also get **Show the full prompt** and **Explain this prompt** there. Test scripts only include the prompt for admins, and the coach is told to keep its instructions to itself. (Like any AI product, a determined person can still guess a lot from the scripts it writes; this keeps the exact wording off their screen.)

**Logins and sessions.**
- Passwords are stored as scrypt hashes; login tries are rate-limited per IP and per email.
- On https the session cookie is `__Host-sid` (HttpOnly, Secure, SameSite=Lax): only your site can read or send it.
- Sessions last 30 days for agents and **7 days for admins**, and end after **14 days unused**. Change with `ADMIN_SESSION_DAYS` and `SESSION_IDLE_DAYS` in `.env`.
- **Account → Where you're logged in** lists each device (browser, IP, last active) with **Log out** and **Log out everywhere else**. Changing a password logs out every other device.

**Two-factor login.**
- **Admins must use it** (the first time you log in after updating, the app walks you through it). Agents can turn it on under **Account → Two-factor login**. `TWO_FACTOR=all` in `.env` requires it for everyone; `TWO_FACTOR=off` makes it optional for admins too (not recommended).
- Any authenticator app works: Google Authenticator, Microsoft Authenticator, 1Password, Authy. Scan the QR code (made on your server, never sent anywhere), enter the code, and **save the 10 backup codes**. Each backup code works once.
- After a password, the login asks for the code. A password-reset link doesn't skip it.
- **Lost phone and backup codes**: another admin taps **Reset 2FA** next to the person in **Admin** (check it's really them first, for example by phone), or on the server: `node admin.js reset-2fa someone@example.com`. They're logged out and set it up again.
- The 2FA keys are encrypted with a key kept in **`/root/generator/.app-key`** (created automatically, readable only by the server's user), or `APP_KEY` in `.env` if you set one. It isn't in `data/` or the backups. **Save a copy of `.app-key` with your `.env`** (in your password manager): if you rebuild the server from a backup without it, everyone's two-factor login has to be reset.

**Activity log.** Every security- or compliance-relevant action is written to `data/audit/YYYY-MM.jsonl` (one line per event, append-only) and shown in **Admin → Activity log**, filterable by workspace and kind, with **Download (CSV)**. It's kept **24 months** (`AUDIT_KEEP_MONTHS`), then removed by the nightly cleanup. It records logins and failed logins with IP, two-factor and password changes, devices logged out, admins opening a workspace and changing its settings (comp, pause, limits, AI cap), invites and reset links, approvals, rejections and posted marks, record and data downloads, deletion requests, declines and deletions, Instagram connect/disconnect, setup, saved settings and terms acceptance. Terminal commands (`node admin.js …`) are recorded as "cli". An agent's data download includes their workspace's entries, with admins shown only as "admin".
It stays after a workspace is deleted (it's a security record); the public deletion page says so. Mention it in your privacy policy too.

**Headers.** Every response sends `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict `Content-Security-Policy` on pages, `Permissions-Policy` (no camera, microphone, location or payment access), `Cross-Origin-Opener-Policy`, and on https `Strict-Transport-Security`.

**Server checklist** (once, on the server; Ubuntu). These protect the machine itself:
```
chmod 600 /root/generator/.env /root/generator/.app-key        # only root can read your keys
apt install -y unattended-upgrades fail2ban                    # automatic security updates; blocks SSH password guessing
dpkg-reconfigure -plow unattended-upgrades                     # answer Yes
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable      # firewall: only SSH and the website
```
**SSH keys only**: first make sure you can log in with your SSH key. Then, in `/etc/ssh/sshd_config`, set `PasswordAuthentication no` and `PermitRootLogin prohibit-password`, and run `systemctl reload ssh`. Keep your current session open until a new login with the key works. The app itself already listens only on 127.0.0.1, behind nginx. In nginx's `http { }` block, `server_tokens off;` hides its version.

## R. Monitoring

**Uptime checker (free, 5 minutes).** Use [UptimeRobot](https://uptimerobot.com) or [Better Stack](https://betterstack.com):
1. Add an **HTTP(s)** monitor for `https://yourdomain.com/api/health`, checked every 5 minutes.
2. Set it to alert you by text or app notification.

It answers **200** when everything is fine and **503** when something needs you, so the checker alerts you if the site is down *or* unhealthy. The checks are:

| Check | Fails when |
|---|---|
| `disk` | Free disk is under `LOW_DISK_GB` (3 GB) |
| `backup` | No nightly backup for 36 hours (`BACKUP_LATE_HOURS`) |
| `offsite` | (only when section Q is set up) the last upload failed or is 36+ hours old |
| `queue` | A video has been rendering for more than 30 minutes (`JOB_STUCK_MINUTES`) |

Strangers only see `ok` and the check names. To see the numbers (free disk, last backup, queue, recent errors, version), set `HEALTH_TOKEN=` (any 16+ random characters, e.g. `openssl rand -hex 16`) and open `/api/health?token=…`. **Admin → Server → Health check** shows the same checks.

**Alerts the server sends you** (**Admin → Alerts**, and your phone with section E):
- **The server is throwing errors**: 5 unexpected errors within 10 minutes (`ERROR_BURST`). At most every 30 minutes. Look at `pm2 logs generator --lines 100`.
- **The nightly backup is late**, **The off-site backup is late**, **A video has been rendering for too long**: once a day each, until fixed.
- Existing ones: failed videos, failed backups and uploads, the weekly restore test, low disk, Instagram problems, AI spend.

## T. Storage: JSON files or SQLite

**From version 15, SQLite is the standard**: new installs start on it, and an update moves a server on JSON files into it once. The rest of this section explains both and how to move by hand.

Before 15 the app kept its data as JSON files in `data/` by default. That works well for a handful of agents. **SQLite** (built into Node 22, nothing to install) keeps the same data in one file, `data/app.db`. With SQLite:
- Every change is a transaction, so the server and `node admin.js` can never overwrite each other's changes.
- Backups take a consistent copy even while the server runs.
- It keeps working smoothly as you grow past a few dozen agents.

Nothing else changes. The app and the portal work the same, and videos, logos, settings history and the activity log stay as files.

**Moving to SQLite** (about a minute of downtime; do it at a quiet time):
```
cd /root/generator
node admin.js storage migrate --dry-run     # reads every file; changes nothing
pm2 stop generator
node admin.js storage migrate               # copies, checks every document, then switches
pm2 start generator
node admin.js storage status
```
The migration copies everything in one go and reads each document back to check it. Only then does it move the JSON files aside to `data/json-before-sqlite-<date>/` (kept, never deleted) and switch. If anything doesn't match, it removes the database and changes nothing. It refuses to run while the server is running, or if any file is damaged (it lists which).

**Going back** (everything written since the move is kept):
```
pm2 stop generator && node admin.js storage rollback && pm2 start generator
```
The database is kept as `data/app.db.rolled-back-<date>`.

**Admin → Server → Storage** shows which one is in use. Backups (including off-site ones) and `node admin.js restore-test` work with either. A restored SQLite backup unpacks as `data/app-snapshot.db`, and the server picks it up automatically.

Needs Node 22.5 or newer (`node --version`). On older versions the server says so and tells you how to switch back.

## U. Run the app as its own user (not root)

Out of the box the app runs as `root`. That's fine to start with, but if the app were ever broken into, the attacker would control the whole server. Running it as its own user, `reels`, limits any damage to the app's own folder. It takes one script and about a minute of downtime:

```
cd /root/generator
bash setup-user.sh --dry-run     # shows every step; changes nothing
bash setup-user.sh
```
It:
1. Creates the user `reels` (no password, can't log in).
2. Moves the app to `/srv/generator` and leaves a link at `/root/generator`, so every command in this guide still works.
3. Gives the folder to `reels`, with `data/`, `backups/`, `.env` and `.app-key` readable by it alone.
4. Moves the app's pm2 process, and its start-on-boot, to `reels`.
5. Checks that the site answers.

**Afterwards, nothing changes for you.** `bash update.sh …` and `node admin.js …` still run from `/root/generator` as root. They switch to `reels` by themselves, so they never create files the app can't use. (`KEEP_ROOT=1 node admin.js …` stays root, for example to write a decrypted backup into `/root`.) The app's pm2 is the `reels` user's:
```
runuser -u reels -- env HOME=/home/reels pm2 status      # or: logs generator / restart generator
```
To undo: `bash /srv/generator/setup-user.sh --undo`.

Together with the server checklist at the end of section O (SSH keys only, firewall, automatic updates, fail2ban), this is the standard way to lock down a small server.

## X. Writing quality: prompts, models and the golden set

**How scripts are written** (all the prompt text is in `lib/prompts/`):
- The writer gets one topic: its worry, its fact, its offer and its open question, and nothing from other topics.
- It writes the whole video first as one short spoken paragraph, then splits it into scenes, so it reads as one person talking. Sound rules and, until the agent has approved scripts of her own, one short example script (on a different subject) set the feel (`lib/prompts/examples.js`).
- For each scene it says what should be on screen ("see"), a footage search and a backup search. The clip check scores stock clips against "see", so footage shows what each line is about.

**Which model writes.** The writer matters more than any setting. `gpt-4o` (the default) is old and OpenAI retires it on 2027-01-14. A stronger writer is the cheapest quality gain: set `ANTHROPIC_API_KEY` and `AI_LADDER_WRITER=anthropic:claude-sonnet-5-5,gpt-6-luna` (and the same for `AI_LADDER_HOOKS` if you like), then compare with the golden set below before you keep it. `node admin.js models` shows what each job uses.

**Models.** Each job can have its own model in `.env` (all optional; anything unset uses `OPENAI_MODEL`, and `OPENAI_MODEL` unset is `gpt-4o`):
```
OPENAI_MODEL=…            # writes scripts and post text
OPENAI_HOOK_MODEL=…       # writes the 8 openings
OPENAI_CRITIC_MODEL=…     # ranks openings and drafts (best as a different model from the writer)
```
Check the model names your OpenAI account can use at platform.openai.com. Add any new model's price to `OPENAI_PRICES` (section N) so the spend guard's estimate stays right, for example `OPENAI_PRICES={"new-model-name":[1.25,10]}` (dollars per million input and output tokens). Then `pm2 restart generator --update-env`.

**Before you switch models, run the golden set:**
```
cd /root/generator
node admin.js list                                    # find the workspace id (for example Melanie's)
node admin.js golden w_abc123 --label current         # today's model
OPENAI_MODEL=new-model-name node admin.js golden w_abc123 --label new-model
node admin.js golden-compare data/golden/<current file>.json data/golden/<new-model file>.json
```
Each run writes 12 fixed video ideas (same audience, worry, fact, format and structure every time) without making videos, about a cent each, counted on that workspace's AI usage. `golden-compare` writes an HTML page next to the second file: download it with SFTP and read it row by row. Ask which script you'd approve; the critic's averages at the top are a hint, not the verdict. Run it again after any prompt change. `--count 20` for more cases.

**Structured outputs** are on by default. `OPENAI_STRUCTURED=off` turns them off (for a provider behind `OPENAI_BASE_URL` that doesn't support them; OpenAI models that don't are detected and fall back automatically).

**Structures** are in **Settings → Video → Structures** for each agent: Classic (always on), Answer first (6+ scenes), Objection (7+), Recap (7+) and Straight to you. Lists, comparisons and mini-stories keep the Classic shape. The structure each video used shows on its card in **Review** and in test scripts. Fixing a scene keeps the video's structure.

**Communication styles** (Communicate) now reach every scene of the script, the critic and the voiceover's pacing. The style checks are soft: they give the writer one chance to reword, and never stop a video.

**Checking a style against real messages.** In the coach → **Reply to a message**, pick the sender's audience when you paste a message in. Only the audience, the style letter and the time are kept (`style-reads.json`, in the agent's data download). After 10 messages from an audience, its card in **Communicate** shows how their messages read and, when 60% or more lean one style that isn't the main one set, a button to use it.

**Overnight drafts.** `OVERNIGHT_DRAFTS=1` (default; 1–3) for overnight videos only.
