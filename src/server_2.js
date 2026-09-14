
require('dotenv').config();
const express=require('express');
const cors=require('cors');
const http=require('http');
const { Server }=require('socket.io');
const bcrypt=require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { runCampaign } = require('./services/jobRunner');
const { sendEmail, renderTemplate, getTransporter } = require('./services/emailService');
const { enrollLeads, processDueSequences } = require('./services/sequenceService');
const { checkWarmupLimit, importCsvLeads, WARMUP_SCHEDULE } = require('./services/warmupService');
const { getProvider, answerCall, hangupCall } = require('./services/callService');
const { signToken, authMiddleware, requireRole } = require('./middleware/auth');
const { getSeats, routeLeads, assignSingleLead } = require('./services/leadRouter');

const prisma=new PrismaClient();
const app=express();
const server=http.createServer(app);
const io=new Server(server, { cors:{ origin:'*' } });

app.use(cors());
app.use(express.json({ limit:'20mb' }));
app.use(express.static('public'));
app.use(express.urlencoded({ extended:true }));

const PORT=process.env.PORT||3000;

io.on('connection', (socket)=>{
  socket.on('join', ({ userId, seatNumber })=>{ socket.join(`user:${userId}`); socket.join(`seat:${seatNumber}`); socket.join('all'); });
  socket.on('call:signal', ({ to, data })=>{ io.to(`user:${to}`).emit('call:signal', { from: socket.id, data }); });
  socket.on('call:answer', async ({ callLogId })=>{ await answerCall(callLogId); io.emit('call:answered', { callLogId }); });
  socket.on('call:hangup', async ({ callLogId })=>{ const r=await hangupCall(callLogId); io.emit('call:ended', { callLogId, duration: r.duration }); });
});

app.get('/api/health', (req,res)=>res.json({ success:true, message:'PLAYBEAT LEADPULSE v3 - Super Admin + Seats + Router + Calling + Email + WhatsApp' }));

app.post('/api/auth/login', async (req,res)=>{
  const { email, password }=req.body;
  const user=await prisma.user.findUnique({ where:{ email }});
  if(!user) return res.status(401).json({ success:false, error:'Invalid credentials' });
  const valid=await bcrypt.compare(password, user.passwordHash);
  if(!valid) return res.status(401).json({ success:false, error:'Invalid credentials' });
  if(!user.isActive) return res.status(403).json({ success:false, error:'Account disabled' });
  const token=signToken(user);
  res.json({ success:true, data:{ token, user:{ id:user.id, email:user.email, name:user.name, role:user.role, seatId:user.seatId }}});
});

app.post('/api/auth/setup-super-admin', async (req,res)=>{
  const existing=await prisma.user.findFirst({ where:{ role:'SUPER_ADMIN' }});
  if(existing) return res.status(400).json({ success:false, error:'Super Admin already exists. Use login.' });
  const { email, password, name }=req.body;
  if(!email || !password) return res.status(400).json({ success:false, error:'email and password required' });
  const hash=await bcrypt.hash(password, 10);
  const user=await prisma.user.create({ data:{ email, passwordHash:hash, name:name||'Super Admin', role:'SUPER_ADMIN' }});
  const token=signToken(user);
  res.json({ success:true, data:{ token, user }});
});

app.post('/api/users', authMiddleware, requireRole('SUPER_ADMIN','ADMIN'), async (req,res)=>{
  const { email, password, name, role, seatNumber }=req.body;
  if(!email || !password || !name) return res.status(400).json({ success:false, error:'email, password, name required' });
  const hash=await bcrypt.hash(password, 10);
  let seat=null;
  if(seatNumber){
    seat=await prisma.seat.findUnique({ where:{ seatNumber: parseInt(seatNumber) }});
    if(!seat){ seat=await prisma.seat.create({ data:{ seatNumber: parseInt(seatNumber), name:`Seat ${['One','Two','Three','Four'][parseInt(seatNumber)-1]||seatNumber}`, maxLeads:250 }}); }
  }
  const user=await prisma.user.create({ data:{ email, passwordHash:hash, name, role: role||'EMPLOYEE', seatId: seat?.id, createdById: req.user.id }});
  if(seat){ await prisma.seat.update({ where:{ id: seat.id }, data:{ user:{ connect:{ id: user.id } } }}); }
  res.json({ success:true, data:user });
});

