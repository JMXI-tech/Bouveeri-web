# Boveeri Pavilion & Suites - Website + Backend (Stages 1 to 3 + chatbot)

Node.js (Express) + PostgreSQL + Caddy (automatic HTTPS), run with Docker.
Stage 1 covers: secure logins with roles, room and event-space booking, receptionist approval
(first come, first served), double-booking protection, and Gmail confirmation emails.
Stage 2 adds the React website in `frontend/` (logo, hero, services, individual rooms with live availability, event spaces, booking form, gallery, guest login, My bookings, and a front-desk dashboard for the receptionist/MD/admin). The Docker build compiles it automatically.
Chatbot: a chat window on every page answers guest questions with the hotel's facts and live room list, and has a "Leave a message" form that emails the hotel and appears under Management > Website enquiries.
Stage 3 adds employees, verification IDs, shifts, notices and a private staff inbox (see section 10).
Also included: sector tools, room photo upload and Paystack payments (sections 11 to 13).

## 1. Before you start
1. A VPS (2 GB RAM, Ubuntu 22.04 or 24.04) with Docker: `curl -fsSL https://get.docker.com | sh`
2. A domain (e.g. boveeri.ng or boveeri.com.ng) whose **A record** points to the VPS IP address.
3. A Gmail app password: Google Account > Security > turn on 2-Step Verification > App passwords > create one named "Boveeri". Use it as GMAIL_APP_PASSWORD (not your normal password).

## 2. Deploy
```
scp -r boveeri-backend user@YOUR_SERVER_IP:~
ssh user@YOUR_SERVER_IP
cd boveeri-backend
cp .env.example .env && nano .env      # fill every value; use long random secrets
docker compose up -d --build
docker compose logs -f app             # should print "Boveeri API on :3000"
```
Open https://YOUR-DOMAIN - the website should load. https://YOUR-DOMAIN/api/venues should list the three event spaces.
The admin account is created from ADMIN_EMAIL / ADMIN_PASSWORD on first start. Change that password afterwards.

## 3. First setup (as admin)
Log in, then add rooms and staff (replace the domain; `-c jar -b jar` keeps the login cookie):
```
curl -c jar -H 'Content-Type: application/json' -d '{"email":"OWNER","password":"PASS"}' https://DOMAIN/api/auth/login
curl -b jar -H 'Content-Type: application/json' -d '{"number":"101","category":"Standard Room","priceNgn":39000,"note":"Ground floor"}' https://DOMAIN/api/admin/rooms
curl -b jar -H 'Content-Type: application/json' -d '{"email":"desk@x.com","name":"Receptionist","role":"receptionist","password":"a-long-password"}' https://DOMAIN/api/admin/users
```
Published rates to use as category prices: Classic 29,200; Standard Room 39,000; Deluxe Room 46,920; Junior Suite 57,960; 1 Bedroom Suite 69,480; 2 Bedroom Suite 114,720; Presidential Suite 167,520 (confirm with the hotel).

## 4. API summary
| Who | Endpoint |
|---|---|
| Public | GET /api/rooms?from=YYYY-MM-DD&to=YYYY-MM-DD, GET /api/venues?date=YYYY-MM-DD (no guest data ever returned) |
| Guest | POST /api/auth/register, /login, /logout; GET /api/auth/me; POST /api/bookings; GET /api/bookings/mine |
| Receptionist, MD, admin | GET /api/staff/bookings (pending oldest first); POST /api/staff/bookings/:id/approve, /decline, /handover |
| Admin | POST /api/admin/rooms; PATCH /api/admin/rooms/:id; GET/POST /api/admin/users; DELETE /api/admin/users/:id |

Booking bodies: room `{"kind":"room","category":"Standard Room","roomId":1,"checkIn":"2026-12-01","checkOut":"2026-12-03","guests":2,"phone":"+234..."}`;
venue `{"kind":"venue","venueId":1,"date":"2026-12-05","startTime":"09:00","endTime":"17:00","guests":150,"phone":"+234..."}`.

## 5. How the rules are enforced
- Requests start as pending and do not block a room. Approval confirms and holds the room.
- Approving a request while an earlier overlapping one is waiting returns a warning (send `{"force":true}` to override).
- PostgreSQL itself rejects two confirmed bookings of the same room or space on overlapping dates, so two receptionists cannot double-book.
- Passwords are hashed (bcrypt); login cookie is httpOnly; login attempts are rate-limited; all input is validated.

## 6. Domain notes
Register the .ng and .com.ng names at a NiRA-accredited registrar (for example Whogohost), point both to the server, and redirect one to the other. Ask the registrar of boveeri.com about recovering it. Do not use info@boveeri.com until you control that domain again.

## 7. Backups and updates
Daily backup (add to `crontab -e`):
`0 2 * * * cd ~/boveeri-backend && docker compose exec -T db pg_dump -U boveeri boveeri | gzip > ~/backup-$(date +\%F).sql.gz`
Copy backups off the server regularly. Update: `git pull` or re-upload, then `docker compose up -d --build`.

