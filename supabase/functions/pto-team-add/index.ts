// Добавление сотрудника в «Команда и права»: учётную запись создаёт только начальник ПТО.
// Создаётся вход по почте и временному паролю (почта подтверждена, письмо не отправляется); имя, роль, активность
// и объект задаёт затем приложение обычными командами pto_command (op profile и member). Пароль сотрудник меняет в «Настройках».
import {createClient} from 'npm:@supabase/supabase-js@2.45.4';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Метод не поддерживается'},405);
 try{
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  const {data:{user},error:authError}=await admin.auth.getUser(token);
  if(authError||!user)return json({error:'Требуется вход'},401);
  const {data:me}=await admin.from('pto_profiles').select('role,active').eq('id',user.id).maybeSingle();
  if(me?.role!=='head'||!me.active)return json({error:'Добавлять сотрудников может начальник ПТО'},403);

  const body=await req.json().catch(()=>({}));
  const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''),name=String(body.display_name||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'Укажите электронную почту'},400);
  if(password.length<8)return json({error:'Временный пароль — не короче 8 символов'},400);
  if(name.length<1||name.length>120)return json({error:'Укажите имя'},400);

  const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:name}});
  if(error)return json({error:/already|registered|exists/i.test(error.message)?'Сотрудник с такой почтой уже есть':error.message},400);
  return json({user_id:data.user.id});
 }catch(err){
  return json({error:String((err as Error)?.message||err)},500);
 }
});