app.get('/api/users', authMiddleware, requireRole('SUPER_ADMIN','ADMIN'), async (req,res)=>{
  const users=await prisma.user.findMany({ include:{ seat:true }, orderBy:{ createdAt:'desc' }});
  res.json({ success:true, data:users });
});

app.delete('/api/users/:id', authMiddleware, requireRole('SUPER_ADMIN'), async (req,res)=>{
  const user=await prisma.user.findUnique({ where:{ id:req.params.id }});
  if(user?.role==='SUPER_ADMIN') return res.status(400).json({ success:false, error:'Cannot delete Super Admin' });
  await prisma.user.delete({ where:{ id:req.params.id }});
  res.json({ success:true });
});

app.get('/api/seats', authMiddleware, async (req,res)=>{
  const seats=await getSeats();
  res.json({ success:true, data:seats });
});
app.post('/api/seats', authMiddleware, requireRole('SUPER_ADMIN'), async (req,res)=>{
  const { seatNumber, name, maxLeads }=req.body;
  const seat=await prisma.seat.upsert({ where:{ seatNumber: parseInt(seatNumber) }, update:{ name, maxLeads }, create:{ seatNumber: parseInt(seatNumber), name: name||`Seat ${seatNumber}`, maxLeads: maxLeads||250 }});
  res.json({ success:true, data:seat });
});

app.get('/api/landing', async (req,res)=>{
  let page=await prisma.landingPage.findFirst();
  if(!page) page=await prisma.landingPage.create({ data:{ title:'PLAYBEAT LEADPULSE', subtitle:'YOUR WORLD OF LEAD POSSIBILITIES', protected:true, logoUrl:'/logo-playbeat.jpeg', heroImageUrl:'/landing-reference.jpeg' }});
  res.json({ success:true, data:page });
});
app.post('/api/landing', authMiddleware, requireRole('SUPER_ADMIN'), async (req,res)=>{
  const { logoUrl, heroImageUrl, title, subtitle, protected: isProtected }=req.body;
  let page=await prisma.landingPage.findFirst();
  if(!page) page=await prisma.landingPage.create({ data:{ logoUrl, heroImageUrl, title, subtitle, protected: isProtected }});
  else page=await prisma.landingPage.update({ where:{ id: page.id }, data:{ logoUrl, heroImageUrl, title, subtitle, protected: isProtected }});
  res.json({ success:true, data:page });
});

app.post('/api/campaigns', authMiddleware, async (req,res)=>{
  const { name, industry, country, city, keywords=[], targetCount=1000 } = req.body;
  if(!name) return res.status(400).json({ success:false, error:'name required' });
  const c=await prisma.campaign.create({ data:{ name, industry, country, city, keywords, targetCount: parseInt(targetCount)||1000, status:'DRAFT' }});
  res.json({ success:true, data:c });
});
app.get('/api/campaigns', authMiddleware, async (req,res)=>{ const campaigns=await prisma.campaign.findMany({ orderBy:{ createdAt:'desc' }}); res.json({ success:true, data:campaigns }); });
app.get('/api/campaigns/:id', authMiddleware, async (req,res)=>{
  const c=await prisma.campaign.findUnique({ where:{ id:req.params.id }, include:{ _count:{ select:{ leads:true, calls:true }}}});
  if(!c) return res.status(404).json({ success:false, error:'Not found' });
  res.json({ success:true, data:c });
});
app.post('/api/campaigns/:id/start', authMiddleware, async (req,res)=>{
  const campaign=await prisma.campaign.findUnique({ where:{ id:req.params.id }});
  if(!campaign) return res.status(404).json({ success:false, error:'Not found' });
  const job=await prisma.job.create({ data:{ campaignId:campaign.id, status:'QUEUED', stage:'DISCOVERY', batchSize:50 }});
  await prisma.campaign.update({ where:{ id:campaign.id }, data:{ status:'QUEUED', currentStage:'QUEUED' }});
  setTimeout(()=>runCampaign(job.id), 500);
  res.json({ success:true, data:{ jobId:job.id, status:'QUEUED' }});
});

