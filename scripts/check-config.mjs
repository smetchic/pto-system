import config from '../deployment.json' with {type:'json'};
import { loadEnv } from 'vite';
const env={...loadEnv('production',process.cwd(),''),...process.env};
env.VITE_SUPABASE_URL ||= config.supabaseUrl;
env.VITE_SUPABASE_PUBLISHABLE_KEY ||= config.supabasePublishableKey;
if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.VITE_SUPABASE_URL||''))throw Error('Set VITE_SUPABASE_URL to the dedicated Supabase project.');
const key=env.VITE_SUPABASE_PUBLISHABLE_KEY||'';
if(!key.startsWith('sb_publishable_'))throw Error('Use a publishable Supabase key, never a service_role or secret key.');
