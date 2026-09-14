
function validateSyntax(email){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()); }
function validateEmail(email){
 const e=email.toLowerCase().trim();
 if(!validateSyntax(e)) return { status:'INVALID', confidence:0 };
 const [local, domain]=e.split('@');
 const disposable=new Set(['tempmail.com','mailinator.com']).has(domain);
 const role=new Set(['info','admin','support','sales','contact']).has(local);
 let status='VALID';
 if(disposable) status='DISPOSABLE';
 else if(role) status='ROLE_ACCOUNT';
 return { status, confidence: status==='VALID'?90:60, syntax:true, disposable, role };
}
module.exports={ validateSyntax, validateEmail };