app.get('/api/leads', authMiddleware, async (req,res)=>{
  const { campaignId, search, page=1, limit=50, hasEmail, hasWhatsApp, minScore, assignedTo, seatId, myLeads } = req.query;
  const where={};
  if(campaignId) where.campaignId=campaignId;
  if(search) where.OR=[{ companyName:{ contains:search, mode:'insensitive'}},{ email:{ contains:search, mode:'insensitive'}},{ domain:{ contains:search, mode:'insensitive'}}];
  if(hasEmail==='true') where.email={ not:null };
  if(hasWhatsApp==='true') where.whatsappDetected=true;
  if(minScore) where.leadScore={ gte: parseInt(minScore) };
  if(assignedTo) where.assignedToId=assignedTo;
  if(seatId) where.assignedSeatId=seatId;
  if(myLeads==='true' && req.user.role==='EMPLOYEE') where.assignedToId=req.user.id;
  const skip=(parseInt(page)-1)*parseInt(limit);
  const [leads,total]=await Promise.all([prisma.lead.findMany({ where, orderBy:{ leadScore:'desc' }, skip, take:Math.min(parseInt(limit),100), include:{ assignedTo:true, assignedSeat:true, _count:{ select:{ calls:true }}} }), prisma.lead.count({ where })]);
  res.json({ success:true, data:{ leads, total, page:parseInt(page), totalPages:Math.ceil(total/parseInt(limit)) }});
});

app.post('/api/leads/route', authMiddleware, requireRole('SUPER_ADMIN','ADMIN'), async (req,res)=>{
  const { campaignId, strategy, channel } = req.body;
  if(!campaignId) return res.status(400).json({ success:false, error:'campaignId required' });
  try{
    const result=await routeLeads({ campaignId, strategy: strategy||'round_robin', channel, assignedById: req.user.id });
    io.emit('leads:routed', { campaignId, total: result.total });
    res.json({ success:true, data: result });
  }catch(e){ res.status(500).json({ success:false, error: String(e.message) }); }
});

app.post('/api/leads/:id/assign', authMiddleware, requireRole('SUPER_ADMIN','ADMIN'), async (req,res)=>{
  const { userId, seatId, channel } = req.body;
  try{ const assignment=await assignSingleLead({ leadId: req.params.id, userId, seatId, assignedById: req.user.id, channel }); res.json({ success:true, data: assignment }); }catch(e){ res.status(500).json({ success:false, error: e.message }); }
});

app.post('/api/leads/export', authMiddleware, async (req,res)=>{
  const { format='csv', campaignId } = req.body;
  const where=campaignId?{ campaignId }:{};
  if(req.user.role==='EMPLOYEE') where.assignedToId=req.user.id;
  const leads=await prisma.lead.findMany({ where, take:10000, include:{ assignedTo:true, assignedSeat:true }});
  if(format==='csv'){
    const { stringify } = require('csv-stringify/sync');
    const csv=stringify(leads.map(l=>({ Company:l.companyName, Industry:l.industry, Email:l.email, Phone:l.phoneNormalized, WhatsApp:l.whatsappNormalized||l.whatsappUrl, Website:l.website, Score:l.leadScore, AssignedTo:l.assignedTo?.name||'', Seat:l.assignedSeat?.name||'', City:l.city })),{ header:true });
    res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=leads.csv'); return res.send(csv);
  }
  return res.json(leads);
});

app.post('/api/leads/import', authMiddleware, async (req,res)=>{
  const { campaignId, csvText } = req.body;
  if(!csvText) return res.status(400).json({ success:false, error:'csvText required' });
  const lines = csvText.split('\n').filter(l=>l.trim());
  const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
  const rows = lines.slice(1).map(line=>{ const vals=line.split(',').map(v=>v.trim()); const obj={}; headers.forEach((h,i)=> obj[h]=vals[i]); return obj; });
  const result = await importCsvLeads({ campaignId, rows });
  res.json({ success:true, data: result });
});

app.get('/api/stats', authMiddleware, async (req,res)=>{
  const baseWhere = req.user.role==='EMPLOYEE' ? { assignedToId: req.user.id } : {};
  const [total, verified, whatsapp, phone, today, calls]=await Promise.all([
    prisma.lead.count({ where: baseWhere }),
    prisma.lead.count({ where:{ ...baseWhere, emailStatus:'VALID' }}),
    prisma.lead.count({ where:{ ...baseWhere, whatsappDetected:true }}),
    prisma.lead.count({ where:{ ...baseWhere, phoneRaw:{ not:null }}}),
    prisma.lead.count({ where:{ ...baseWhere, createdAt:{ gte:new Date(new Date().setHours(0,0,0,0)) }}}),
    prisma.callLog.count({ where: req.user.role==='EMPLOYEE' ? { userId: req.user.id } : {} }),
  ]);
  const seats=await prisma.seat.findMany({ include:{ _count:{ select:{ leads:true }}, user:true }});
  res.json({ success:true, data:{ total, verified, whatsapp, phone, today, calls, seats }});
});

