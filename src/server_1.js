
require('dotenv').config();
const express=require('express');
const cors=require('cors');
const { PrismaClient } = require('@prisma/client');
const { runCampaign } = require('./services/jobRunner');
const { sendEmail, renderTemplate, getTransporter } = require('./services/emailService');
const { enrollLeads, processDueSequences } = require('./services/sequenceService');
const { checkWarmupLimit, importCsvLeads, WARMUP_SCHEDULE } = require('./services/warmupService');

const prisma=new PrismaClient();
const app=express();
app.use(cors());
app.use(express.json({ limit:'20mb' }));
app.use(express.static('public'));

const PORT=process.env.PORT||3000;

app.get('/api/health', (req,res)=>res.json({ success:true, message:'LeadForge v2.1 - SOLID + Sequences + CSV Import + SMTP Warmup' }));

// Campaigns
app.post('/api/campaigns', async (req,res)=>{
  const { name, industry, country, city, keywords=[], targetCount=1000 } = req.body;
  if(!name) return res.status(400).json({ success:false, error:'name required' });
  const c=await prisma.campaign.create({ data:{ name, industry, country, city, keywords, targetCount: parseInt(targetCount)||1000, status:'DRAFT' }});
  res.json({ success:true, data:c });
});
app.get('/api/campaigns', async (req,res)=>{ const campaigns=await prisma.campaign.findMany({ orderBy:{ createdAt:'desc' }}); res.json({ success:true, data:campaigns }); });
app.get('/api/campaigns/:id', async (req,res)=>{
  const c=await prisma.campaign.findUnique({ where:{ id:req.params.id }, include:{ _count:{ select:{ leads:true, outreachLogs:true, sequences:true }}}});
  if(!c) return res.status(404).json({ success:false, error:'Not found' });
  res.json({ success:true, data:c });
});
app.post('/api/campaigns/:id/start', async (req,res)=>{
  const campaign=await prisma.campaign.findUnique({ where:{ id:req.params.id }});
  if(!campaign) return res.status(404).json({ success:false, error:'Not found' });
  const job=await prisma.job.create({ data:{ campaignId:campaign.id, status:'QUEUED', stage:'DISCOVERY', batchSize:50 }});
  await prisma.campaign.update({ where:{ id:campaign.id }, data:{ status:'QUEUED', currentStage:'QUEUED' }});
  setTimeout(()=>runCampaign(job.id), 500);
  res.json({ success:true, data:{ jobId:job.id, status:'QUEUED', message:`Target ${campaign.targetCount} - enhanced multi-source + contact crawl + enrichment` }});
});

// Leads
app.get('/api/leads', async (req,res)=>{
  const { campaignId, search, page=1, limit=50, hasEmail, hasWhatsApp, minScore } = req.query;
  const where={};
  if(campaignId) where.campaignId=campaignId;
  if(search) where.OR=[{ companyName:{ contains:search, mode:'insensitive'}},{ email:{ contains:search, mode:'insensitive'}},{ domain:{ contains:search, mode:'insensitive'}}];
  if(hasEmail==='true') where.email={ not:null };
  if(hasWhatsApp==='true') where.whatsappDetected=true;
  if(minScore) where.leadScore={ gte: parseInt(minScore) };
  const skip=(parseInt(page)-1)*parseInt(limit);
  const [leads,total]=await Promise.all([prisma.lead.findMany({ where, orderBy:{ leadScore:'desc' }, skip, take:Math.min(parseInt(limit),100) }), prisma.lead.count({ where })]);
  res.json({ success:true, data:{ leads, total, page:parseInt(page), totalPages:Math.ceil(total/parseInt(limit)) }});
});

app.post('/api/leads/export', async (req,res)=>{
  const { format='csv', campaignId } = req.body;
  const where=campaignId?{ campaignId }:{};
  const leads=await prisma.lead.findMany({ where, take:10000 });
  if(format==='csv'){
    const { stringify } = require('csv-stringify/sync');
    const csv=stringify(leads.map(l=>({ Company:l.companyName, Industry:l.industry, Country:l.country, City:l.city, Email:l.email, EmailStatus:l.emailStatus, Phone:l.phoneNormalized, WhatsApp:l.whatsappNormalized||l.whatsappUrl, Website:l.website, LeadScore:l.leadScore, Source:l.source })),{ header:true });
    res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=leads.csv'); return res.send(csv);
  }
  return res.json(leads);
});

