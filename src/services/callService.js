
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
class TwilioAdapter {
  constructor(){ this.name='twilio'; this.accountSid=process.env.TWILIO_ACCOUNT_SID; this.authToken=process.env.TWILIO_AUTH_TOKEN; this.fromNumber=process.env.TWILIO_FROM_NUMBER; }
  isConfigured(){ return !!(this.accountSid && this.authToken && this.fromNumber); }
  async makeCall({ from, to, leadId, campaignId }){
    if(!this.isConfigured()) throw new Error('Twilio not configured. Set TWILIO_ACCOUNT_SID, AUTH_TOKEN, FROM_NUMBER');
    const twilio=require('twilio')(this.accountSid, this.authToken);
    const log=await prisma.callLog.create({ data:{ leadId, campaignId, direction:'OUTBOUND', fromNumber: from||this.fromNumber, toNumber: to, status:'INITIATED', provider:'twilio' }});
    try{
      const call=await twilio.calls.create({ from: from||this.fromNumber, to, url: `${process.env.PUBLIC_URL||'http://localhost:3000'}/api/calls/twiml?callLogId=${log.id}`, statusCallback: `${process.env.PUBLIC_URL||'http://localhost:3000'}/api/calls/status?callLogId=${log.id}`, statusCallbackEvent:['initiated','ringing','answered','completed'], statusCallbackMethod:'POST' });
      await prisma.callLog.update({ where:{ id: log.id }, data:{ providerCallId: call.sid, status:'RINGING' }});
      return { callLogId: log.id, providerCallId: call.sid, status:'RINGING' };
    }catch(e){ await prisma.callLog.update({ where:{ id: log.id }, data:{ status:'FAILED', notes: e.message }}); throw e; }
  }
}
class WebRTCAdapter {
  constructor(){ this.name='webrtc'; }
  async makeCall({ from, to, leadId, campaignId }){
    const log=await prisma.callLog.create({ data:{ leadId, campaignId, direction:'OUTBOUND', fromNumber: from||'webrtc_user', toNumber: to, status:'RINGING', provider:'webrtc' }});
    return { callLogId: log.id, status:'RINGING', provider:'webrtc', webrtc:true };
  }
}
class MockAdapter {
  constructor(){ this.name='mock'; }
  async makeCall({ from, to, leadId, campaignId }){
    const log=await prisma.callLog.create({ data:{ leadId, campaignId, direction:'OUTBOUND', fromNumber: from||'+10000000000', toNumber: to, status:'RINGING', provider:'mock' }});
    setTimeout(async ()=>{ await prisma.callLog.update({ where:{ id: log.id }, data:{ status:'IN_PROGRESS', answeredAt: new Date() }}); }, 2000);
    setTimeout(async ()=>{ await prisma.callLog.update({ where:{ id: log.id }, data:{ status:'COMPLETED', endedAt: new Date(), duration: 12 }}); }, 14000);
    return { callLogId: log.id, status:'RINGING', provider:'mock' };
  }
}
function getProvider(){
  const twilio=new TwilioAdapter();
  if(twilio.isConfigured()) return twilio;
  if(process.env.CALL_PROVIDER==='webrtc') return new WebRTCAdapter();
  return new MockAdapter();
}
async function answerCall(callLogId){ await prisma.callLog.update({ where:{ id: callLogId }, data:{ status:'IN_PROGRESS', answeredAt: new Date() }}); return { success:true }; }
async function hangupCall(callLogId){
  const log=await prisma.callLog.findUnique({ where:{ id: callLogId }});
  if(!log) throw new Error('Call not found');
  const duration = log.answeredAt ? Math.floor((new Date() - new Date(log.answeredAt))/1000) : 0;
  await prisma.callLog.update({ where:{ id: callLogId }, data:{ status:'COMPLETED', endedAt: new Date(), duration }});
  if(log.leadId){ await prisma.lead.update({ where:{ id: log.leadId }, data:{ lastContactedAt: new Date() }}); }
  return { success:true, duration };
}
module.exports={ TwilioAdapter, WebRTCAdapter, MockAdapter, getProvider, answerCall, hangupCall };
