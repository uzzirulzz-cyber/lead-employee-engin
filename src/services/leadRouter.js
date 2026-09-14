
const { PrismaClient } = require('@prisma/client');
const prisma=new PrismaClient();
async function getSeats(){
  let seats=await prisma.seat.findMany({ orderBy:{ seatNumber:'asc' }, include:{ user:true, _count:{ select:{ leads:true }}}});
  if(seats.length===0){
    for(let i=1;i<=4;i++){ await prisma.seat.create({ data:{ seatNumber:i, name:`Seat ${['One','Two','Three','Four'][i-1]}`, status:'AVAILABLE', maxLeads:250 }}); }
    seats=await prisma.seat.findMany({ orderBy:{ seatNumber:'asc' }, include:{ user:true, _count:{ select:{ leads:true }}}});
  }
  return seats;
}
async function routeLeads({ campaignId, strategy='round_robin', channel=null, assignedById }){
  const leads=await prisma.lead.findMany({ where:{ campaignId, assignedToId:null }, orderBy:{ leadScore:'desc' }});
  const seats=await getSeats();
  const availableSeats=seats.filter(s=>s.user && s.user.isActive);
  if(availableSeats.length===0) throw new Error('No employees assigned to seats. Super Admin must create employees and assign to seats first.');
  let assignments=[];
  if(strategy==='round_robin'){
    let idx=0;
    for(const lead of leads){
      const seat=availableSeats[idx % availableSeats.length];
      await prisma.lead.update({ where:{ id: lead.id }, data:{ assignedToId: seat.user.id, assignedSeatId: seat.id }});
      await prisma.leadAssignment.create({ data:{ leadId: lead.id, userId: seat.user.id, seatId: seat.id, campaignId, channel: channel||null, assignedById }});
      assignments.push({ leadId: lead.id, seat: seat.seatNumber, employee: seat.user.name });
      idx++;
    }
  } else if(strategy==='channel_split'){
    for(const lead of leads){
      let targetSeat;
      if(lead.whatsappDetected) targetSeat=availableSeats.find(s=>s.seatNumber===3) || availableSeats[2];
      else if(lead.email) targetSeat=availableSeats.find(s=>s.seatNumber===1) || availableSeats[0];
      else if(lead.phoneRaw) targetSeat=availableSeats.find(s=>s.seatNumber===4) || availableSeats[3];
      else targetSeat=availableSeats[0];
      await prisma.lead.update({ where:{ id: lead.id }, data:{ assignedToId: targetSeat.user.id, assignedSeatId: targetSeat.id }});
      await prisma.leadAssignment.create({ data:{ leadId: lead.id, userId: targetSeat.user.id, seatId: targetSeat.id, campaignId, channel, assignedById }});
      assignments.push({ leadId: lead.id, seat: targetSeat.seatNumber, employee: targetSeat.user.name });
    }
  } else {
    let idx=0;
    for(const lead of leads){
      const seat=availableSeats[idx % availableSeats.length];
      await prisma.lead.update({ where:{ id: lead.id }, data:{ assignedToId: seat.user.id, assignedSeatId: seat.id }});
      await prisma.leadAssignment.create({ data:{ leadId: lead.id, userId: seat.user.id, seatId: seat.id, campaignId, channel, assignedById }});
      assignments.push({ leadId: lead.id, seat: seat.seatNumber, employee: seat.user.name });
      idx++;
    }
  }
  return { total: assignments.length, assignments, seats: availableSeats.map(s=>({ seatNumber:s.seatNumber, name:s.name, employee:s.user.name, employeeId:s.user.id, maxLeads:s.maxLeads })) };
}
async function assignSingleLead({ leadId, userId, seatId, assignedById, channel }){
  const seat=seatId? await prisma.seat.findUnique({ where:{ id: seatId }, include:{ user:true }}):null;
  const targetUserId=userId || seat?.user?.id;
  if(!targetUserId) throw new Error('No user found for seat');
  await prisma.lead.update({ where:{ id: leadId }, data:{ assignedToId: targetUserId, assignedSeatId: seatId }});
  const assignment=await prisma.leadAssignment.create({ data:{ leadId, userId: targetUserId, seatId, assignedById, channel }});
  return assignment;
}
module.exports={ getSeats, routeLeads, assignSingleLead };