app.post('/api/outreach/email/send', authMiddleware, async (req,res)=>{
  const { leadId, subject, body, campaignId } = req.body;
  const lead=await prisma.lead.findUnique({ where:{ id:leadId }});
  if(!lead || !lead.email) return res.status(400).json({ success:false, error:'Lead has no email' });
  if(req.user.role==='EMPLOYEE' && lead.assignedToId!==req.user.id) return res.status(403).json({ success:false, error:'Not assigned to you' });
  try{
    const info=await sendEmail({ to: lead.email, subject, body, lead });
    const log=await prisma.outreachLog.create({ data:{ leadId, campaignId: campaignId||lead.campaignId, userId: req.user.id, channel:'EMAIL', subject: renderTemplate(subject, lead), message: renderTemplate(body, lead), status:'SENT', sentAt:new Date() }});
    const { incrementWarmup } = require('./services/warmupService'); await incrementWarmup();
    res.json({ success:true, data:{ log, messageId: info.messageId }});
  }catch(e){ await prisma.outreachLog.create({ data:{ leadId, campaignId, userId: req.user.id, channel:'EMAIL', status:'FAILED', error: String(e.message) }}); res.status(500).json({ success:false, error:String(e.message) }); }
});

app.post('/api/outreach/email/bulk', authMiddleware, async (req,res)=>{
  const { leadIds, subject, body, campaignId } = req.body;
  let where={ id:{ in: leadIds }, email:{ not:null }};
  if(req.user.role==='EMPLOYEE') where.assignedToId=req.user.id;
  const leads=await prisma.lead.findMany({ where });
  let sent=0, failed=0;
  for(const lead of leads){
    const limit = await checkWarmupLimit();
    if(!limit.allowed){ failed+= (leads.length - sent); break; }
    try{ await sendEmail({ to: lead.email, subject, body, lead }); await prisma.outreachLog.create({ data:{ leadId: lead.id, campaignId: campaignId||lead.campaignId, userId: req.user.id, channel:'EMAIL', subject: renderTemplate(subject, lead), message: renderTemplate(body, lead), status:'SENT', sentAt:new Date() }}); const { incrementWarmup } = require('./services/warmupService'); await incrementWarmup(); sent++; await new Promise(r=>setTimeout(r, 1500)); }catch(e){ failed++; }
  }
  res.json({ success:true, data:{ sent, failed, total: leads.length }});
});

app.post('/api/outreach/whatsapp/generate', authMiddleware, async (req,res)=>{
  const { leadIds, message, campaignId } = req.body;
  let where={ id:{ in: leadIds }};
  if(req.user.role==='EMPLOYEE') where.assignedToId=req.user.id;
  const leads=await prisma.lead.findMany({ where });
  const results=leads.map(lead=>{
    const phone=lead.whatsappNormalized || lead.phoneNormalized || lead.whatsappRaw || lead.phoneRaw;
    if(!phone) return { leadId: lead.id, error:'No phone' };
    const clean=phone.replace(/\D/g,'');
    const rendered=renderTemplate(message||'Hi {{companyName}}!', lead);
    return { leadId: lead.id, company: lead.companyName, phone: clean, message: rendered, waUrl:`https://wa.me/${clean}?text=${encodeURIComponent(rendered)}` };
  });
  for(const r of results){ if(!r.error) await prisma.outreachLog.create({ data:{ leadId: r.leadId, campaignId, userId: req.user.id, channel:'WHATSAPP', message: r.message, status:'SENT', sentAt:new Date() }}); }
  res.json({ success:true, data: results });
});

app.get('/api/outreach/logs', authMiddleware, async (req,res)=>{
  const { campaignId, channel }=req.query;
  const where={}; if(campaignId) where.campaignId=campaignId; if(channel) where.channel=channel;
  if(req.user.role==='EMPLOYEE') where.userId=req.user.id;
  const logs=await prisma.outreachLog.findMany({ where, include:{ lead:true, user:true }, orderBy:{ createdAt:'desc' }, take:100 });
  res.json({ success:true, data: logs });
});

