
require('dotenv').config();
const express=require('express');
const cors=require('cors');
const { PrismaClient } = require('@prisma/client');
const { runCampaign } = require('./services/jobRunner');
const { sendEmail, renderTemplate, getTransporter } = require('./services/emailService');

const prisma=new PrismaClient();
const app=express();
app.use(cors());
app.use(express.json({ limit:'10mb' }));
app.use(express.static('public'));

const PORT=process.env.PORT||3000;

// Health
app.get('/api/health', (req,res)=>res.json({ success:true, message:'LeadForge v2 - Solid 1000+ leads + Outreach' }));

// Campaigns
app.post('/api/campaigns', async (req,res)=>{
  const { name, industry, country, city, keywords=[], targetCount=1000 } = req.body;
  if(!name) return res.status(400).json({ success:false, error:'name required' });
  const c=await prisma.campaign.create({ data:{ name, industry, country, city, keywords, targetCount: parseInt(targetCount)||1000, status:'DRAFT' }});
  res.json({ success:true, data:c });
});
app.get('/api/campaigns', async (req,res)=>{ const campaigns=await prisma.campaign.findMany({ orderBy:{ createdAt:'desc' }}); res.json({ success:true, data:campaigns }); });
app.get('/api/campaigns/:id', async (req,res)=>{
  const c=await prisma.campaign.findUnique({ where:{ id:req.params.id }, include:{ _count:{ select:{ leads:true, outreachLogs:true }}}});
  if(!c) return res.status(404).json({ success:false, error:'Not found' });
  res.json({ success:true, data:c });
});
app.post('/api/campaigns/:id/start', async (req,res)=>{
  const campaign=await prisma.campaign.findUnique({ where:{ id:req.params.id }});
  if(!campaign) return res.status(404).json({ success:false, error:'Not found' });
  const job=await prisma.job.create({ data:{ campaignId:campaign.id, status:'QUEUED', stage:'DISCOVERY', batchSize:50 }});
  await prisma.campaign.update({ where:{ id:campaign.id }, data:{ status:'QUEUED', currentStage:'QUEUED' }});
  setTimeout(()=>runCampaign(job.id), 500);
  res.json({ success:true, data:{ jobId:job.id, status:'QUEUED', message:`Target ${campaign.targetCount} leads - enhanced multi-source discovery + contact-page enrichment. Batch 50.` }});
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
    const csv=stringify(leads.map(l=>({ Company:l.companyName, Industry:l.industry, Country:l.country, City:l.city, Email:l.email, EmailStatus:l.emailStatus, Phone:l.phoneNormalized, WhatsApp:l.whatsappNormalized||l.whatsappUrl, Website:l.website, LinkedIn:l.linkedinUrl, Facebook:l.facebookUrl, Instagram:l.instagramUrl, LeadScore:l.leadScore, Source:l.source, SourceUrl:l.sourceUrl })),{ header:true });
    res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=leads.csv'); return res.send(csv);
  }
  return res.json(leads);
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

// === TEMPLATES ===
app.get('/api/templates/email', async (req,res)=>{ const t=await prisma.emailTemplate.findMany({ orderBy:{ createdAt:'desc' }}); res.json({ success:true, data:t }); });
app.post('/api/templates/email', async (req,res)=>{ const t=await prisma.emailTemplate.create({ data:req.body }); res.json({ success:true, data:t }); });
app.delete('/api/templates/email/:id', async (req,res)=>{ await prisma.emailTemplate.delete({ where:{ id:req.params.id }}); res.json({ success:true }); });

app.get('/api/templates/whatsapp', async (req,res)=>{ const t=await prisma.whatsAppTemplate.findMany({ orderBy:{ createdAt:'desc' }}); res.json({ success:true, data:t }); });
app.post('/api/templates/whatsapp', async (req,res)=>{ const t=await prisma.whatsAppTemplate.create({ data:req.body }); res.json({ success:true, data:t }); });

// === OUTREACH ===

// Send single email inside dashboard
app.post('/api/outreach/email/send', async (req,res)=>{
  const { leadId, templateId, subject, body, campaignId } = req.body;
  const lead=await prisma.lead.findUnique({ where:{ id:leadId }});
  if(!lead || !lead.email) return res.status(400).json({ success:false, error:'Lead has no email' });
  try{
    const renderedSubject = subject || 'Hello {{companyName}}';
    const renderedBody = body || 'Hi {{companyName}},\n\nWe found your business in {{city}}...';
    const info=await sendEmail({ to: lead.email, subject: renderedSubject, body: renderedBody, lead });
    const log=await prisma.outreachLog.create({ data:{ leadId, campaignId: campaignId||lead.campaignId, channel:'EMAIL', templateId, subject: renderTemplate(renderedSubject, lead), message: renderTemplate(renderedBody, lead), status:'SENT', sentAt:new Date() }});
    res.json({ success:true, data:{ log, messageId: info.messageId }});
  }catch(e){ 
    await prisma.outreachLog.create({ data:{ leadId, campaignId: campaignId||lead.campaignId, channel:'EMAIL', subject, message: body, status:'FAILED', error: String(e.message) }});
    res.status(500).json({ success:false, error:String(e.message) }); 
  }
});

// Bulk email
app.post('/api/outreach/email/bulk', async (req,res)=>{
  const { leadIds, templateId, subject, body, campaignId } = req.body;
  if(!leadIds || leadIds.length===0) return res.status(400).json({ success:false, error:'No leads' });
  const leads=await prisma.lead.findMany({ where:{ id:{ in: leadIds }, email:{ not:null }}});
  let sent=0, failed=0;
  for(const lead of leads){
    try{ await sendEmail({ to: lead.email, subject, body, lead }); await prisma.outreachLog.create({ data:{ leadId: lead.id, campaignId: campaignId||lead.campaignId, channel:'EMAIL', templateId, subject: renderTemplate(subject, lead), message: renderTemplate(body, lead), status:'SENT', sentAt:new Date() }}); sent++; await new Promise(r=>setTimeout(r, 1500)); }catch(e){ failed++; await prisma.outreachLog.create({ data:{ leadId: lead.id, campaignId: campaignId||lead.campaignId, channel:'EMAIL', status:'FAILED', error:String(e.message) }}); }
  }
  res.json({ success:true, data:{ sent, failed, total: leads.length }});
});

// WhatsApp - generate wa.me links and log outreach (compliant - no spam API)
app.post('/api/outreach/whatsapp/generate', async (req,res)=>{
  const { leadIds, templateId, message, campaignId } = req.body;
  const leads=await prisma.lead.findMany({ where:{ id:{ in: leadIds }}});
  const results=leads.map(lead=>{
    const phone=lead.whatsappNormalized || lead.phoneNormalized || lead.whatsappRaw || lead.phoneRaw;
    if(!phone) return { leadId: lead.id, error:'No phone/WhatsApp' };
    const clean=phone.replace(/\D/g,'');
    const rendered=renderTemplate(message||'Hi {{companyName}}! Found your business in {{city}}', lead);
    const waUrl=`https://wa.me/${clean}?text=${encodeURIComponent(rendered)}`;
    return { leadId: lead.id, company: lead.companyName, phone: clean, message: rendered, waUrl };
  });
  // Log
  for(const r of results){
    if(!r.error) await prisma.outreachLog.create({ data:{ leadId: r.leadId, campaignId: campaignId, channel:'WHATSAPP', templateId, message: r.message, status:'SENT', sentAt:new Date() }});
  }
  res.json({ success:true, data: results });
});

app.get('/api/outreach/logs', async (req,res)=>{
  const { campaignId, channel }=req.query;
  const where={};
  if(campaignId) where.campaignId=campaignId;
  if(channel) where.channel=channel;
  const logs=await prisma.outreachLog.findMany({ where, include:{ lead:true }, orderBy:{ createdAt:'desc' }, take:100 });
  res.json({ success:true, data: logs });
});

app.get('/api/smtp/status', (req,res)=>{
  const transporter=getTransporter();
  res.json({ success:true, data:{ configured: !!transporter, user: process.env.SMTP_USER||null }});
});

app.listen(PORT, ()=>console.log(`LeadForge v2 SOLID running on http://localhost:${PORT} - Enhanced discovery + Email & WhatsApp outreach inside dashboard`));