app.post('/api/leads/import', async (req,res)=>{
  const { campaignId, csvText } = req.body;
  if(!csvText) return res.status(400).json({ success:false, error:'csvText required' });
  // Simple CSV parse - expects header row
  const lines = csvText.split('\n').filter(l=>l.trim());
  const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
  const rows = lines.slice(1).map(line=>{
    const vals = line.split(',').map(v=>v.trim());
    const obj={};
    headers.forEach((h,i)=> obj[h]=vals[i]);
    return obj;
  });
  const result = await importCsvLeads({ campaignId, rows });
  res.json({ success:true, data: result });
});

app.get('/api/stats', async (req,res)=>{
  const [total, verified, whatsapp, phone, today]=await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where:{ emailStatus:'VALID' }}),
    prisma.lead.count({ where:{ whatsappDetected:true }}),
    prisma.lead.count({ where:{ phoneRaw:{ not:null }}}),
    prisma.lead.count({ where:{ createdAt:{ gte:new Date(new Date().setHours(0,0,0,0)) }}}),
  ]);
  res.json({ success:true, data:{ total, verified, whatsapp, phone, today }});
});

// Templates
app.get('/api/templates/email', async (req,res)=>{ const t=await prisma.emailTemplate.findMany({ orderBy:{ createdAt:'desc' }}); res.json({ success:true, data:t }); });
app.post('/api/templates/email', async (req,res)=>{ const t=await prisma.emailTemplate.create({ data:req.body }); res.json({ success:true, data:t }); });
app.get('/api/templates/whatsapp', async (req,res)=>{ const t=await prisma.whatsAppTemplate.findMany({ orderBy:{ createdAt:'desc' }}); res.json({ success:true, data:t }); });
app.post('/api/templates/whatsapp', async (req,res)=>{ const t=await prisma.whatsAppTemplate.create({ data:req.body }); res.json({ success:true, data:t }); });

// Outreach
app.post('/api/outreach/email/send', async (req,res)=>{
  const { leadId, subject, body, campaignId } = req.body;
  const lead=await prisma.lead.findUnique({ where:{ id:leadId }});
  if(!lead || !lead.email) return res.status(400).json({ success:false, error:'Lead has no email' });
  try{
    const info=await require('./services/emailService').sendEmail({ to: lead.email, subject, body, lead });
    const log=await prisma.outreachLog.create({ data:{ leadId, campaignId: campaignId||lead.campaignId, channel:'EMAIL', subject: renderTemplate(subject, lead), message: renderTemplate(body, lead), status:'SENT', sentAt:new Date() }});
    const { incrementWarmup } = require('./services/warmupService'); await incrementWarmup();
    res.json({ success:true, data:{ log, messageId: info.messageId }});
  }catch(e){ await prisma.outreachLog.create({ data:{ leadId, campaignId, channel:'EMAIL', status:'FAILED', error: String(e.message) }}); res.status(500).json({ success:false, error:String(e.message) }); }
});
app.post('/api/outreach/email/bulk', async (req,res)=>{
  const { leadIds, subject, body, campaignId } = req.body;
  const leads=await prisma.lead.findMany({ where:{ id:{ in: leadIds }, email:{ not:null }}});
  let sent=0, failed=0;
  for(const lead of leads){
    const limit = await checkWarmupLimit();
    if(!limit.allowed){ failed+= (leads.length - sent); break; }
    try{ await sendEmail({ to: lead.email, subject, body, lead }); await prisma.outreachLog.create({ data:{ leadId: lead.id, campaignId: campaignId||lead.campaignId, channel:'EMAIL', subject: renderTemplate(subject, lead), message: renderTemplate(body, lead), status:'SENT', sentAt:new Date() }}); const { incrementWarmup } = require('./services/warmupService'); await incrementWarmup(); sent++; await new Promise(r=>setTimeout(r, 1500)); }catch(e){ failed++; }
  }
  res.json({ success:true, data:{ sent, failed, total: leads.length }});
});
app.post('/api/outreach/whatsapp/generate', async (req,res)=>{
  const { leadIds, message, campaignId } = req.body;
  const leads=await prisma.lead.findMany({ where:{ id:{ in: leadIds }}});
  const results=leads.map(lead=>{
    const phone=lead.whatsappNormalized || lead.phoneNormalized || lead.whatsappRaw || lead.phoneRaw;
    if(!phone) return { leadId: lead.id, error:'No phone' };
    const clean=phone.replace(/\D/g,'');
    const rendered=renderTemplate(message||'Hi {{companyName}}!', lead);
    return { leadId: lead.id, company: lead.companyName, phone: clean, message: rendered, waUrl:`https://wa.me/${clean}?text=${encodeURIComponent(rendered)}` };
  });
  for(const r of results){ if(!r.error) await prisma.outreachLog.create({ data:{ leadId: r.leadId, campaignId, channel:'WHATSAPP', message: r.message, status:'SENT', sentAt:new Date() }}); }
  res.json({ success:true, data: results });
});
app.get('/api/outreach/logs', async (req,res)=>{
  const { campaignId, channel }=req.query;
  const where={}; if(campaignId) where.campaignId=campaignId; if(channel) where.channel=channel;
  const logs=await prisma.outreachLog.findMany({ where, include:{ lead:true }, orderBy:{ createdAt:'desc' }, take:100 });
  res.json({ success:true, data: logs });
});

