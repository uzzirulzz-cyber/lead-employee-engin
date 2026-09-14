
const jwt=require('jsonwebtoken');
const JWT_SECRET=process.env.JWT_SECRET||'leadforge-super-secret-change-me';
function signToken(user){ return jwt.sign({ id:user.id, email:user.email, role:user.role, seatId:user.seatId }, JWT_SECRET, { expiresIn:'7d' }); }
function authMiddleware(req,res,next){
  const header=req.headers.authorization;
  if(!header) return res.status(401).json({ success:false, error:'No token' });
  const token=header.replace('Bearer ','');
  try{ const decoded=jwt.verify(token, JWT_SECRET); req.user=decoded; next(); }catch(e){ return res.status(401).json({ success:false, error:'Invalid token' }); }
}
function requireRole(...roles){ return (req,res,next)=>{ if(!req.user) return res.status(401).json({ success:false, error:'No user' }); if(!roles.includes(req.user.role)) return res.status(403).json({ success:false, error:'Forbidden - requires '+roles.join('/') }); next(); }; }
module.exports={ signToken, authMiddleware, requireRole, JWT_SECRET };
