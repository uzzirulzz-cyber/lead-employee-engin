
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const WARMUP_SCHEDULE = [20,40,80,120,160,200,250,300,350,400,450,500,600,700,800,900,1000];
async function getOrCreateWarmup(email){
  let w = await prisma.smtpWarmup.findUnique({ where:{ email }});
  if(!w){ w = await prisma.smtpWarmup.create({ data:{ email, day:1, dailyLimit: WARMUP_SCHEDULE[0], sentToday:0 }}); }
  const lastReset = new Date(w.lastReset); const now = new Date();
  if(now.toDateString() !== lastReset.toDateString()){
    const newDay = Math.min(w.day+1, WARMUP_SCHEDULE.length);
    const newLimit = WARMUP_SCHEDULE[newDay-1];
    w = await prisma.smtpWarmup.update({ where:{ id: w.id }, data:{ day: newDay, dailyLimit: newLimit, sentToday:0, lastReset: now }});
  }
  return w;
}
async function checkWarmupLimit(){
  const email = process.env.SMTP_USER;
  if(!email) return { allowed:true, sent:0, limit: 1000 };
  const w = await getOrCreateWarmup(email);
  return { allowed: w.sentToday < w.dailyLimit, sent: w.sentToday, limit: w.dailyLimit, day: w.day, email: w.email };
}
async function incrementWarmup(){
  const email = process.env.SMTP_USER; if(!email) return;
  const w = await getOrCreateWarmup(email);
  await prisma.smtpWarmup.update({ where:{ id: w.id }, data:{ sentToday:{ increment:1 }}});
}
async function importCsvLeads({ campaignId, rows }){
  const { fingerprint, canonicalDomain } = require('../lib/fingerprint');
  const { scoreLead } = require('../lib/extractors');
  let imported=0, duplicates=0;
  for(const row of rows){
    const domain = canonicalDomain(row.website||row.domain||row.email?.split('@')[1]||'');
    const fp = fingerprint({ email: row.email, phone: row.phone||row.phoneRaw, domain, company: row.companyName });
    const exists = await prisma.lead.findUnique({ where:{ fingerprint: fp }});
    if(exists){ duplicates++; continue; }
    const leadData = { campaignId, companyName: row.companyName||row.company||null, industry: row.industry||null, website: row.website||null, domain, email: row.email||null, phoneRaw: row.phone||null, phoneNormalized: row.phone||null, whatsappRaw: row.whatsapp||null, country: row.country||null, city: row.city||null, source: 'csv_import', sourceUrl: 'csv_import', fingerprint: fp };
    leadData.leadScore = scoreLead({ ...leadData, sourceCount:1 });
    await prisma.lead.create({ data: leadData }); imported++;
  }
  return { imported, duplicates };
}
module.exports={ checkWarmupLimit, incrementWarmup, importCsvLeads, WARMUP_SCHEDULE };
