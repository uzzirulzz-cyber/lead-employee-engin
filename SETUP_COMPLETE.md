
# PLAYBEAT LEADPULSE V3 - COMPLETE SETUP PACKAGE

## What's Inside
This zip contains COMPLETE setup with:
- Neon DB: postgresql://neondb_owner:npg_YfErWsIBK3D8@ep-royal-feather-aei4avdp-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
- Super Admin: admin@playbeat.live / playbeat1122
- 4 Seats: Seat One-Four, 250 leads each = 1000 total
- 4 Employees: emp1@playbeat.live ... emp4@playbeat.live / playbeat1122
- Landing Page: /landing.html as per your image YOUR WORLD OF LEAD POSSIBILITIES
- Dashboard: /index.html Super Admin protected
- Logo: /public/logo-playbeat.jpeg (your uploaded logo)
- All backend: leadRouter, callService, email, WhatsApp, sequences

## Installation (2 mins)
1. Unzip PLAYBEAT-LEADPULSE-V3-COMPLETE.zip
2. npm install
3. npx prisma migrate dev --name init
4. npx prisma generate
5. node src/seed.js
   -> Creates Super Admin admin@playbeat.live / playbeat1122 in Neon DB
   -> Creates 4 seats + 4 employees
6. npm start
7. Open http://localhost:3000/index.html -> login admin@playbeat.live / playbeat1122
8. Open http://localhost:3000/landing.html -> landing page as per image

## Push to GitHub https://github.com/uzzirulzz-cyber/Playbeatpulselead
### Method 1: GitHub Web (Easiest - No terminal)
1. Go to https://github.com/uzzirulzz-cyber/Playbeatpulselead
2. Click "Add file" -> "Upload files"
3. Drag ALL files from unzipped folder (or drag the zip, GitHub will extract)
4. Commit: "PLAYBEAT LEADPULSE v3 Complete Setup"

### Method 2: Terminal
```bash
git clone https://github.com/uzzirulzz-cyber/Playbeatpulselead.git
cd Playbeatpulselead
# Copy all files from unzipped folder into this folder
cp -r /path/to/unzipped/* .
git add .
git commit -m "PLAYBEAT LEADPULSE v3 - Complete Setup - Super Admin admin@playbeat.live / playbeat1122 + Neon DB + Seats + Router + Landing as per images"
git push origin main
```

### Method 3: Use push script (inside zip)
```bash
chmod +x push_to_github.sh
./push_to_github.sh
```

## Deploy to Vercel
1. Import GitHub repo https://github.com/uzzirulzz-cyber/Playbeatpulselead to Vercel
2. Set Environment Variable: DATABASE_URL = your Neon URL
3. Build Command: npm install && npx prisma generate
4. Start Command: npm start
5. After deploy, run seed once: node src/seed.js (via Vercel CLI or add to build)

## Structure
```
├── public/
│   ├── logo-playbeat.jpeg (your logo)
│   ├── landing-reference.jpeg (your landing ref)
│   ├── landing.html (YOUR WORLD OF LEAD POSSIBILITIES - as per image)
│   └── index.html (Super Admin dashboard)
├── prisma/
│   └── schema.prisma (User, Seat, Lead, Campaign, CallLog, etc.)
├── src/
│   ├── server.js (all APIs)
│   ├── seed.js (creates admin@playbeat.live / playbeat1122)
│   ├── middleware/auth.js
│   ├── services/leadRouter.js (250 each seat)
│   ├── services/callService.js (real-time calling)
│   └── adapters/
├── .env (Neon DB pre-filled)
├── package.json
└── README.md
```

## Super Admin Flow
1. Login admin@playbeat.live / playbeat1122
2. Employees & Seats -> Create employees -> Assign Seat 1/2/3/4
3. Create Campaign: Pakistan Real Estate 1000
4. Start Campaign -> generates leads via SOLID architecture
5. Lead Router -> Route 1000 leads -> 250 each seat
6. Employees login -> see only their 250 leads -> Email/WhatsApp/Calling per seat
