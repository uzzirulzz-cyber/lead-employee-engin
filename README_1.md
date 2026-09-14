# PLAYBEAT LEADPULSE v3
Super Admin + Seats + Lead Router + Calling + Email + WhatsApp

Logo: PLAYBEAT LEADPULSE - as per your images - dark neon blue + yellow heartbeat

## Super Admin
Email: admin@playbeat.live
Password: playbeat1122

## Neon Database
postgresql://neondb_owner:npg_YfErWsIBK3D8@ep-royal-feather-aei4avdp-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require

## Install
npm install
npx prisma migrate dev --name init
npx prisma generate
node src/seed.js
npm start

Dashboard: http://localhost:3000/index.html
Landing: http://localhost:3000/landing.html