app.get('/api/sequences', authMiddleware, async (req,res)=>{ const s=await prisma.sequence.findMany({ include:{ steps:{ orderBy:{ stepIndex:'asc' }}, _count:{ select:{ enrollments:true }}} , orderBy:{ createdAt:'desc' }}); res.json({ success:true, data:s }); });
app.post('/api/sequences', authMiddleware, async (req,res)=>{
  const { name, campaignId, steps } = req.body;
  const seq=await prisma.sequence.create({ data:{ name, campaignId, status:'ACTIVE' }});
  for(let i=0;i<steps.length;i++){ const st=steps[i]; await prisma.sequenceStep.create({ data:{ sequenceId: seq.id, stepIndex:i, channel: st.channel||'EMAIL', delayDays: st.delayDays||0, delayHours: st.delayHours||0, subject: st.subject, body: st.body }}); }
  const full=await prisma.sequence.findUnique({ where:{ id: seq.id }, include:{ steps:true }});
  res.json({ success:true, data: full });
});
app.post('/api/sequences/:id/enroll', authMiddleware, async (req,res)=>{ const { leadIds } = req.body; const result=await enrollLeads({ sequenceId: req.params.id, leadIds }); res.json({ success:true, data: result }); });

app.get('/api/calls', authMiddleware, async (req,res)=>{
  const { campaignId, leadId }=req.query;
  const where={}; if(campaignId) where.campaignId=campaignId; if(leadId) where.leadId=leadId;
  if(req.user.role==='EMPLOYEE') where.userId=req.user.id;
  const calls=await prisma.callLog.findMany({ where, include:{ lead:true, user:true }, orderBy:{ createdAt:'desc' }, take:100 });
  res.json({ success:true, data: calls });
});
app.post('/api/calls/make', authMiddleware, async (req,res)=>{
  const { to, leadId, campaignId, from } = req.body;
  let phone=to; let finalLeadId=leadId; let finalCampaignId=campaignId;
  if(leadId && !phone){
    const lead=await prisma.lead.findUnique({ where:{ id: leadId }});
    if(!lead) return res.status(404).json({ success:false, error:'Lead not found' });
    if(req.user.role==='EMPLOYEE' && lead.assignedToId!==req.user.id) return res.status(403).json({ success:false, error:'Lead not assigned to you' });
    phone=lead.phoneNormalized||lead.phoneRaw||lead.whatsappNormalized;
    if(!phone) return res.status(400).json({ success:false, error:'Lead has no phone' });
    finalCampaignId=lead.campaignId;
  }
  try{
    const provider=getProvider();
    const result=await provider.makeCall({ from, to: phone, leadId: finalLeadId, campaignId: finalCampaignId });
    await prisma.callLog.update({ where:{ id: result.callLogId }, data:{ userId: req.user.id }});
    io.emit('call:initiated', { callLogId: result.callLogId, to: phone, leadId: finalLeadId, status:'RINGING', userId: req.user.id });
    res.json({ success:true, data: result });
  }catch(e){ res.status(500).json({ success:false, error: String(e.message) }); }
});
app.post('/api/calls/:id/answer', authMiddleware, async (req,res)=>{ try{ const r=await answerCall(req.params.id); io.emit('call:answered', { callLogId: req.params.id }); res.json({ success:true, data:r }); }catch(e){ res.status(500).json({ success:false, error:e.message }); }});
app.post('/api/calls/:id/hangup', authMiddleware, async (req,res)=>{ try{ const r=await hangupCall(req.params.id); io.emit('call:ended', { callLogId: req.params.id, duration: r.duration }); res.json({ success:true, data:r }); }catch(e){ res.status(500).json({ success:false, error:e.message }); }});
app.get('/api/calls/provider/status', (req,res)=>{ const provider=getProvider(); res.json({ success:true, data:{ provider: provider.name, mode: provider.name==='twilio'?'PSTN real calls via Twilio':'Mock/WebRTC free mode' }}); });

app.get('/api/warmup/status', authMiddleware, async (req,res)=>{ const status=await checkWarmupLimit(); const w=await prisma.smtpWarmup.findMany({ orderBy:{ day:'desc' }}); res.json({ success:true, data:{ current: status, history: w, schedule: WARMUP_SCHEDULE }}); });
app.get('/api/smtp/status', (req,res)=>{ const t=getTransporter(); res.json({ success:true, data:{ configured: !!t, user: process.env.SMTP_USER||null }}); });

const cron=require('node-cron');
cron.schedule('*/5 * * * *', async ()=>{ try{ await processDueSequences(); }catch(e){ console.error('cron seq', e.message); } });

server.listen(PORT, ()=>console.log(`PLAYBEAT LEADPULSE v3 - Super Admin + Seats + Router running on http://localhost:${PORT}`));