## 8. Known limits
Neither stage was run against a live database or built with npm in this session, so deploy to a test server first.
Gmail allows roughly 500 emails a day. Venue bookings hold a whole day. Time-slot sharing, employee verification IDs, notices, staff inbox and payments are later stages.

## 9. Working on the website locally
```
cd frontend && npm install && npm run dev     # http://localhost:5173, proxies /api to the backend on :3000
```
Run the backend with Postgres locally (`docker compose up db -d`, then `npm run dev` in the project root with a .env that sets DATABASE_URL=postgres://boveeri:PASSWORD@localhost:5432/boveeri). Photos for rooms are set by pasting an image URL in the room's `photoUrl` (upload support comes later). The gallery photos come from Google listings: replace them with the hotel's own photos in `frontend/public/img/` and `frontend/src/gallery.json` before launch.

## 10. Chatbot and stage 3
**Chatbot.** Create a key at console.anthropic.com, put it in `.env` as ANTHROPIC_API_KEY (CHAT_MODEL defaults to claude-haiku-5-5; change if that model name is unavailable on your account), then `docker compose up -d`. With no key the chat politely asks guests to call. Usage is billed to your Anthropic account; the server limits each visitor to 15 messages a minute. The bot only knows the facts in `facts()` in `src/server.js` - edit that text when prices or services change, and add event capacities and the cancellation policy once known.

**Employees.** Admin or MD: Management > Add an employee (name, job title, sector, account type, shift). The page shows a one-time **verification ID** (BVR-XXXXXX). The employee opens Log in > "Staff? Use your verification ID", enters it with their own email and password, and the account is created with the role you chose (staff, receptionist or md). They then complete phone, address and emergency contact in Staff portal > Profile, and you see it in Management. Only admin can create an MD or delete an employee (deleting also deletes their login). Editing a record updates their role and name immediately.

**Notices.** Admin/MD post to everyone, staff only, guests only, or one sector. Guests and visitors see "everyone/guests" notices at the top of the home page; staff see their own sector's notices in the portal.

**Staff inbox.** One-to-one messages between any staff accounts. Nobody else, including the admin, can read them through the app. Messages refresh every 8 seconds (real-time push comes later).

**Sector access.** In this stage a sector decides which notices an employee sees and the receptionist/MD/admin roles decide the dashboards. Dedicated tools per sector (housekeeping room status, kitchen orders and so on) are a later stage.

**Test order:** log in as admin > add a room > create a receptionist employee > sign up with its ID in a private window > guest signs up and books > receptionist approves > check the emails.

## 11. Sector tools
Every employee sees a **My sector** tab in the Staff portal. Each sector gets its own log with the right label (Housekeeping: cleaning tasks, Maintenance: repair tickets, Security: incident/visitor log, Kitchen: order or stock notes, Bar & Lounge: stock notes, Pool & Leisure: pool safety log, Events: event tasks, Laundry: laundry batches, Accounts: daily records, Front Desk: notes). Entries move open > in progress > done, can name a room, and can only be seen and changed by that sector, the MD and the admin. Housekeeping, Front Desk and Maintenance also get a **room status board** (clean, dirty, being cleaned, needs inspection, out of service). Admin/MD open Management > Sector boards to look at any sector. Rooms are not yet marked dirty automatically at check-out; that is a good next improvement.

## 12. Room photos
Management > Room photos: pick a photo for each room (JPEG, PNG or WebP). The browser shrinks it, the server checks it really is an image (max 5 MB), stores it in the `uploads` Docker volume and shows it on the public Rooms section. Replacing a photo deletes the old file. The volume is separate from the database, so back it up too: `docker run --rm -v boveeri-backend_uploads:/d -v ~:/b alpine tar czf /b/uploads.tgz -C /d .`

## 13. Payments with Paystack
1. Create a Paystack business account. In Settings > API Keys copy the **test secret key** into `PAYSTACK_SECRET_KEY`, set `SITE_URL=https://YOUR-DOMAIN` in `.env`, then `docker compose up -d`.
2. In Paystack Settings > API Keys & Webhooks set the **Webhook URL** to `https://YOUR-DOMAIN/api/paystack/webhook`.
3. Test: guest books > receptionist approves (a room's amount is set automatically as nights x room price; for event spaces use **Set amount** on the Front desk page) > the guest opens My bookings > **Pay** > pay with a Paystack test card > the booking shows paid and a receipt email is sent.
4. When satisfied, switch to your **live** secret key (Paystack asks you to complete business verification first).
How it stays safe: amounts come from the database, never from the browser; each payment is re-verified directly with Paystack before it counts; webhook signatures are checked; a payment can only count once. Staff can record **Cash** received at the desk. Part-payments/deposits, refunds and a finance report are not built yet.
