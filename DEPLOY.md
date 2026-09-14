
# Deploy PLAYBEAT LEADPULSE v3

## Neon Database
URL: postgresql://neondb_owner:npg_YfErWsIBK3D8@ep-royal-feather-aei4avdp-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require

### Prisma Migrate
```bash
npx prisma migrate dev --name playbeat_v3_init
npx prisma generate
```

### Seed Super Admin + Seats
```bash
node src/seed.js
```
Creates:
- Super Admin admin@playbeat.live / playbeat1122
- 4 seats Seat One-Four max 250 each
- Demo employees emp1-4@playbeat.live / playbeat1122

## GitHub Push
Repo: https://github.com/uzzirulzz-cyber/Playbeatpulselead

```bash
cd /path/to/project
git init
git add .
git commit -m "PLAYBEAT LEADPULSE v3"
git branch -M main
git remote add origin https://github.com/uzzirulzz-cyber/Playbeatpulselead.git
git push -u origin main
```

## If push fails due to empty repo
GitHub may need PAT token. Create token at https://github.com/settings/tokens
Then:
```bash
git remote set-url origin https://YOUR_TOKEN@github.com/uzzirulzz-cyber/Playbeatpulselead.git
git push -u origin main --force
```