// === SEQUENCES ===
app.get('/api/sequences', async (req,res)=>{ const s=await prisma.sequence.findMany({ include:{ steps:{ orderBy:{ stepIndex:'asc' }}, _count:{ select:{ enrollments:true }}} , orderBy:{ createdAt:'desc' }}); res.json({ success:true, data:s }); });
app.post('/api/sequences', async (req,res)=>{
  const { name, campaignId, steps } = req.body;
  // steps: [{ channel, delayDays, delayHours, subject, body }]
  const seq=await prisma.sequence.create({ data:{ name, campaignId, status:'ACTIVE' }});
  for(let i=0;i<steps.length;i++){
    const st=steps[i];
    await prisma.sequenceStep.create({ data:{ sequenceId: seq.id, stepIndex:i, channel: st.channel||'EMAIL', delayDays: st.delayDays||0, delayHours: st.delayHours||0, subject: st.subject, body: st.body, templateId: st.templateId }});
  }
  const full=await prisma.sequence.findUnique({ where:{ id: seq.id }, include:{ steps:true }});
  res.json({ success:true, data: full });
});
app.post('/api/sequences/:id/enroll', async (req,res)=>{
  const { leadIds } = req.body;
  const result=await enrollLeads({ sequenceId: req.params.id, leadIds });
  res.json({ success:true, data: result });
});
app.get('/api/sequences/:id/enrollments', async (req,res)=>{
  const enrolls=await prisma.sequenceEnrollment.findMany({ where:{ sequenceId: req.params.id }, include:{ lead:true }, orderBy:{ createdAt:'desc' }});
  res.json({ success:true, data: enrolls });
});
app.post('/api/sequences/process', async (req,res)=>{
  await processDueSequences();
  res.json({ success:true, message:'Processed due sequences' });
});

// === SMTP Warmup ===
app.get('/api/warmup/status', async (req,res)=>{
  const status=await checkWarmupLimit();
  const w=await prisma.smtpWarmup.findMany({ orderBy:{ day:'desc' }});
  res.json({ success:true, data:{ current: status, history: w, schedule: WARMUP_SCHEDULE }});
});
app.post('/api/warmup/reset', async (req,res)=>{
  const email=process.env.SMTP_USER;
  if(!email) return res.status(400).json({ success:false, error:'No SMTP_USER' });
  await prisma.smtpWarmup.deleteMany({ where:{ email }});
  res.json({ success:true });
});

app.get('/api/smtp/status', (req,res)=>{ const t=getTransporter(); res.json({ success:true, data:{ configured: !!t, user: process.env.SMTP_USER||null }}); });

// Cron for sequences - runs every 5 minutes
const cron=require('node-cron');
cron.schedule('*/5 * * * *', async ()=>{ try{ await processDueSequences(); }catch(e){ console.error('cron seq failed', e.message); } });

app.listen(PORT, ()=>console.log(`LeadForge v2.1 SOLID + Sequences + CSV Import + Warmup running on http://localhost:${PORT}`));
